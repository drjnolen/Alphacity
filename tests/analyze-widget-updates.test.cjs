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
    assert.match(analyzeHtml, /if \(returnedKey\) fieldsById\[returnedKey\] = fields/);
    assert.match(analyzeHtml, /else if \(requestedKey\) fieldsById\[requestedKey\] = fields/);
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

test('Liquidity Pools recover partial Turbos object batches without refetching hydrated records', async () => {
    const helperSource = analyzeHtml.slice(
        analyzeHtml.indexOf('function extractObjectId'),
        analyzeHtml.indexOf('async function renderLpPositions'),
    );
    const calls = [];
    let batchAttempt = 0;
    const objectResponse = objectId => ({
        data: {
            objectId,
            content: { fields: { object_id: objectId } },
        },
    });
    const rpc = async (method, [request]) => {
        calls.push({ method, request });
        if (method === 'sui_multiGetObjects') {
            batchAttempt += 1;
            if (batchAttempt === 1) return [objectResponse('0x2')];
            if (batchAttempt === 2) return [objectResponse('0x1')];
        }
        if (method === 'sui_getObject') return objectResponse(request);
        return [];
    };
    const fetchObjectFields = new Function(
        'rpc',
        'console',
        `${helperSource}; return fetchObjectFields;`,
    )(rpc, { warn() {} });

    const fields = await fetchObjectFields(['0x1', '0x2', '0x3']);

    assert.deepEqual(Object.keys(fields).sort(), ['0x1', '0x2', '0x3']);
    assert.equal(fields['0x1'].object_id, '0x1');
    assert.equal(fields['0x2'].object_id, '0x2');
    assert.deepEqual(calls, [
        { method: 'sui_multiGetObjects', request: ['0x1', '0x2', '0x3'] },
        { method: 'sui_multiGetObjects', request: ['0x1', '0x3'] },
        { method: 'sui_getObject', request: '0x3' },
    ]);
});

test('canonical Sui USDC retains six decimals when metadata is unavailable', async () => {
    const decimalSource = analyzeHtml.slice(
        analyzeHtml.indexOf('const coinMetadataCache'),
        analyzeHtml.indexOf('function coinSymbol'),
    );
    const createDecimalTools = rpc => new Function(
        'rpc',
        'isSuiCoinType',
        'CITY_TYPE',
        `${decimalSource}; return { fetchCoinDecimals, coinDecimals, knownCoinDecimals };`,
    )(rpc, () => false, '0xcity::city::CITY');
    const usdcType = 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    const fallbackTools = createDecimalTools(async () => { throw new Error('metadata unavailable'); });

    assert.equal(await fallbackTools.fetchCoinDecimals(`0x${usdcType}`), 6);
    assert.equal(fallbackTools.coinDecimals(usdcType), 6);
    assert.equal(195_840_000 / (10 ** fallbackTools.coinDecimals(usdcType)), 195.84);

    const stringMetadataTools = createDecimalTools(async () => ({ decimals: '6' }));
    assert.equal(await stringMetadataTools.fetchCoinDecimals(usdcType), 6);
});

test('desktop utility widgets follow Whale Tracker in the right column', () => {
    const rightColumn = analyzeHtml.indexOf('<!-- ===== RIGHT COLUMN:');
    const whaleTracker = analyzeHtml.indexOf('id="whale-tracker-widget"');
    const ecosystemLaunchpad = analyzeHtml.indexOf('id="ecosystem-launchpad-widget"');
    const citizenManager = analyzeHtml.indexOf('id="citizen-manager-widget"');

    assert.ok(rightColumn >= 0);
    assert.ok(whaleTracker > rightColumn);
    assert.ok(ecosystemLaunchpad > whaleTracker);
    assert.ok(citizenManager > ecosystemLaunchpad);
    assert.equal((analyzeHtml.match(/id="ecosystem-launchpad-widget"/g) || []).length, 1);
    assert.equal((analyzeHtml.match(/id="citizen-manager-widget"/g) || []).length, 1);
});
