const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'intel', 'index.html'), 'utf8');
const gate = fs.readFileSync(path.join(root, 'shared', 'tools-gate.js'), 'utf8');

test('Analyze defers shared dependencies without flashing gated content', () => {
    assert.match(html, /<style id="tools-gate-style">body \{ display: none !important; \}<\/style>/);
    for (const asset of ['wallet-sync', 'sui-client', 'trade-alerts', 'alpha-signals', 'lp-tools', 'tools-gate']) {
        assert.match(html, new RegExp(`<script defer src="/shared/${asset}\\.js(?:\\?v=\\d+)?"><\\/script>`));
    }
    assert.doesNotMatch(html, /trade-tools\.js/);
    assert.match(html, /DOMContentLoaded', initializeAnalyzePage/);
});

test('Analyze removes the retired Daily Brief and Trade Decision Lab code paths', () => {
    for (const obsolete of ['daily-brief', 'trade-decision-lab', 'initDailyHome', 'initTradeDecisionLab', 'AlphaCityTradeTools', 'execution-planner-launch']) {
        assert.doesNotMatch(html, new RegExp(obsolete));
    }
});

test('mobile columns prioritize middle widgets while desktop retains left-middle-right layout', () => {
    assert.match(html, /id="analyze-middle-column" class="order-1 lg:order-2 lg:col-span-5/);
    assert.match(html, /id="analyze-left-column" class="order-2 lg:order-1 lg:col-span-3/);
    assert.match(html, /id="analyze-right-column" class="order-3 lg:order-3 lg:col-span-4/);
    assert.ok(html.indexOf('id="market-pulse"') < html.indexOf('id="analyze-left-column"'));
    assert.ok(html.indexOf('id="analyze-right-column"') < html.indexOf('id="intel-dashboard"'));
});

test('background refreshes sleep while hidden and resume when overdue', () => {
    const scheduler = html.slice(html.indexOf('function createVisibleInterval'), html.indexOf('function runWidgetSafe'));
    assert.match(scheduler, /setTimeout\(run/);
    assert.match(scheduler, /visibilitychange/);
    assert.match(scheduler, /Date\.now\(\) >= nextRunAt/);
    assert.doesNotMatch(scheduler, /setInterval/);
});

test('market, TVL, and weather data use bounded refresh caches', () => {
    assert.match(html, /MARKET_PULSE_CACHE_STORAGE/);
    assert.match(html, /TVL_REFRESH_MS\s*=\s*15 \* 60_000/);
    assert.match(html, /WEATHER_LOCATION_CACHE_STORAGE/);
    assert.match(html, /WEATHER_CACHE_STORAGE/);
    assert.match(html, /id="weather-unit"/);
    assert.match(html, /Number\.isFinite\(lat\) && Number\.isFinite\(lon\)/);
});

test('watchlist market loads are single-flight and external news links are protocol-gated', () => {
    assert.match(html, /tokenAlertMarketCache\.promise/);
    assert.match(html, /function safeExternalUrl/);
    assert.match(html, /url: safeExternalUrl\(art\.link\)/);
    assert.match(html, /\.filter\(article => article\.url\)/);
});

test('enriched alerts derive volume and sell pressure from the existing pair snapshot', () => {
    assert.match(html, /volumeH1: pair\.volume\?\.h1/);
    assert.match(html, /sellPressureH1: flowH1 \? \(sellsH1 \/ flowH1\) \* 100 : null/);
});

test('intelligence tab choice persists and supports arrow-key navigation', () => {
    assert.match(html, /INTEL_TAB_STORAGE/);
    assert.match(html, /function restoreIntelTab/);
    assert.match(html, /event\.key === 'ArrowRight'/);
    assert.match(html, /event\.key === 'ArrowLeft'/);
});

test('local Analyze preview cannot bypass the gate on a non-loopback host', () => {
    assert.match(gate, /\['localhost', '127\.0\.0\.1', '::1'\]\.includes\(window\.location\.hostname\)/);
    assert.match(gate, /window\.location\.pathname\.startsWith\('\/intel'\)/);
    assert.match(gate, /get\('preview'\) === '1'/);
    assert.match(gate, /function scheduleWalletCheck/);
    assert.match(gate, /visibilitychange/);
    assert.doesNotMatch(gate, /setInterval\(checkWalletSession/);
});
