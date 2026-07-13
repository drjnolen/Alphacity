const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'analyze', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'analyze', 'tailwind.css'), 'utf8');

test('Trade Decision Lab loads its calculation engine and initializes without background polling', () => {
    assert.match(html, /src="\/shared\/trade-tools\.js"/);
    assert.match(html, /id="trade-decision-lab"/);
    assert.match(html, /initTradeDecisionLab\(\)/);
    const labScript = html.match(/\/\/ TRADE DECISION LAB[\s\S]*?\/\/ WIDGET: TOKEN TRENDS/)?.[0] || '';
    assert.doesNotMatch(labScript, /createVisibleInterval|setInterval/);
});

test('Trade Decision Lab styles are present in the precompiled stylesheet', () => {
    for (const selector of ['.bg-brand-primary\\/5', '.bg-yellow-500\\/10', '.border-yellow-500\\/20', '.divide-gray-800\\/50', '.h-\\[38px\\]']) {
        assert.ok(css.includes(selector), `missing ${selector}`);
    }
});

test('execution analysis is on-demand, single-flight, and cached for sixty seconds', () => {
    assert.match(html, /const EXECUTION_CACHE_TTL_MS = 60_000/);
    assert.match(html, /if \(cached\?\.promise\) return cached\.promise/);
    assert.match(html, /token-pairs\/v1\/sui/);
    assert.match(html, /execution-analyze-btn[^]*addEventListener\('click', runExecutionAnalysis\)/);
});

test('enriched alerts derive volume and sell pressure from the existing pair snapshot', () => {
    assert.match(html, /volumeH1: pair\.volume\?\.h1/);
    assert.match(html, /sellPressureH1: flowH1 \? \(sellsH1 \/ flowH1\) \* 100 : null/);
});
