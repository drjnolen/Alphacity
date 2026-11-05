const assert = require('node:assert/strict');
const test = require('node:test');
const feeds = require('../shared/intel-feeds.js');

const NOW = Date.parse('2026-11-05T09:00:00Z');
const rss = (title = 'A story', link = 'https://example.com/story') => ({
    status: 'ok', items: [{ title, link, pubDate: '2026-11-05 08:00:00' }],
});
const wire = items => ({ version: 'https://jsonfeed.org/version/1.1', items });
const response = payload => ({ ok: true, json: async () => payload });
const memory = () => {
    const map = new Map();
    return { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
};

test('news dates preserve unknown values and interpret RSS2JSON timestamps as UTC', () => {
    assert.equal(feeds.publishedAt(undefined, NOW), null);
    assert.equal(feeds.publishedAt('not a date', NOW), null);
    assert.equal(feeds.publishedAt('2027-01-01T00:00:00Z', NOW), null);
    assert.equal(feeds.publishedAt('2026-11-05 08:00:00', NOW), Date.parse('2026-11-05T08:00:00Z'));
});

test('SuiWire normalization preserves attribution and sponsorship without carrying article HTML', () => {
    const [article] = feeds.normalizeArticles(wire([{
        title: '<img src=x onerror=alert(1)> News', url: 'https://suiwire.com/news/story?utm_source=x#top',
        date_published: '2026-11-05T08:00:00Z', content_html: '<script>bad()</script>',
        tags: ['DeFi', null], _suiwire: { sponsored: true },
    }]), feeds.SOURCES.sui[0], NOW);
    assert.equal(article.publisher, 'SuiWire');
    assert.equal(article.url, 'https://suiwire.com/news/story');
    assert.equal(article.sponsored, true);
    assert.deepEqual(article.tags, ['DeFi']);
    assert.equal(article.content_html, undefined);
    assert.match(article.title, /<img/); // The UI must render this as text, not markup.
    assert.throws(() => feeds.normalizeArticles(wire([{ title: 'bad', url: 'javascript:alert(1)' }]), feeds.SOURCES.sui[0], NOW));
    assert.throws(() => feeds.normalizeArticles(wire([{ title: 'bad', url: 'https://evil.example/story' }]), feeds.SOURCES.sui[0], NOW));
});

test('news deduplication prefers the direct publisher and sorts undated items last', () => {
    const articles = feeds.mergeArticles([
        { articles: [{ title: 'Same Story', url: 'https://suiwire.com/news/a', publishedAt: NOW - 1000, sourceId: 'suiwire' }] },
        { articles: [
            { title: 'same   story', url: 'https://news.google.com/a', publishedAt: NOW, sourceId: 'google-sui' },
            { title: 'Unknown date', url: 'https://example.com/b', publishedAt: null },
            { title: 'Latest', url: 'https://example.com/c', publishedAt: NOW },
        ] },
    ]);
    assert.deepEqual(articles.map(article => article.title), ['Latest', 'Same Story', 'Unknown date']);
    assert.equal(articles[1].sourceId, 'suiwire');
});

test('RSS titles decode character references as text, including encoded markup', () => {
    const [article] = feeds.normalizeArticles(rss('S&amp;P &#x1F680; &#39;news&#39; &lt;img src=x&gt; &#99999999;'), feeds.SOURCES.crypto[0], NOW);
    assert.equal(article.title, "S&P 🚀 'news' <img src=x> &#99999999;");
});

test('news source requests coalesce, expire and allow a manual refresh', async () => {
    let now = NOW;
    let calls = 0;
    const store = feeds.createStore({ now: () => now, storage: memory(), fetchImpl: async () => {
        calls++;
        return response(rss());
    } });
    await Promise.all([store.load('crypto'), store.load('crypto'), store.load('crypto', { force: true })]);
    assert.equal(calls, 1);
    await store.load('crypto');
    assert.equal(calls, 1);
    await store.load('crypto', { force: true });
    assert.equal(calls, 2);
    now += feeds.TTL_MS + 1;
    await store.load('crypto');
    assert.equal(calls, 3);
});

test('one provider failure keeps successful sources and bounded stale articles with their original timestamp', async () => {
    let now = NOW;
    let failWire = false;
    const storage = memory();
    const store = feeds.createStore({ now: () => now, storage, fetchImpl: async url => {
        if (url.includes('suiwire.com')) {
            if (failWire) throw new Error('offline');
            return response(wire([{ title: 'Direct news', url: 'https://suiwire.com/news/a' }]));
        }
        return response(rss('Other coverage'));
    } });
    await store.load('sui');
    now += feeds.TTL_MS + 1;
    failWire = true;
    const partial = await store.load('sui');
    assert.equal(partial.articles.length, 2);
    assert.equal(partial.sources[0].state, 'stale');
    assert.equal(partial.sources[0].fetchedAt, NOW);
    assert.equal(partial.sources[1].state, 'fresh');
    assert.equal(store.peek('sui').sources[0].state, 'stale');
    now = NOW + feeds.MAX_STALE_MS + 1;
    const expired = await store.load('sui');
    assert.equal(expired.sources[0].state, 'unavailable');
    assert.equal(expired.articles.length, 1);
});

test('invalid payloads do not replace last-known-good news and synchronous fetch errors can recover', async () => {
    let payload = rss();
    let synchronousError = false;
    const store = feeds.createStore({ now: () => NOW, fetchImpl: () => {
        if (synchronousError) throw new Error('sync failure');
        return Promise.resolve(response(payload));
    } });
    await store.load('crypto');
    payload = { status: 'ok', items: [{ title: 'bad', link: 'data:text/html,bad' }] };
    const bad = await store.load('crypto', { force: true });
    assert.equal(bad.sources[0].state, 'stale');
    assert.equal(bad.articles[0].title, 'A story');
    synchronousError = true;
    await store.load('crypto', { force: true });
    synchronousError = false;
    payload = rss('Recovered');
    assert.equal((await store.load('crypto', { force: true })).articles[0].title, 'Recovered');
});

test('blocked storage and malformed persisted entries cannot break fresh news', async () => {
    const store = feeds.createStore({
        now: () => NOW,
        storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } },
        fetchImpl: async () => response(rss()),
    });
    assert.equal((await store.load('crypto')).sources[0].state, 'fresh');
    const malformed = feeds.createStore({
        now: () => NOW,
        storage: { getItem: () => JSON.stringify({ fetchedAt: NOW, articles: [null, { url: 'javascript:bad' }] }) },
    });
    assert.deepEqual(malformed.peek('crypto').articles, []);
});
