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
    assert.match(html, /Preview data only/);
    assert.match(html, /No wallet actions enabled/);
    assert.match(html, /id="stake-nft-btn"[^>]*disabled[^>]*aria-disabled="true"/);
    assert.match(html, /No NFTs are moved, nested, staked, or approved/);
    assert.doesNotMatch(source, /signAndExecute|AlphaCitySui|walletAdapter/);
});

test('Citizens preview exposes all five swappable equipment slots and strategy surfaces', () => {
    for (const slot of ['head', 'armor', 'weapon', 'boots', 'relic']) {
        assert.match(source, new RegExp(`${slot}: \\{ label:`));
    }
    assert.match(html, /id="citizen-roster"/);
    assert.match(html, /id="equipment-slots"/);
    assert.match(html, /id="equipment-inventory"/);
    assert.match(html, /id="active-synergies"/);
    assert.match(html, /id="checkpoint-options"/);
    assert.match(html, /Ashfall Protocol/);
});

test('bonus preview stacks equipment, set, mixed-loadout, and event effects', () => {
    const emberLoadout = Array.from({ length: 5 }, (_, index) => ({ set: 'Ember', boost: index + 1 }));
    const ember = preview.calculateBonuses(emberLoadout);
    assert.equal(ember.equipmentBonus, 15);
    assert.equal(ember.setBonus, 25);
    assert.equal(ember.eventBonus, 15);
    assert.equal(ember.multiplier, 1.55);

    const mixed = preview.calculateBonuses([
        { set: 'Ember', boost: 2 },
        { set: 'Civic', boost: 2 },
        { set: 'Void', boost: 2 },
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
