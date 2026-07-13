const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'shared', 'trade-tools.js'), 'utf8'),
    context,
    { filename: 'shared/trade-tools.js' },
);

const tools = context.AlphaCityTradeTools;

test('pool impact and maximum trade calculations are inverse estimates', () => {
    const maxTrade = tools.maxTradeForImpact(200000, 1);
    assert.ok(Math.abs(maxTrade - 1010.1010101) < 0.001);
    assert.ok(Math.abs(tools.estimatePoolImpact(maxTrade, 200000) - 1) < 0.000001);
});

test('execution analysis ranks liquidity and reports flow and price dispersion', () => {
    const pairs = [
        { dexId: 'small', priceUsd: '1.02', liquidity: { usd: 50000 }, volume: { h24: 10000 }, txns: { h1: { buys: 2, sells: 8 } } },
        { dexId: 'large', priceUsd: '1.00', liquidity: { usd: 200000 }, volume: { h24: 100000 }, txns: { h1: { buys: 30, sells: 10 } } },
    ];
    const result = tools.analyzeExecution(pairs, { tradeUsd: 1000, impactBudgetPct: 1 });
    assert.equal(result.bestPool.dexId, 'large');
    assert.equal(result.buySharePct, 75);
    assert.equal(result.transactionsH1, 40);
    assert.ok(result.priceSpreadPct > 1.9);
    assert.ok(result.maxTradeUsd > 1000);
});

test('position sizing respects risk budget and long trade geometry', () => {
    const plan = tools.buildPositionPlan({
        accountUsd: 10000,
        riskPct: 1,
        direction: 'long',
        entry: 2,
        stop: 1.8,
        target: 2.6,
    });
    assert.equal(plan.riskBudgetUsd, 100);
    assert.ok(Math.abs(plan.units - 500) < 0.000001);
    assert.ok(Math.abs(plan.notionalUsd - 1000) < 0.000001);
    assert.ok(Math.abs(plan.rewardRisk - 3) < 0.000001);
});

test('position sizing rejects stops and targets on the wrong side', () => {
    assert.throws(() => tools.buildPositionPlan({ accountUsd: 1000, riskPct: 1, direction: 'long', entry: 2, stop: 2.1, target: 2.5 }), /long stop/);
    assert.throws(() => tools.buildPositionPlan({ accountUsd: 1000, riskPct: 1, direction: 'short', entry: 2, stop: 2.2, target: 2.1 }), /short target/);
});
