(function (root) {
    'use strict';

    const CREDIT_SCALE = 1_000_000_000n;
    const ACCRUAL_PRECISION = 1_000_000_000_000_000n;
    const MILLISECONDS_PER_HOUR = 3_600_000n;
    const EMISSION_MULTIPLIER = 10n;
    const BASIS_POINTS = 10_000n;

    function toBigInt(value) {
        try {
            return BigInt(value ?? '0');
        } catch (_) {
            return 0n;
        }
    }

    function toNumber(value) {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function ownerAddress(owner) {
        if (!owner) return '';
        if (typeof owner.AddressOwner === 'string') return owner.AddressOwner;
        if (typeof owner.address === 'string') return owner.address;
        if (typeof owner.owner?.address === 'string') return owner.owner.address;
        return '';
    }

    function parseStakeObject(object) {
        const data = object?.data || object || {};
        const fields = data.content?.fields || data.fields;
        const address = ownerAddress(data.owner);
        if (!fields || !address) return null;

        return {
            objectId: data.objectId || fields.id?.id || fields.id || '',
            address,
            stakedAmountAtomic: toBigInt(fields.staked_amount ?? fields.principal?.fields?.value),
            lockEndMs: toNumber(fields.lock_end_ms),
            lastAccrualMs: toNumber(fields.last_accrual_ms),
            multiplierBps: toNumber(fields.multiplier_bps),
            unclaimedCreditsAtomic: toBigInt(fields.unclaimed_credits),
            claimedCreditsAtomic: toBigInt(fields.claimed_credits),
        };
    }

    function calculateAccruedCredits(stake, elapsedMs) {
        const duration = toBigInt(elapsedMs);
        if (!stake || duration <= 0n || stake.stakedAmountAtomic <= 0n) return 0n;
        return stake.stakedAmountAtomic
            * duration
            * BigInt(stake.multiplierBps)
            * EMISSION_MULTIPLIER
            * CREDIT_SCALE
            / (MILLISECONDS_PER_HOUR * ACCRUAL_PRECISION * BASIS_POINTS);
    }

    function calculateCurrentUnclaimed(stake, nowMs = Date.now()) {
        if (!stake) return 0n;
        if (stake.stakedAmountAtomic <= 0n) return stake.unclaimedCreditsAtomic;

        const accrualEndMs = Math.min(toNumber(nowMs), stake.lockEndMs);
        if (accrualEndMs <= stake.lastAccrualMs) return stake.unclaimedCreditsAtomic;

        return stake.unclaimedCreditsAtomic
            + calculateAccruedCredits(stake, BigInt(accrualEndMs - stake.lastAccrualMs));
    }

    function descendingBy(field) {
        return (left, right) => {
            if (left[field] > right[field]) return -1;
            if (left[field] < right[field]) return 1;
            return left.address.localeCompare(right.address);
        };
    }

    function aggregateStakeObjects(objects, nowMs = Date.now()) {
        const positions = objects.map(parseStakeObject).filter(Boolean);
        const byAddress = new Map();
        let tvlAtomic = 0n;

        positions.forEach((stake) => {
            const unclaimedCreditsAtomic = calculateCurrentUnclaimed(stake, nowMs);
            const current = byAddress.get(stake.address) || {
                address: stake.address,
                claimedCreditsAtomic: 0n,
                unclaimedCreditsAtomic: 0n,
                totalCreditsAtomic: 0n,
                stakedAtomic: 0n,
                positionCount: 0,
                activePositionCount: 0,
            };

            current.claimedCreditsAtomic += stake.claimedCreditsAtomic;
            current.unclaimedCreditsAtomic += unclaimedCreditsAtomic;
            current.totalCreditsAtomic += stake.claimedCreditsAtomic + unclaimedCreditsAtomic;
            current.stakedAtomic += stake.stakedAmountAtomic;
            current.positionCount += 1;
            if (stake.stakedAmountAtomic > 0n) current.activePositionCount += 1;
            byAddress.set(stake.address, current);
            tvlAtomic += stake.stakedAmountAtomic;
        });

        const stakers = [...byAddress.values()];
        return {
            positions,
            stakers,
            tvlAtomic,
            activeStakers: stakers.filter((entry) => entry.stakedAtomic > 0n).length,
            claimedLeaderboard: stakers
                .filter((entry) => entry.claimedCreditsAtomic > 0n)
                .sort(descendingBy('claimedCreditsAtomic')),
            totalLeaderboard: stakers
                .filter((entry) => entry.totalCreditsAtomic > 0n)
                .sort(descendingBy('totalCreditsAtomic')),
        };
    }

    async function queryAllStakeObjects({ rpc, packageIds, coinType, pageSize = 50, onProgress }) {
        if (typeof rpc !== 'function') throw new Error('A Sui RPC function is required');
        if (!Array.isArray(packageIds) || packageIds.length === 0) throw new Error('At least one staking package is required');
        if (!coinType) throw new Error('The staked coin type is required');

        const objects = [];
        const seenObjectIds = new Set();

        for (const packageId of packageIds) {
            const structType = `${packageId}::city_staking::UserStake<${coinType}>`;
            const seenCursors = new Set();
            let cursor = null;
            let page = 0;

            for (;;) {
                const response = await rpc('suix_queryObjects', [
                    {
                        filter: { StructType: structType },
                        options: { showType: true, showOwner: true, showContent: true },
                    },
                    cursor,
                    pageSize,
                ]);

                page += 1;
                for (const object of response?.data || []) {
                    const objectId = object?.data?.objectId || object?.objectId || '';
                    const dedupeKey = objectId || `${packageId}:${objects.length}`;
                    if (seenObjectIds.has(dedupeKey)) continue;
                    seenObjectIds.add(dedupeKey);
                    objects.push(object);
                }

                onProgress?.({ packageId, page, objectCount: objects.length });
                if (!response?.hasNextPage) break;
                if (!response.nextCursor || seenCursors.has(response.nextCursor)) {
                    throw new Error('Sui object pagination returned an invalid cursor');
                }
                seenCursors.add(response.nextCursor);
                cursor = response.nextCursor;
            }
        }

        return objects;
    }

    async function loadSnapshot(options) {
        const objects = await queryAllStakeObjects(options);
        return aggregateStakeObjects(objects, options?.nowMs ?? Date.now());
    }

    root.AlphaCityStakingCredits = Object.freeze({
        CREDIT_SCALE,
        parseStakeObject,
        calculateAccruedCredits,
        calculateCurrentUnclaimed,
        aggregateStakeObjects,
        queryAllStakeObjects,
        loadSnapshot,
    });
})(typeof window !== 'undefined' ? window : globalThis);
