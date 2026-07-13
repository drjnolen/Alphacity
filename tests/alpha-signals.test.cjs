const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'alpha-signals.js'), 'utf8'), context);
const signals = context.AlphaCityAlphaSignals;
const NOW = Date.UTC(2026, 6, 13);

function pair(overrides = {}) {
    return {
        pairAddress: overrides.pairAddress || Math.random().toString(16),
        dexId: overrides.dexId || 'dex-a',
        baseToken: { address: overrides.token || '0x1::coin::COIN', symbol: overrides.symbol || 'COIN' },
        quoteToken: { address: '0x2::sui::SUI', symbol: 'SUI' },
        priceUsd: overrides.priceUsd ?? '1',
        liquidity: { usd: overrides.liquidityUsd ?? 250000 },
        volume: { h1: overrides.volumeH1 ?? 30000, h24: overrides.volumeH24 ?? 240000 },
        txns: { h1: { buys: overrides.buysH1 ?? 70, sells: overrides.sellsH1 ?? 30 } },
        priceChange: { h1: overrides.changeH1 ?? 4, h24: overrides.changeH24 ?? 12 },
        pairCreatedAt: overrides.pairCreatedAt ?? NOW - 72 * 60 * 60 * 1000,
        fdv: overrides.fdv ?? 5000000,
    };
}

test('signal ranking rewards liquid acceleration and filters shallow pairs', () => {
    const strong = pair({ pairAddress: 'strong', token: '0x1', liquidityUsd: 1000000, volumeH1: 100000, volumeH24: 400000, buysH1: 80, sellsH1: 20 });
    const weak = pair({ pairAddress: 'weak', token: '0x2', liquidityUsd: 30000, volumeH1: 10, volumeH24: 1000, buysH1: 1, sellsH1: 4, changeH1: -5 });
    const shallow = pair({ pairAddress: 'shallow', token: '0x3', liquidityUsd: 5000 });
    const ranked = signals.rankSignals([weak, shallow, strong], { now: NOW, minLiquidityUsd: 25000 });
    assert.equal(ranked[0].pair.pairAddress, 'strong');
    assert.equal(ranked.some(item => item.pair.pairAddress === 'shallow'), false);
    assert.ok(ranked[0].score > ranked[1].score);
});

test('anomalous percentage moves receive a material score penalty', () => {
    const normal = signals.signalForPair(pair({ pairAddress: 'normal', changeH24: 20 }), NOW);
    const anomaly = signals.signalForPair(pair({ pairAddress: 'anomaly', changeH24: 1000000 }), NOW);
    assert.ok(normal.score > anomaly.score);
    assert.ok(anomaly.risks.includes('anomalous 24h change'));
});

test('market regime combines breadth, transaction flow, and velocity', () => {
    const universe = [1, 2, 3, 4].map(index => pair({ pairAddress: String(index), token: `0x${index}`, changeH1: 2 + index, buysH1: 70, sellsH1: 30 }));
    const regime = signals.marketRegime(universe, { now: NOW });
    assert.equal(regime.regime, 'risk-on');
    assert.equal(regime.breadthPct, 100);
    assert.equal(regime.buySharePct, 70);
});

test('broad negative breadth classifies as risk-off without requiring extreme sell flow', () => {
    const universe = [1, 2, 3, 4].map(index => pair({ pairAddress: String(index), token: `0x${index}`, changeH1: -index, buysH1: 49, sellsH1: 51 }));
    const regime = signals.marketRegime(universe, { now: NOW });
    assert.equal(regime.regime, 'risk-off');
});

test('new pool quality favors liquid active launches over empty pools', () => {
    const active = pair({ pairAddress: 'active', token: '0xa', pairCreatedAt: NOW - 12 * 60 * 60 * 1000, liquidityUsd: 200000 });
    const empty = pair({ pairAddress: 'empty', token: '0xb', pairCreatedAt: NOW - 12 * 60 * 60 * 1000, liquidityUsd: 2000, volumeH1: 0, volumeH24: 0, buysH1: 0, sellsH1: 0 });
    const ranked = signals.rankNewPools([empty, active], { now: NOW });
    assert.equal(ranked[0].pair.pairAddress, 'active');
    assert.ok(ranked[0].score > ranked[1].score);
});

test('new pool ranking ignores pairs without a creation timestamp', () => {
    const timestamped = pair({ pairAddress: 'timestamped', token: '0xa', pairCreatedAt: NOW - 12 * 60 * 60 * 1000 });
    const missing = pair({ pairAddress: 'missing', token: '0xb' });
    delete missing.pairCreatedAt;
    const ranked = signals.rankNewPools([missing, timestamped], { now: NOW });
    assert.deepEqual(Array.from(ranked, item => item.pair.pairAddress), ['timestamped']);
});

test('dislocations require distinct venues and reject extreme stale-looking spreads', () => {
    const low = pair({ pairAddress: 'low', token: '0x9', dexId: 'dex-a', priceUsd: '1', liquidityUsd: 300000 });
    const high = pair({ pairAddress: 'high', token: '0x9', dexId: 'dex-b', priceUsd: '1.02', liquidityUsd: 400000 });
    const extreme = pair({ pairAddress: 'extreme', token: '0x9', dexId: 'dex-c', priceUsd: '5', liquidityUsd: 500000 });
    const result = signals.findDislocations([low, high], { minSpreadPct: 0.25 });
    assert.equal(result.length, 1);
    assert.equal(result[0].confidence, 'high');
    assert.ok(result[0].spreadPct > 1.9 && result[0].spreadPct < 2.1);
    assert.equal(signals.findDislocations([low, extreme]).length, 0);
});
