'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/launchpad-core.js');

const ADDRESS = `0x${'1'.repeat(64)}`;
const TREASURY = `0x${'2'.repeat(64)}`;

function project(overrides = {}) {
    return {
        id: 'night-shift',
        name: 'Night Shift',
        creatorName: 'After Dark Studio',
        creatorAddress: ADDRESS,
        description: 'A collection built after midnight.',
        heroFile: 'hero.png',
        royaltyBps: 500,
        platformFeeBps: 500,
        maxPerTx: 5,
        stages: [{
            name: 'Public Mint', priceSui: '1.25', startTime: '2026-08-01T18:00:00Z',
            endTime: '2026-08-02T18:00:00Z', walletLimit: 5, allocation: 0,
            allowlistOnly: false, allowlist: [],
        }],
        ...overrides,
    };
}

const csv = [
    'Name,Description,File Name,Reserve For Creator,attributes[Background],attributes[Quote]',
    'Night #1,"A description, with a comma",001.png,false,Blue,"Hello ""City"""',
    'Night #2,Team item,002.png,true,Gold,Reserved',
].join('\n');

const files = [
    { name: 'hero.png', size: 100 },
    { name: '001.png', size: 200 },
    { name: '002.png', size: 300 },
];

test('CSV parser handles quoted commas and doubled quotes', () => {
    const parsed = core.parseCsv(csv);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].Description, 'A description, with a comma');
    assert.equal(parsed.rows[0]['attributes[Quote]'], 'Hello "City"');
});

test('SUI amounts convert to MIST without floating-point rounding', () => {
    assert.equal(core.suiToMist('1.000000001'), 1_000_000_001n);
    assert.equal(core.suiToMist('0.25'), 250_000_000n);
    assert.equal(core.mistToSui(1_250_000_000n), '1.25');
    assert.throws(() => core.suiToMist('0.0000000001'), /9 decimal places/);
    assert.throws(() => core.suiToMist('-1'), /non-negative decimal/);
});

test('submission validation matches media, traits, and reserved inventory', () => {
    const result = core.validateSubmission(project(), csv, files);
    assert.equal(result.valid, true, result.errors.join('\n'));
    assert.equal(result.supply, 2);
    assert.equal(result.publicSupply, 1);
    assert.equal(result.reservedSupply, 1);
    assert.deepEqual(result.items[0].attributes, { Background: 'Blue', Quote: 'Hello "City"' });
});

test('validation rejects missing media and an empty allowlist-only stage', () => {
    const input = project({ stages: [{ name: 'Private', priceSui: '1', startTime: '2026-08-01T18:00:00Z', walletLimit: 1, allowlistOnly: true, allowlist: [] }] });
    const result = core.validateSubmission(input, csv, files.filter((file) => file.name !== '002.png'));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes('allowlist-only')));
    assert.ok(result.errors.some((error) => error.includes('002.png')));
});

test('validation cannot report ready before a media folder is supplied', () => {
    const result = core.validateSubmission(project(), csv, []);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes('media folder')));
    assert.ok(result.errors.some((error) => error.includes('001.png')));
});

test('prepared launch separates initialization data from public collection config', () => {
    const validation = core.validateSubmission(project(), csv, files);
    const bundle = core.prepareLaunch(validation, {
        platformTreasury: TREASURY,
        mediaBaseUrl: 'https://assets.example/drop',
        contract: { packageId: ADDRESS, dropId: TREASURY, module: 'managed_drop' },
    });
    assert.equal(bundle.collection.contract.mode, 'managed-drop');
    assert.equal(bundle.collection.heroImage, 'https://assets.example/drop/hero.png');
    assert.equal(bundle.initialization.publicItems[0].mediaUrl, 'https://assets.example/drop/001.png');
    assert.equal(bundle.initialization.reservedItems[0].name, 'Night #2');
    assert.equal(bundle.initialization.stages[0].priceMist, '1250000000');
});

test('Sui addresses are normalized to 32 bytes', () => {
    assert.equal(core.normalizeSuiAddress('0x2'), `0x${'0'.repeat(63)}2`);
    assert.equal(core.isValidSuiAddress('not-an-address'), false);
});
