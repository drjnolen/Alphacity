const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const worker = import(pathToFileURL(path.join(__dirname, '../api/intel-data/worker.mjs')));
const pool = (id, apy = 10, chain = 'Sui') => ({ pool: id, symbol: 'SUI-USDC', project: 'cetus-clmm', chain, tvlUsd: 20000, apy, underlyingTokens: ['0x2::sui::SUI'], irrelevant: 'discard me' });
const request = query => new Request('https://intel.example/v1/yields' + (query || ''));
const cache = () => {
    const values = new Map();
    return { match: async key => values.get(key.url)?.clone(), put: async (key, response) => values.set(key.url, response.clone()) };
};

test('yields response contains only five eligible Sui pools and bounded display fields', async () => {
    const { selectSuiPools } = await worker;
    const data = Array.from({ length: 16000 }, (_, i) => pool('eth-' + i, 10000, 'Ethereum'));
    data.push(...Array.from({ length: 8 }, (_, i) => pool('sui-' + i, i + 1)));
    data.push(pool('sui-7', 999), { ...pool('shallow', 1000), tvlUsd: 19999 }, pool('invalid', 'NaN'));
    const result = selectSuiPools({ data });
    assert.equal(result.length, 5);
    assert.deepEqual(result.map(item => item.pool), ['sui-7', 'sui-6', 'sui-5', 'sui-4', 'sui-3']);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 2500);
    assert.equal(result[0].irrelevant, undefined);
    assert.throws(() => selectSuiPools({ data: [] }));
});

test('concurrent requests share one upstream fetch and query strings cannot bypass the cache', async () => {
    const { createHandler } = await worker;
    let calls = 0;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const handler = createHandler({ cache: cache(), now: () => 1000000, fetchImpl: async url => {
        assert.equal(url, 'https://yields.llama.fi/pools');
        calls++;
        await pending;
        return Response.json({ data: [pool('sui')] });
    } });
    const requests = [handler.fetch(request()), handler.fetch(request('?force=true')), handler.fetch(request('?url=https://evil.example'))];
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    for (const response of await Promise.all(requests)) {
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
        assert.equal((await response.json()).stale, false);
    }
    await handler.fetch(request());
    assert.equal(calls, 1);
});

test('shared cache survives a new handler and stale fallback retains its timestamp with bounded retries', async () => {
    const { createHandler, FRESH_MS, MAX_STALE_MS } = await worker;
    const shared = cache();
    let now = 1000000;
    const fetchedAt = now;
    const first = createHandler({ cache: shared, now: () => now, fetchImpl: async () => Response.json({ data: [pool('sui')] }) });
    await first.fetch(request());
    let failures = 0;
    const second = createHandler({ cache: shared, now: () => now, fetchImpl: async () => { failures++; throw Error('offline'); } });
    assert.equal((await (await second.fetch(request())).json()).stale, false);
    assert.equal(failures, 0);
    now += FRESH_MS + 1;
    const staleResponse = await second.fetch(request());
    const stale = await staleResponse.json();
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, fetchedAt);
    assert.equal(staleResponse.headers.get('cache-control'), 'no-store');
    await second.fetch(request());
    assert.equal(failures, 1);
    now = fetchedAt + MAX_STALE_MS + 1;
    assert.equal((await second.fetch(request())).status, 503);
});

test('failed or malformed upstream responses never overwrite the last successful yield snapshot', async () => {
    const { createHandler, FRESH_MS } = await worker;
    let now = 1000000;
    let bad = false;
    const handler = createHandler({ cache: cache(), now: () => now, fetchImpl: () => {
        if (bad) throw Error('synchronous outage');
        return Promise.resolve(Response.json({ data: [pool('sui')] }));
    } });
    await handler.fetch(request());
    now += FRESH_MS + 1;
    bad = true;
    assert.equal((await (await handler.fetch(request())).json()).stale, true);
    now += 60001;
    bad = false;
    const recovered = await (await handler.fetch(request())).json();
    assert.equal(recovered.stale, false);
    assert.equal(recovered.fetchedAt, now);
    const invalid = createHandler({ fetchImpl: async () => Response.json({ unexpected: true }) });
    assert.equal((await invalid.fetch(request())).status, 503);
});

test('data worker is read-only and exposes a provider-independent deployment health check', async () => {
    const { createHandler } = await worker;
    const handler = createHandler({ fetchImpl: () => { throw Error('must not fetch'); } });
    assert.equal((await handler.fetch(new Request('https://intel.example/health'))).status, 200);
    assert.equal((await handler.fetch(new Request('https://intel.example/v1/yields', { method: 'POST' }))).status, 405);
    assert.equal((await handler.fetch(new Request('https://intel.example/unknown'))).status, 404);
    assert.equal((await handler.fetch(new Request('https://intel.example/v1/yields', { method: 'OPTIONS' }))).status, 204);
});

test('retired Nitter route returns 410 without contacting public mirrors', async () => {
    const { default: proxy } = await import(pathToFileURL(path.join(__dirname, '../api/openai-proxy/worker.js')));
    const response = await proxy.fetch(new Request('https://proxy.example/nitter?handle=SuiNetwork'), {});
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
});
