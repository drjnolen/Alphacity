const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'shared', 'trade-alerts.js'), 'utf8'),
    context,
    { filename: 'shared/trade-alerts.js' },
);

const alerts = context.AlphaCityTradeAlerts;

test('trade alert rules validate token, type, and positive threshold', () => {
    const rule = alerts.createRule({ id: 'rule-1', token: '0x2::sui::SUI', type: 'price_above', threshold: '2.5', now: 10 });
    assert.equal(rule.threshold, 2.5);
    assert.equal(rule.createdAt, 10);
    assert.throws(() => alerts.createRule({ token: '', type: 'price_above', threshold: 1 }), /Choose a token/);
    assert.throws(() => alerts.createRule({ token: '0x2::sui::SUI', type: 'unknown', threshold: 1 }), /supported alert type/);
    assert.throws(() => alerts.createRule({ token: '0x2::sui::SUI', type: 'price_above', threshold: 0 }), /greater than zero/);
});

test('price alerts fire once on crossing and rearm after the condition clears', () => {
    const rule = alerts.createRule({ id: 'price', token: 'SUI', type: 'price_above', threshold: 2, now: 1 });
    const first = alerts.evaluateRules([rule], { SUI: { priceUsd: 2.1 } }, 2);
    assert.equal(first.triggered.length, 1);
    assert.equal(first.rules[0].isTriggered, true);

    const stillAbove = alerts.evaluateRules(first.rules, { SUI: { priceUsd: 2.2 } }, 3);
    assert.equal(stillAbove.triggered.length, 0);

    const rearmed = alerts.evaluateRules(stillAbove.rules, { SUI: { priceUsd: 1.9 } }, 4);
    assert.equal(rearmed.rules[0].isTriggered, false);
    const crossedAgain = alerts.evaluateRules(rearmed.rules, { SUI: { priceUsd: 2.05 } }, 5);
    assert.equal(crossedAgain.triggered.length, 1);
});

test('liquidity and downward momentum alerts use their dedicated metrics', () => {
    const liquidity = alerts.createRule({ id: 'liq', token: 'CITY', type: 'liquidity_below', threshold: 50000, now: 1 });
    const momentum = alerts.createRule({ id: 'move', token: 'CITY', type: 'change_1h_down', threshold: 8, now: 1 });
    const result = alerts.evaluateRules([liquidity, momentum], {
        CITY: { liquidityUsd: 45000, changeH1: -9.5 },
    }, 2);
    assert.deepEqual(Array.from(result.triggered, rule => rule.id), ['liq', 'move']);
});

test('volume and sell-pressure alerts reuse the enriched market snapshot', () => {
    const volume = alerts.createRule({ id: 'volume', token: 'SUI', type: 'volume_1h_above', threshold: 100000, now: 1 });
    const pressure = alerts.createRule({ id: 'pressure', token: 'SUI', type: 'sell_pressure_1h_above', threshold: 65, now: 1 });
    const result = alerts.evaluateRules([volume, pressure], {
        SUI: { volumeH1: 125000, sellPressureH1: 72.5 },
    }, 2);
    assert.deepEqual(Array.from(result.triggered, rule => rule.id), ['volume', 'pressure']);
});

test('missing market snapshots do not rearm an already-triggered rule', () => {
    const rule = { ...alerts.createRule({ id: 'price', token: 'SUI', type: 'price_below', threshold: 1, now: 1 }), isTriggered: true };
    const result = alerts.evaluateRules([rule], {}, 2);
    assert.equal(result.rules[0].isTriggered, true);
    assert.equal(result.triggered.length, 0);
});

test('Sui token matching canonicalizes package addresses without prefix collisions', () => {
    const paddedSui = `0x${'0'.repeat(63)}2::sui::SUI`;
    assert.equal(alerts.tokenMatchesPairAddress('0x2::sui::SUI', paddedSui), true);
    assert.equal(alerts.tokenMatchesPairAddress('0xabc', '0x000abc::coin::COIN'), true);
    assert.equal(alerts.tokenMatchesPairAddress('0x2', '0x20::coin::COIN'), false);
    assert.equal(alerts.tokenMatchesPairAddress('0xabc::coin::ONE', '0xabc::coin::TWO'), false);
});
