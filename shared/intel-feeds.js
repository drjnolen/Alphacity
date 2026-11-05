(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AlphaCityIntelFeeds = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TTL_MS = 10 * 60_000;
    const MAX_STALE_MS = 24 * 60 * 60_000;
    const SOURCES = Object.freeze({
        sui: [
            { id: 'suiwire', label: 'SuiWire', url: 'https://suiwire.com/feed.json', format: 'jsonfeed' },
            { id: 'google-sui', label: 'Google News', url: 'https://news.google.com/rss/search?q=sui+blockchain+OR+sui+cryptocurrency&hl=en-US&gl=US&ceid=US:en' },
        ],
        crypto: [{ id: 'cointelegraph', label: 'Cointelegraph', url: 'https://cointelegraph.com/rss' }],
        macro: [{ id: 'yahoo', label: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' }],
        good: [{ id: 'goodnews', label: 'Good News Network', url: 'https://www.goodnewsnetwork.org/feed/' }],
        science: [{ id: 'science', label: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/all.xml' }],
    });

    function safeUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
        } catch (_) { return ''; }
    }

    function publishedAt(value, now = Date.now()) {
        if (typeof value !== 'string' || !value.trim()) return null;
        let date = value.trim();
        // RSS2JSON omits the timezone on its UTC timestamps.
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) date = date.replace(' ', 'T') + 'Z';
        const timestamp = Date.parse(date);
        return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 5 * 60_000 ? timestamp : null;
    }

    function canonicalUrl(value) {
        const safe = safeUrl(value);
        if (!safe) return '';
        const url = new URL(safe);
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
            if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
        }
        return url.href;
    }

    function titleText(value) {
        // Decode RSS character references without interpreting any markup.
        const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
        return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code) => {
            if (code[0] !== '#') return named[code.toLowerCase()];
            const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
            return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
        });
    }

    function normalizeArticles(payload, source, now = Date.now()) {
        if (!payload || !Array.isArray(payload.items) ||
            (source.format === 'jsonfeed' ? !String(payload.version || '').startsWith('https://jsonfeed.org/version/') : payload.status !== 'ok')) {
            throw new Error('Invalid news response');
        }
        const articles = payload.items.slice(0, 100).map(item => {
            if (!item || typeof item.title !== 'string') return null;
            const url = canonicalUrl(source.format === 'jsonfeed' ? item.url : item.link);
            if (!url) return null;
            if (source.id === 'suiwire' && !['suiwire.com', 'www.suiwire.com'].includes(new URL(url).hostname)) return null;
            let title = titleText(item.title).trim().slice(0, 500);
            let publisher = source.label;
            if (source.id === 'google-sui') {
                const parts = title.split(' - ');
                if (parts.length > 1) {
                    publisher = parts.pop().trim().slice(0, 100);
                    title = parts.join(' - ').trim();
                }
            }
            if (!title) return null;
            return {
                id: url, url, title, sourceId: source.id, publisher,
                publishedAt: publishedAt(source.format === 'jsonfeed' ? item.date_published : item.pubDate, now),
                sponsored: source.id === 'suiwire' && item._suiwire?.sponsored === true,
                tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string').slice(0, 12).map(tag => tag.slice(0, 80)) : [],
            };
        }).filter(Boolean);
        if (payload.items.length && !articles.length) throw new Error('News response contains no valid articles');
        return articles;
    }

    function mergeArticles(entries) {
        const urls = new Set();
        const titles = new Set();
        return entries.flatMap(entry => entry.articles).filter(article => {
            const titleKey = article.title.toLowerCase().replace(/\s+/g, ' ').trim();
            if (urls.has(article.url) || titles.has(titleKey)) return false;
            urls.add(article.url);
            titles.add(titleKey);
            return true;
        }).sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)).slice(0, 60);
    }

    function createStore({ fetchImpl = globalThis.fetch, storage, now = Date.now } = {}) {
        const entries = new Map();
        const pending = new Map();
        const failures = new Set();
        function read(source) {
            let entry = entries.get(source.id);
            if (!entry) {
                try { entry = JSON.parse(storage?.getItem('ac_intel_news_v2:' + source.id) || 'null'); } catch (_) {}
            }
            const age = now() - entry?.fetchedAt;
            if (!entry || !Number.isFinite(age) || age < 0 || age > MAX_STALE_MS || !Array.isArray(entry.articles)) return null;
            const articles = entry.articles.filter(article =>
                article && typeof article.title === 'string' && typeof article.publisher === 'string' &&
                article.sourceId === source.id && safeUrl(article.url) &&
                (article.publishedAt === null || Number.isFinite(article.publishedAt))
            ).slice(0, 100);
            return { articles, fetchedAt: entry.fetchedAt };
        }
        function result(source, entry, failed = failures.has(source.id)) {
            return {
                id: source.id, label: source.label, articles: entry?.articles || [],
                fetchedAt: entry?.fetchedAt || null,
                state: !entry ? 'unavailable' : failed || now() - entry.fetchedAt >= TTL_MS ? 'stale' : 'fresh',
            };
        }
        function summarize(category, sources) {
            return { category, articles: mergeArticles(sources), sources };
        }
        async function loadSource(source, force) {
            const cached = read(source);
            if (!force && cached && !failures.has(source.id) && now() - cached.fetchedAt < TTL_MS) return result(source, cached);
            if (pending.has(source.id)) return pending.get(source.id);
            const request = Promise.resolve().then(async () => {
                try {
                    const url = source.format === 'jsonfeed' ? source.url :
                        'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(source.url);
                    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), cache: 'no-cache' });
                    if (!response.ok) throw new Error('News source unavailable');
                    const articles = normalizeArticles(await response.json(), source, now());
                    const entry = { articles, fetchedAt: now() };
                    entries.set(source.id, entry);
                    failures.delete(source.id);
                    try { storage?.setItem('ac_intel_news_v2:' + source.id, JSON.stringify(entry)); } catch (_) {}
                    return result(source, entry);
                } catch (_) {
                    failures.add(source.id);
                    return result(source, read(source), true);
                } finally {
                    pending.delete(source.id);
                }
            });
            pending.set(source.id, request);
            return request;
        }
        return {
            peek(category) {
                return summarize(category, (SOURCES[category] || []).map(source => result(source, read(source))));
            },
            async load(category, { force = false } = {}) {
                if (!SOURCES[category]) throw new Error('Unknown news category');
                return summarize(category, await Promise.all(SOURCES[category].map(source => loadSource(source, force))));
            },
        };
    }

    return { TTL_MS, MAX_STALE_MS, SOURCES, safeUrl, canonicalUrl, publishedAt, normalizeArticles, mergeArticles, createStore };
});
