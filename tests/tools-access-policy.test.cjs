const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const gate = read('shared/tools-gate.js');
const tools = read('tools/index.html');
const intel = read('intel/index.html');
const airdrop = read('airdrop/index.html');
const pay = read('pay/index.html');
const sluice = read('sluice/app-source.js');

test('shared tool access requires one million CITY and invalidates old threshold caches', () => {
    assert.match(gate, /GATE_THRESHOLD = 1000000n \* \(10n \*\* 9n\)/);
    assert.match(gate, /cachedThreshold === GATE_THRESHOLD\.toString\(\)/);
    assert.match(gate, /setItem\('alphacity_gate_threshold', GATE_THRESHOLD\.toString\(\)\)/);
    for (const page of [intel, airdrop, pay]) assert.match(page, /\/shared\/tools-gate\.js/);
});

test('Sluice creation and the intelligence dashboard use the same one million CITY threshold', () => {
    assert.match(sluice, /CREATION_GATE = 1_000_000n \* 1_000_000_000n/);
    assert.match(intel, /CITY_ACCESS_MIN\s+= 1_000_000n \* 10n \*\* 9n/);
});

test('the tools portal targets the intel route and no analyze route remains', () => {
    assert.match(tools, /href="\/intel\/"/);
    assert.doesNotMatch(tools, /href="\/analyze\//);
    assert.match(tools, /GATE_MAX_CITY\s+= 1000000/);
});
