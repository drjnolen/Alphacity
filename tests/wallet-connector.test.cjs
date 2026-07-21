'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'shared', 'wallet-connector.js'), 'utf8');

test('shared wallet connector exposes provider, account, and disconnect options', () => {
    assert.match(source, /Switch Account/);
    assert.match(source, /Switch Wallet Provider/);
    assert.match(source, /Disconnect/);
});

test('shared wallet connector signs through modern and legacy Sui wallet features', () => {
    assert.match(source, /sui:signAndExecuteTransaction/);
    assert.match(source, /sui:signAndExecuteTransactionBlock/);
    assert.match(source, /signAndExecuteTransaction,/);
    assert.match(source, /selectedAccount\s*=\s*availableAccounts\.find/);
});
