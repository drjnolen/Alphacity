'use strict';

const crypto = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const { SuiGrpcClient } = require('@mysten/sui/grpc');
const { Transaction } = require('@mysten/sui/transactions');
const { normalizeAddress, observationFromPairs } = require('../shared/sluice-core.cjs');
const moon = require('../shared/moonordie-core.cjs');
const {
    keypairFromSecret, nestedByteVectors, matchOracleSigners, queryScheduleTypeOrigin,
    querySchedules, fetchDexPairs, effectSucceeded, waitForFinality,
} = require('./sluice-relayer.js');

function required(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function verifyConfig(commitment) {
    const expected = crypto.createHash('sha256').update(moon.configText(commitment)).digest();
    const actual = Buffer.from(commitment.configHash);
    if (actual.length !== 32 || !crypto.timingSafeEqual(expected, actual)) {
        throw new Error('Unsupported Moon or Die observation policy');
    }
}

async function execute({ client, gasKeypair, packageId, commitment, action, sample, signers }) {
    const tx = new Transaction();
    if (action === 'success') {
        const message = moon.encodeObservation({ id: commitment.id, configHash: commitment.configHash, ...sample });
        const signatures = await Promise.all(signers.map(async signer => Array.from(await signer.keypair.sign(message))));
        tx.moveCall({
            target: `${packageId}::moonordie::submit_success`, typeArguments: [commitment.coinType],
            arguments: [tx.object(commitment.id), tx.pure.u64(sample.marketCap), tx.pure.u64(sample.observedAtMs),
                tx.pure.vector('u8', signers.map(signer => signer.index)),
                tx.pure.vector('vector<u8>', signatures), tx.object('0x6')],
        });
    } else if (action === 'dispose') {
        tx.moveCall({ target: `${packageId}::moonordie::dispose`, typeArguments: [commitment.coinType],
            arguments: [tx.object(commitment.id), tx.object('0x6')] });
    } else throw new Error('Unknown keeper action');
    const result = await gasKeypair.signAndExecuteTransaction({ transaction: tx, client, include: { effects: true } });
    if (!effectSucceeded(result)) throw new Error('Moon or Die transaction failed; inspect chain state before retrying');
    return waitForFinality(client, result);
}

async function run(options = {}) {
    const packageId = normalizeAddress(options.packageId || required('MOONORDIE_PACKAGE_ADDRESS'));
    const network = options.network || process.env.SUI_NETWORK || 'mainnet';
    if (!['mainnet', 'testnet'].includes(network)) throw new Error('Unsupported network');
    const graphqlUrl = options.graphqlUrl || process.env.SUI_GRAPHQL_URL || `https://graphql.${network}.sui.io/graphql`;
    const client = options.client || new SuiGrpcClient({ network, baseUrl: process.env.SUI_GRPC_URL || `https://fullnode.${network}.sui.io:443` });
    const oracleKeypairs = (options.oracleSecrets || required('MOONORDIE_ORACLE_PRIVATE_KEYS').split(/[\s,]+/).filter(Boolean)).map(keypairFromSecret);
    const gasKeypair = options.gasKeypair || keypairFromSecret(required('MOONORDIE_RELAYER_PRIVATE_KEY'));
    const fetchImpl = options.fetchImpl || fetch;
    const now = options.now || Date.now;
    const dryRun = options.dryRun ?? process.env.MOONORDIE_DRY_RUN === 'true';
    const typeOrigin = await queryScheduleTypeOrigin(graphqlUrl, packageId, fetchImpl, 'moonordie', 'Commitment');
    // A dedicated immutable publication should never be configured as an upgrade.
    if (typeOrigin !== packageId) throw new Error('Moon or Die must use its original immutable publication');
    const objects = await querySchedules(graphqlUrl, typeOrigin, fetchImpl, 'moonordie', 'Commitment');
    if (!dryRun) {
        const { balance } = await client.core.getBalance({ owner: gasKeypair.toSuiAddress(), signal: AbortSignal.timeout(15_000) });
        if (BigInt(balance.balance) < 50_000_000n) console.error('Moon or Die gas sponsor is below 0.05 SUI; refill before transactions stop');
    }
    const counts = { indexed: objects.length, pending: 0, submitted: 0, failed: 0 };
    const cache = new Map();
    for (const object of objects) {
        try {
            const commitment = moon.parseCommitment(object);
            if (commitment.status !== moon.STATUSES.PENDING) continue;
            counts.pending += 1;
            verifyConfig(commitment);
            const fields = object.data.content.fields;
            const signers = matchOracleSigners(nestedByteVectors(fields.oracle_pubkeys), Number(fields.oracle_threshold), oracleKeypairs);
            let action = moon.keeperAction(commitment, null, BigInt(now()));
            let sample;
            if (action !== 'dispose') {
                let entry = cache.get(commitment.coinType);
                if (!entry || now() - entry.receivedAt >= 30_000 || now() < entry.receivedAt) {
                    const pairs = await fetchDexPairs(commitment.coinType, fetchImpl);
                    // Never backdate market data by Sluice's 30-second skew buffer:
                    // that could turn a post-deadline price into apparent success.
                    entry = { pairs, receivedAt: now() };
                    cache.set(commitment.coinType, entry);
                }
                sample = { marketCap: observationFromPairs(commitment, entry.pairs).observedValue, observedAtMs: BigInt(entry.receivedAt) };
                action = moon.keeperAction(commitment, sample, BigInt(now()));
            }
            if (action === 'none') continue;
            if (dryRun) console.log(`[dry-run] ${commitment.id}: ${action}`);
            else {
                const digest = await execute({ client, gasKeypair, packageId, commitment, action, sample, signers });
                counts.submitted += 1;
                console.log(`${commitment.id}: ${action} ${digest}`);
            }
        } catch (error) {
            counts.failed += 1;
            console.error(`${object?.data?.objectId || 'unknown'}: ${error.message}`);
        }
    }
    console.log(JSON.stringify({ service: 'moonordie', checkedAt: new Date(now()).toISOString(), ...counts }));
    if (counts.failed) throw new Error(`${counts.failed} Moon or Die commitment(s) could not be serviced`);
    return counts;
}

async function main() {
    if (!process.argv.includes('--watch')) return run();
    const interval = Number(process.env.MOONORDIE_POLL_MS || 30_000);
    if (!Number.isInteger(interval) || interval < 10_000 || interval > 60_000) throw new Error('MOONORDIE_POLL_MS must be 10000–60000');
    const shutdown = new AbortController();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown.abort());
    while (!shutdown.signal.aborted) {
        const started = Date.now();
        try { await run(); }
        catch (error) { console.error(`Moon or Die scan failed: ${error.message}`); }
        if (Date.now() - started > interval) console.error('Moon or Die scan exceeded its polling interval; keeper capacity needs attention');
        await sleep(Math.max(1000, interval - (Date.now() - started)), null, { signal: shutdown.signal }).catch(error => {
            if (!shutdown.signal.aborted) throw error;
        });
    }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run, execute, verifyConfig };
