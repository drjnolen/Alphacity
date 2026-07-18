(function initializeCitizensPreview(global) {
    'use strict';

    // Canonical slots, specialties, rarities, passives, charges, and abilities mirror
    // https://github.com/drjnolen/GuildVenture/blob/main/item_traits.py.
    const SLOT_ORDER = ['cranial', 'chassis', 'equipment', 'mobility', 'companion'];
    const SLOT_META = {
        cranial: { label: 'Cranial', icon: '🧠' },
        chassis: { label: 'Chassis', icon: '🛡' },
        equipment: { label: 'Equipment', icon: '🔧' },
        mobility: { label: 'Mobility', icon: '🦿' },
        companion: { label: 'Companion', icon: '🐾' },
    };
    const SPECIALTY_META = {
        Umbral: { color: '#a78bfa', tint: 'rgba(167,139,250,.12)', damageType: 'Umbral' },
        Blockchain: { color: '#38bdf8', tint: 'rgba(56,189,248,.12)', damageType: 'Mercantile' },
        Kinetic: { color: '#fb7185', tint: 'rgba(251,113,133,.12)', damageType: 'Kinetic' },
        Enertech: { color: '#facc15', tint: 'rgba(250,204,21,.12)', damageType: 'Enertech' },
        Archon: { color: '#f59e0b', tint: 'rgba(245,158,11,.12)', damageType: 'Archon' },
        Neural: { color: '#e879f9', tint: 'rgba(232,121,249,.12)', damageType: 'Neural' },
        Mechanical: { color: '#94a3b8', tint: 'rgba(148,163,184,.12)', damageType: 'Mechanical' },
    };
    const RARITY_META = {
        'Salvage': { damageBonus: 5, stakeBoost: 1, charges: 1, color: '#d1d5db' },
        'Gutter-Tech': { damageBonus: 10, stakeBoost: 2, charges: 1, color: '#4ade80' },
        'Street Mod': { damageBonus: 15, stakeBoost: 3, charges: 2, color: '#60a5fa' },
        'Black Market': { damageBonus: 25, stakeBoost: 5, charges: 2, color: '#c084fc' },
        'Node-Forged': { damageBonus: 40, stakeBoost: 8, charges: 3, color: '#facc15' },
        'Peerless': { damageBonus: 60, stakeBoost: 12, charges: 4, color: '#fb7185' },
    };
    const ABILITY_CATALOG = {
        cranial: {
            Umbral: ['Shadow Whisper', '8 Umbral damage', 'Project dark thoughts into the target’s mind.'],
            Blockchain: ['Market Insight', '+15 to next roll', 'Analyze enemy weakness through financial data patterns.'],
            Kinetic: ['Neural Overcharge', '10 Kinetic damage', 'Amplify combat reflexes for a devastating strike.'],
            Enertech: ['Synaptic Surge', '9 Enertech damage', 'Channel raw energy through a neural implant.'],
            Archon: ['Command Protocol', '7 Archon damage', 'Assert dominance with an authoritative mental command.'],
            Neural: ['Mind Mend', 'Heal 10 HP', 'Reorganize neural pathways to repair damage.'],
            Mechanical: ['Logic Spike', '8 Mechanical damage', 'Fire a concentrated packet that disrupts target systems.'],
        },
        chassis: {
            Umbral: ['Shadow Shroud', 'Heal 12 HP', 'Envelop yourself in darkness and regenerate.'],
            Blockchain: ['Economic Shield', 'Heal party 6 HP', 'Redistribute damage through market algorithms.'],
            Kinetic: ['Impact Absorb', 'Heal 14 HP', 'Convert incoming kinetic energy into healing power.'],
            Enertech: ['Energy Barrier', 'Heal 11 HP', 'Project a protective field that restores HP.'],
            Archon: ['Authority Aura', 'Heal 10 HP', 'A commanding presence bolsters your defenses.'],
            Neural: ['Psionic Shield', 'Heal 13 HP', 'Create a mental barrier that repairs physical damage.'],
            Mechanical: ['Nanobot Repair', 'Heal 15 HP', 'Deploy nanobots to restore structural integrity.'],
        },
        equipment: {
            Umbral: ['Void Grenade', '12 Umbral damage', 'Detonate a grenade into consuming darkness.'],
            Blockchain: ['Crypto Bomb', '11 Mercantile damage', 'Crash enemy financial systems.'],
            Kinetic: ['Concussion Charge', '14 Kinetic damage', 'Detonate a powerful kinetic blast.'],
            Enertech: ['Plasma Launcher', '13 Enertech damage', 'Fire a concentrated plasma bolt.'],
            Archon: ['Sanction Device', '10 Archon damage', 'Activate an Overlord-sanctioned punishment protocol.'],
            Neural: ['Psi Amplifier', '+20 to next roll', 'Boost the next action with psionic energy.'],
            Mechanical: ['EMP Burst', '12 Mechanical damage', 'Release a pulse that damages mechanical targets.'],
        },
        mobility: {
            Umbral: ['Shadow Step', '9 Umbral damage', 'Phase through shadows and strike unexpectedly.'],
            Blockchain: ['Market Momentum', '+18 to next roll', 'Ride economic data waves into the next action.'],
            Kinetic: ['Velocity Strike', '11 Kinetic damage', 'Build speed for a devastating impact.'],
            Enertech: ['Energy Dash', '10 Enertech damage', 'Surge forward in a burst of energy.'],
            Archon: ['Executive Retreat', 'Heal 8 HP', 'Tactical repositioning restores composure.'],
            Neural: ['Psionic Leap', '+15 to next roll', 'Teleport a short distance through mental focus.'],
            Mechanical: ['Thruster Boost', '10 Mechanical damage', 'Activate thrusters for a high-speed attack.'],
        },
        companion: {
            Umbral: ['Shadow Bite', '11 Umbral damage', 'A shadow-beast companion lunges at the target.'],
            Blockchain: ['Broker Bot Attack', '10 Mercantile damage', 'A financial drone executes a hostile takeover.'],
            Kinetic: ['Combat Drone Strike', '13 Kinetic damage', 'A combat drone delivers a punishing blow.'],
            Enertech: ['Energy Familiar', '12 Enertech damage', 'An energy construct blasts the target.'],
            Archon: ['Enforcer Summon', '9 Archon damage', 'A personal enforcer delivers punishment.'],
            Neural: ['Psionic Familiar', 'Heal 9 HP', 'A mental construct restores its operator.'],
            Mechanical: ['Mech Companion Strike', '12 Mechanical damage', 'A mechanical companion unleashes its weapons.'],
        },
    };
    const ITEM_RARITIES = {
        cranial: ['Black Market', 'Street Mod', 'Node-Forged', 'Gutter-Tech', 'Peerless', 'Node-Forged', 'Salvage'],
        chassis: ['Street Mod', 'Black Market', 'Node-Forged', 'Gutter-Tech', 'Peerless', 'Black Market', 'Node-Forged'],
        equipment: ['Black Market', 'Street Mod', 'Node-Forged', 'Peerless', 'Black Market', 'Gutter-Tech', 'Node-Forged'],
        mobility: ['Street Mod', 'Node-Forged', 'Black Market', 'Gutter-Tech', 'Peerless', 'Node-Forged', 'Black Market'],
        companion: ['Node-Forged', 'Black Market', 'Peerless', 'Street Mod', 'Black Market', 'Node-Forged', 'Gutter-Tech'],
    };
    const SPECIALTIES = Object.keys(SPECIALTY_META);
    const ITEMS = Object.fromEntries(SLOT_ORDER.map((slot) => [
        slot,
        SPECIALTIES.map((specialty, index) => {
            const [name, trait, description] = ABILITY_CATALOG[slot][specialty];
            const rarity = ITEM_RARITIES[slot][index];
            const rarityMeta = RARITY_META[rarity];
            return {
                id: `${slot}-${specialty.toLowerCase()}`,
                name,
                slot,
                specialty,
                rarity,
                boost: rarityMeta.stakeBoost,
                damageBonus: rarityMeta.damageBonus,
                charges: rarityMeta.charges,
                damageType: SPECIALTY_META[specialty].damageType,
                trait,
                description,
            };
        }),
    ]));
    const CHECKPOINTS = [
        { days: 5, quality: 1, rarity: 1, category: 'Cranial' },
        { days: 15, quality: 4, rarity: 4, category: 'Mobility' },
        { days: 30, quality: 10, rarity: 10, category: 'Companion' },
    ];
    const CITIZENS = [
        {
            id: 'eira-0142', name: 'Eira Voss #0142', faction: 'Nodewalker', alignment: 'Underground', trait: 'Blockchain-mystic · Technology +1',
            colors: ['#1d4ed8', '#0f172a'],
            loadout: { cranial: 'cranial-blockchain', chassis: 'chassis-neural', equipment: 'equipment-mechanical', mobility: 'mobility-blockchain', companion: 'companion-blockchain' },
        },
        {
            id: 'mako-0871', name: 'Mako Raze #0871', faction: 'Chainbreaker', alignment: 'Underground', trait: 'Augmented warrior · Strength +1',
            colors: ['#c2410c', '#1c1917'],
            loadout: { cranial: 'cranial-kinetic', chassis: 'chassis-kinetic', equipment: 'equipment-kinetic', mobility: 'mobility-kinetic', companion: 'companion-kinetic' },
        },
        {
            id: 'cassian-2036', name: 'Cassian Vale #2036', faction: 'Overlord', alignment: 'Overcity', trait: 'Dynastic scion · Communication +1',
            colors: ['#a16207', '#111827'],
            loadout: { cranial: 'cranial-archon', chassis: 'chassis-archon', equipment: 'equipment-archon', mobility: 'mobility-archon', companion: 'companion-archon' },
        },
    ];

    const state = {
        citizenId: CITIZENS[0].id,
        activeSlot: 'cranial',
        checkpointDays: 30,
        loadouts: Object.fromEntries(CITIZENS.map((citizen) => [citizen.id, { ...citizen.loadout }])),
    };

    function getItem(slot, itemId) {
        return ITEMS[slot].find((item) => item.id === itemId) || null;
    }

    function materializeLoadout(loadout) {
        return SLOT_ORDER.map((slot) => getItem(slot, loadout[slot])).filter(Boolean);
    }

    function calculateBonuses(loadout, context = {}) {
        const items = Array.isArray(loadout) ? loadout.filter(Boolean) : materializeLoadout(loadout || {});
        const specialtyCounts = items.reduce((counts, item) => {
            counts[item.specialty] = (counts[item.specialty] || 0) + 1;
            return counts;
        }, {});
        const equipmentBonus = items.reduce((total, item) => total + Number(item.boost || 0), 0);
        let setBonus = 0;
        Object.values(specialtyCounts).forEach((count) => {
            if (count >= 2) setBonus += 5;
            if (count >= 3) setBonus += 8;
            if (count >= 5) setBonus += 12;
        });
        const mixedSetBonus = Object.keys(specialtyCounts).length >= 3 ? 4 : 0;
        setBonus += mixedSetBonus;
        const factionEventBonus = context.faction === 'Nodewalker' ? 5 : 0;
        const eventBonus = (specialtyCounts.Blockchain || 0) * 3 + factionEventBonus;
        const totalBonus = equipmentBonus + setBonus + eventBonus;
        return {
            items,
            specialtyCounts,
            equipmentBonus,
            setBonus,
            mixedSetBonus,
            factionEventBonus,
            eventBonus,
            totalBonus,
            multiplier: 1 + totalBonus / 100,
        };
    }

    function recipeProgress(loadout) {
        return Number(loadout.cranial === 'cranial-blockchain')
            + Number(loadout.equipment === 'equipment-mechanical')
            + Number(loadout.companion === 'companion-blockchain');
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
                        <span class="mt-0.5 block truncate text-[11px] text-gray-500">${escapeHtml(citizen.faction)} · ${escapeHtml(citizen.alignment)}</span>
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
            const specialty = item ? SPECIALTY_META[item.specialty] : null;
            return `
                <button type="button" class="equipment-slot min-h-24 rounded-xl border border-gray-700 bg-gray-900/65 p-3 text-left transition hover:border-gray-500" aria-pressed="${state.activeSlot === slot}" data-slot="${slot}">
                    <span class="flex items-center justify-between">
                        <span class="text-lg text-gray-500">${meta.icon}</span>
                        <span class="text-[9px] font-bold uppercase tracking-[0.13em] text-gray-600">${meta.label}</span>
                    </span>
                    <span class="mt-2 block text-xs font-bold text-white">${item ? escapeHtml(item.name) : 'Empty slot'}</span>
                    <span class="mt-1 block text-[10px] font-semibold" style="color:${specialty ? specialty.color : '#6b7280'}">${item ? `${escapeHtml(item.specialty)} · +${item.boost}% stake` : 'Select gear'}</span>
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
            const specialty = SPECIALTY_META[item.specialty];
            const rarity = RARITY_META[item.rarity];
            return `
                <button type="button" class="equipment-option min-h-36 rounded-xl border border-gray-700 bg-gray-900/55 p-3 text-left transition hover:border-gray-500" aria-pressed="${selected}" data-item-id="${escapeHtml(item.id)}" title="${escapeHtml(item.description)}">
                    <span class="flex items-center justify-between gap-2">
                        <span class="rounded-md px-2 py-1 text-[10px] font-bold" style="color:${specialty.color};background:${specialty.tint}">${escapeHtml(item.specialty)}</span>
                        <span class="text-[10px] font-semibold" style="color:${rarity.color}">${escapeHtml(item.rarity)}</span>
                    </span>
                    <span class="mt-3 block text-sm font-bold text-white">${escapeHtml(item.name)}</span>
                    <span class="mt-1 block text-[11px] text-gray-500">${escapeHtml(item.trait)}</span>
                    <span class="mt-3 flex items-center justify-between border-t border-gray-800 pt-2 text-[10px]"><span class="text-gray-500">+${item.damageBonus}% ${escapeHtml(item.damageType)} · ${item.charges} charge${item.charges === 1 ? '' : 's'}</span><span class="font-mono font-bold text-green-400">+${item.boost}% stake</span></span>
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
        const citizen = activeCitizen();
        const bonuses = calculateBonuses(loadout, { faction: citizen.faction });
        const research = recipeProgress(loadout);
        element('loadout-multiplier').textContent = `${bonuses.multiplier.toFixed(2)}×`;
        element('equipment-bonus').textContent = `+${bonuses.equipmentBonus}%`;
        element('set-bonus').textContent = `+${bonuses.setBonus}%`;
        element('event-bonus').textContent = `+${bonuses.eventBonus}%`;
        element('research-progress').textContent = `${research} / 3`;
        element('event-recipe').textContent = `Deep Ledger ${research} / 3`;

        const synergies = [];
        Object.entries(bonuses.specialtyCounts).forEach(([specialty, count]) => {
            if (count < 2) return;
            const tier = count >= 5 ? '5-piece ascension' : count >= 3 ? '3-piece circuit' : '2-piece link';
            synergies.push({ label: `${specialty} ${tier}`, color: SPECIALTY_META[specialty].color });
        });
        if (bonuses.mixedSetBonus) synergies.push({ label: 'Cross-specialty field rig', color: '#60a5fa' });
        if (bonuses.specialtyCounts.Blockchain) synergies.push({ label: `Relay · ${bonuses.specialtyCounts.Blockchain} Blockchain signal${bonuses.specialtyCounts.Blockchain === 1 ? '' : 's'}`, color: '#38bdf8' });
        if (bonuses.factionEventBonus) synergies.push({ label: 'Oracle’s Relay · Nodewalker resonance', color: '#c084fc' });
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
        taxonomy: Object.freeze({
            slots: SLOT_ORDER.map((slot) => SLOT_META[slot].label),
            specialties: [...SPECIALTIES],
            rarities: Object.keys(RARITY_META),
            factions: CITIZENS.map((citizen) => citizen.faction),
            itemCount: SLOT_ORDER.reduce((total, slot) => total + ITEMS[slot].length, 0),
        }),
    });

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
        else init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
