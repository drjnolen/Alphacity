const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'market-integrity.js'), 'utf8');
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(source, context);
const tools = context.globalThis.AlphaCityMarketIntegrity;

const DEEP = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP';
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI = '0x2::sui::SUI';

function pair(overrides = {}) {
    return {
        chainId: 'sui',
        pairAddress: overrides.pairAddress || '0xpair',
        dexId: overrides.dexId || 'cetus',
        baseToken: overrides.baseToken || { address: DEEP, symbol: 'DEEP' },
        quoteToken: overrides.quoteToken || { address: USDC, symbol: 'USDC' },
        priceUsd: overrides.priceUsd || '0.02',
        priceNative: overrides.priceNative || '0.02',
        liquidity: { usd: overrides.liquidityUsd ?? 100000 },
        volume: { h24: overrides.volumeH24 ?? 200000 },
        txns: { h1: { buys: overrides.buysH1 ?? 60, sells: overrides.sellsH1 ?? 40 } },
        boosts: overrides.boosts,
    };
}

test('market integrity combines venue depth, flow, price dispersion, and paid attention', () => {
    const pairs = [
        pair({ pairAddress: '0x1', dexId: 'cetus', boosts: { active: 5 } }),
        pair({ pairAddress: '0x2', dexId: 'turbos', priceUsd: '0.0201', liquidityUsd: 100000, volumeH24: 100000, buysH1: 30, sellsH1: 70 }),
        pair({
            pairAddress: '0x3',
            dexId: 'aftermath',
            baseToken: { address: SUI, symbol: 'SUI' },
            quoteToken: { address: DEEP, symbol: 'DEEP' },
            priceUsd: '2',
            priceNative: '100',
            liquidityUsd: 50000,
            volumeH24: 50000,
            buysH1: 10,
            sellsH1: 10,
            boosts: { active: 99 },
        }),
        pair({ pairAddress: '0x2', dexId: 'turbos', liquidityUsd: 1000 }),
    ];
    const promotion = {
        orders: [
            { type: 'tokenProfile', status: 'approved' },
            { type: 'tokenAd', status: 'cancelled' },
        ],
        boosts: [{ amount: 30 }],
    };

    const summary = tools.summarizeMarketIntegrity(pairs, promotion, DEEP);

    assert.equal(summary.poolCount, 3);
    assert.equal(summary.venueCount, 3);
    assert.equal(summary.aggregateLiquidityUsd, 250000);
    assert.equal(summary.aggregateVolumeH24, 350000);
    assert.equal(summary.turnoverH24, 1.4);
    assert.equal(summary.transactionsH1, 220);
    assert.ok(Math.abs(summary.priceSpreadPct - 0.5) < 0.0001);
    assert.equal(summary.deepestPoolSharePct, 40);
    assert.equal(summary.activeBoosts, 5);
    assert.deepEqual(Array.from(summary.paidOrderTypes), ['tokenProfile']);
    assert.equal(summary.purchasedBoostAmount, 30);
    assert.equal(summary.structure, 'robust');
});

test('quote-side token prices are derived from base USD and native price', () => {
    const quotePair = pair({
        baseToken: { address: SUI },
        quoteToken: { address: DEEP },
        priceUsd: '2',
        priceNative: '100',
    });
    assert.equal(tools.tokenPriceUsd(quotePair, DEEP), 0.02);
});

test('thin single-pool markets are classified as fragile without promotions', () => {
    const summary = tools.summarizeMarketIntegrity([
        pair({ liquidityUsd: 5000, volumeH24: 100, buysH1: 1, sellsH1: 0 }),
    ], [], DEEP);

    assert.equal(summary.structure, 'fragile');
    assert.equal(summary.priceSpreadPct, null);
    assert.equal(summary.activeBoosts, 0);
    assert.deepEqual(Array.from(summary.paidOrderTypes), []);
    assert.match(summary.observations.join(' '), /thin aggregate liquidity/);
});

test('promotion availability remains distinct from a clean disclosure response', () => {
    const summary = tools.summarizeMarketIntegrity([pair()], {}, DEEP, { promotionAvailable: false });

    assert.equal(summary.promotionAvailable, false);
    assert.equal(summary.activeBoosts, 0);
    assert.deepEqual(Array.from(summary.paidOrderTypes), []);
});
