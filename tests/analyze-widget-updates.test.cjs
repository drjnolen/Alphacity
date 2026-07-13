const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const analyzeHtml = fs.readFileSync(path.join(root, 'analyze', 'index.html'), 'utf8');
const proxyWorker = fs.readFileSync(path.join(root, 'api', 'openai-proxy', 'worker.js'), 'utf8');
const lpTools = fs.readFileSync(path.join(root, 'shared', 'lp-tools.js'), 'utf8');

test('signal methodology is compact, tiered, and includes a financial disclaimer', () => {
    assert.match(analyzeHtml, /<details[^>]*>[\s\S]*How signal ratings work/);
    assert.match(analyzeHtml, /S70\+/);
    assert.match(analyzeHtml, /S55–69/);
    assert.match(analyzeHtml, /not financial advice/i);
});

test('X ecosystem cards are reordered by parsed tweet timestamp', () => {
    assert.match(analyzeHtml, /function tweetTimestamp\(pubDate\)/);
    assert.match(analyzeHtml, /function sortXFeedByMostRecent\(container\)/);
    assert.match(analyzeHtml, /b\.dataset\.tweetTimestamp[\s\S]*a\.dataset\.tweetTimestamp/);
    assert.match(analyzeHtml, /sortXFeedByMostRecent\(container\)/);
});

test('Notes Terminal replaces Side Quest and obsolete proxy code is removed', () => {
    assert.equal((analyzeHtml.match(/id="notes-textarea"/g) || []).length, 1);
    assert.equal((analyzeHtml.match(/Notes Terminal/g) || []).length, 1);
    assert.doesNotMatch(analyzeHtml, /side[_ -]?quest/i);
    assert.doesNotMatch(proxyWorker, /side[_ -]?quest/i);
});

test('Token Safety Checker is the user-facing widget name', () => {
    assert.match(analyzeHtml, />\s*<span>🛡️<\/span> Token Safety Checker\s*<\/h3>/);
    assert.doesNotMatch(analyzeHtml, /Token Safety Sniffer/);
});

test('compact token widget opens on Watchlist', () => {
    assert.match(analyzeHtml, /id="widget-token-watchlist-tab" class="widget-tab-btn active"/);
    assert.match(analyzeHtml, /id="widget-trending-container" class="hidden space-y-2"/);
    assert.match(analyzeHtml, /id="widget-watchlist-container" class="space-y-3"/);
    assert.match(analyzeHtml, /\/\/ Initial load\s*renderWidgetWatchlist\(\)/);
});

test('Liquidity Pools hydrate Turbos positions across gRPC object shapes', () => {
    assert.match(analyzeHtml, /src="\/shared\/lp-tools\.js"/);
    assert.match(analyzeHtml, /async function fetchLpPositions\(address\)/);
    assert.equal((analyzeHtml.match(/fetchLpPositions\(/g) || []).length, 3);
    assert.match(analyzeHtml, /function objectIdKey\(value\)/);
    assert.match(analyzeHtml, /fieldsById\[requestedKey\] = fields/);
    assert.match(analyzeHtml, /fieldsById\[returnedKey\] = fields/);
    assert.match(lpTools, /current_sqrt_price \|\| poolFields\?\.sqrt_price/);
    assert.match(analyzeHtml, /posFields\.liquidity !== undefined/);
    assert.match(analyzeHtml, /'Position detected'/);
    assert.match(analyzeHtml, /await Promise\.all\(lpCoinTypes\.map\(fetchCoinDecimals\)\)/);
    assert.match(analyzeHtml, /Open LP position ↗/);

    const helperSource = analyzeHtml.slice(
        analyzeHtml.indexOf('function extractObjectId'),
        analyzeHtml.indexOf('async function fetchObjectFields'),
    );
    const { extractObjectId, objectIdKey, normalizeEmbeddedCoinType } = new Function(
        `${helperSource}; return { extractObjectId, objectIdKey, normalizeEmbeddedCoinType };`,
    )();
    assert.equal(extractObjectId({ fields: { id: '0x02' } }), '0x02');
    assert.equal(objectIdKey('0x0002'), objectIdKey('0x2'));
    assert.equal(normalizeEmbeddedCoinType('0002::sui::SUI'), '0x0002::sui::SUI');
});
