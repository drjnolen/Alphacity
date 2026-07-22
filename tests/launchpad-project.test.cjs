'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'scripts', 'launchpad-project.cjs');
const address = `0x${'a'.repeat(64)}`;
const treasury = `0x${'b'.repeat(64)}`;

test('prepare command emits a reproducible package, config, and transaction batches', (context) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphacity-launch-'));
    context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const media = path.join(temp, 'media');
    fs.mkdirSync(media);
    fs.writeFileSync(path.join(media, 'hero.png'), 'hero');
    fs.writeFileSync(path.join(media, '001.png'), 'one');
    fs.writeFileSync(path.join(media, '002.png'), 'two');
    fs.writeFileSync(path.join(temp, 'metadata.csv'), [
        'Name,Description,File Name,Reserve For Creator,attributes[Type]',
        'One,First,001.png,false,Public',
        'Two,Second,002.png,true,Reserved',
    ].join('\n'));
    fs.writeFileSync(path.join(temp, 'project.json'), JSON.stringify({
        id: 'CLI Test', name: 'CLI Test', creatorAddress: address, heroFile: 'hero.png',
        platformFeeBps: 500, royaltyBps: 250, maxPerTx: 3,
        stages: [{ name: 'Public', priceSui: '2', startTime: '2026-08-01T00:00:00Z', walletLimit: 3, allowlistOnly: false }],
    }));
    const output = path.join(temp, 'output');
    const stdout = execFileSync(process.execPath, [cli, 'prepare', temp, '--treasury', treasury, '--media-base-url', 'https://cdn.example/cli-test', '--out', output], { encoding: 'utf8' });
    assert.match(stdout, /VALID: 2 items/);
    assert.match(stdout, /No package was published/);
    const collection = JSON.parse(fs.readFileSync(path.join(output, 'collection.json'), 'utf8'));
    const transactions = JSON.parse(fs.readFileSync(path.join(output, 'transactions.json'), 'utf8'));
    const moveSource = fs.readFileSync(path.join(output, 'contract', 'sources', 'managed_drop.move'), 'utf8');
    assert.equal(collection.contract.mode, 'coming-soon');
    assert.equal(transactions.inventoryBatches.length, 1);
    assert.equal(transactions.inventoryBatches[0].length, 2);
    assert.equal(transactions.createDrop.target, '${PACKAGE_ID}::managed_drop::create_drop');
    assert.match(moveSource, /module cli_test::managed_drop/);
    assert.equal(fs.existsSync(path.join(output, 'contract', 'tests')), false);
});
