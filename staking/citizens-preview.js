(function initializeCitizensPreview(global) {
    'use strict';

    const SLOT_ORDER = ['head', 'armor', 'weapon', 'boots', 'relic'];
    const SLOT_META = {
        head: { label: 'Head', icon: '◇' },
        armor: { label: 'Armor', icon: '⬡' },
        weapon: { label: 'Weapon', icon: '⚔' },
        boots: { label: 'Boots', icon: '▿' },
        relic: { label: 'Relic', icon: '✦' },
    };
    const SET_META = {
        Ember: { color: '#fb923c', tint: 'rgba(251,146,60,.12)' },
        Civic: { color: '#60a5fa', tint: 'rgba(96,165,250,.12)' },
        Void: { color: '#c084fc', tint: 'rgba(192,132,252,.12)' },
    };
    const ITEMS = {
        head: [
            { id: 'ember-crown', name: 'Ember Crown', set: 'Ember', rarity: 'Epic', boost: 5, trait: 'Heat signal' },
            { id: 'civic-visor', name: 'Civic Visor', set: 'Civic', rarity: 'Rare', boost: 3, trait: 'Pattern scan' },
            { id: 'void-hood', name: 'Null Hood', set: 'Void', rarity: 'Legendary', boost: 7, trait: 'Hidden path' },
        ],
        armor: [
            { id: 'ember-plate', name: 'Ember Plate', set: 'Ember', rarity: 'Rare', boost: 4, trait: 'Forge guard' },
            { id: 'civic-weave', name: 'Civic Weave', set: 'Civic', rarity: 'Uncommon', boost: 2, trait: 'Credit flow' },
            { id: 'void-mantle', name: 'Null Mantle', set: 'Void', rarity: 'Epic', boost: 5, trait: 'Phase layer' },
        ],
        weapon: [
            { id: 'ember-blade', name: 'Ember Blade', set: 'Ember', rarity: 'Epic', boost: 6, trait: 'Ignition' },
            { id: 'civic-arc', name: 'Civic Arc', set: 'Civic', rarity: 'Rare', boost: 3, trait: 'Network link' },
            { id: 'void-edge', name: 'Null Edge', set: 'Void', rarity: 'Epic', boost: 5, trait: 'Entropy' },
        ],
        boots: [
            { id: 'ember-boots', name: 'Ember Boots', set: 'Ember', rarity: 'Rare', boost: 3, trait: 'Hot step' },
            { id: 'civic-treads', name: 'Civic Treads', set: 'Civic', rarity: 'Uncommon', boost: 2, trait: 'Fast route' },
            { id: 'void-greaves', name: 'Null Greaves', set: 'Void', rarity: 'Epic', boost: 5, trait: 'Silent stride' },
        ],
        relic: [
            { id: 'ember-sigil', name: 'Ember Sigil', set: 'Ember', rarity: 'Legendary', boost: 8, trait: 'Ash memory' },
            { id: 'civic-charter', name: 'Civic Charter', set: 'Civic', rarity: 'Epic', boost: 5, trait: 'Shared yield' },
            { id: 'void-prism', name: 'Null Prism', set: 'Void', rarity: 'Legendary', boost: 8, trait: 'Rarity bend' },
        ],
    };
    const CHECKPOINTS = [
        { days: 5, quality: 1, rarity: 1, category: 'Head' },
        { days: 15, quality: 4, rarity: 4, category: 'Boots' },
        { days: 30, quality: 10, rarity: 10, category: 'Relic' },
    ];
    const CITIZENS = [
        {
            id: 'nova-0142', name: 'Nova #0142', faction: 'Northstar', trait: 'Signal Runner · Genesis',
            colors: ['#1d4ed8', '#0f172a'],
            loadout: { head: 'ember-crown', armor: 'civic-weave', weapon: 'civic-arc', boots: 'ember-boots', relic: 'void-prism' },
        },
        {
            id: 'rook-0871', name: 'Rook #0871', faction: 'Foundry', trait: 'Forge Warden · Prime',
            colors: ['#c2410c', '#1c1917'],
            loadout: { head: 'ember-crown', armor: 'ember-plate', weapon: 'ember-blade', boots: 'ember-boots', relic: 'ember-sigil' },
        },
        {
            id: 'vex-2036', name: 'Vex #2036', faction: 'Undercity', trait: 'Cipher Scout · Origin',
            colors: ['#7e22ce', '#111827'],
            loadout: { head: 'void-hood', armor: 'void-mantle', weapon: 'civic-arc', boots: 'civic-treads', relic: 'void-prism' },
        },
    ];

    const state = {
        citizenId: CITIZENS[0].id,
        activeSlot: 'head',
        checkpointDays: 30,
        loadouts: Object.fromEntries(CITIZENS.map((citizen) => [citizen.id, { ...citizen.loadout }])),
    };

    function getItem(slot, itemId) {
        return ITEMS[slot].find((item) => item.id === itemId) || null;
    }

    function materializeLoadout(loadout) {
        return SLOT_ORDER.map((slot) => getItem(slot, loadout[slot])).filter(Boolean);
    }

    function calculateBonuses(loadout) {
        const items = Array.isArray(loadout) ? loadout.filter(Boolean) : materializeLoadout(loadout || {});
        const setCounts = items.reduce((counts, item) => {
            counts[item.set] = (counts[item.set] || 0) + 1;
            return counts;
        }, {});
        const equipmentBonus = items.reduce((total, item) => total + Number(item.boost || 0), 0);
        let setBonus = 0;
        Object.values(setCounts).forEach((count) => {
            if (count >= 2) setBonus += 5;
            if (count >= 3) setBonus += 8;
            if (count >= 5) setBonus += 12;
        });
        const mixedSetBonus = Object.keys(setCounts).length >= 3 ? 4 : 0;
        setBonus += mixedSetBonus;
        const eventBonus = (setCounts.Ember || 0) * 3;
        const totalBonus = equipmentBonus + setBonus + eventBonus;
        return {
            items,
            setCounts,
            equipmentBonus,
            setBonus,
            mixedSetBonus,
            eventBonus,
            totalBonus,
            multiplier: 1 + totalBonus / 100,
        };
    }

    function recipeProgress(loadout) {
        return Number(loadout.head === 'ember-crown')
            + Number(loadout.weapon === 'civic-arc')
            + Number(Boolean(loadout.relic));
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function element(id) {
        return document.getElementById(id);
    }

    function activeCitizen() {
        return CITIZENS.find((citizen) => citizen.id === state.citizenId) || CITIZENS[0];
    }

    function renderRoster() {
        const roster = element('citizen-roster');
        if (!roster) return;
        roster.innerHTML = CITIZENS.map((citizen, index) => {
            const selected = citizen.id === state.citizenId;
            return `
                <button type="button" class="citizen-selector flex w-full items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/55 p-2.5 text-left transition hover:border-gray-600" role="option" aria-selected="${selected}" data-citizen-id="${escapeHtml(citizen.id)}">
                    <span class="citizen-portrait h-12 w-12 shrink-0 rounded-lg border border-white/10" style="--portrait-from:${citizen.colors[0]};--portrait-to:${citizen.colors[1]};"></span>
                    <span class="min-w-0">
                        <span class="block truncate text-sm font-bold text-white">${escapeHtml(citizen.name)}</span>
                        <span class="mt-0.5 block truncate text-[11px] text-gray-500">${escapeHtml(citizen.faction)}</span>
                    </span>
                    <span class="ml-auto font-mono text-[10px] text-gray-600">0${index + 1}</span>
                </button>`;
        }).join('');

        roster.querySelectorAll('[data-citizen-id]').forEach((button) => {
            button.addEventListener('click', () => {
                state.citizenId = button.dataset.citizenId;
                renderAll();
            });
        });
    }

    function renderCitizen() {
        const citizen = activeCitizen();
        const portrait = element('active-citizen-portrait');
        portrait.style.setProperty('--portrait-from', citizen.colors[0]);
        portrait.style.setProperty('--portrait-to', citizen.colors[1]);
        element('active-citizen-name').textContent = citizen.name;
        element('active-citizen-faction').textContent = citizen.faction;
        element('active-citizen-trait').textContent = citizen.trait;
        element('citizen-roster-index').textContent = String(CITIZENS.findIndex((item) => item.id === citizen.id) + 1);
    }

    function renderSlots() {
        const loadout = state.loadouts[state.citizenId];
        const slotContainer = element('equipment-slots');
        slotContainer.innerHTML = SLOT_ORDER.map((slot) => {
            const meta = SLOT_META[slot];
            const item = getItem(slot, loadout[slot]);
            const set = item ? SET_META[item.set] : null;
            return `
                <button type="button" class="equipment-slot min-h-24 rounded-xl border border-gray-700 bg-gray-900/65 p-3 text-left transition hover:border-gray-500" aria-pressed="${state.activeSlot === slot}" data-slot="${slot}">
                    <span class="flex items-center justify-between">
                        <span class="text-lg text-gray-500">${meta.icon}</span>
                        <span class="text-[9px] font-bold uppercase tracking-[0.13em] text-gray-600">${meta.label}</span>
                    </span>
                    <span class="mt-2 block text-xs font-bold text-white">${item ? escapeHtml(item.name) : 'Empty slot'}</span>
                    <span class="mt-1 block text-[10px] font-semibold" style="color:${set ? set.color : '#6b7280'}">${item ? `${escapeHtml(item.set)} · +${item.boost}%` : 'Select gear'}</span>
                </button>`;
        }).join('');
        const equipped = materializeLoadout(loadout).length;
        element('loadout-completion').textContent = `${equipped} / 5 equipped`;
        slotContainer.querySelectorAll('[data-slot]').forEach((button) => {
            button.addEventListener('click', () => {
                state.activeSlot = button.dataset.slot;
                renderSlots();
                renderInventory();
            });
        });
    }

    function renderInventory() {
        const slot = state.activeSlot;
        const selectedItemId = state.loadouts[state.citizenId][slot];
        element('active-slot-label').textContent = SLOT_META[slot].label;
        const options = [null, ...ITEMS[slot]];
        const inventory = element('equipment-inventory');
        inventory.innerHTML = options.map((item) => {
            const selected = item ? selectedItemId === item.id : !selectedItemId;
            if (!item) {
                return `
                    <button type="button" class="equipment-option min-h-28 rounded-xl border border-dashed border-gray-700 bg-gray-900/35 p-3 text-left transition hover:border-gray-500" aria-pressed="${selected}" data-item-id="">
                        <span class="text-lg text-gray-600">＋</span>
                        <span class="mt-3 block text-sm font-bold text-gray-300">Unequip slot</span>
                        <span class="mt-1 block text-[11px] text-gray-600">Return NFT to inventory</span>
                    </button>`;
            }
            const set = SET_META[item.set];
            return `
                <button type="button" class="equipment-option min-h-28 rounded-xl border border-gray-700 bg-gray-900/55 p-3 text-left transition hover:border-gray-500" aria-pressed="${selected}" data-item-id="${escapeHtml(item.id)}">
                    <span class="flex items-center justify-between gap-2">
                        <span class="rounded-md px-2 py-1 text-[10px] font-bold" style="color:${set.color};background:${set.tint}">${escapeHtml(item.set)}</span>
                        <span class="text-[10px] font-semibold text-gray-500">${escapeHtml(item.rarity)}</span>
                    </span>
                    <span class="mt-3 block text-sm font-bold text-white">${escapeHtml(item.name)}</span>
                    <span class="mt-1 flex items-center justify-between text-[11px]"><span class="text-gray-500">${escapeHtml(item.trait)}</span><span class="font-mono font-bold text-green-400">+${item.boost}%</span></span>
                </button>`;
        }).join('');
        inventory.querySelectorAll('[data-item-id]').forEach((button) => {
            button.addEventListener('click', () => {
                state.loadouts[state.citizenId][slot] = button.dataset.itemId || null;
                renderSlots();
                renderInventory();
                renderBonuses();
            });
        });
    }

    function renderBonuses() {
        const loadout = state.loadouts[state.citizenId];
        const bonuses = calculateBonuses(loadout);
        const research = recipeProgress(loadout);
        element('loadout-multiplier').textContent = `${bonuses.multiplier.toFixed(2)}×`;
        element('equipment-bonus').textContent = `+${bonuses.equipmentBonus}%`;
        element('set-bonus').textContent = `+${bonuses.setBonus}%`;
        element('event-bonus').textContent = `+${bonuses.eventBonus}%`;
        element('research-progress').textContent = `${research} / 3`;
        element('event-recipe').textContent = `Forge ${research} / 3`;

        const synergies = [];
        Object.entries(bonuses.setCounts).forEach(([set, count]) => {
            if (count < 2) return;
            const tier = count >= 5 ? '5-piece ascension' : count >= 3 ? '3-piece circuit' : '2-piece link';
            synergies.push({ label: `${set} ${tier}`, color: SET_META[set].color });
        });
        if (bonuses.mixedSetBonus) synergies.push({ label: 'Streetwise mixed-set array', color: '#60a5fa' });
        if (bonuses.eventBonus) synergies.push({ label: `Ashfall · ${bonuses.setCounts.Ember} Ember signal${bonuses.setCounts.Ember === 1 ? '' : 's'}`, color: '#c084fc' });
        element('active-synergies').innerHTML = synergies.length
            ? synergies.map((synergy) => `<div class="flex items-center gap-2 text-[11px] text-gray-300"><span class="h-1.5 w-1.5 rounded-full" style="background:${synergy.color}"></span>${escapeHtml(synergy.label)}</div>`).join('')
            : '<p class="text-[11px] text-gray-600">Equip matching or mixed sets to activate a bonus.</p>';
    }

    function renderCheckpoints() {
        const options = element('checkpoint-options');
        options.innerHTML = CHECKPOINTS.map((checkpoint) => `
            <button type="button" class="checkpoint-option rounded-xl border border-gray-700 bg-gray-900/55 p-3 text-left transition hover:border-gray-500" aria-pressed="${checkpoint.days === state.checkpointDays}" data-checkpoint-days="${checkpoint.days}">
                <span class="block text-sm font-black text-white">${checkpoint.days} days</span>
                <span class="mt-1 block text-[10px] text-gray-500">+${checkpoint.quality} quality · +${checkpoint.rarity}% odds</span>
            </button>`).join('');
        options.querySelectorAll('[data-checkpoint-days]').forEach((button) => {
            button.addEventListener('click', () => {
                state.checkpointDays = Number(button.dataset.checkpointDays);
                renderCheckpoints();
            });
        });
        const active = CHECKPOINTS.find((checkpoint) => checkpoint.days === state.checkpointDays) || CHECKPOINTS[0];
        element('checkpoint-days').textContent = `${active.days} days`;
        element('checkpoint-quality').textContent = `+${active.quality}`;
        element('checkpoint-rarity').textContent = `+${active.rarity}%`;
        element('checkpoint-category').textContent = active.category;
    }

    function renderAll() {
        renderRoster();
        renderCitizen();
        renderSlots();
        renderInventory();
        renderBonuses();
        renderCheckpoints();
    }

    function setCitizensMode(enabled) {
        const primary = element('staking-primary-column');
        const sidebar = element('staking-sidebar');
        if (!primary || !sidebar) return;
        primary.classList.toggle('lg:col-span-2', !enabled);
        primary.classList.toggle('lg:col-span-3', enabled);
        sidebar.classList.toggle('hidden', enabled);
    }

    function init() {
        if (!element('nft-view')) return;
        renderAll();
        const tokenSwitch = element('switch-token');
        const citizenSwitch = element('switch-nft');
        if (tokenSwitch) tokenSwitch.addEventListener('click', () => setCitizensMode(false));
        if (citizenSwitch) citizenSwitch.addEventListener('click', () => setCitizensMode(true));
    }

    global.AlphaCityCitizensPreview = Object.freeze({
        calculateBonuses,
        recipeProgress,
        checkpoints: CHECKPOINTS.map((checkpoint) => ({ ...checkpoint })),
    });

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
        else init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
