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
    assert.doesNotMatch(html, /GuildVenture trait model/);
    assert.match(html, /id="stake-nft-btn"[^>]*disabled[^>]*aria-disabled="true"/);
    assert.match(html, /No NFTs are moved, nested, staked, or approved/);
    assert.doesNotMatch(source, /signAndExecute|AlphaCitySui|walletAdapter/);
});

test('Step 3 limits the equipment preview while retaining the unequip control', () => {
    assert.match(source, /const INVENTORY_PREVIEW_LIMIT = 3/);
    assert.match(source, /\.slice\(0, INVENTORY_PREVIEW_LIMIT\)/);
    assert.match(source, /const options = \[null, \.\.\.previewItems\]/);
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
    assert.deepEqual(Array.from(preview.taxonomy.specialties), ['Umbral', 'Mercantile', 'Kinetic', 'Enertech', 'Archon', 'Neural', 'Mechanical']);
    assert.deepEqual(Array.from(preview.taxonomy.rarities), ['Salvage', 'Gutter-Tech', 'Street Mod', 'Black Market', 'Node-Forged', 'Peerless']);
    assert.deepEqual(Array.from(preview.taxonomy.factions), ['Nodewalker', 'Chainbreaker', 'Overlord']);
    assert.equal(preview.taxonomy.itemCount, 35);
    for (const ability of ['Shadow Whisper', 'Economic Shield', 'Concussion Charge', 'Market Momentum', 'Mech Companion Strike']) {
        assert.match(source, new RegExp(ability));
    }
});

test('bonus preview stacks rarity, specialty, mixed-loadout, faction, and Relay effects', () => {
    const mercantileLoadout = Array.from({ length: 5 }, (_, index) => ({ specialty: 'Mercantile', boost: index + 1 }));
    const mercantile = preview.calculateBonuses(mercantileLoadout, { faction: 'Nodewalker' });
    assert.equal(mercantile.equipmentBonus, 15);
    assert.equal(mercantile.setBonus, 25);
    assert.equal(mercantile.eventBonus, 20);
    assert.equal(mercantile.multiplier, 1.6);

    const mixed = preview.calculateBonuses([
        { specialty: 'Umbral', boost: 2 },
        { specialty: 'Mercantile', boost: 2 },
        { specialty: 'Kinetic', boost: 2 },
    ]);
    assert.equal(mixed.mixedSetBonus, 4);
    assert.equal(mixed.setBonus, 4);
    assert.equal(mixed.eventBonus, 3);
    assert.equal(mixed.totalBonus, 13);
});

test('Citizens presentation uses the canonical affinity palette without preview imagery or effects', () => {
    const citizensHtml = html.slice(html.indexOf('id="nft-view"'), html.indexOf('id="staking-sidebar"'));
    assert.doesNotMatch(citizensHtml, /<img|citizen-portrait|gradient|animate-|shadow-/);
    assert.doesNotMatch(source, /citizen-portrait|coming-soon-pulse/);
    for (const color of ['#DC143C', '#D7A06E', '#A855F7', '#E9FF32', '#FF8A1F', '#94A3B8', '#FBBF24']) {
        assert.match(source, new RegExp(color));
    }
    assert.match(source, /Glitchborn: SPECIALTY_META\.Umbral/);
    assert.match(source, /Coinbroker: SPECIALTY_META\.Mercantile/);
    assert.match(source, /Nodewalker: SPECIALTY_META\.Enertech/);
    assert.match(source, /rendered: false/);
    assert.match(source, /ensureRendered\(\)/);
    assert.match(source, /requestIdleCallback/);
    assert.match(citizensHtml, /citizens-deferred-section/);
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
