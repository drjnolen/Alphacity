'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const {
    selectPrimaryPair,
    metricValue,
    verifyScheduleConfig,
    matchOracleSigners,
    querySchedules,
} = require('../scripts/sluice-relayer.js');
const { normalizeAddress, normalizeCoinType, canonicalTriggerConfig } = require('../shared/sluice-core.cjs');

const PACKAGE = normalizeAddress('0xabc');
const COIN = `${normalizeAddress('0x123')}::coin::TOKEN`;

test('pair selection requires exact base token and chooses highest liquidity', () => {
    const pairs = [
        { baseToken: { address: COIN }, liquidity: { usd: 10 }, pairAddress: 'low' },
        { baseToken: { address: `${normalizeAddress('0x999')}::coin::OTHER` }, liquidity: { usd: 999 }, pairAddress: 'wrong' },
        { baseToken: { address: COIN }, liquidity: { usd: 50 }, pairAddress: 'high' },
    ];
    assert.equal(selectPrimaryPair(pairs, normalizeCoinType(COIN)).pairAddress, 'high');
});

test('market cap and FDV never substitute for one another', () => {
    const pair = { marketCap: '1200000', fdv: '5000000', priceUsd: '0.00123456789', liquidity: { usd: '25000.9' }, volume: { h24: '9000.8' } };
    assert.equal(metricValue(pair, 1), 1_200_000n);
    assert.equal(metricValue(pair, 2), 5_000_000n);
    assert.equal(metricValue(pair, 3), 123_456n);
    assert.equal(metricValue(pair, 4), 25_000n);
    assert.equal(metricValue(pair, 5), 9_000n);
    assert.throws(() => metricValue({ fdv: 10 }, 1), /unavailable/);
});

test('relayer accepts only the canonical trigger configuration committed on-chain', () => {
    const schedule = { coinType: normalizeCoinType(COIN), triggerKind: 1, minLiquidityUsd: 25_000n };
    schedule.triggerConfigHash = Array.from(crypto.createHash('sha256').update(canonicalTriggerConfig(schedule)).digest());
    assert.doesNotThrow(() => verifyScheduleConfig(schedule));
    schedule.minLiquidityUsd = 1n;
    assert.throws(() => verifyScheduleConfig(schedule), /not supported/);
});

test('threshold signing requires enough schedule-indexed oracle keys', () => {
    const keyA = new Ed25519Keypair();
    const keyB = new Ed25519Keypair();
    const keys = [keyA.getPublicKey().toRawBytes(), keyB.getPublicKey().toRawBytes()];
    const matches = matchOracleSigners(keys, 2, [keyB, keyA]);
    assert.deepEqual(matches.map(match => match.index), [0, 1]);
    assert.throws(() => matchOracleSigners(keys, 2, [keyA]), /controls 1 of 2/);
});

test('schedule discovery paginates GraphQL instead of truncating at 50', async () => {
    const calls = [];
    const fetchImpl = async (_url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body.variables.after);
        const second = body.variables.after === 'next';
        return {
            ok: true,
            json: async () => ({ data: { objects: {
                pageInfo: { hasNextPage: !second, endCursor: second ? null : 'next' },
                nodes: [{
                    address: second ? normalizeAddress('0x2') : normalizeAddress('0x1'),
                    version: 1,
                    digest: 'digest',
                    asMoveObject: { contents: { type: { repr: `${PACKAGE}::sluice_v2::VestingScheduleV2<${COIN}>` }, json: {} } },
                }],
            } } }),
        };
    };
    const result = await querySchedules('https://example.invalid/graphql', PACKAGE, fetchImpl);
    assert.equal(result.length, 2);
    assert.deepEqual(calls, [null, 'next']);
});
