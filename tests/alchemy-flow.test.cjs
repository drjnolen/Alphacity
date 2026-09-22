const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../shared/alchemy-core.js');

function app() {
    const elements = new Map();
    const targetLabels = Array.from({ length: 4 }, () => ({ textContent: 'CITY' }));
    const element = id => {
        if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', hidden: false, disabled: false,
            querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {} });
        return elements.get(id);
    };
    const context = vm.createContext({
        window: { AlphaCityAlchemyCore: core },
        document: { getElementById: element, querySelectorAll: selector => selector === '[data-target-symbol]' ? targetLabels : [], addEventListener() {} },
        console, setTimeout: () => 1, clearTimeout() {}, AbortController,
    });
    const source = fs.readFileSync(path.join(__dirname, '../alchemy/app-source.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
    vm.runInContext(source + '\n globalThis.app = { state, quoteHolding, quoteSelectedHolding, renderHoldings, renderSummary, handleTargetChange, scanWallet, prepareAlchemy, executeAlchemy };', context);
    return { ...context.app, element, window: context.window, context, targetLabels };
}

test('connected target switching requotes a large wallet and hides tiny and unchecked holdings', async () => {
    const a = app();
    a.state.address = '0x123';
    const balances = Array.from({ length: 43 }, (_, index) => ({
        coinType: `0xabc::dust::TOKEN_${index}`, totalBalance: '1000000',
    }));
    const outgoing = [];
    a.window.AlphaCitySui = { async rpc(method) {
        return method === 'suix_getCoinMetadata' ? { decimals: 9 } : balances;
    } };
    a.state.routerPromise = Promise.resolve({ async getCompleteTradeRouteGivenAmountIn(args) {
        const index = Number(args.coinInType.split('_').at(-1));
        if (args.coinOutType === core.USDC_TYPE) {
            if (index === 2) throw new Error('Unpriced');
            return { coinOut: { amount: index === 0 ? 49_999n : 50_000n } };
        }
        outgoing.push(args.coinOutType);
        return { coinOut: { amount: args.coinOutType === core.CITY_TYPE ? 1_000_000_000n : 2_000_000_000n } };
    } });
    await a.scanWallet();
    assert.ok(a.targetLabels.every(label => label.textContent === 'CITY'));
    assert.equal(a.element('expected-city').textContent, '10');
    a.state.prepared = { tx: {} };
    outgoing.length = 0;
    a.element('target-token').value = 'LOFI';
    const switched = a.handleTargetChange();
    assert.equal(a.state.prepared, null);
    assert.equal(a.state.holdings.length, 0);
    assert.ok(a.targetLabels.every(label => label.textContent === 'LOFI'));
    await switched;
    assert.equal(outgoing.length, 38);
    assert.ok(outgoing.every(type => type === core.LOFI_TYPE));
    assert.equal(a.element('expected-city').textContent, '20');
    assert.match(a.element('prepare-button').textContent, /LOFI/);
    assert.equal((a.element('holdings-list').innerHTML.match(/class="holding-checkbox/g) || []).length, 38);
    assert.doesNotMatch(a.element('holdings-list').innerHTML, /TOKEN_(?:0|2|40|41|42)(?:["<\s])|Initial scan limit/);
    assert.match(a.element('holdings-list').innerHTML, /TOKEN_1["<\s]/);
    assert.match(a.element('alchemy-status').textContent, /Checked 40 of 43/);
});

test('render restores the selector to the actual target after browser form restoration', () => {
    const a = app();
    a.element('target-token').value = 'LOFI';
    a.renderSummary();
    assert.equal(a.element('target-token').value, 'CITY');
    assert.ok(a.targetLabels.every(label => label.textContent === 'CITY'));
});

test('quotes LOFI and skips output routes for holdings below five cents', async () => {
    const a = app();
    a.state.target = { ...core.TARGETS.LOFI, decimals: 9 };
    const calls = [];
    const router = { async getCompleteTradeRouteGivenAmountIn(args) {
        calls.push(args);
        return { coinOut: { amount: 123_456_789n } };
    } };
    const dust = { coinType: core.USDC_TYPE, totalBalance: '50000', metadata: { decimals: 6 } };
    const quoted = await a.quoteHolding(dust, router);
    assert.equal(calls[0].coinOutType, core.LOFI_TYPE);
    assert.equal(core.classifyHolding(quoted, a.state.target).eligible, true);
    await a.quoteSelectedHolding(dust, router);
    assert.equal(calls[1].coinOutType, core.LOFI_TYPE);
    calls.length = 0;
    await a.quoteHolding({ ...dust, totalBalance: '49999' }, router);
    assert.equal(calls.length, 0);
});

test('target switching clears selections and prepared transactions', () => {
    const a = app();
    assert.equal(a.state.target.symbol, 'CITY');
    a.state.prepared = { tx: {} };
    a.state.selected.add('dust');
    a.state.holdings = [{ usdMicros: 50_000n }];
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

test('holdings renderer hides tiny and unpriced balances while showing the boundary', () => {
    const a = app();
    a.state.address = '0x123';
    a.state.holdings = [
        { coinType: '0xa::a::TINY', usdMicros: 49_999n },
        { coinType: '0xb::b::UNKNOWN', usdMicros: null },
        { coinType: '0xc::c::VISIBLE', usdMicros: 50_000n },
    ];
    a.renderHoldings();
    assert.match(a.element('holdings-list').innerHTML, /VISIBLE/);
    assert.doesNotMatch(a.element('holdings-list').innerHTML, /TINY|UNKNOWN/);
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
    a.state.holdings = [{ coinType: core.USDC_TYPE, totalBalance: '50000', metadata: { decimals: 6 },
        usdMicros: 50_000n, targetRoute: { coinOut: { amount: 1_250_000n } } }];
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
        coinType, totalBalance: '50000', metadata: { decimals: 6 }, usdMicros: 50_000n,
        targetRoute: { coinOut: { amount: 100_000_000n } },
    }));
    a.state.holdings.forEach(row => a.state.selected.add(row.coinType));
    const routes = [];
    a.state.routerPromise = Promise.resolve({
        async getCompleteTradeRouteGivenAmountIn(args) {
            return { coinOut: { type: args.coinOutType, amount: args.coinOutType === core.USDC_TYPE ? 50_000n : 100_000_000n } };
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
