const assert = require('node:assert/strict');
const test = require('node:test');
const safety = require('../shared/token-safety.js');

test('Sui capabilities treat both documented active values as active even without an owner', () => {
    for (const value of ['1', '2', 1, 2]) assert.equal(safety.capability({ value }).state, 'active');
    assert.equal(safety.capability({ value: '2', cap_owner: 'Shared' }).state, 'active');
    assert.equal(safety.capability({ value: '1', cap_owner: ' Multiple ' }).state, 'active');
    assert.equal(safety.capability({ value: '1', cap_owner: 'Immutable' }).state, 'inactive');
    assert.equal(safety.capability({ value: '0' }).state, 'inactive');
});

test('missing, invalid, unsupported and unavailable capabilities never become inactive', () => {
    for (const value of [null, undefined, {}, { value: '' }, { value: false }, { value: '3' }, { cap_owner: 'Immutable' }]) {
        assert.equal(safety.capability(value).state, 'unknown');
    }
    assert.equal(safety.capability({}, 'unavailable').state, 'unavailable');
    assert.equal(safety.capability({}, 'unsupported').state, 'unsupported');
    const unknown = safety.assess({ security: { state: 'available', data: {} } });
    assert.equal(unknown.known, 0);
    assert.equal(unknown.supply, null);
    assert.equal(unknown.holderShare, null);
    assert.equal(unknown.checks.some(check => check.state === 'inactive'), false);
});

test('coin matching normalizes address padding while respecting case-sensitive Move identifiers', () => {
    assert.equal(safety.coinKey('0x000A::coin::COIN'), '0xa::coin::COIN');
    assert.notEqual(safety.coinKey('0xA::coin::COIN'), safety.coinKey('0xa::coin::Coin'));
    assert.equal(safety.coinKey('0xa'), '');
    const payload = { code: 1, result: { '0x000a::coin::COIN': { mintable: { value: '2' } }, '0xa': { mintable: { value: '0' } } } };
    assert.equal(safety.securityRecord(payload, '0xa::coin::COIN').state, 'available');
    assert.equal(safety.securityRecord(payload, '0xa::coin::Coin').state, 'unsupported');
    assert.equal(safety.securityRecord({ code: 0, result: {} }, '0xa::coin::COIN').state, 'unavailable');
});

test('market gaps and API failures do not imply illiquidity or untradability', () => {
    const coin = '0xa::coin::COIN';
    assert.equal(safety.marketRecord({ pairs: [] }, coin).state, 'unsupported');
    assert.equal(safety.marketRecord({ error: 'rate limited' }, coin).state, 'unavailable');
    const unrelated = { chainId: 'sui', baseToken: { address: '0xb::coin::COIN' }, liquidity: { usd: 1000000 } };
    assert.equal(safety.marketRecord({ pairs: [unrelated] }, coin).pair, null);
    const missing = safety.assess({ market: { state: 'unavailable', pair: null } });
    assert.equal(missing.liquidity, null);
    assert.equal(missing.checks.find(check => check.key === 'liquidity').risk, false);
    const empty = safety.assess({ market: { state: 'available', pair: { liquidity: { usd: null } } } });
    assert.equal(empty.checks.find(check => check.key === 'liquidity').state, 'unknown');
});

test('complete provider checks expose risks and label reported concentration without invented scores', () => {
    const data = {
        mintable: { value: '2' }, blacklist: { value: '0' }, contract_upgradeable: { value: '0' },
        total_supply: '1000000', holders: [{ address: '0x1', percent: '0.6', tag: 'pool' }, { address: '0x2', percent: '0.1' }],
    };
    const result = safety.assess({ security: { state: 'available', data }, market: { state: 'available', pair: { liquidity: { usd: 0 } } } });
    assert.equal(result.known, 5);
    assert.equal(result.riskCount, 3);
    assert.equal(result.score, undefined);
    assert.equal(result.holderShare, 70);
    assert.equal(result.supply, 1000000);
    assert.match(result.checks.find(check => check.key === 'holders').text, /pools or custodians/);
    for (const holders of [[], [{ address: '0x1', percent: '' }], [{ address: '0x1', percent: 1.1 }], [{ address: '0x1', percent: .8 }, { address: '0x2', percent: .8 }]]) {
        assert.equal(safety.assess({ security: { state: 'available', data: { holders } } }).holderShare, null);
    }
});
