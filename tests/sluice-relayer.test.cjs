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
    effectSucceeded,
    waitForFinality,
    nestedByteVectors,
    safeObservationTimestamp,
    querySchedules,
    fetchObservation,
    fetchJsonWithTimeout,
    fetchJson,
    queryScheduleTypeOrigin,
    observationTimestamp,
    run,
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

test('one DexScreener response is reused for schedules tracking the same coin', async () => {
    let requests = 0;
    const fetchImpl = async () => {
        requests += 1;
        return {
            ok: true,
            json: async () => ({ pairs: [{
                baseToken: { address: COIN },
                liquidity: { usd: '50000' },
                marketCap: '1200000',
                fdv: '1500000',
                dexId: 'test',
                pairAddress: 'pair',
            }] }),
        };
    };
    const cache = new Map();
    const schedule = { coinType: normalizeCoinType(COIN), triggerKind: 1, minLiquidityUsd: 10_000n };
    const marketCap = await fetchObservation(schedule, fetchImpl, cache);
    const fdv = await fetchObservation({ ...schedule, triggerKind: 2 }, fetchImpl, cache);
    assert.equal(marketCap.observedValue, 1_200_000n);
    assert.equal(fdv.observedValue, 1_500_000n);
    await assert.rejects(
        fetchObservation({ ...schedule, minLiquidityUsd: 60_000n }, fetchImpl, cache),
        /below required/,
    );
    assert.equal(requests, 1);
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

test('GraphQL base64 oracle vectors decode to the raw signing keys', () => {
    const key = new Ed25519Keypair();
    const raw = key.getPublicKey().toRawBytes();
    const encoded = Buffer.from(raw).toString('base64');
    const decoded = nestedByteVectors([encoded]);
    assert.deepEqual(decoded, [Array.from(raw)]);
    assert.equal(matchOracleSigners(decoded, 1, [key]).length, 1);
});

test('observation timestamps tolerate a runner clock ahead of Sui consensus', () => {
    assert.equal(safeObservationTimestamp(100_000n), 70_000n);
    assert.equal(safeObservationTimestamp(20_000n), 0n);
});

test('current gRPC transaction results report success through the nested transaction status', () => {
    assert.equal(effectSucceeded({ $kind: 'Transaction', Transaction: { status: { success: true } } }), true);
    assert.equal(effectSucceeded({ $kind: 'FailedTransaction', FailedTransaction: { status: { success: false } } }), false);
    assert.equal(effectSucceeded({ effects: { status: { status: 'success' } } }), true);
});

test('successive submissions wait for the prior gas-object version to finalize', async () => {
    const calls = [];
    const client = {
        waitForTransaction: async input => calls.push(input),
    };
    const digest = await waitForFinality(client, {
        $kind: 'Transaction',
        Transaction: { digest: 'canary-digest', status: { success: true } },
    });
    assert.equal(digest, 'canary-digest');
    assert.deepEqual(calls, [{ digest: 'canary-digest' }]);
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

const jsonResponse = payload => ({ ok: true, json: async () => payload });
const dexPayload = value => ({ pairs: [{
    baseToken: { address: COIN }, liquidity: { usd: '50000' }, marketCap: String(value),
}] });

test('HTTP deadline includes a stalled JSON body after headers arrive', async () => {
    const fetchImpl = async (_url, { signal }) => ({
        ok: true,
        json: () => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    });
    await assert.rejects(fetchJsonWithTimeout(fetchImpl, 'https://example.invalid', {}, 10), /timed out/);
});

test('transient reads retry with bounded backoff, then return the recovered payload', async () => {
    let attempts = 0;
    let cancelled = 0;
    const delays = [];
    const payload = await fetchJson(async () => {
        attempts += 1;
        if (attempts < 3) return { ok: false, status: attempts === 1 ? 503 : 429, body: { cancel: async () => { cancelled += 1; } } };
        return jsonResponse({ recovered: true });
    }, 'https://example.invalid', {}, { sleep: async ms => delays.push(ms) });
    assert.deepEqual(payload, { recovered: true });
    assert.deepEqual(delays, [500, 1000]);
    assert.equal(cancelled, 2);
});

test('read retries stop after three network failures and do not retry permanent errors', async () => {
    let attempts = 0;
    await assert.rejects(fetchJson(async () => {
        attempts += 1;
        throw new TypeError('fetch failed');
    }, 'https://example.invalid', {}, { sleep: async () => {} }), /fetch failed/);
    assert.equal(attempts, 3);
    attempts = 0;
    await assert.rejects(fetchJson(async () => {
        attempts += 1;
        return { ok: false, status: 401 };
    }, 'https://example.invalid'), /HTTP 401/);
    assert.equal(attempts, 1);
});

test('cached market data retains its acquisition time and refreshes at the TTL', async () => {
    let clock = 100_000;
    let requests = 0;
    const fetchImpl = async () => jsonResponse(dexPayload(++requests));
    const schedule = { coinType: COIN, triggerKind: 1 };
    const cache = new Map();
    const first = await fetchObservation(schedule, fetchImpl, cache, () => clock);
    clock += 29_999;
    const cached = await fetchObservation(schedule, fetchImpl, cache, () => clock);
    assert.equal(cached.fetchedAtMs, first.fetchedAtMs);
    assert.equal(cached.observedValue, 1n);
    clock += 1;
    const fresh = await fetchObservation(schedule, fetchImpl, cache, () => clock);
    assert.equal(fresh.observedValue, 2n);
    assert.equal(fresh.fetchedAtMs, 130_000n);
    assert.equal(requests, 2);
});

test('a failed market fetch is evicted so later schedules can recover', async () => {
    let requests = 0;
    const fetchImpl = async () => ++requests === 1 ? { ok: false, status: 400 } : jsonResponse(dexPayload(42));
    const schedule = { coinType: COIN, triggerKind: 1 };
    const cache = new Map();
    await assert.rejects(fetchObservation(schedule, fetchImpl, cache), /HTTP 400/);
    assert.equal(cache.size, 0);
    assert.equal((await fetchObservation(schedule, fetchImpl, cache)).observedValue, 42n);
});

test('old or replayed observations are rejected locally before spending gas', () => {
    const schedule = { lastObservedAtMs: 0n };
    const observation = { fetchedAtMs: 100_000n };
    assert.equal(observationTimestamp(schedule, observation, 120_000n, 101_000n), 70_000n);
    assert.throws(() => observationTimestamp(schedule, observation, 30_000n, 101_000n), /too old/);
    assert.throws(() => observationTimestamp(schedule, observation, 600_000n, 400_000n), /too old/);
    assert.throws(() => observationTimestamp({ lastObservedAtMs: 70_000n }, observation, 120_000n, 101_000n), /does not advance/);
});

test('missing connections and broken pagination fail closed instead of reporting zero pending', async () => {
    for (const objects of [null, {}, { nodes: [], pageInfo: {} }, { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } }]) {
        await assert.rejects(querySchedules('https://example.invalid', PACKAGE, async () => jsonResponse({ data: { objects } })), /incomplete|did not advance/);
    }
    let requests = 0;
    await assert.rejects(querySchedules('https://example.invalid', PACKAGE, async () => {
        requests += 1;
        return jsonResponse({ data: { objects: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' } } } });
    }), /did not advance/);
    assert.equal(requests, 2);
});

test('duplicate indexed objects are serviced once even when pagination overlaps', async () => {
    let requests = 0;
    const objects = await querySchedules('https://example.invalid', PACKAGE, async () => {
        requests += 1;
        return jsonResponse({ data: { objects: {
            nodes: [{ address: normalizeAddress('0x1') }],
            pageInfo: { hasNextPage: requests === 1, endCursor: 'next' },
        } } });
    });
    assert.equal(objects.length, 1);
    assert.equal(requests, 2);
});

test('discovery resolves the defining package and rejects an unrelated package', async () => {
    const response = origins => jsonResponse({ data: { object: { asMovePackage: { typeOrigins: origins } } } });
    assert.equal(await queryScheduleTypeOrigin('https://example.invalid', PACKAGE, async () => response([
        { module: 'sluice_v2', struct: 'VestingScheduleV2', definingId: '0x1234' },
    ])), normalizeAddress('0x1234'));
    await assert.rejects(queryScheduleTypeOrigin('https://example.invalid', PACKAGE, async () => response([])), /does not define/);
});

test('invalid oracle thresholds and duplicate keys fail before submission', () => {
    const key = new Ed25519Keypair();
    const pubkey = Array.from(key.getPublicKey().toRawBytes());
    for (const threshold of [0, -1, 0.5, NaN, 2]) {
        assert.throws(() => matchOracleSigners([pubkey], threshold, [key]), /invalid oracle policy/);
    }
    assert.throws(() => matchOracleSigners([pubkey, pubkey], 2, [key]), /invalid oracle policy/);
});

function runFixture(t, { malformedFirst = false, expireDuringFetch = false, failSubmission = false } = {}) {
    const key = new Ed25519Keypair();
    const origin = normalizeAddress('0x1234');
    let clock = 100_000;
    let discoveryType;
    let dexRequests = 0;
    const commands = [];
    const schedule = {
        address: normalizeAddress('0x1'),
        asMoveObject: { contents: {
            type: { repr: `${origin}::sluice_v2::VestingScheduleV2<${COIN}>` },
            json: {
                creator: '0x2', beneficiary: '0x3', status: 0, trigger_kind: 1,
                max_observation_age_ms: '120000', min_liquidity_usd: '10000',
                trigger_deadline_ms: expireDuringFetch ? '101000' : '0',
                oracle_pubkeys: [Buffer.from(key.getPublicKey().toRawBytes()).toString('base64')],
                oracle_threshold: 1,
                trigger_config_hash: Array.from(crypto.createHash('sha256').update(canonicalTriggerConfig({
                    coinType: COIN, triggerKind: 1, minLiquidityUsd: 10_000n,
                })).digest()),
            },
        } },
    };
    const nodes = malformedFirst ? [{ address: normalizeAddress('0x99'), asMoveObject: null }, schedule] : [schedule];
    const fetchImpl = async (url, options) => {
        if (url.includes('dexscreener')) {
            dexRequests += 1;
            if (expireDuringFetch) clock = 102_000;
            return jsonResponse(dexPayload(1_000_000));
        }
        const { query, variables } = JSON.parse(options.body);
        if (query.includes('typeOrigins')) return jsonResponse({ data: { object: { asMovePackage: {
            typeOrigins: [{ module: 'sluice_v2', struct: 'VestingScheduleV2', definingId: origin }],
        } } } });
        discoveryType = variables.type;
        return jsonResponse({ data: { objects: { nodes, pageInfo: { hasNextPage: false } } } });
    };
    // Intercept the signing boundary: inspect real transaction commands without
    // executing a transaction or requiring an RPC transaction-builder fixture.
    t.mock.method(Ed25519Keypair.prototype, 'signAndExecuteTransaction', async ({ transaction }) => {
        commands.push(transaction.getData().commands[0].MoveCall);
        if (failSubmission) throw new Error('submission unavailable');
        return { Transaction: { digest: 'test-digest', status: { success: true } } };
    });
    const client = { waitForTransaction: async () => {} };
    return {
        options: { packageId: PACKAGE, graphqlUrl: 'https://example.invalid', oracleSecrets: [key.getSecretKey()], gasSecret: key.getSecretKey(), client, fetchImpl, now: () => clock },
        result: () => ({ commands, dexRequests, discoveryType, origin }),
    };
}

test('upgraded relayer scans original types but submits through the configured implementation', async t => {
    const fixture = runFixture(t);
    const result = await run(fixture.options);
    const observed = fixture.result();
    assert.equal(result.submitted, 1);
    assert.equal(observed.discoveryType, `${observed.origin}::sluice_v2::VestingScheduleV2`);
    assert.equal(observed.commands[0].package, PACKAGE);
    assert.equal(observed.commands[0].function, 'submit_observation');
});

test('deadline crossed during market read resolves fallback without signing an observation', async t => {
    const fixture = runFixture(t, { expireDuringFetch: true });
    const result = await run(fixture.options);
    assert.equal(result.submitted, 1);
    assert.deepEqual(fixture.result().commands.map(call => call.function), ['resolve_expired_trigger']);
});

test('a malformed schedule cannot prevent later valid schedules from being serviced', async t => {
    const fixture = runFixture(t, { malformedFirst: true });
    await assert.rejects(run(fixture.options), /1 schedule\(s\) could not be serviced/);
    assert.equal(fixture.result().commands.length, 1);
    assert.equal(fixture.result().dexRequests, 1);
});

test('submission failures are reported without blindly resubmitting transactions', async t => {
    const fixture = runFixture(t, { failSubmission: true });
    await assert.rejects(run(fixture.options), /1 schedule\(s\) could not be serviced/);
    assert.equal(fixture.result().commands.length, 1);
});
