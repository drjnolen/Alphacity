const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const analyzeHtml = fs.readFileSync(path.join(__dirname, '..', 'analyze', 'index.html'), 'utf8');
const tailwindCss = fs.readFileSync(path.join(__dirname, '..', 'analyze', 'tailwind.css'), 'utf8');

test('Analyze uses precompiled Tailwind without permanent glass compositor layers', () => {
    assert.match(analyzeHtml, /href="\/analyze\/tailwind\.css"/);
    assert.doesNotMatch(analyzeHtml, /cdn\.tailwindcss\.com/);
    assert.doesNotMatch(analyzeHtml, /backdrop-filter\s*:/);
    assert.doesNotMatch(analyzeHtml, /will-change\s*:/);
});

test('precompiled Analyze CSS includes static and dynamic utility selectors', () => {
    for (const selector of [
        '.bg-brand-primary',
        '.text-brand-secondary',
        '.bg-dark-bg\\/95',
        '.z-\\[120\\]',
        '.bg-orange-500\\/10',
        '.border-orange-500\\/20',
    ]) {
        assert.ok(tailwindCss.includes(selector), `missing ${selector}`);
    }
});

test('Analyze coalesces concurrent DexScreener market loads', () => {
    assert.match(analyzeHtml, /let dexInFlight = null/);
    assert.match(analyzeHtml, /if \(dexInFlight\) return dexInFlight/);
    assert.match(analyzeHtml, /finally \{\s*dexInFlight = null/);
});

test('heavy Analyze widgets initialize near the viewport', () => {
    for (const widgetId of ['tradingview-widget', 'apy-radar-widget', 'x-feed-widget', 'whale-tracker-widget', 'intel-dashboard']) {
        assert.match(analyzeHtml, new RegExp(`initWhenVisible\\('${widgetId}'`));
    }
    assert.match(analyzeHtml, /createVisibleInterval/);
});

test('LP details batch object RPCs and bound direct fallbacks to missing records', () => {
    assert.match(analyzeHtml, /rpc\('sui_multiGetObjects'/);
    const helper = analyzeHtml.slice(
        analyzeHtml.indexOf('async function fetchObjectFields'),
        analyzeHtml.indexOf('async function renderLpPositions'),
    );
    assert.match(helper, /pendingIds = pendingIds\.filter/);
    assert.match(helper, /pendingIds\.map[\s\S]*rpc\('sui_getObject'/);
    assert.doesNotMatch(helper, /uniqueIds\.map[\s\S]*rpc\('sui_getObject'/);
});
