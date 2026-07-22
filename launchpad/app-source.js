import { Transaction } from '@mysten/sui/transactions';

const core = window.AlphaCityLaunchpadCore;
const CLOCK_ID = '0x6';
const SUI_TYPE = '0x2::sui::SUI';
const state = {
    registry: null,
    collection: null,
    collectionId: '',
    collectionUrl: '',
    wallet: null,
    walletConnector: null,
    quantity: 1,
    balanceMist: null,
    onchain: null,
    activeStage: null,
    busy: false,
};

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const numberFormat = (value) => Number(value || 0).toLocaleString();
const rpc = (method, params) => {
    if (!window.AlphaCitySui?.rpc) throw new Error('The Sui data service is unavailable.');
    return window.AlphaCitySui.rpc(method, params);
};

function resolveUrl(path, base = state.collectionUrl || window.location.href) {
    return path ? new URL(path, base).toString() : '';
}

function firstNumber(...values) {
    const found = values.find((value) => value !== undefined && value !== null && value !== '');
    const parsed = Number(found || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function chainFields(value) {
    if (!value || typeof value !== 'object') return {};
    return value.fields && typeof value.fields === 'object' ? value.fields : value;
}

function chainString(value) {
    if (typeof value === 'string') return value;
    const fields = chainFields(value);
    return fields.bytes || fields.value || '';
}

function contractMode() {
    return state.collection?.contract?.mode || 'coming-soon';
}

function isManagedDrop() {
    return ['managed-drop', 'enabled'].includes(contractMode());
}

function currentSupply() {
    return firstNumber(state.onchain?.publicSupply, state.onchain?.totalSupply, state.collection?.publicSupply, state.collection?.supply);
}

function currentMinted() {
    return firstNumber(state.onchain?.mintedPublic, state.collection?.minted);
}

function currentPriceMist() {
    if (state.activeStage?.priceMist != null) return BigInt(state.activeStage.priceMist);
    return core.suiToMist(String(state.collection?.priceSui || '0'));
}

function maxQuantity() {
    const transactionLimit = Math.max(1, firstNumber(state.collection?.maxPerTx, 1));
    const walletLimit = Math.max(1, firstNumber(state.activeStage?.walletLimit, transactionLimit));
    const remaining = Math.max(1, currentSupply() - currentMinted());
    return Math.min(transactionLimit, walletLimit, remaining);
}

function formatSui(mist) {
    if (mist == null) return '—';
    return `${Number(core.mistToSui(mist)).toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI`;
}

function formatDate(timestamp) {
    if (!timestamp) return 'No end time';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

function shortAddress(address) {
    return window.AlphaCityWalletConnector?.shortAddress(address) || address;
}

function safeExternalUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch (_) { return ''; }
}

function explorerUrl(digest) {
    return `https://suivision.xyz/txblock/${encodeURIComponent(digest)}`;
}

function transactionFailure(result) {
    const failed = result?.FailedTransaction;
    if (failed) return failed.error?.message || failed.error || 'The transaction failed on-chain.';
    const status = result?.effects?.status || result?.Transaction?.effects?.status;
    const value = status?.status || status?.success;
    if (value === false || String(value || '').toLowerCase() === 'failure') return status?.error || 'The transaction failed on-chain.';
    return '';
}

function showStatus(message, type = 'info', link) {
    const element = byId('mint-status');
    const styles = {
        info: 'border-blue-500/30 bg-blue-500/10 text-blue-100',
        success: 'border-green-500/30 bg-green-500/10 text-green-100',
        error: 'border-red-500/30 bg-red-500/10 text-red-100',
    };
    element.className = `mt-4 rounded-2xl border px-4 py-3 text-sm ${styles[type] || styles.info}`;
    element.replaceChildren(document.createTextNode(message));
    if (link) {
        const anchor = document.createElement('a');
        anchor.href = link;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.className = 'ml-2 font-semibold underline';
        anchor.textContent = 'View transaction';
        element.append(anchor);
    }
    element.classList.remove('hidden');
}

function hideStatus() {
    byId('mint-status').classList.add('hidden');
}

async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
    return response.json();
}

function parseChainStage(stageValue, index) {
    const stage = chainFields(stageValue);
    return {
        id: firstNumber(stage.id, index),
        name: chainString(stage.name) || `Stage ${index + 1}`,
        priceMist: String(stage.price_mist ?? stage.priceMist ?? '0'),
        startTimeMs: firstNumber(stage.start_time_ms, stage.startTimeMs),
        endTimeMs: firstNumber(stage.end_time_ms, stage.endTimeMs),
        walletLimit: firstNumber(stage.wallet_limit, stage.walletLimit),
        allocation: firstNumber(stage.allocation),
        minted: firstNumber(stage.minted),
        allowlistOnly: Boolean(stage.allowlist_only ?? stage.allowlistOnly),
    };
}

function selectActiveStage(stages, now = Date.now()) {
    const current = stages.find((stage) => stage.startTimeMs <= now && (!stage.endTimeMs || stage.endTimeMs > now) && (!stage.allocation || stage.minted < stage.allocation));
    if (current) return current;
    return stages.filter((stage) => stage.startTimeMs > now).sort((a, b) => a.startTimeMs - b.startTimeMs)[0] || null;
}

async function refreshOnchain() {
    if (!isManagedDrop()) {
        state.onchain = null;
        state.activeStage = selectActiveStage((state.collection?.phases || []).map((stage, index) => ({
            id: stage.id ?? index,
            name: stage.name,
            priceMist: stage.priceMist || core.suiToMist(String(stage.priceSui ?? state.collection?.priceSui ?? 0)).toString(),
            startTimeMs: firstNumber(stage.startTimeMs),
            endTimeMs: firstNumber(stage.endTimeMs),
            walletLimit: firstNumber(stage.walletLimit, state.collection?.maxPerTx),
            allocation: firstNumber(stage.allocation),
            minted: firstNumber(stage.minted),
            allowlistOnly: Boolean(stage.allowlistOnly),
        })));
        return;
    }
    const dropId = state.collection.contract.dropId;
    if (!core.isValidSuiAddress(dropId)) throw new Error('This collection has an invalid drop object ID.');
    const response = await rpc('sui_getObject', [dropId, { showContent: true, showType: true }]);
    if (response?.error) throw new Error(response.error.message || 'The launch contract was not found.');
    const fields = response?.data?.content?.fields || {};
    const stages = Array.isArray(fields.stages) ? fields.stages.map(parseChainStage) : [];
    state.onchain = {
        paused: Boolean(fields.paused),
        published: Boolean(fields.published),
        totalSupply: firstNumber(fields.total_supply),
        publicSupply: firstNumber(fields.public_supply),
        reservedSupply: firstNumber(fields.reserved_supply),
        mintedPublic: firstNumber(fields.minted_public),
        creator: String(fields.creator || state.collection.creator?.address || ''),
        platformFeeBps: firstNumber(fields.platform_fee_bps, state.collection.platformFeeBps),
        stages,
    };
    state.activeStage = selectActiveStage(stages);
}

async function refreshBalance() {
    if (!state.wallet?.address) {
        state.balanceMist = null;
        renderBalance();
        return;
    }
    try {
        const response = await rpc('suix_getBalance', [state.wallet.address, SUI_TYPE]);
        state.balanceMist = BigInt(response?.totalBalance || 0);
    } catch (error) {
        console.warn('[launchpad] Could not load SUI balance:', error);
        state.balanceMist = null;
    }
    renderBalance();
}

async function loadGallery(collection) {
    if (Array.isArray(collection.gallery) && collection.gallery.length) {
        return collection.gallery.map((item) => ({ name: item.name || collection.name, image: resolveUrl(item.image) }));
    }
    if (!collection.csv) return [];
    try {
        const csvUrl = resolveUrl(collection.csv);
        const response = await fetch(csvUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Gallery CSV returned ${response.status}`);
        const parsed = core.parseCsv(await response.text());
        return parsed.rows.slice(0, Number(collection.galleryLimit || 8)).map((row, index) => ({
            name: row.name || row.Name || `${collection.name} #${index + 1}`,
            image: resolveUrl(row.image || row['File Name'], csvUrl),
        })).filter((item) => item.image);
    } catch (error) {
        console.warn('[launchpad] Gallery could not be loaded:', error);
        return [];
    }
}

function phaseState(stage, now) {
    if (stage.startTimeMs > now) return 'upcoming';
    if (stage.endTimeMs && stage.endTimeMs <= now) return 'ended';
    if (stage.allocation && stage.minted >= stage.allocation) return 'filled';
    return 'active';
}

function renderPhases() {
    const now = Date.now();
    const phases = state.onchain?.stages || state.collection?.phases || [];
    const container = byId('phase-list');
    if (!phases.length) {
        container.innerHTML = '<div class="rounded-2xl border border-white/5 bg-dark-bg/55 p-4 text-sm text-dark-text-secondary">Mint stages will appear after the project schedule is finalized.</div>';
        return;
    }
    container.innerHTML = phases.map((raw, index) => {
        const phase = raw.priceMist != null ? raw : {
            ...raw,
            id: raw.id ?? index,
            startTimeMs: firstNumber(raw.startTimeMs),
            endTimeMs: firstNumber(raw.endTimeMs),
            priceMist: raw.priceMist || core.suiToMist(String(raw.priceSui ?? state.collection.priceSui ?? 0)).toString(),
            walletLimit: firstNumber(raw.walletLimit, state.collection.maxPerTx),
            minted: firstNumber(raw.minted), allocation: firstNumber(raw.allocation),
        };
        const status = raw.state && !isManagedDrop() ? raw.state : phaseState(phase, now);
        const active = state.activeStage && Number(state.activeStage.id) === Number(phase.id) && status === 'active';
        const badge = active ? 'Live' : status === 'ended' ? 'Ended' : status === 'filled' ? 'Filled' : status === 'upcoming' ? 'Upcoming' : status;
        const schedule = phase.startTimeMs ? `${formatDate(phase.startTimeMs)}${phase.endTimeMs ? ` – ${formatDate(phase.endTimeMs)}` : ''}` : (raw.description || 'Schedule to be announced');
        return `<article class="rounded-2xl border ${active ? 'border-blue-400/35 bg-blue-400/10' : 'border-white/5 bg-dark-bg/55'} p-4">
            <div class="flex flex-wrap items-start justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><h3 class="font-bold text-white">${escapeHtml(phase.name)}</h3>${phase.allowlistOnly ? '<span class="rounded-full bg-violet-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-200">Allowlist</span>' : ''}</div><p class="mt-1 text-sm text-dark-text-secondary">${escapeHtml(schedule)}</p></div><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${active ? 'bg-green-400/15 text-green-300' : 'bg-gray-700 text-gray-300'}">${escapeHtml(badge)}</span></div>
            <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-300"><span>${formatSui(phase.priceMist)}</span><span>${phase.walletLimit || '—'} per wallet</span>${phase.allocation ? `<span>${numberFormat(phase.minted)} / ${numberFormat(phase.allocation)} stage mints</span>` : ''}</div>
        </article>`;
    }).join('');
}

function renderGallery() {
    const gallery = state.collection?.galleryResolved || [];
    const section = byId('gallery-section');
    if (!gallery.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    byId('gallery-grid').innerHTML = gallery.map((item) => `<figure class="overflow-hidden rounded-2xl border border-white/5 bg-dark-bg/55"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="aspect-square w-full object-cover" loading="lazy"><figcaption class="px-4 py-3 text-sm font-semibold text-white">${escapeHtml(item.name)}</figcaption></figure>`).join('');
}

function renderDetails() {
    const collection = state.collection;
    const details = Array.isArray(collection.details) ? [...collection.details] : [];
    if (collection.creator?.address) details.push({ label: 'Creator payout', value: shortAddress(collection.creator.address) });
    if (collection.platformFeeBps != null) details.push({ label: 'Primary fee', value: `${Number(collection.platformFeeBps) / 100}%` });
    byId('detail-grid').innerHTML = details.map((detail) => `<div class="rounded-2xl border border-white/5 bg-dark-bg/55 p-4"><p class="text-xs uppercase tracking-[.18em] text-dark-text-secondary">${escapeHtml(detail.label)}</p><p class="mt-2 break-words font-semibold text-white">${escapeHtml(detail.value)}</p></div>`).join('');
    byId('about-copy').textContent = collection.description || collection.tagline || 'Collection details will be published before minting opens.';
    const links = [
        safeExternalUrl(collection.creator?.website) && { label: 'Website', href: safeExternalUrl(collection.creator.website) },
        safeExternalUrl(collection.creator?.twitter) && { label: 'X / Twitter', href: safeExternalUrl(collection.creator.twitter) },
        safeExternalUrl(collection.creator?.discord) && { label: 'Discord', href: safeExternalUrl(collection.creator.discord) },
    ].filter(Boolean);
    byId('creator-links').innerHTML = links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" class="rounded-xl border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-blue-400 hover:text-white">${escapeHtml(link.label)}</a>`).join('');
}

function renderBalance() {
    byId('sui-balance').textContent = state.balanceMist == null ? '—' : formatSui(state.balanceMist);
}

function renderMintButton() {
    const button = byId('mint-btn');
    const caption = byId('mint-caption');
    const disabled = 'mt-6 w-full cursor-not-allowed rounded-2xl bg-gray-700 px-5 py-4 text-lg font-bold text-gray-300 shadow-lg';
    const enabled = 'mt-6 w-full rounded-2xl bg-brand-secondary px-5 py-4 text-lg font-bold text-gray-900 shadow-lg shadow-yellow-500/20 transition hover:-translate-y-0.5 hover:bg-yellow-300 disabled:cursor-wait disabled:opacity-70';
    if (!state.collection) { button.disabled = true; button.className = disabled; button.textContent = 'Loading launch…'; caption.textContent = ''; return; }
    if (!isManagedDrop()) { button.disabled = true; button.className = disabled; button.textContent = state.collection.contract?.ctaLabel || 'Mint opens soon'; caption.textContent = state.collection.contract?.message || 'Publication details are being finalized.'; return; }
    if (state.onchain?.paused) { button.disabled = true; button.className = disabled; button.textContent = 'Mint paused'; caption.textContent = 'The project team has temporarily paused this mint.'; return; }
    if (state.onchain && !state.onchain.published) { button.disabled = true; button.className = disabled; button.textContent = 'Finalizing collection'; caption.textContent = 'The contract exists, but its inventory is not yet locked for public minting.'; return; }
    if (currentMinted() >= currentSupply() && currentSupply()) { button.disabled = true; button.className = disabled; button.textContent = 'Sold out'; caption.textContent = 'All public inventory has been minted.'; return; }
    if (!state.activeStage || phaseState(state.activeStage, Date.now()) !== 'active') {
        button.disabled = true; button.className = disabled;
        button.textContent = state.activeStage?.startTimeMs > Date.now() ? 'Mint not started' : 'No active mint stage';
        caption.textContent = state.activeStage?.startTimeMs ? `Next stage starts ${formatDate(state.activeStage.startTimeMs)}.` : 'Check the schedule for the next stage.';
        return;
    }
    if (!state.wallet?.address) { button.disabled = true; button.className = disabled; button.textContent = 'Connect wallet to mint'; caption.textContent = 'Connect any supported Sui wallet using the button above.'; return; }
    const total = currentPriceMist() * BigInt(state.quantity);
    button.disabled = state.busy;
    button.className = enabled;
    button.textContent = state.busy ? 'Waiting for wallet…' : `Mint ${state.quantity} for ${formatSui(total)}`;
    caption.textContent = state.activeStage.allowlistOnly ? 'This stage verifies your wallet against the on-chain allowlist.' : 'Payment is split directly between the creator and AlphaCity on-chain.';
}

function renderCollection() {
    const collection = state.collection;
    if (!collection) return;
    const supply = currentSupply();
    const minted = currentMinted();
    const progress = supply ? Math.min(100, (minted / supply) * 100) : 0;
    const liveStage = state.activeStage && phaseState(state.activeStage, Date.now()) === 'active';
    const status = state.onchain?.paused
        ? 'Paused'
        : liveStage
            ? 'Minting Live'
            : isManagedDrop() && state.activeStage?.startTimeMs > Date.now()
                ? 'Upcoming'
                : collection.statusLabel || 'Coming Soon';
    byId('hero-image').src = collection.heroImageResolved || '';
    byId('hero-image').alt = `${collection.name || 'Collection'} artwork`;
    byId('eyebrow').textContent = collection.eyebrow || 'Alpha City Launchpad';
    byId('headline').textContent = collection.headline || collection.name || 'Alpha City collection';
    byId('tagline').textContent = collection.tagline || collection.description || '';
    byId('collection-name').textContent = collection.name || 'Collection';
    byId('status-label').textContent = status;
    byId('stat-supply').textContent = numberFormat(supply);
    byId('stat-price').textContent = formatSui(currentPriceMist());
    byId('stat-limit').textContent = String(maxQuantity());
    byId('stat-network').textContent = collection.network?.name || 'Sui';
    byId('minted-count').textContent = numberFormat(minted);
    byId('supply-count').textContent = numberFormat(supply);
    byId('progress-bar').style.width = `${progress}%`;
    byId('mint-note').textContent = collection.mintNote || 'Connect your wallet to get ready.';
    byId('quantity').textContent = String(state.quantity);
    byId('qty-caption').textContent = `Up to ${maxQuantity()} per transaction`;
    renderPhases();
    renderGallery();
    renderDetails();
    renderBalance();
    renderMintButton();
}

function renderSwitcher() {
    const collections = state.registry?.collections || [];
    const select = byId('collection-switcher');
    const wrap = byId('collection-switcher-wrap');
    wrap.classList.toggle('hidden', collections.length <= 1);
    select.innerHTML = collections.map((collection) => `<option value="${escapeHtml(collection.id)}" ${collection.id === state.collectionId ? 'selected' : ''}>${escapeHtml(collection.label || collection.id)}</option>`).join('');
}

async function loadCollection(id) {
    const entry = state.registry.collections.find((collection) => collection.id === id) || state.registry.collections[0];
    if (!entry) throw new Error('No launchpad collections are configured.');
    state.collectionId = entry.id;
    state.collectionUrl = resolveUrl(entry.config, `${window.location.origin}/launchpad/collections/index.json`);
    const collection = await fetchJson(state.collectionUrl);
    collection.heroImageResolved = resolveUrl(collection.heroImage, state.collectionUrl);
    collection.galleryResolved = await loadGallery(collection);
    state.collection = collection;
    state.quantity = 1;
    state.onchain = null;
    state.activeStage = null;
    hideStatus();
    await refreshOnchain();
    renderSwitcher();
    renderCollection();
    if (state.wallet) await refreshBalance();
    const url = new URL(window.location.href);
    url.searchParams.set('collection', entry.id);
    history.replaceState(null, '', url);
}

async function mint() {
    if (state.busy || !state.wallet?.address || !state.activeStage || !isManagedDrop()) return;
    const totalMist = currentPriceMist() * BigInt(state.quantity);
    if (state.balanceMist != null && state.balanceMist <= totalMist) {
        showStatus('Your wallet does not have enough SUI for the mint price plus gas.', 'error');
        return;
    }
    state.busy = true;
    hideStatus();
    renderMintButton();
    try {
        const transaction = new Transaction();
        transaction.setSender(state.wallet.address);
        const [payment] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(totalMist)]);
        transaction.moveCall({
            target: `${state.collection.contract.packageId}::${state.collection.contract.module || 'managed_drop'}::mint`,
            arguments: [
                transaction.object(state.collection.contract.dropId),
                transaction.object(CLOCK_ID),
                payment,
                transaction.pure.u64(state.activeStage.id),
                transaction.pure.u64(state.quantity),
            ],
        });
        const result = await state.walletConnector.signAndExecuteTransaction(transaction);
        const immediateFailure = transactionFailure(result);
        if (immediateFailure) throw new Error(immediateFailure);
        const digest = result?.digest || result?.Transaction?.digest || result?.effects?.transactionDigest;
        if (digest && window.AlphaCitySui?.grpcClient?.waitForTransaction) {
            const confirmed = await window.AlphaCitySui.grpcClient.waitForTransaction({ digest, include: { effects: true, events: true, objectChanges: true } });
            const confirmedFailure = transactionFailure(confirmed);
            if (confirmedFailure) throw new Error(confirmedFailure);
        }
        showStatus(`Mint confirmed${digest ? `: ${digest.slice(0, 10)}…` : ''}`, 'success', digest ? explorerUrl(digest) : '');
        await Promise.all([refreshOnchain(), refreshBalance()]);
        renderCollection();
    } catch (error) {
        console.error('[launchpad] Mint failed:', error);
        showStatus(error?.message || 'The mint could not be completed.', 'error');
    } finally {
        state.busy = false;
        renderMintButton();
    }
}

function initializeWallet() {
    if (!window.AlphaCityWalletConnector) throw new Error('The universal wallet connector did not load.');
    state.walletConnector = window.AlphaCityWalletConnector.create({
        button: byId('connect-wallet-btn'),
        onChange(session) {
            state.wallet = session;
            refreshBalance().finally(renderMintButton);
        },
    });
}

async function initialize() {
    byId('current-year').textContent = String(new Date().getFullYear());
    initializeWallet();
    state.registry = await fetchJson('/launchpad/collections/index.json');
    const requested = new URLSearchParams(window.location.search).get('collection');
    await loadCollection(requested || state.registry.defaultCollection);
    window.setInterval(() => {
        if (!state.collection) return;
        state.activeStage = selectActiveStage(state.onchain?.stages || state.collection.phases || []);
        renderCollection();
    }, 30_000);
}

byId('qty-minus').addEventListener('click', () => { state.quantity = Math.max(1, state.quantity - 1); renderCollection(); });
byId('qty-plus').addEventListener('click', () => { state.quantity = Math.min(maxQuantity(), state.quantity + 1); renderCollection(); });
byId('mint-btn').addEventListener('click', mint);
byId('collection-switcher').addEventListener('change', (event) => loadCollection(event.target.value).catch((error) => showStatus(error.message, 'error')));

initialize().catch((error) => {
    console.error('[launchpad] Initialization failed:', error);
    showStatus(error?.message || 'The launchpad could not be loaded.', 'error');
    byId('mint-btn').textContent = 'Launchpad unavailable';
});
