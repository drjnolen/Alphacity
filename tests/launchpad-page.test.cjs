'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'launchpad', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'launchpad', 'app-source.js'), 'utf8');
const operator = fs.readFileSync(path.join(root, 'launchpad', 'operator', 'index.html'), 'utf8');

test('public launchpad uses shared infrastructure instead of a page-local wallet adapter', () => {
    assert.match(page, /\/shared\/wallet-connector\.js/);
    assert.match(page, /\/shared\/sui-client\.js/);
    assert.match(page, /\/shared\/launchpad-core\.js/);
    assert.doesNotMatch(page, /standardAdapter|legacyAdapter|discoverWallets/);
    assert.match(source, /AlphaCityWalletConnector\.create/);
});

test('managed-drop mint path builds and executes a Sui transaction', () => {
    assert.match(source, /new Transaction\(\)/);
    assert.match(source, /transaction\.splitCoins\(transaction\.gas/);
    assert.match(source, /::\$\{state\.collection\.contract\.module.*::mint/);
    assert.match(source, /signAndExecuteTransaction\(transaction\)/);
    assert.match(source, /waitForTransaction/);
    assert.doesNotMatch(source, /Minting is not live yet/);
});

test('operator workspace is intentionally non-indexed and never requests a private key', () => {
    assert.match(operator, /noindex,nofollow/);
    assert.match(operator, /shared\/wallet-connector\.js/);
    assert.match(operator, /never contains a private key or seed phrase/i);
    assert.doesNotMatch(operator, /type="password"/);
});
