'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const moon = require('../shared/moonordie-core.cjs');
const { normalizeAddress, normalizeCoinType } = require('../shared/sluice-core.cjs');
const { run } = require('../scripts/moonordie-keeper.js');
const { immutablePublishTransaction } = require('../scripts/moonordie-publish.js');
const PACKAGE = normalizeAddress('0xabc');
const COIN = normalizeCoinType('0x123::test::TEST');
const json = payload => ({ ok: true, json: async () => payload });

test('keeper decisions preserve permanent success and the strict deadline boundary', () => {
    const c = { status: 0, startTimeMs: 100n, endTimeMs: 1000n, targetValue: 1_000_000n };
    const sample = { marketCap: 1_000_000n, observedAtMs: 999n };
    assert.equal(moon.keeperAction(c, sample, 999n), 'success');
    assert.equal(moon.keeperAction(c, sample, 1000n), 'dispose');
    assert.equal(moon.keeperAction(c, { ...sample, marketCap: 999_999n }, 999n), 'none');
    assert.equal(moon.keeperAction(c, { ...sample, observedAtMs: 99n }, 999n), 'none');
    assert.equal(moon.keeperAction(c, { ...sample, observedAtMs: 1000n }, 999n), 'none');
    for (const status of [1, 2, 3]) assert.equal(moon.keeperAction({ ...c, status }, null, 2000n), 'none');
});

test('creation rejects zero beneficiary, past deadlines, and u64 overflow', () => {
    const valid = { amount: 500n, beneficiary: '0x1', target: 1_000_000n, deadline: 2000n, minLiquidity: 10_000n, now: 1000n };
    assert.doesNotThrow(() => moon.validateCreate(valid));
    assert.throws(() => moon.validateCreate({ ...valid, beneficiary: '0x0' }), /zero address/);
    assert.throws(() => moon.validateCreate({ ...valid, deadline: 1000n }), /future/);
    assert.throws(() => moon.validateCreate({ ...valid, amount: 2n ** 64n }), /range/);
});

test('JavaScript observation bytes match the successful real-signature Move test vector', async () => {
    const message = moon.encodeObservation({ id: '0x5ef2fcf809fb9535ea0aeaea421f683026f06c34569aafc42bcde652ef6dd270', configHash: Array(32).fill(7), marketCap: 1_000_000n, observedAtMs: 1500n });
    const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(1));
    const signature = Buffer.from(await key.sign(message)).toString('hex');
    assert.equal(signature, 'e227a11fd8bed62f6d97f96578e320104b845ef2cb5c0e33cc03b5246fcc356a0b0e7b973b8af78c9bd37e8b706474ed6c93a7a2c1895684546376816b50d90c');
    assert.equal(await key.getPublicKey().verify(message, Buffer.from(signature, 'hex')), true);
    const other = moon.encodeObservation({ id: '0x2', configHash: Array(32).fill(7), marketCap: 1_000_000n, observedAtMs: 1500n });
    assert.equal(await key.getPublicKey().verify(other, Buffer.from(signature, 'hex')), false);
});

function fixture(t, { clock = 100_000, deadline = 200_000, value = 1_000_000,
    status = 0, fetchEndsAt, failedFeed = false, wrongConfig = false, failTransaction = false,
    malformedFirst = false, wrongToken = false } = {}) {
    const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(2));
    const configHash = crypto.createHash('sha256').update(moon.configText({ coinType: COIN, minLiquidityUsd: 10_000n })).digest();
    const node = { address: normalizeAddress('0x1'), asMoveObject: { contents: {
        type: { repr: `${PACKAGE}::moonordie::Commitment<${COIN}>` }, json: {
            creator: '0x2', beneficiary: '0x3', balance: '500', total_amount: '500',
            created_at_ms: '1000', deadline_ms: String(deadline), target_market_cap: '1000000', min_liquidity_usd: '10000',
            config_hash: (wrongConfig ? Buffer.alloc(32) : configHash).toString('base64'),
            oracle_pubkeys: [Buffer.from(key.getPublicKey().toRawBytes()).toString('base64')], oracle_threshold: 1, status,
        },
    } } };
    const transactions = [];
    const observations = [];
    let reads = 0;
    let finality = 0;
    t.mock.method(Ed25519Keypair.prototype, 'signAndExecuteTransaction', async ({ transaction }) => {
        transactions.push(transaction.getData());
        if (failTransaction) throw new Error('Unknown submission outcome');
        return { Transaction: { digest: 'test-digest', status: { success: true } } };
    });
    const originalSign = key.sign.bind(key);
    t.mock.method(Ed25519Keypair.prototype, 'sign', async bytes => {
        observations.push(bytes);
        return originalSign(bytes);
    });
    const fetchImpl = async (url, options) => {
        if (url.includes('dexscreener')) {
            reads += 1;
            if (fetchEndsAt != null) clock = fetchEndsAt;
            if (failedFeed) return { ok: false, status: 400 };
            return json({ pairs: [{ baseToken: { address: wrongToken ? '0x999::other::OTHER' : COIN },
                marketCap: value, fdv: 50_000_000, liquidity: { usd: 50_000 } }] });
        }
        const request = JSON.parse(options.body);
        if (request.query.includes('typeOrigins')) return json({ data: { object: { asMovePackage: { typeOrigins: [
            { module: 'moonordie', struct: 'Commitment', definingId: PACKAGE },
        ] } } } });
        assert.equal(request.variables.type, `${PACKAGE}::moonordie::Commitment`);
        return json({ data: { objects: { pageInfo: { hasNextPage: false }, nodes:
            malformedFirst ? [{ address: '0x99' }, node] : [node] } } });
    };
    return {
        options: { packageId: PACKAGE, graphqlUrl: 'https://example.invalid', oracleSecrets: [key.getSecretKey()], gasKeypair: key,
            client: { core: { getBalance: async () => ({ balance: { balance: '1000000000' } }) },
                waitForTransaction: async () => { finality += 1; } }, fetchImpl, now: () => clock },
        state: () => ({ transactions, observations, reads, finality }),
        node,
    };
}

test('qualifying observation is signed once and submits success through the dedicated module', async t => {
    const f = fixture(t);
    const result = await run(f.options);
    assert.equal(result.submitted, 1);
    const { transactions, observations, finality } = f.state();
    assert.equal(transactions[0].commands[0].MoveCall.function, 'submit_success');
    assert.equal(transactions[0].commands[0].MoveCall.module, 'moonordie');
    assert.equal(observations.length, 1);
    assert.equal(finality, 1);
});

test('below-target market cap never substitutes FDV or spends transaction gas', async t => {
    const f = fixture(t, { value: 999_999 });
    const result = await run(f.options);
    assert.equal(result.submitted, 0);
    assert.equal(f.state().reads, 1);
    assert.equal(f.state().observations.length, 0);
});

test('expiry automatically disposes without depending on a working market feed', async t => {
    const f = fixture(t, { clock: 200_000, failedFeed: true });
    await run(f.options);
    assert.equal(f.state().reads, 0);
    assert.equal(f.state().transactions[0].commands[0].MoveCall.function, 'dispose');
});

test('a response arriving at the deadline is never backdated into a winning sample', async t => {
    const f = fixture(t, { clock: 199_999, fetchEndsAt: 200_000 });
    await run(f.options);
    assert.equal(f.state().observations.length, 0);
    assert.equal(f.state().transactions[0].commands[0].MoveCall.function, 'dispose');
});

test('successful commitments are never disposed even after their deadline', async t => {
    const f = fixture(t, { status: 1, clock: 300_000 });
    assert.equal((await run(f.options)).pending, 0);
    assert.equal(f.state().reads, 0);
    assert.equal(f.state().transactions.length, 0);
});

test('wrong token, unavailable market cap, and unsupported policy fail closed', async t => {
    for (const settings of [{ wrongToken: true }, { value: null }, { wrongConfig: true }]) {
        const f = fixture(t, settings);
        await assert.rejects(run(f.options), /could not be serviced/);
        assert.equal(f.state().transactions.length, 0);
        t.mock.restoreAll();
    }
});

test('feed failure before deadline does not turn into immediate disposal', async t => {
    const f = fixture(t, { failedFeed: true });
    await assert.rejects(run(f.options), /could not be serviced/);
    assert.equal(f.state().transactions.length, 0);
});

test('one malformed record does not starve valid commitments', async t => {
    const f = fixture(t, { malformedFirst: true });
    await assert.rejects(run(f.options), /1 Moon or Die/);
    assert.equal(f.state().transactions.length, 1);
});

test('uncertain transaction outcomes are not blindly retried', async t => {
    const f = fixture(t, { failTransaction: true });
    await assert.rejects(run(f.options), /could not be serviced/);
    assert.equal(f.state().transactions.length, 1);
});

test('dry-run inspects commitments without signing or sending transactions', async t => {
    const f = fixture(t);
    await run({ ...f.options, dryRun: true });
    assert.equal(f.state().transactions.length, 0);
    assert.equal(f.state().observations.length, 0);
});

test('immutable publish transaction consumes the UpgradeCap instead of retaining administrator control', () => {
    const tx = immutablePublishTransaction({ modules: ['AA=='], dependencies: [normalizeAddress('0x2')] }).getData();
    assert.equal(tx.commands.length, 2);
    assert.equal(tx.commands[1].MoveCall.function, 'make_immutable');
    assert.equal(tx.commands[1].MoveCall.module, 'package');
    assert.deepEqual(tx.commands[1].MoveCall.arguments[0].NestedResult, [0, 0]);
});

test('Sluice mode is opt-in, deployment gated, and uses the existing visual stylesheet', () => {
    const root = path.resolve(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'sluice/index.html'), 'utf8');
    const source = fs.readFileSync(path.join(root, 'sluice/app-source.js'), 'utf8');
    assert.match(html, /id="schedule-mode"/);
    assert.match(html, /id="moon-fields" hidden disabled/);
    assert.match(html, /id="moon-acknowledge"[^>]*required/);
    assert.match(source, /CONFIG\.moonordieReady === true/);
    assert.match(source, /if \(creationInProgress\) return/);
    assert.match(source, /moon\.validateCreate/);
    assert.match(html, /sluice\.css\?v=6/);
    assert.doesNotMatch(html, /style=/);
});
