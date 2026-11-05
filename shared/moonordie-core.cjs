'use strict';

const { bcs } = require('@mysten/sui/bcs');
const { normalizeAddress, normalizeCoinType, readU64, canonicalTriggerConfig } = require('./sluice-core.cjs');
const DOMAIN = 'alphacity.sluice.moonordie.v1.observation';
const MAX_AGE_MS = 120_000n;
const U64_MAX = 18_446_744_073_709_551_615n;
const STATUSES = Object.freeze({ PENDING: 0, SUCCESS: 1, CLAIMED: 2, DISPOSED: 3 });
const Observation = bcs.struct('MoonObservation', {
    domain: bcs.vector(bcs.u8()), commitment_id: bcs.Address,
    config_hash: bcs.vector(bcs.u8()), market_cap: bcs.u64(), observed_at_ms: bcs.u64(),
});

function configText({ coinType, minLiquidityUsd = 0n }) {
    return JSON.stringify({
        mode: 'moonordie-v1', settlement: 'recorded-on-chain-before-deadline',
        feed: JSON.parse(canonicalTriggerConfig({ coinType, triggerKind: 1, minLiquidityUsd })),
    });
}

function encodeObservation({ id, configHash, marketCap, observedAtMs }) {
    return Observation.serialize({
        domain: Array.from(new TextEncoder().encode(DOMAIN)), commitment_id: normalizeAddress(id),
        config_hash: Array.from(configHash), market_cap: String(marketCap), observed_at_ms: String(observedAtMs),
    }).toBytes();
}

function bytes(value) {
    if (Array.isArray(value)) return value.map(Number);
    if (value?.fields) return bytes(value.fields);
    if (typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value)) {
        return (value.slice(2).match(/../g) || []).map(byte => parseInt(byte, 16));
    }
    if (typeof value === 'string') return Array.from(atob(value), c => c.charCodeAt(0));
    return [];
}

function parseCommitment(object) {
    const data = object?.data || object;
    const fields = data?.content?.fields;
    const type = data?.content?.type || '';
    const match = type.match(/^0x[0-9a-f]+::moonordie::Commitment<(.+)>$/i);
    if (!match || !fields || ![0, 1, 2, 3].includes(Number(fields.status))) throw new Error('Invalid Moon or Die commitment');
    const totalAmount = readU64(fields.total_amount);
    const status = Number(fields.status);
    const frozen = fields.disposed_coin?.vec || fields.disposed_coin?.fields?.vec || fields.disposed_coin;
    return {
        id: normalizeAddress(data.objectId), mode: 'moonordie', version: 3,
        objectType: type, coinType: normalizeCoinType(match[1]),
        creator: normalizeAddress(fields.creator), beneficiary: normalizeAddress(fields.beneficiary),
        totalAmount, balance: readU64(fields.balance), status,
        releasedAmount: status === STATUSES.CLAIMED ? totalAmount : 0n,
        startTimeMs: readU64(fields.created_at_ms), endTimeMs: readU64(fields.deadline_ms),
        targetValue: readU64(fields.target_market_cap), minLiquidityUsd: readU64(fields.min_liquidity_usd),
        triggerKind: 1, comparison: 0, revocable: false,
        configHash: bytes(fields.config_hash), clientReference: bytes(fields.client_reference),
        disposedCoin: typeof frozen === 'string' ? normalizeAddress(frozen)
            : Array.isArray(frozen) && frozen.length ? normalizeAddress(frozen[0]) : null,
    };
}

function validateCreate({ amount, beneficiary, target, deadline, minLiquidity, now }) {
    for (const [label, value] of Object.entries({ amount, target, deadline, minLiquidity })) {
        if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) throw new Error(`${label} is outside the supported integer range`);
    }
    if (amount === 0n || target === 0n) throw new Error('Amount and market-cap target must be positive');
    if (normalizeAddress(beneficiary) === normalizeAddress('0x0')) throw new Error('Beneficiary cannot be the zero address');
    if (deadline <= now) throw new Error('Moon or Die requires a future deadline');
}

function keeperAction(c, sample, now) {
    if (c.status !== STATUSES.PENDING) return 'none';
    if (now >= c.endTimeMs) return 'dispose';
    if (!sample || sample.observedAtMs < c.startTimeMs || sample.observedAtMs > now
        || now - sample.observedAtMs >= MAX_AGE_MS) return 'none';
    return sample.marketCap >= c.targetValue ? 'success' : 'none';
}

module.exports = { DOMAIN, MAX_AGE_MS, STATUSES, configText, encodeObservation, parseCommitment, validateCreate, keeperAction };
