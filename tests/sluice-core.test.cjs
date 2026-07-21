'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bcs } = require('@mysten/sui/bcs');
const {
    normalizeAddress,
    normalizeCoinType,
    parseDecimalToBigInt,
    decimalToScaledBigInt,
    parseScheduleObject,
    calculateClaimable,
    canonicalTriggerConfig,
    encodeObservationMessage,
    encodeClaimMessage,
    encodeClaimFragment,
    decodeClaimFragment,
} = require('../shared/sluice-core.cjs');

const ADDRESS = `0x${'12'.repeat(32)}`;
const COIN = `${ADDRESS}::coin::TOKEN`;

test('amount parsing is exact and rejects silent precision loss', () => {
    assert.equal(parseDecimalToBigInt('12.345678', 6), 12_345_678n);
    assert.equal(parseDecimalToBigInt('1', 9), 1_000_000_000n);
    assert.throws(() => parseDecimalToBigInt('1.0000001', 6), /at most 6/);
    assert.throws(() => parseDecimalToBigInt('1e6', 9), /positive decimal/);
});

test('oracle decimal scaling accepts API scientific notation without float math', () => {
    assert.equal(decimalToScaledBigInt('1.23456789e-3', 8), 123_456n);
    assert.equal(decimalToScaledBigInt('1.9e6', 0), 1_900_000n);
    assert.equal(decimalToScaledBigInt('999.99', 0), 999n);
});

test('schedule parsing accepts direct gRPC balance strings', () => {
    const schedule = parseScheduleObject({ data: {
        objectId: ADDRESS,
        content: {
            type: `${ADDRESS}::sluice_v2::VestingScheduleV2<${COIN}>`,
            fields: {
                id: { id: ADDRESS }, creator: '0x1', beneficiary: '0x2',
                balance: '750', total_amount: '1000', released_amount: '250',
                start_time_ms: '1000', end_time_ms: '11000', interval_ms: '1000',
                status: 1, revocable: true, trigger_kind: 1, comparison: 0,
                target_value: '1000000', min_liquidity_usd: '25000',
                validation_window_ms: '1800000', max_sample_gap_ms: '900000',
                trigger_deadline_ms: '0', fallback_policy: 0,
                client_reference: [1, 2], trigger_config_hash: Array(32).fill(7),
            },
        },
    }});
    assert.equal(schedule.balance, 750n);
    assert.equal(schedule.creator, normalizeAddress('0x1'));
    assert.equal(schedule.coinType, normalizeCoinType(COIN));
    assert.equal(calculateClaimable(schedule, 6_000n), 250n);
});

test('legacy active status is normalized for claimable calculations', () => {
    const schedule = parseScheduleObject({ data: {
        objectId: ADDRESS,
        content: {
            type: `${ADDRESS}::sluice::VestingSchedule<${COIN}>`,
            fields: {
                creator: '0x1', beneficiary: '0x2', balance: '100000',
                total_amount: '100000', released_amount: '0',
                start_time_ms: '1000', end_time_ms: '2000', interval_ms: '100',
                milestone_status: 0, revocable: true, target_marketcap: null,
            },
        },
    }});
    assert.equal(schedule.legacyMilestoneStatus, 0);
    assert.equal(schedule.status, 1);
    assert.equal(calculateClaimable(schedule, 3000n), 100000n);
    schedule.balance = 0n;
    assert.equal(calculateClaimable(schedule, 3000n), 0n);
});

test('trigger configuration is deterministic and distinguishes market cap from FDV', () => {
    const marketCap = canonicalTriggerConfig({ coinType: COIN, triggerKind: 1, minLiquidityUsd: 25_000 });
    const fdv = canonicalTriggerConfig({ coinType: COIN, triggerKind: 2, minLiquidityUsd: 25_000 });
    assert.match(marketCap, /"metric":"marketCap"/);
    assert.match(fdv, /"metric":"fdv"/);
    assert.notEqual(marketCap, fdv);
});

test('observation and claim messages use stable BCS field ordering', () => {
    const observation = encodeObservationMessage({
        scheduleId: ADDRESS,
        triggerConfigHash: Array(32).fill(3),
        triggerKind: 1,
        comparison: 0,
        observedValue: 5n,
        observedAtMs: 6n,
        validUntilMs: 7n,
    });
    const claim = encodeClaimMessage({
        scheduleId: ADDRESS,
        currentBeneficiary: '0x1',
        newBeneficiary: '0x2',
        validUntilMs: 7n,
    });
    assert.equal(observation.length, 32 + 32 + 33 + 2 + 24);
    assert.equal(claim.length, 26 + 32 + 32 + 32 + 8);
    assert.equal(observation.at(-24), 5);
    assert.equal(claim.at(-8), 7);

    const observationSchema = bcs.struct('ObservationMessage', {
        domain: bcs.vector(bcs.u8()),
        schedule_id: bcs.Address,
        trigger_config_hash: bcs.vector(bcs.u8()),
        trigger_kind: bcs.u8(),
        comparison: bcs.u8(),
        observed_value: bcs.u64(),
        observed_at_ms: bcs.u64(),
        valid_until_ms: bcs.u64(),
    });
    const claimSchema = bcs.struct('ClaimMessage', {
        domain: bcs.vector(bcs.u8()),
        schedule_id: bcs.Address,
        current_beneficiary: bcs.Address,
        new_beneficiary: bcs.Address,
        valid_until_ms: bcs.u64(),
    });
    assert.deepEqual(observation, observationSchema.serialize({
        domain: Array.from(Buffer.from('alphacity.sluice.v2.observation')),
        schedule_id: ADDRESS,
        trigger_config_hash: Array(32).fill(3),
        trigger_kind: 1,
        comparison: 0,
        observed_value: 5n,
        observed_at_ms: 6n,
        valid_until_ms: 7n,
    }).toBytes());
    assert.deepEqual(claim, claimSchema.serialize({
        domain: Array.from(Buffer.from('alphacity.sluice.v2.claim')),
        schedule_id: ADDRESS,
        current_beneficiary: normalizeAddress('0x1'),
        new_beneficiary: normalizeAddress('0x2'),
        valid_until_ms: 7n,
    }).toBytes());
});

test('claim fragments round-trip without query-string credentials', () => {
    const encoded = encodeClaimFragment({ v: 2, scheduleId: ADDRESS, coinType: COIN, secretKey: 'suiprivkey1test' });
    assert.doesNotMatch(encoded, /[?=&]/);
    const decoded = decodeClaimFragment(encoded);
    assert.equal(decoded.scheduleId, ADDRESS);
    assert.equal(decoded.secretKey, 'suiprivkey1test');
});
