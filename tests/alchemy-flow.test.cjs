const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../shared/alchemy-core.js');

function app() {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', hidden: false, disabled: false,
            querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {} });
        return elements.get(id);
    };
    const context = vm.createContext({
        window: { AlphaCityAlchemyCore: core },
        document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} },
        console, setTimeout: () => 1, clearTimeout() {}, AbortController,
    });
    const source = fs.readFileSync(path.join(__dirname, '../alchemy/app-source.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
    vm.runInContext(source + '\n globalThis.app = { state, fetchMetadata, quoteHolding, quoteSelectedHolding, renderHoldings, renderSummary, handleTargetChange, scanWallet, prepareAlchemy, executeAlchemy };', context);
    return { ...context.app, element, window: context.window, context };
}

test('quotes LOFI and skips output routes for holdings at or below one cent', async () => {
    const a = app();
    a.state.target = { ...core.TARGETS.LOFI, decimals: 9 };
    const calls = [];
    const router = { async getCompleteTradeRouteGivenAmountIn(args) {
        calls.push(args);
        return { coinOut: { amount: 123_456_789n } };
    } };
    const dust = { coinType: core.USDC_TYPE, totalBalance: '10001', metadata: { decimals: 6 } };
    const quoted = await a.quoteHolding(dust, router);
    assert.equal(calls[0].coinOutType, core.LOFI_TYPE);
    assert.equal(core.classifyHolding(quoted, a.state.target).eligible, true);
    await a.quoteSelectedHolding(dust, router);
    assert.equal(calls[1].coinOutType, core.LOFI_TYPE);
    calls.length = 0;
    await a.quoteHolding({ ...dust, totalBalance: '10000' }, router);
    assert.equal(calls.length, 0);
});

test('target switching clears selections and prepared transactions', () => {
    const a = app();
    assert.equal(a.state.target.symbol, 'CITY');
    a.state.prepared = { tx: {} };
    a.state.selected.add('dust');
    a.state.holdings = [{ usdMicros: 10_001n }];
    a.element('target-token').value = 'LOFI';
    a.handleTargetChange();
    assert.equal(a.state.target.coinType, core.LOFI_TYPE);
    assert.equal(a.state.prepared, null);
    assert.equal(a.state.selected.size, 0);
    assert.equal(a.state.holdings.length, 0);
    assert.equal(a.element('confirm-button').disabled, true);
    a.state.preparing = true;
    a.element('target-token').value = 'CITY';
    a.handleTargetChange();
    assert.equal(a.state.target.symbol, 'LOFI');
});

test('scan quotes larger holdings but only selects those below five dollars', async () => {
    for (const target of Object.values(core.TARGETS)) {
        const a = app();
        a.state.address = '0x123';
        a.state.target = target;
        const values = [10_000n, 10_001n, 1_000_000n, 4_999_999n, 5_000_000n, 20_000_000n];
        const balances = values.map((value, index) => ({ coinType: `0xabc::dust::D${index}`, totalBalance: String(value) }));
        a.window.AlphaCitySui = { async rpc(method) {
            return method === 'suix_getCoinMetadata' ? { decimals: 9 } : [...balances].reverse();
        } };
        const outputRequests = [];
        a.state.routerPromise = Promise.resolve({ async getCompleteTradeRouteGivenAmountIn(args) {
            if (args.coinOutType !== core.USDC_TYPE) outputRequests.push(args);
            return { coinOut: { amount: args.coinInAmount } };
        } });
        await a.scanWallet();
        assert.deepEqual(Array.from(a.state.holdings, row => row.usdMicros), values);
        const rendered = a.element('holdings-list').innerHTML;
        for (let index = 1; index < 5; index += 1) {
            assert.ok(rendered.indexOf(`::D${index}`) < rendered.indexOf(`::D${index + 1}`));
        }
        assert.equal(outputRequests.length, 5);
        assert.ok(outputRequests.every(args => args.coinOutType === target.coinType));
        assert.deepEqual([...a.state.selected].sort(), balances.slice(1, 4).map(row => row.coinType));
        assert.equal(a.state.holdings.filter(row => core.classifyHolding(row, target).eligible).length, 5);
        assert.match(a.element('holdings-list').innerHTML, /Manual selection/);
        a.state.selected.add(balances[5].coinType);
        a.renderSummary();
        assert.equal(a.element('selected-count').textContent, '4');
        assert.equal(a.element('prepare-button').disabled, false);
    }
});

test('holdings renderer hides tiny and unpriced balances while showing the boundary', () => {
    const a = app();
    a.state.address = '0x123';
    a.state.holdings = [
        { coinType: '0xa::a::TINY', usdMicros: 10_000n },
        { coinType: '0xb::b::UNKNOWN', usdMicros: null },
        { coinType: '0xc::c::VISIBLE', usdMicros: 10_001n },
    ];
    a.renderHoldings();
    assert.match(a.element('holdings-list').innerHTML, /VISIBLE/);
    assert.doesNotMatch(a.element('holdings-list').innerHTML, /TINY|UNKNOWN/);
});

test('GraphQL recovers decimals and renders exact ETH, DEEP, and LOFI balances', async () => {
    const a = app();
    const fixtures = [
        { coinType: '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH', decimals: 8, symbol: 'ETH', raw: '2597', formatted: '0.00002597 ETH' },
        { coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP', decimals: 6, symbol: 'DEEP', raw: '179497293', formatted: '179.497293 DEEP' },
        { coinType: core.LOFI_TYPE, decimals: 9, symbol: 'LOFI', raw: '1433290126393', formatted: '1433.290126393 LOFI' },
    ];
    let rpcCalls = 0;
    let graphqlCalls = 0;
    a.window.AlphaCitySui = {
        async rpc() { rpcCalls += 1; throw new Error('Rate limited'); },
        async graphql(query, { coinType }) {
            graphqlCalls += 1;
            assert.match(query, /coinMetadata\(coinType: \$coinType\)/);
            return { coinMetadata: fixtures.find(row => row.coinType === coinType) };
        },
    };
    a.state.address = '0x123';
    for (const fixture of fixtures) {
        const [metadata, duplicate] = await Promise.all([a.fetchMetadata(fixture.coinType), a.fetchMetadata(fixture.coinType)]);
        assert.equal(metadata, duplicate);
        a.state.holdings.push({ coinType: fixture.coinType, totalBalance: fixture.raw, metadata,
            usdMicros: 100_000n, targetRoute: { coinOut: { amount: 1000n } } });
        assert.equal(await a.fetchMetadata(fixture.coinType), metadata);
    }
    a.renderHoldings();
    for (const fixture of fixtures) assert.ok(a.element('holdings-list').innerHTML.includes(fixture.formatted));
    assert.equal(rpcCalls, 3);
    assert.equal(graphqlCalls, 3);
});

test('metadata lookup retries and does not cache failure or trust ticker aliases', async () => {
    const a = app();
    let calls = 0;
    let recovered = false;
    a.window.AlphaCitySui = {
        async rpc() {
            calls += 1;
            return recovered ? { decimals: 6, symbol: 'LOFI' } : { decimals: null, symbol: 'LOFI' };
        },
        async graphql() { throw new Error('Unavailable'); },
    };
    assert.equal(await a.fetchMetadata(core.LOFI_TYPE), null);
    assert.equal(calls, 2);
    recovered = true;
    assert.equal((await a.fetchMetadata(core.LOFI_TYPE)).decimals, 6);
    assert.equal(calls, 3);
    await a.fetchMetadata('0xabc::LOFI::LOFI');
    assert.equal(calls, 4, 'same symbol at a different package must get its own lookup');

    const b = app();
    let attempts = 0;
    b.window.AlphaCitySui = { async rpc() {
        attempts += 1;
        if (attempts === 1) throw new Error('Temporary failure');
        return { decimals: 8, symbol: 'ETH' };
    } };
    assert.equal((await b.fetchMetadata('0xdef::eth::ETH')).decimals, 8);
    assert.equal(attempts, 2);
});

test('unknown decimals show an explicit full-balance label instead of raw token counts', () => {
    const a = app();
    a.state.address = '0x123';
    a.state.holdings = [{ coinType: '0xabc::dust::DUST', totalBalance: '987654321123456789', metadata: null,
        usdMicros: 100_000n, targetRoute: { coinOut: { amount: 1000n } } }];
    a.renderHoldings();
    const html = a.element('holdings-list').innerHTML;
    assert.match(html, /Full balance · decimals unavailable/);
    assert.doesNotMatch(html, /987654321123456789|Unverified|disabled/);
});

test('scans beyond 40 tokens and displays valued holdings without target routes or metadata', async () => {
    const a = app();
    a.state.address = '0x123';
    const balances = Array.from({ length: 131 }, (_, index) => ({
        coinType: `0xabc::dust::TOKEN_${index}`, totalBalance: '1000000',
    }));
    a.window.AlphaCitySui = { async rpc(method, [type]) {
        if (method !== 'suix_getCoinMetadata') return balances;
        return type === balances[130].coinType ? null : { decimals: 6 };
    } };
    const valuedTypes = [];
    let active = 0;
    let peak = 0;
    a.state.routerPromise = Promise.resolve({ async getCompleteTradeRouteGivenAmountIn(args) {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        const index = Number(args.coinInType.split('_').at(-1));
        if (args.coinOutType === core.USDC_TYPE) {
            valuedTypes.push(args.coinInType);
            return { coinOut: { amount: index < 128 ? 10_000n : 10_001n } };
        }
        if (index === 129) throw new Error('No route found');
        return { coinOut: { amount: 123_000_000n } };
    } });
    await a.scanWallet();
    assert.equal(valuedTypes.length, 131);
    assert.ok(peak <= 3);
    assert.equal(a.state.holdings.length, 131);
    assert.deepEqual([...a.state.selected], [balances[128].coinType, balances[130].coinType]);
    const html = a.element('holdings-list').innerHTML;
    assert.equal((html.match(/class="holding-checkbox/g) || []).length, 3);
    assert.match(html, /TOKEN_128/);
    assert.match(html, /No CITY route/);
    assert.match(html, /Full balance · decimals unavailable/);
    assert.match(html, /\$0\.010001 liquidation value/);
    assert.match(a.element('alchemy-status').textContent, /checked all 131 token types\. 3 worth more than \$0\.01; 2 ready/);
});

test('renders scan results progressively and stops scheduling work after wallet changes', async () => {
    const a = app();
    a.state.address = '0x123';
    const balances = Array.from({ length: 9 }, (_, index) => ({
        coinType: `0xabc::dust::TOKEN_${index}`, totalBalance: '1000000',
    }));
    a.window.AlphaCitySui = { async rpc(method) { return method === 'suix_getCoinMetadata' ? { decimals: 6 } : balances; } };
    let release;
    const paused = new Promise(resolve => { release = resolve; });
    let notifyFourth;
    const fourth = new Promise(resolve => { notifyFourth = resolve; });
    let valuationCalls = 0;
    a.state.routerPromise = Promise.resolve({ async getCompleteTradeRouteGivenAmountIn(args) {
        if (args.coinOutType === core.USDC_TYPE) {
            valuationCalls += 1;
            if (valuationCalls === 4) notifyFourth();
            if (valuationCalls > 1) await paused;
        }
        return { coinOut: { amount: 25_000n } };
    } });
    const scanning = a.scanWallet();
    await fourth;
    assert.equal(a.state.scanning, true);
    assert.match(a.element('holdings-list').innerHTML, /TOKEN_0/);
    assert.match(a.element('holdings-list').innerHTML, /disabled/);
    a.state.scanNonce += 1;
    a.state.holdings = [];
    a.element('alchemy-status').textContent = 'New wallet';
    release();
    await scanning;
    assert.equal(valuationCalls, 4);
    assert.equal(a.state.holdings.length, 0);
    assert.equal(a.element('alchemy-status').textContent, 'New wallet');
});

test('scan uses target metadata decimals and excludes LOFI when selected', async () => {
    const a = app();
    a.state.address = '0x123';
    a.state.target = core.TARGETS.LOFI;
    a.window.AlphaCitySui = { async rpc(method, params) {
        if (method === 'suix_getCoinMetadata') {
            assert.equal(params[0], core.LOFI_TYPE);
            return { decimals: 6, symbol: 'LOFI' };
        }
        return [{ coinType: core.LOFI_TYPE, totalBalance: '1000000' }];
    } };
    await a.scanWallet();
    assert.equal(a.state.target.decimals, 6);
    assert.equal(a.state.holdings.length, 0);
    a.state.holdings = [{ coinType: core.USDC_TYPE, totalBalance: '10001', metadata: { decimals: 6 },
        usdMicros: 10_001n, targetRoute: { coinOut: { amount: 1_250_000n } } }];
    a.state.selected.add(core.USDC_TYPE);
    a.renderSummary();
    assert.equal(a.element('expected-city').textContent, '1.25');
    assert.match(a.element('prepare-button').textContent, /LOFI/);
});

test('prepares one simulated LOFI transaction and refuses execution after a target mismatch', async () => {
    const a = app();
    a.state.address = '0x123';
    a.state.target = { ...core.TARGETS.LOFI, decimals: 9 };
    const commands = [];
    a.context.Transaction = class {
        mergeCoins(...args) { commands.push(['merge', ...args]); }
        transferObjects(...args) { commands.push(['transfer', ...args]); }
        setSender(address) { this.sender = address; }
    };
    a.state.holdings = [core.USDC_TYPE, core.CITY_TYPE].map(coinType => ({
        coinType, totalBalance: '25000000', metadata: null, usdMicros: 25_000_000n,
        targetRoute: { coinOut: { amount: 100_000_000n } },
    }));
    a.state.holdings.forEach(row => a.state.selected.add(row.coinType));
    const routes = [];
    a.state.routerPromise = Promise.resolve({
        async getCompleteTradeRouteGivenAmountIn(args) {
            assert.equal(args.coinInAmount, 25_000_000n);
            return { coinOut: { type: args.coinOutType, amount: args.coinOutType === core.USDC_TYPE ? 25_000_000n : 100_000_000n } };
        },
        async addTransactionForCompleteTradeRoute({ tx, completeRoute }) {
            routes.push(completeRoute);
            return { tx, coinOutId: `out-${routes.length}` };
        },
    });
    let simulated;
    a.window.AlphaCitySui = {
        async rpc() { return a.state.holdings; },
        grpcClient: { async simulateTransaction({ transaction }) {
            simulated = transaction;
            return { Transaction: { effects: { status: { success: true }, gasUsed: {} } } };
        } },
    };
    await a.prepareAlchemy();
    assert.equal(routes.length, 2);
    assert.ok(routes.every(route => route.coinOut.type === core.LOFI_TYPE));
    assert.equal(a.state.prepared.tx, simulated);
    assert.equal(a.state.prepared.targetType, core.LOFI_TYPE);
    assert.ok(a.state.prepared.rows.every(row => row.metadata === null));
    assert.equal(commands[0][0], 'merge');
    assert.equal(commands[1][0], 'transfer');
    assert.equal(a.element('preflight-min-city').textContent, '0.198');
    assert.equal(a.element('confirm-button').disabled, false);
    let signed = false;
    a.state.walletConnector = { async signAndExecuteTransaction() { signed = true; } };
    a.state.target = core.TARGETS.CITY;
    await a.executeAlchemy();
    assert.equal(signed, false);
    assert.equal(a.state.prepared, null);
});
