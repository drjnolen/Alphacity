const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'intel', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'intel', 'tailwind.css'), 'utf8');

test('Intelligence Dashboard defaults to the Signal Radar and exposes dislocations', () => {
    assert.match(html, /src="\/shared\/alpha-signals\.js"/);
    assert.match(html, /class="intel-tab-btn active" data-tab="signals"/);
    assert.match(html, /id="tab-signals" class="intel-tab-content active"/);
    assert.match(html, /data-tab="dislocations"/);
    assert.match(html, /signals: renderSignals/);
    assert.match(html, /dislocations: renderDislocations/);
});

test('alpha dashboard controls and regime cards are included in compiled CSS', () => {
    for (const selector of ['.w-28', '.w-32', '.w-40', '.capitalize', '.md\\:grid-cols-5']) {
        assert.ok(css.includes(selector), `missing ${selector}`);
    }
});

test('new alpha views reuse the existing coalesced market universe', () => {
    const signalRenderer = html.match(/async function renderSignals[\s\S]*?\n    }/)?.[0] || '';
    const dislocationRenderer = html.match(/async function renderDislocations[\s\S]*?\n    }/)?.[0] || '';
    assert.match(signalRenderer, /await fetchDexData\(\)/);
    assert.match(dislocationRenderer, /await fetchDexData\(\)/);
    assert.doesNotMatch(signalRenderer, /fetch\(|rpc\(/);
    assert.doesNotMatch(dislocationRenderer, /fetch\(|rpc\(/);
});

test('wallet intelligence is capped, cached, and single-flight', () => {
    assert.match(html, /const MAX_INTEL_WATCHLIST = 8/);
    assert.match(html, /const INTEL_WATCHLIST_CACHE_TTL_MS = 60_000/);
    assert.match(html, /if \(cached\?\.promise\) return cached\.promise/);
    assert.match(html, /slice\(0, MAX_INTEL_WATCHLIST\)/);
    assert.match(html, /mapWithConcurrency\(list, 3/);
});

test('dashboard rankings include anomaly and liquidity quality gates', () => {
    assert.match(html, /minLiquidityUsd: 25000/);
    assert.match(html, /anomalous 24h change/);
    assert.match(html, /rankNewPools/);
    assert.match(html, /findDislocations/);
});
