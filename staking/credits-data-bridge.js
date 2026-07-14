(function () {
    'use strict';

    const STAKING_PACKAGE = '0x008856d5d6d60a088f6153dbe6f7697d19f81d1d0403695c9e9fbaecdc8b29a9';
    const CITY_TYPE = '0x308fa16c7aead43e3a49a4ff2e76205ba2a12697234f4fe80a2da66515284060::city::CITY';
    const EVENT_PREFIX = `${STAKING_PACKAGE}::city_staking::`;
    const SUPPORTED_EVENTS = new Set(['StakeCreated', 'StakeIncreased', 'Unstaked', 'CreditsClaimed']);
    const CACHE_TTL_MS = 30_000;

    if (!window.AlphaCitySui?.rpc || !window.AlphaCityStakingCredits?.loadSnapshot) return;

    const rpc = window.AlphaCitySui.rpc.bind(window.AlphaCitySui);
    let cachedSnapshot = null;
    let cachedAt = 0;
    let pendingSnapshot = null;

    async function getSnapshot() {
        if (cachedSnapshot && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSnapshot;
        if (!pendingSnapshot) {
            pendingSnapshot = window.AlphaCityStakingCredits.loadSnapshot({
                rpc,
                packageIds: [STAKING_PACKAGE],
                coinType: CITY_TYPE,
            }).then((snapshot) => {
                cachedSnapshot = snapshot;
                cachedAt = Date.now();
                return snapshot;
            }).finally(() => {
                pendingSnapshot = null;
            });
        }
        return pendingSnapshot;
    }

    function syntheticEvents(snapshot, eventName) {
        if (eventName === 'StakeIncreased' || eventName === 'Unstaked') return [];

        return snapshot.positions.map((stake, index) => {
            const parsedJson = eventName === 'StakeCreated'
                ? {
                    stake_id: stake.objectId,
                    staker: stake.address,
                    amount: stake.stakedAmountAtomic.toString(),
                }
                : {
                    stake_id: stake.objectId,
                    staker: stake.address,
                    lifetime_claimed: stake.claimedCreditsAtomic.toString(),
                };

            return {
                id: { txDigest: `stake-state-${stake.objectId}`, eventSeq: String(index) },
                packageId: STAKING_PACKAGE,
                transactionModule: 'city_staking',
                sender: stake.address,
                type: `${EVENT_PREFIX}${eventName}`,
                parsedJson,
                bcs: '',
                timestampMs: String(cachedAt),
            };
        });
    }

    function cursorOffset(cursor) {
        const value = typeof cursor === 'string' ? cursor : cursor?.eventSeq;
        const match = String(value || '').match(/(\d+)$/);
        return match ? Number(match[1]) : 0;
    }

    window.AlphaCitySui.rpc = async function stakingStateRpc(method, params = []) {
        const eventType = params?.[0]?.MoveEventType || '';
        if (method !== 'suix_queryEvents' || !eventType.startsWith(EVENT_PREFIX)) {
            return rpc(method, params);
        }

        const eventName = eventType.slice(EVENT_PREFIX.length);
        if (!SUPPORTED_EVENTS.has(eventName)) return rpc(method, params);

        const snapshot = await getSnapshot();
        const events = syntheticEvents(snapshot, eventName);
        const offset = cursorOffset(params[1]);
        const requestedLimit = Number(params[2] || 50);
        const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 50, 100));
        const data = events.slice(offset, offset + limit);
        const nextOffset = offset + data.length;

        return {
            data,
            hasNextPage: nextOffset < events.length,
            nextCursor: nextOffset < events.length ? `stake-state:${nextOffset}` : null,
        };
    };
})();
