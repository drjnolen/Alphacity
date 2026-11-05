export const FRESH_MS = 15 * 60_000;
export const MAX_STALE_MS = 6 * 60 * 60_000;
const RETRY_MS = 60_000;
const UPSTREAM = 'https://yields.llama.fi/pools';

function number(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function selectSuiPools(payload) {
    if (!payload || !Array.isArray(payload.data) || !payload.data.length) throw new Error('Invalid yields response');
    const seen = new Set();
    return payload.data.filter(pool =>
        pool && String(pool.chain).toLowerCase() === 'sui' &&
        number(pool.tvlUsd) >= 20000 && number(pool.apy) > 0 &&
        typeof pool.pool === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(pool.pool) &&
        typeof pool.project === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(pool.project) &&
        typeof pool.symbol === 'string' && pool.symbol.trim()
    ).sort((a, b) => number(b.apy) - number(a.apy)).filter(pool => {
        if (seen.has(pool.pool)) return false;
        seen.add(pool.pool);
        return true;
    }).slice(0, 5).map(pool => ({
        pool: pool.pool, symbol: pool.symbol.slice(0, 100), project: pool.project,
        tvlUsd: number(pool.tvlUsd), apy: number(pool.apy),
        underlyingTokens: (Array.isArray(pool.underlyingTokens) ? pool.underlyingTokens : [])
            .filter(token => typeof token === 'string' && /^(0x)?[a-fA-F0-9]{1,64}::\w+::\w+$/.test(token)).slice(0, 4),
    }));
}

function json(data, status = 200, stale = false) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': status === 200 && !stale ? 'public, max-age=60' : 'no-store',
            ...(stale || status === 503 ? { 'Retry-After': '60' } : {}),
        },
    });
}

export function createHandler({ fetchImpl = globalThis.fetch, now = Date.now, cache: injectedCache } = {}) {
    let lastGood = null;
    let inFlight = null;
    let retryAfter = 0;
    function usable(snapshot) {
        const age = now() - snapshot?.fetchedAt;
        return snapshot?.version === 1 && Number.isFinite(age) && age >= 0 && age <= MAX_STALE_MS && Array.isArray(snapshot.pools);
    }
    async function refresh(cache, key) {
        if (inFlight) return inFlight;
        inFlight = Promise.resolve().then(async () => {
            try {
                const response = await fetchImpl(UPSTREAM, { signal: AbortSignal.timeout(10000) });
                if (!response.ok) throw new Error('Yields upstream failed');
                const pools = selectSuiPools(await response.json());
                const snapshot = { version: 1, source: 'DefiLlama', fetchedAt: now(), pools };
                lastGood = snapshot;
                retryAfter = 0;
                if (cache) {
                    // The longer internal lifetime preserves a bounded fallback during upstream outages.
                    await cache.put(key, new Response(JSON.stringify(snapshot), {
                        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + MAX_STALE_MS / 1000 },
                    })).catch(() => {});
                }
                return snapshot;
            } catch (error) {
                retryAfter = now() + RETRY_MS;
                throw error;
            } finally { inFlight = null; }
        });
        return inFlight;
    }
    return {
        async fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/health' && request.method === 'GET') return json({ version: 1, ok: true });
            if (url.pathname !== '/v1/yields') return json({ error: 'Not found' }, 404);
            if (request.method === 'OPTIONS') return new Response(null, {
                status: 204,
                headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' },
            });
            if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
            const cache = injectedCache || globalThis.caches?.default;
            // Ignore arbitrary query strings: clients cannot bypass the shared upstream refresh budget.
            const key = new Request(url.origin + '/cache/yields-v1');
            if (!usable(lastGood) && cache) {
                try {
                    const response = await cache.match(key);
                    const snapshot = response ? await response.json() : null;
                    if (usable(snapshot)) lastGood = snapshot;
                } catch (_) {}
            }
            if (usable(lastGood) && now() - lastGood.fetchedAt < FRESH_MS) return json({ ...lastGood, stale: false });
            if (now() >= retryAfter) {
                try { return json({ ...await refresh(cache, key), stale: false }); } catch (_) {}
            }
            if (usable(lastGood)) return json({ ...lastGood, stale: true }, 200, true);
            return json({ error: 'Yield data temporarily unavailable' }, 503);
        },
    };
}

export default createHandler();
