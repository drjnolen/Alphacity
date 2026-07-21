const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'predict', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'predict', 'styles.css'), 'utf8');
const Arcade = require(path.join(root, 'shared', 'predict-arcade.js'));

test('the hidden Predict route is noindex and absent from existing navigation surfaces', () => {
    assert.match(html, /name="robots" content="noindex,nofollow,noarchive,nosnippet"/);
    assert.match(html, /Testnet Preview/);
    for (const relative of ['index.html', 'tools/index.html', 'analyze/index.html', 'staking/index.html', 'districts/index.html']) {
        const source = fs.readFileSync(path.join(root, relative), 'utf8');
        assert.doesNotMatch(source, /href=["']\/predict\/?["']/, `${relative} unexpectedly links to Predict`);
    }
});

test('the preview loads shared wallet identity before the arcade controller', () => {
    const sync = html.indexOf('/shared/wallet-sync.js');
    const connector = html.indexOf('/shared/wallet-connector.js');
    const arcade = html.indexOf('/shared/predict-arcade.js');
    assert.ok(sync > 0 && sync < connector && connector < arcade);
    assert.match(html, /id="connect-wallet-btn"/);
    assert.match(html, /WalletConnector\.create/);
});

test('the Predict draft uses the established Alpha City visual system', () => {
    assert.match(html, /family=Inter:wght@400;500;600;700/);
    assert.doesNotMatch(html, /Space\+Grotesk|IBM\+Plex\+Mono/);
    assert.match(html, /class="header-link" href="\/">Back to Home/);
    assert.match(html, /class="header-link district-link" href="\/districts\/">Districts/);
    assert.match(css, /--bg:\s*#111827/i);
    assert.match(css, /--panel:\s*#1f2937/i);
    assert.match(css, /--blue:\s*#3b82f6/i);
    assert.match(css, /font-family:\s*Inter, system-ui, sans-serif/);
});

test('the draft exposes the complete paper arcade loop and clear safety states', () => {
    for (const id of [
        'view-markets', 'market-list', 'probability-split', 'position-amount', 'place-position-btn',
        'view-districts', 'district-rows', 'preview-credits', 'view-positions', 'positions-table',
    ]) assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, /Simulation mode/);
    assert.match(html, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
    assert.match(html, /No transaction will be signed/);
    assert.match(html, /stores a simulated position only in this browser/i);
    assert.match(html, /Awaiting stable API/);
    assert.match(html, /All prices, probabilities, volumes, operators, standings, and rewards.+illustrative/s);
    assert.doesNotMatch(html, /signAndExecuteTransaction|executeTransactionBlock|signTransactionBlock/);
});

test('the inline controller parses as JavaScript', () => {
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
        .map((match) => match[1])
        .filter((source) => source.trim());
    assert.equal(scripts.length, 1);
    assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: 'predict/index.html:inline-controller.js' }));
});

test('the responsive stylesheet covers wallet dialogs, tabs, tickets, and reduced motion', () => {
    for (const selector of [
        '.ac-wallet-overlay', '.market-grid', '.direction-button', '.district-layout',
        '.positions-table', '@media (max-width: 720px)', '@media (prefers-reduced-motion: reduce)',
    ]) assert.ok(css.includes(selector), `missing ${selector}`);
});

test('demo markets expose supported assets, future expiries, and complementary probabilities', () => {
    const now = 1_800_000_000_000;
    const markets = Arcade.makeDemoMarkets(now);
    assert.equal(markets.length, 7);
    assert.deepEqual([...new Set(markets.map((market) => market.symbol))].sort(), ['BTC', 'DEEP', 'SUI']);
    assert.ok(markets.every((market) => market.expiry > now));
    const market = markets[0];
    const up = Arcade.marketDirectionProbability(market, 'UP');
    const down = Arcade.marketDirectionProbability(market, 'DOWN');
    assert.equal(Arcade.round(up + down, 6), 1);
});

test('paper quotes calculate contracts, payout, profit, and direction correctly', () => {
    const market = { id: 'test', symbol: 'SUI', strike: 3.25, expiry: Date.now() + 1000, probabilityUp: 0.4 };
    const up = Arcade.quotePosition(market, 'UP', 100);
    assert.equal(up.contractPrice, 0.4);
    assert.equal(up.shares, 250);
    assert.equal(up.payout, 250);
    assert.equal(up.profit, 150);
    assert.equal(up.roi, 150);
    const down = Arcade.quotePosition(market, 'DOWN', 100);
    assert.equal(down.contractPrice, 0.6);
    assert.equal(down.payout, 166.67);
    assert.throws(() => Arcade.quotePosition(market, 'UP', 0), /greater than 0/);
    assert.throws(() => Arcade.quotePosition(market, 'UP', 10001), /capped at 10,000/);
});

test('paper positions remain clearly identified and storage is isolated by identity', () => {
    const now = 1_800_000_000_000;
    const market = Arcade.makeDemoMarkets(now)[0];
    const address = `0x${'a'.repeat(64)}`;
    const position = Arcade.createPaperPosition(market, 'DOWN', 75, address, now);
    assert.match(position.id, /^paper-/);
    assert.equal(position.status, 'OPEN');
    assert.equal(position.address, address);
    assert.equal(position.direction, 'DOWN');
    assert.notEqual(Arcade.positionStorageKey(address), Arcade.positionStorageKey(null));
    assert.match(Arcade.positionStorageKey(null), /guest$/);
});

test('district assignment and mission progress are deterministic', () => {
    const address = `0x${'b'.repeat(64)}`;
    const first = Arcade.districtForAddress(address);
    const second = Arcade.districtForAddress(address);
    assert.deepEqual(first, second);
    assert.ok(Arcade.DISTRICTS.some((district) => district.key === first.key));
    assert.equal(Arcade.districtForAddress(''), null);

    const progress = Arcade.missionProgress([
        { marketId: 'sui-1', symbol: 'SUI' },
        { marketId: 'sui-2', symbol: 'SUI' },
        { marketId: 'btc-1', symbol: 'BTC' },
    ]);
    assert.deepEqual(progress, { firstSignal: 1, marketScout: 3, suiSpecialist: 2, credits: 90 });
});

test('market filters and share copy preserve the selected market context', () => {
    const now = 1_800_000_000_000;
    const markets = Arcade.makeDemoMarkets(now);
    assert.ok(Arcade.filterMarkets(markets, { asset: 'SUI' }, now).every((market) => market.symbol === 'SUI'));
    assert.ok(Arcade.filterMarkets(markets, { cadence: '7D' }, now).every((market) => market.cadence === '7D'));
    assert.equal(Arcade.filterMarkets(markets, { search: '125,000' }, now).length, 0);
    assert.equal(Arcade.filterMarkets(markets, { search: '125000' }, now).length, 1);
    assert.match(Arcade.buildShareText(markets[0], 'UP'), /SUI UP \$3\.250/);
    assert.match(Arcade.buildShareText(markets[0], 'UP'), /Alpha City Predict preview/);
});
