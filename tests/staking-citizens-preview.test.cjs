const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'staking', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'staking', 'citizens-preview.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'staking/citizens-preview.js' });
const preview = context.window.AlphaCityCitizensPreview;

test('Citizens tab is explicitly presented as a non-operational preview', () => {
    assert.match(html, /id="nft-view"[^>]*data-preview-only/);
    assert.match(html, /Coming soon/i);
    assert.match(html, /GuildVenture trait model/);
    assert.match(html, /No wallet actions enabled/);
    assert.match(html, /id="stake-nft-btn"[^>]*disabled[^>]*aria-disabled="true"/);
    assert.match(html, /No NFTs are moved, nested, staked, or approved/);
    assert.doesNotMatch(source, /signAndExecute|AlphaCitySui|walletAdapter/);
});

test('Citizens preview exposes all five swappable equipment slots and strategy surfaces', () => {
    for (const slot of ['cranial', 'chassis', 'equipment', 'mobility', 'companion']) {
        assert.match(source, new RegExp(`${slot}: \\{ label:`));
    }
    assert.match(html, /id="citizen-roster"/);
    assert.match(html, /id="equipment-slots"/);
    assert.match(html, /id="equipment-inventory"/);
    assert.match(html, /id="active-synergies"/);
    assert.match(html, /id="checkpoint-options"/);
    assert.match(html, /Oracle's Relay Uplink/);
});

test('GuildVenture slots, specialties, rarities, factions, and abilities stay canonical', () => {
    assert.deepEqual(Array.from(preview.taxonomy.slots), ['Cranial', 'Chassis', 'Equipment', 'Mobility', 'Companion']);
    assert.deepEqual(Array.from(preview.taxonomy.specialties), ['Umbral', 'Blockchain', 'Kinetic', 'Enertech', 'Archon', 'Neural', 'Mechanical']);
    assert.deepEqual(Array.from(preview.taxonomy.rarities), ['Salvage', 'Gutter-Tech', 'Street Mod', 'Black Market', 'Node-Forged', 'Peerless']);
    assert.deepEqual(Array.from(preview.taxonomy.factions), ['Nodewalker', 'Chainbreaker', 'Overlord']);
    assert.equal(preview.taxonomy.itemCount, 35);
    for (const ability of ['Shadow Whisper', 'Economic Shield', 'Concussion Charge', 'Market Momentum', 'Mech Companion Strike']) {
        assert.match(source, new RegExp(ability));
    }
});

test('bonus preview stacks rarity, specialty, mixed-loadout, faction, and Relay effects', () => {
    const blockchainLoadout = Array.from({ length: 5 }, (_, index) => ({ specialty: 'Blockchain', boost: index + 1 }));
    const blockchain = preview.calculateBonuses(blockchainLoadout, { faction: 'Nodewalker' });
    assert.equal(blockchain.equipmentBonus, 15);
    assert.equal(blockchain.setBonus, 25);
    assert.equal(blockchain.eventBonus, 20);
    assert.equal(blockchain.multiplier, 1.6);

    const mixed = preview.calculateBonuses([
        { specialty: 'Umbral', boost: 2 },
        { specialty: 'Blockchain', boost: 2 },
        { specialty: 'Kinetic', boost: 2 },
    ]);
    assert.equal(mixed.mixedSetBonus, 4);
    assert.equal(mixed.setBonus, 4);
    assert.equal(mixed.eventBonus, 3);
    assert.equal(mixed.totalBonus, 13);
});

test('checkpoint preview includes the planned hybrid rarity progression', () => {
    assert.deepEqual(
        Array.from(preview.checkpoints, ({ days, quality, rarity }) => ({ days, quality, rarity })),
        [
            { days: 5, quality: 1, rarity: 1 },
            { days: 15, quality: 4, rarity: 4 },
            { days: 30, quality: 10, rarity: 10 },
        ],
    );
});
