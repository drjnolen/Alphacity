const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'analyze', 'index.html'), 'utf8');
const gate = fs.readFileSync(path.join(root, 'shared', 'tools-gate.js'), 'utf8');

test('Analyze defers shared dependencies without flashing gated content', () => {
    assert.match(html, /<style id="tools-gate-style">body \{ display: none !important; \}<\/style>/);
    for (const asset of ['wallet-sync', 'sui-client', 'trade-alerts', 'trade-tools', 'alpha-signals', 'lp-tools', 'tools-gate']) {
        assert.match(html, new RegExp(`<script defer src="/shared/${asset}\\.js(?:\\?v=\\d+)?"><\\/script>`));
    }
    assert.match(html, /DOMContentLoaded', initializeAnalyzePage/);
});

test('Analyze has a daily brief with active refresh and long-page shortcuts', () => {
    for (const id of ['daily-brief', 'daily-market-tone', 'daily-habit-progress', 'daily-alert-count', 'refresh-home-btn']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /data-jump-target="trade-decision-lab"/);
    assert.match(html, /data-jump-target="intel-dashboard"/);
    assert.match(html, /async function refreshActiveHomeData/);
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

test('intelligence tab choice persists and supports arrow-key navigation', () => {
    assert.match(html, /INTEL_TAB_STORAGE/);
    assert.match(html, /function restoreIntelTab/);
    assert.match(html, /event\.key === 'ArrowRight'/);
    assert.match(html, /event\.key === 'ArrowLeft'/);
});

test('local Analyze preview cannot bypass the gate on a non-loopback host', () => {
    assert.match(gate, /\['localhost', '127\.0\.0\.1', '::1'\]\.includes\(window\.location\.hostname\)/);
    assert.match(gate, /window\.location\.pathname\.startsWith\('\/analyze'\)/);
    assert.match(gate, /get\('preview'\) === '1'/);
    assert.match(gate, /function scheduleWalletCheck/);
    assert.match(gate, /visibilitychange/);
    assert.doesNotMatch(gate, /setInterval\(checkWalletSession/);
});
