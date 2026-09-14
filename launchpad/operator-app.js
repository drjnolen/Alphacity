(function alphaCityFirstPartyBuilder() {
    'use strict';

    const core = window.AlphaCityLaunchpadCore;
    if (!core) throw new Error('Launchpad validation tools did not load.');

    const drafts = window.AlphaCityLaunchpadDrafts.create({
        indexedDB: window.indexedDB,
        get localStorage() { try { return window.localStorage; } catch (_) { return null; } },
    });
    const STEP_LABELS = ['Collection', 'Items', 'Mint phases', 'Payouts', 'Review', 'Prepare'];
    const state = {
        draftId: '',
        projects: [],
        attachments: new Map(),
        fileEpoch: 0,
        mediaReading: false,
        csvReading: false,
        itemPage: 0,
        coverFile: null,
        renderTimer: null,
        switching: false,
        reviewedSteps: new Set(),
        releaseLock: null,
        step: 0,
        phases: [],
        csvText: '',
        csvName: '',
        mediaFiles: [],
        mediaSignatures: new Map(),
        mediaReadEpoch: 0,
        validation: null,
        editingPhase: -1,
        saveTimer: null,
        coverUrl: '',
        loaded: false,
        resetting: false,
    };

    const byId = (id) => document.getElementById(id);
    const value = (id) => byId(id)?.value?.trim() || '';
    const escapeHtml = (input) => String(input == null ? '' : input).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
    const integer = (id, fallback = 0) => {
        const parsed = Number(value(id));
        return value(id) === '' ? fallback : parsed;
    };

    function localDateTime(input) {
        const timestamp = typeof input === 'number' ? input : Date.parse(input || '');
        if (!Number.isFinite(timestamp)) return '';
        const date = new Date(timestamp);
        return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
    }

    function isoDateTime(input) {
        if (!input) return '';
        const timestamp = typeof input === 'number' ? input : Date.parse(input);
        return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : input;
    }

    function exactPercentToBps(input) {
        const text = String(input == null ? '' : input).trim();
        if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error('Royalty percentage must use at most two decimal places.');
        const [whole, fraction = ''] = text.split('.');
        const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
        if (bps < 0 || bps > 10_000) throw new Error('Royalty percentage must be between 0% and 100%.');
        return bps;
    }

    function bpsToPercent(input) {
        const bps = Number(input || 0);
        return (bps / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    }

    function formProject() {
        let royaltyBps = 0;
        try { royaltyBps = exactPercentToBps(value('royalty-percent') || '0'); }
        catch (_) { royaltyBps = -1; }
        return {
            schemaVersion: 3,
            id: value('collection-slug'),
            name: value('collection-name'),
            intendedSupply: integer('intended-supply'),
            creatorName: value('creator-name'),
            creatorAddress: value('payout-address'),
            headline: value('headline'),
            tagline: value('tagline'),
            description: value('description'),
            website: value('website'),
            twitter: value('twitter'),
            discord: value('discord'),
            heroFile: value('hero-file'),
            mediaBaseUrl: value('media-base-url'),
            royaltyBps,
            platformFeeBps: 0,
            maxPerTx: integer('max-per-tx', 5),
            assignmentPolicy: byId('assignment-policy-equivalent')?.checked ? core.ASSIGNMENT_POLICY : '',
            mediaReleaseVerified: Boolean(byId('media-release-verified')?.checked),
            reveal: { mode: value('reveal-mode') === 'delayed' ? 'delayed' : 'instant' },
            stages: state.phases.map((phase) => ({
                name: phase.name,
                priceSui: phase.priceSui,
                startTime: isoDateTime(phase.startTime),
                endTime: isoDateTime(phase.endTime),
                walletLimit: Number(phase.walletLimit),
                allocation: Number(phase.allocation || 0),
                allowlistOnly: Boolean(phase.allowlistOnly),
                allowlist: (phase.allowlist || []).map((entry) => ({ address: entry.address, limit: Number(entry.limit) })),
            })),
        };
    }

    function currentDraft() {
        return {
            id: state.draftId,
            savedAt: new Date().toISOString(),
            project: formProject(),
            step: state.step,
        };
    }

    function autosaveStatus(label, tone = 'idle') {
        const element = byId('autosave-state');
        const mobile = byId('mobile-autosave');
        if (element) {
            const dot = element.querySelector('span');
            const text = element.querySelector('span:last-child');
            if (dot) dot.className = `h-2 w-2 rounded-full ${tone === 'saved' ? 'bg-green-400' : tone === 'error' ? 'bg-red-400' : 'bg-gray-500'}`;
            if (text) text.textContent = label;
        }
        if (mobile) mobile.textContent = label;
    }

    async function persistDraft() {
        if (!state.loaded || state.resetting) return false;
        clearTimeout(state.saveTimer);
        autosaveStatus('Saving…');
        const draft = currentDraft();
        try {
            await drafts.save(draft);
            state.projects = state.projects.filter((entry) => entry.id !== draft.id);
            state.projects.unshift(draft);
            renderProjects();
            autosaveStatus('Saved in this browser', 'saved');
            return true;
        } catch (error) {
            console.warn('[launchpad] Could not save draft:', error);
            autosaveStatus('Not saved · Export a backup', 'error');
            return false;
        }
    }

    function scheduleSave() {
        if (!state.loaded || state.resetting) return;
        clearTimeout(state.saveTimer);
        autosaveStatus('Unsaved changes');
        state.saveTimer = setTimeout(persistDraft, 450);
    }

    function newProject() {
        return { royaltyBps: 500, maxPerTx: 5, intendedSupply: 1000, stages: [{
            name: 'Public mint', priceSui: '1', startTime: new Date(Date.now() + 86400000).toISOString(),
            endTime: '', walletLimit: 5, allocation: 0, allowlistOnly: false, allowlist: [],
        }] };
    }

    function renderProjects() {
        const projects = [currentDraft(), ...state.projects.filter((entry) => entry.id !== state.draftId)];
        byId('project-switcher').innerHTML = projects.map((draft) => `<option value="${escapeHtml(draft.id)}" ${draft.id === state.draftId ? 'selected' : ''}>${escapeHtml(draft.project.name || 'Untitled collection')}${draft.project.id ? ` (${escapeHtml(draft.project.id)})` : ''}</option>`).join('');
    }

    function clearFiles() {
        state.fileEpoch++;
        state.mediaReadEpoch++;
        state.csvText = '';
        state.csvName = '';
        state.mediaFiles = [];
        state.mediaSignatures = new Map();
        state.validation = null;
        state.mediaReading = false;
        state.csvReading = false;
        state.itemPage = 0;
        byId('metadata-file').value = '';
        byId('media-files').value = '';
        byId('media-individual-files').value = '';
        byId('assignment-policy-equivalent').checked = false;
        byId('media-release-verified').checked = false;
        byId('csv-file-label').textContent = 'Choose this project’s metadata CSV';
        byId('media-file-label').textContent = 'Choose this project’s media folder or individual images';
        ['summary-items', 'summary-files', 'summary-public', 'summary-reserved'].forEach((id) => { byId(id).textContent = '0'; });
        renderMessages('item-validation-messages', []);
        renderMessages('prepare-messages', []);
        renderItemTable();
    }

    async function activateDraft(draft) {
        if (state.releaseLock) { state.releaseLock(); state.releaseLock = null; }
        if (navigator.locks) {
            const available = await new Promise((resolve) => {
                navigator.locks.request(`alphacity-launchpad:${draft.id}`, { ifAvailable: true }, async (lock) => {
                    if (!lock) { resolve(false); return; }
                    await new Promise((release) => { state.releaseLock = release; resolve(true); });
                }).catch(() => resolve(true));
            });
            if (!available) {
                draft = { ...draft, id: crypto.randomUUID(), project: { ...draft.project, name: `${draft.project.name || 'Untitled collection'} (copy)` } };
                showToast('This project is open in another tab. You’re editing a separate copy.');
                return activateDraft(draft);
            }
        }
        clearFiles();
        state.reviewedSteps = new Set();
        state.draftId = draft.id;
        populateProject(draft.project);
        // File-dependent confirmations must be repeated after a reload/import.
        byId('assignment-policy-equivalent').checked = false;
        byId('media-release-verified').checked = false;
        const files = state.attachments.get(draft.id);
        if (files && files.projectSignature === JSON.stringify(draft.project)) {
            const { projectSignature, ...attachments } = files;
            Object.assign(state, attachments);
            byId('csv-file-label').textContent = state.csvName || 'Choose metadata CSV';
            byId('media-file-label').textContent = `${state.mediaFiles.length} files selected`;
            byId('assignment-policy-equivalent').checked = Boolean(draft.project.assignmentPolicy);
            byId('media-release-verified').checked = Boolean(draft.project.mediaReleaseVerified);
        }
        const step = Number(draft.step);
        state.step = Number.isInteger(step) ? Math.max(0, Math.min(5, step)) : 0;
        drafts.select(draft.id);
        renderProjects();
        if (state.csvText) validateItems(false);
        else renderAll();
        showStep(state.step);
    }

    async function changeProject(id, project) {
        if (state.switching) return;
        state.switching = true;
        byId('project-switcher').disabled = true;
        byId('builder-content').inert = true;
        try {
            if (!await persistDraft()) throw new Error('Export a backup before changing projects; browser storage is unavailable.');
            state.attachments.set(state.draftId, {
                projectSignature: JSON.stringify(formProject()),
                csvText: state.csvText, csvName: state.csvName,
                mediaFiles: state.mediaFiles, mediaSignatures: state.mediaSignatures,
            });
            state.projects = await drafts.list();
            const draft = project ? { id: crypto.randomUUID(), project, step: 0 } : state.projects.find((entry) => entry.id === id);
            if (!draft) throw new Error('This project could not be found.');
            await activateDraft(draft);
            await persistDraft();
            return true;
        } catch (error) { showToast(error.message, 'error'); renderProjects(); return false; }
        finally { state.switching = false; byId('project-switcher').disabled = false; byId('builder-content').inert = false; }
    }

    async function loadDraft() {
        try {
            state.projects = (await drafts.list()).filter((draft) => {
                try { importableProject(draft.project); return true; }
                catch (_) { showToast('A saved project could not be opened. Its stored copy has been kept.', 'error'); return false; }
            });
        }
        catch (error) { showToast(error.message, 'error'); }
        const draft = state.projects.find((entry) => entry.id === drafts.active()) || state.projects[0]
            || { id: crypto.randomUUID(), project: newProject(), step: 0 };
        await activateDraft(draft);
        state.loaded = true;
        autosaveStatus(state.projects.length ? 'Project restored · Reselect files' : 'New project');
    }

    function importableProject(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose an editable project JSON file.');
        const project = input.project || input;
        if (!project || typeof project !== 'object' || Array.isArray(project) || !('name' in project || 'id' in project || 'stages' in project)) throw new Error('This file is not an editable collection project.');
        if (project.schemaVersion != null && ![1, 2, 3].includes(project.schemaVersion)) throw new Error('This project uses an unsupported version.');
        if (project.stages != null && (!Array.isArray(project.stages) || project.stages.some((stage) => !stage || typeof stage !== 'object' || Array.isArray(stage) || (stage.allowlist != null && !Array.isArray(stage.allowlist))))) throw new Error('Mint phases must be a list with valid allowlist entries.');
        for (const stage of project.stages || []) {
            if (stage.priceSui == null && stage.priceMist != null) {
                try { core.mistToSui(stage.priceMist); }
                catch (_) { throw new Error('A mint phase has an invalid priceMist amount.'); }
            }
        }
        if (Number(project.platformFeeBps || 0) !== 0) throw new Error('This builder supports projects with a 0% platform fee.');
        return project;
    }

    function setValue(id, next) {
        const element = byId(id);
        if (element) element.value = next == null ? '' : String(next);
    }

    function populateProject(project) {
        setValue('collection-name', project.name);
        setValue('collection-slug', project.id);
        byId('collection-slug').dataset.touched = project.id ? 'true' : '';
        setValue('intended-supply', project.intendedSupply ?? project.supply ?? '');
        setValue('hero-file', project.heroFile);
        setValue('creator-name', project.creatorName || project.creator?.name);
        setValue('headline', project.headline);
        setValue('tagline', project.tagline);
        setValue('description', project.description);
        setValue('website', project.website || project.creator?.website);
        setValue('twitter', project.twitter || project.creator?.twitter);
        setValue('discord', project.discord || project.creator?.discord);
        setValue('payout-address', project.creatorAddress || project.creator?.address);
        setValue('royalty-percent', bpsToPercent(project.royaltyBps));
        setValue('max-per-tx', project.maxPerTx ?? 5);
        byId('assignment-policy-equivalent').checked = project.assignmentPolicy === core.ASSIGNMENT_POLICY;
        byId('media-release-verified').checked = project.mediaReleaseVerified === true;
        setValue('reveal-mode', project.reveal?.mode === 'delayed' ? 'delayed' : 'instant');
        setValue('media-base-url', project.mediaBaseUrl);
        state.phases = (project.stages || []).map((phase) => ({
            name: phase.name || 'Mint phase',
            priceSui: String(phase.priceSui ?? (phase.priceMist != null ? core.mistToSui(phase.priceMist) : '1')),
            startTime: isoDateTime(phase.startTime ?? phase.startTimeMs),
            endTime: isoDateTime(phase.endTime ?? phase.endTimeMs),
            walletLimit: Number(phase.walletLimit ?? 1),
            allocation: Number(phase.allocation || 0),
            allowlistOnly: Boolean(phase.allowlistOnly),
            allowlist: Array.isArray(phase.allowlist) ? phase.allowlist.map((entry) => typeof entry === 'string'
                ? { address: entry, limit: Number(phase.walletLimit ?? 1) }
                : { address: entry?.address || '', limit: Number(entry?.limit ?? phase.walletLimit ?? 1) }) : [],
        }));
    }

    function showToast(message, tone = 'info') {
        const toast = byId('toast');
        toast.className = `pointer-events-none fixed bottom-5 right-5 z-[70] max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-2xl ${tone === 'error' ? 'border-red-400/30 bg-red-950 text-red-100' : 'border-blue-400/30 bg-gray-900 text-blue-100'}`;
        toast.textContent = message;
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3200);
    }

    function showStep(next) {
        if (state.loaded && Number(next) !== state.step) state.reviewedSteps.add(state.step);
        state.step = Math.max(0, Math.min(5, Number.isInteger(Number(next)) ? Number(next) : 0));
        document.querySelectorAll('[data-step-panel]').forEach((panel) => { panel.hidden = Number(panel.dataset.stepPanel) !== state.step; });
        document.querySelectorAll('[data-step-target]').forEach((button) => {
            if (Number(button.dataset.stepTarget) === state.step) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
        });
        byId('previous-step').disabled = state.step === 0;
        const nextButton = byId('next-step');
        nextButton.textContent = state.step === 5 ? 'Back to review' : `Next: ${STEP_LABELS[state.step + 1]} →`;
        if (state.step === 5) nextButton.onclick = () => showStep(4);
        else nextButton.onclick = () => showStep(state.step + 1);
        renderAll();
        if (state.step === 4) renderPreview();
        if (state.step === 5) renderReadiness();
        scheduleSave();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const heading = document.querySelector(`[data-step-panel="${state.step}"] h2`);
        if (heading) {
            heading.setAttribute('tabindex', '-1');
            requestAnimationFrame(() => heading.focus({ preventScroll: true }));
        }
    }

    function displayMessage(message) {
        return String(message)
            .replace('A hero image filename from the validated raster media folder is required.', 'Choose a cover image filename in Collection and include that image in your media folder.')
            .replace('A valid nonzero Sui creator payout address is required.', 'Enter a valid Sui payout address in Payouts.')
            .replace('Assignment policy must explicitly confirm that sequentially assigned public items have equivalent mint value.', 'Confirm that all public items have equivalent mint value in Items.')
            .replace(/Mint stages/g, 'Mint phases').replace(/Mint stage/g, 'Mint phase').replace(/mint stage/g, 'mint phase');
    }

    function renderMessages(containerId, errors, warnings = []) {
        const container = byId(containerId);
        const messages = [
            ...errors.map((message) => ({ tone: 'error', message })),
            ...warnings.map((message) => ({ tone: 'warning', message })),
        ];
        container.classList.toggle('hidden', messages.length === 0);
        container.innerHTML = messages.slice(0, 50).map(({ tone, message }) => `<div class="rounded-xl border px-4 py-3 text-sm ${tone === 'error' ? 'border-red-400/25 bg-red-400/10 text-red-100' : 'border-yellow-400/20 bg-yellow-400/10 text-yellow-100'}">${escapeHtml(displayMessage(message))}</div>`).join('');
        if (messages.length > 50) container.insertAdjacentHTML('beforeend', `<p class="text-sm text-gray-400">Showing 50 of ${messages.length.toLocaleString()} issues. Fix these and validate again to see the remaining issues.</p>`);
    }

    function isItemValidationMessage(message) {
        return /\b(?:CSV|media|file|image|item|inventory|supply|reserved|public|assignment)\b/i.test(String(message));
    }

    function validationMediaFiles() {
        return state.mediaFiles.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
            signatureBytes: state.mediaSignatures.get(file) || new Uint8Array(),
        }));
    }

    function validateItems(showMessages = true) {
        const result = core.validateSubmission(formProject(), state.csvText, validationMediaFiles(), { requireMediaSignatures: true });
        const itemErrors = result.errors.filter(isItemValidationMessage);
        const itemWarnings = result.warnings.filter(isItemValidationMessage);
        state.validation = { ...result, errors: itemErrors, warnings: itemWarnings, valid: itemErrors.length === 0 };
        byId('summary-items').textContent = String(result.items.length || 0);
        byId('summary-files').textContent = String(state.mediaFiles.length);
        byId('summary-public').textContent = String(result.publicSupply || 0);
        byId('summary-reserved').textContent = String(result.reservedSupply || 0);
        renderItemTable();
        renderMessages('item-validation-messages', showMessages ? itemErrors : [], itemWarnings);
        updateCoverPreview();
        renderAll();
        return result;
    }

    function renderItemTable() {
        const result = state.validation || { items: [] };
        const pages = Math.max(1, Math.ceil(result.items.length / 100));
        state.itemPage = Math.min(state.itemPage, pages - 1);
        const body = byId('item-table');
        body.innerHTML = result.items.length ? result.items.slice(state.itemPage * 100, (state.itemPage + 1) * 100).map((item) => `<tr class="bg-dark-bg/25"><td class="px-4 py-3 text-gray-500">${item.index + 1}</td><td class="px-4 py-3 font-semibold text-white">${escapeHtml(item.name || 'Missing name')}</td><td class="px-4 py-3 font-mono text-xs text-gray-300">${escapeHtml(item.fileName || 'Missing')}</td><td class="px-4 py-3 text-gray-400">${Object.keys(item.attributes).length}</td><td class="px-4 py-3"><span class="rounded-full px-2 py-1 text-xs font-semibold ${item.reserved ? 'bg-yellow-400/10 text-yellow-200' : 'bg-blue-400/10 text-blue-200'}">${item.reserved ? 'Reserved' : 'Public'}</span></td></tr>`).join('')
            : '<tr><td colspan="5" class="px-4 py-12 text-center text-dark-text-secondary">Select a CSV and media folder to inspect the collection.</td></tr>';
        byId('item-page-label').textContent = result.items.length ? `Page ${state.itemPage + 1} of ${pages} · ${result.items.length.toLocaleString()} items` : 'No items selected';
        byId('items-previous').disabled = state.itemPage === 0;
        byId('items-next').disabled = state.itemPage + 1 >= pages;
    }

    function parseAllowlist(text, defaultLimit) {
        const entries = [];
        const errors = [];
        String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line, index) => {
            if (index === 0 && /^address(?:\s*,|$)/i.test(line)) return;
            const [rawAddress, rawLimit] = line.split(',').map((part) => part.trim());
            const address = core.normalizeSuiAddress(rawAddress);
            const limit = rawLimit === undefined || rawLimit === '' ? defaultLimit : Number(rawLimit);
            if (!address || /^0x0{64}$/.test(address)) errors.push(`Allowlist row ${index + 1} has an invalid address.`);
            else if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) errors.push(`Allowlist row ${index + 1} has an invalid limit.`);
            else entries.push({ address, limit });
        });
        const seen = new Set();
        const duplicates = entries.filter((entry) => { const duplicate = seen.has(entry.address); seen.add(entry.address); return duplicate; });
        if (duplicates.length) errors.push('Allowlist contains duplicate wallet addresses.');
        return { entries, errors };
    }

    function phaseText(phase) {
        const access = phase.allowlistOnly ? `${phase.allowlist.length} allowlisted` : 'Public';
        const start = Number.isFinite(Date.parse(phase.startTime)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(phase.startTime)) : 'No start';
        return `${phase.priceSui} SUI · ${access} · ${start}`;
    }

    function renderPhases() {
        const container = byId('phase-list');
        if (!state.phases.length) {
            container.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-700 p-8 text-center text-sm text-gray-400">No mint phases yet. Add at least one phase before preparing the collection.</div>';
            return;
        }
        container.innerHTML = state.phases.map((phase, index) => `<article class="rounded-2xl border border-white/5 bg-dark-bg/55 p-4"><div class="flex flex-wrap items-start justify-between gap-4"><div><div class="flex flex-wrap items-center gap-2"><span class="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-400/10 text-xs font-bold text-blue-200">${index + 1}</span><h3 class="font-bold text-white">${escapeHtml(phase.name)}</h3>${phase.allowlistOnly ? '<span class="rounded-full bg-violet-400/10 px-2 py-1 text-[10px] font-bold uppercase text-violet-200">Allowlist</span>' : ''}</div><p class="mt-2 text-xs leading-5 text-gray-400">${escapeHtml(phaseText(phase))}</p></div><div class="flex flex-wrap gap-2"><button type="button" data-phase-action="up" data-phase-index="${index}" class="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300" aria-label="Move phase up">↑</button><button type="button" data-phase-action="down" data-phase-index="${index}" class="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300" aria-label="Move phase down">↓</button><button type="button" data-phase-action="edit" data-phase-index="${index}" class="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200">Edit</button><button type="button" data-phase-action="delete" data-phase-index="${index}" class="rounded-lg border border-red-400/20 px-3 py-1.5 text-xs font-semibold text-red-200">Delete</button></div></div></article>`).join('');
    }

    function openPhaseDialog(index = -1) {
        state.editingPhase = index;
        state.allowlistEpoch = (state.allowlistEpoch || 0) + 1;
        const phase = index >= 0 ? state.phases[index] : {
            name: 'Public mint', priceSui: '1',
            startTime: localDateTime(Date.now() + 24 * 60 * 60 * 1000), endTime: '', walletLimit: 5,
            allocation: 0, allowlistOnly: false, allowlist: [],
        };
        byId('phase-dialog-title').textContent = index >= 0 ? 'Edit mint phase' : 'Add mint phase';
        setValue('phase-name', phase.name);
        setValue('phase-price', phase.priceSui);
        setValue('phase-start', localDateTime(phase.startTime));
        setValue('phase-end', localDateTime(phase.endTime));
        setValue('phase-wallet-limit', phase.walletLimit);
        setValue('phase-allocation', phase.allocation || 0);
        byId('phase-allowlist-only').checked = Boolean(phase.allowlistOnly);
        byId('phase-allowlist').value = (phase.allowlist || []).map((entry) => `${entry.address},${entry.limit}`).join('\n');
        byId('allowlist-fields').classList.toggle('hidden', !phase.allowlistOnly);
        byId('phase-errors').classList.add('hidden');
        byId('phase-dialog').showModal();
    }

    function closePhaseDialog() { state.allowlistEpoch++; byId('phase-dialog').close(); }

    function revalidateAfterRuleChange() {
        state.validation = null;
        if (state.csvText) validateItems(false);
        else renderAll();
    }

    function savePhase(event) {
        event.preventDefault();
        const errors = [];
        const name = value('phase-name');
        const priceSui = value('phase-price');
        const startTime = value('phase-start');
        const endTime = value('phase-end');
        const walletLimit = integer('phase-wallet-limit');
        const allocation = integer('phase-allocation');
        const allowlistOnly = byId('phase-allowlist-only').checked;
        if (!name) errors.push('Phase name is required.');
        try {
            const priceMist = core.suiToMist(priceSui);
            if (priceMist > core.U64_MAX) errors.push('Phase price exceeds the Sui u64 amount limit.');
            const maxPerTx = Math.max(0, integer('max-per-tx', 0));
            if (priceMist * BigInt(maxPerTx) > core.U64_MAX) errors.push('Phase price multiplied by the maximum per transaction exceeds the Sui u64 amount limit.');
        } catch (error) { errors.push(error.message); }
        if (!startTime || !Number.isFinite(Date.parse(startTime))) errors.push('A valid start date and time is required.');
        if (endTime && (!Number.isFinite(Date.parse(endTime)) || Date.parse(endTime) <= Date.parse(startTime))) errors.push('End time must be after start time.');
        if (!Number.isSafeInteger(walletLimit) || walletLimit < 1 || walletLimit > 10_000) errors.push('Wallet limit must be between 1 and 10,000.');
        if (!Number.isSafeInteger(allocation) || allocation < 0) errors.push('Phase allocation must be a whole number of zero or more.');
        const parsed = parseAllowlist(value('phase-allowlist'), walletLimit);
        if (allowlistOnly && !parsed.entries.length) errors.push('An allowlist phase needs at least one valid address.');
        if (allowlistOnly) errors.push(...parsed.errors);
        const candidate = { name, priceSui, startTime: isoDateTime(startTime), endTime: isoDateTime(endTime), walletLimit, allocation, allowlistOnly, allowlist: allowlistOnly ? parsed.entries : [] };
        const phases = [...state.phases];
        if (state.editingPhase >= 0) phases[state.editingPhase] = candidate;
        else phases.push(candidate);
        for (let left = 0; left < phases.length; left += 1) {
            for (let right = left + 1; right < phases.length; right += 1) {
                const aStart = Date.parse(phases[left].startTime);
                const bStart = Date.parse(phases[right].startTime);
                const aEnd = phases[left].endTime ? Date.parse(phases[left].endTime) : Infinity;
                const bEnd = phases[right].endTime ? Date.parse(phases[right].endTime) : Infinity;
                if (aStart < bEnd && bStart < aEnd) errors.push(`“${phases[left].name}” overlaps “${phases[right].name}”.`);
            }
        }
        const errorBox = byId('phase-errors');
        if (errors.length) { errorBox.textContent = errors.join(' '); errorBox.classList.remove('hidden'); return; }
        state.phases = phases.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
        closePhaseDialog();
        revalidateAfterRuleChange();
        scheduleSave();
    }

    function renderPreview() {
        const project = formProject();
        const first = state.phases.slice().sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))[0];
        byId('preview-path').textContent = project.id ? `/mint/?collection=${encodeURIComponent(project.id)}` : '/mint/';
        byId('preview-name').textContent = project.name || 'Untitled collection';
        byId('preview-tagline').textContent = project.tagline || project.description || 'Your collection tagline will appear here.';
        byId('preview-supply').textContent = project.intendedSupply ? Number(project.intendedSupply).toLocaleString() : '—';
        byId('preview-price').textContent = first ? `${first.priceSui} SUI` : '—';
        byId('preview-royalty').textContent = `${value('royalty-percent') || '0'}%`;
        byId('preview-phase').textContent = first?.name || 'Mint schedule pending';
        byId('preview-time').textContent = Number.isFinite(Date.parse(first?.startTime)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(first.startTime)) : 'Add a mint phase to continue.';
        byId('preview-limit').textContent = first ? `${first.walletLimit} per wallet` : '—';
        const normalized = core.normalizeProject(project);
        renderMessages('review-warnings', normalized.errors, normalized.warnings);
        updateCoverPreview();
    }

    function renderPayoutValidation() {
        const normalized = core.normalizeProject(formProject());
        const payoutErrors = normalized.errors.filter((error) => /creator payout|Royalty|Maximum per transaction/i.test(error));
        const container = byId('payout-validation');
        container.classList.toggle('hidden', payoutErrors.length === 0);
        container.className = payoutErrors.length
            ? 'mt-5 rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100'
            : 'mt-5 hidden rounded-2xl border px-4 py-3 text-sm';
        container.textContent = payoutErrors.join(' ');
        byId('payout-address').setAttribute('aria-invalid', String(payoutErrors.some((error) => /creator payout/i.test(error))));
        byId('royalty-percent').setAttribute('aria-invalid', String(payoutErrors.some((error) => /Royalty/i.test(error))));
        byId('max-per-tx').setAttribute('aria-invalid', String(payoutErrors.some((error) => /Maximum per transaction/i.test(error))));
    }

    function updateCoverPreview() {
        const hero = state.mediaFiles.find((file) => file.name === value('hero-file'));
        if (hero === state.coverFile) return;
        state.coverFile = hero;
        if (state.coverUrl) { URL.revokeObjectURL(state.coverUrl); state.coverUrl = ''; }
        const image = byId('preview-art');
        const empty = byId('preview-art-empty');
        if (hero) {
            state.coverUrl = URL.createObjectURL(hero);
            image.src = state.coverUrl;
            image.classList.remove('hidden');
            empty.classList.add('hidden');
        } else {
            image.removeAttribute('src');
            image.classList.add('hidden');
            empty.classList.remove('hidden');
        }
    }

    function errorStep(error) {
        if (/mint stage/i.test(error)) return 2;
        if (/payout|royalty|maximum per transaction|reveal|platform fee/i.test(error)) return 3;
        if (/assignment policy/i.test(error)) return 1;
        return 0;
    }

    function readinessRows() {
        const project = formProject();
        const normalized = core.normalizeProject(project);
        const mediaUrlValidation = core.validateMediaBaseUrl(project.mediaBaseUrl || '', { requireReleasePath: true, collectionId: project.id });
        return [
            ...[0, 2, 3].map((step) => {
                const errors = normalized.errors.filter((error) => errorStep(error) === step);
                return { ready: errors.length === 0, title: ['Collection details', '', 'Mint phases', 'Payouts and royalties'][step], detail: errors.length ? errors.join(' ') : 'Complete', step };
            }),
            { ready: Boolean(state.validation?.valid) && !state.mediaReading && !state.csvReading, step: 1, title: 'Items validated', detail: state.mediaReading || state.csvReading ? 'Reading files…' : state.validation ? `${state.validation.supply || 0} items · ${state.validation.errors.length} errors` : 'Select the CSV and media folder' },
            { ready: mediaUrlValidation.valid, step: 5, title: 'Published media URL', detail: mediaUrlValidation.valid ? project.mediaBaseUrl : mediaUrlValidation.error },
            { ready: project.mediaReleaseVerified, step: 5, title: 'Published files verified', detail: project.mediaReleaseVerified ? 'You confirmed the uploaded files and locked release path' : 'Follow the publishing guide, then confirm the files above' },
            { ready: project.reveal.mode === 'instant', step: 3, title: 'Reveal mode', detail: project.reveal.mode === 'instant' ? 'Instant reveal' : 'Choose immediate reveal in Payouts' },
            { ready: project.assignmentPolicy === core.ASSIGNMENT_POLICY, step: 1, title: 'Item value confirmed', detail: project.assignmentPolicy === core.ASSIGNMENT_POLICY ? 'All public items are confirmed to have equivalent mint value' : 'Required because the contract does not randomize item order' },
        ];
    }

    function renderReadiness() {
        const rows = readinessRows();
        byId('readiness-list').innerHTML = rows.map((row) => `<div class="flex gap-3"><span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${row.ready ? 'bg-green-400/15 text-green-300' : 'bg-gray-700 text-gray-400'}">${row.ready ? '✓' : '·'}</span><div class="min-w-0"><p class="text-sm font-semibold ${row.ready ? 'text-white' : 'text-gray-400'}">${escapeHtml(row.title)}</p><p class="mt-0.5 break-all text-xs leading-5 text-gray-500">${escapeHtml(displayMessage(row.detail))}</p>${!row.ready ? `<button type="button" data-fix-step="${row.step ?? 0}" class="mt-2 text-xs font-semibold text-blue-200 underline">Go to ${STEP_LABELS[row.step ?? 0]}</button>` : ''}</div></div>`).join('');
        const ready = rows.every((row) => row.ready);
        const badge = byId('readiness-badge');
        badge.textContent = ready ? 'Ready to export' : 'Not ready';
        badge.className = ready ? 'rounded-full border border-green-400/25 bg-green-400/10 px-2.5 py-1 text-xs font-semibold text-green-300' : 'rounded-full border border-gray-600 bg-gray-700/50 px-2.5 py-1 text-xs font-semibold text-gray-300';
        const button = byId('export-bundle');
        button.disabled = !ready;
        button.className = ready ? 'rounded-xl bg-brand-secondary px-5 py-3 font-bold text-gray-950 shadow-lg shadow-yellow-500/20 hover:bg-yellow-300' : 'rounded-xl bg-gray-700 px-5 py-3 font-bold text-gray-400';
    }

    function updateProgress() {
        const project = formProject();
        const normalized = core.normalizeProject(project);
        const complete = [
            !normalized.errors.some((error) => errorStep(error) === 0),
            Boolean(state.validation?.valid),
            Boolean(state.phases.length && !normalized.errors.some((error) => /mint stage/i.test(error))),
            !normalized.errors.some((error) => /payout|Royalty|Maximum|Reveal/i.test(error)),
            normalized.errors.length === 0 && Boolean(state.validation?.valid),
            readinessRows().every((row) => row.ready),
        ];
        document.querySelectorAll('.step-check').forEach((element, index) => { element.textContent = complete[index] ? '✓' : ''; });
        const count = complete.filter(Boolean).length;
        byId('progress-label').textContent = `${count} / 6`;
        byId('progress-bar').style.width = `${count / 6 * 100}%`;
    }

    function renderAll() {
        byId('description-count').textContent = String(value('description').length);
        renderPhases();
        renderPreview();
        renderPayoutValidation();
        renderReadiness();
        updateProgress();
        byId('validate-items').disabled = state.mediaReading || state.csvReading;
        const project = formProject();
        const duplicateSlug = project.id && state.projects.some((entry) => entry.id !== state.draftId && entry.project.id === project.id);
        renderMessages('collection-validation', state.reviewedSteps.has(0) ? core.normalizeProject(project).errors.filter((error) => errorStep(error) === 0) : [], duplicateSlug ? ['Another saved project uses this mint URL. Give each published collection a unique slug.'] : []);
        renderMessages('phase-validation', core.normalizeProject(formProject()).errors.filter((error) => /mint stage/i.test(error)));
        renderProjects();
    }

    function download(fileName, contents, type = 'application/json') {
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(new Blob([contents], { type }));
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
    }

    function exportProject() {
        const project = formProject();
        const id = core.slugify(project.id || project.name) || 'alpha-city-collection';
        download(`${id}-project.json`, `${JSON.stringify(project, null, 2)}\n`);
        showToast('Editable project exported. Keep it with the CSV and media backup.');
    }

    function exportBundle() {
        if (state.mediaReading || state.csvReading) { showToast('Wait for the files to finish loading.', 'error'); return; }
        const validation = validateItems(true);
        const project = formProject();
        const messages = [];
        if (!validation.valid) messages.push(...validation.errors);
        const mediaUrlValidation = core.validateMediaBaseUrl(project.mediaBaseUrl || '', { requireReleasePath: true, collectionId: project.id });
        if (!mediaUrlValidation.valid) messages.push(mediaUrlValidation.error);
        if (project.reveal.mode !== 'instant') messages.push('Delayed reveal is not supported by the current contract.');
        if (!project.mediaReleaseVerified) messages.push('Verify the release-specific R2 manifest, public URLs, and release controls before export.');
        if (messages.length) { renderMessages('prepare-messages', messages); showToast('Fix the preparation errors before export.', 'error'); return; }
        try {
            const bundle = core.prepareLaunch(validation, {
                mediaBaseUrl: project.mediaBaseUrl,
                platformTreasury: project.creatorAddress,
            });
            download(`${project.id}-launch-bundle.json`, `${JSON.stringify(bundle, null, 2)}\n`);
            renderMessages('prepare-messages', [], ['Bundle exported. Rehearse the generated package and transactions on testnet before mainnet.']);
            showToast('Prepared bundle exported. No transaction was signed.');
        } catch (error) {
            renderMessages('prepare-messages', [error.message]);
        }
    }

    function bindEvents() {
        document.querySelectorAll('[data-step-target]').forEach((button) => button.addEventListener('click', () => showStep(button.dataset.stepTarget)));
        byId('previous-step').addEventListener('click', () => showStep(state.step - 1));
        byId('add-phase').addEventListener('click', () => openPhaseDialog());
        byId('close-phase-dialog').addEventListener('click', closePhaseDialog);
        byId('cancel-phase').addEventListener('click', closePhaseDialog);
        byId('phase-form').addEventListener('submit', savePhase);
        byId('phase-allowlist-only').addEventListener('change', (event) => byId('allowlist-fields').classList.toggle('hidden', !event.target.checked));
        byId('phase-allowlist-file').addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            const epoch = state.allowlistEpoch;
            try {
                if (file?.size > 10 * 1024 * 1024) throw new Error('Allowlist must be 10 MB or smaller.');
                const text = file ? await file.text() : '';
                if (state.allowlistEpoch === epoch && byId('phase-dialog').open) byId('phase-allowlist').value = text;
            } catch (error) { showToast(error.message, 'error'); }
            event.target.value = '';
        });
        byId('phase-list').addEventListener('click', (event) => {
            const button = event.target.closest('[data-phase-action]');
            if (!button) return;
            const index = Number(button.dataset.phaseIndex);
            const action = button.dataset.phaseAction;
            if (action === 'edit') openPhaseDialog(index);
            if (action === 'delete') {
                if (window.confirm(`Delete “${state.phases[index].name}”?`)) state.phases.splice(index, 1);
            }
            if (action === 'up' && index > 0) [state.phases[index - 1], state.phases[index]] = [state.phases[index], state.phases[index - 1]];
            if (action === 'down' && index + 1 < state.phases.length) [state.phases[index + 1], state.phases[index]] = [state.phases[index], state.phases[index + 1]];
            if (action !== 'edit') { revalidateAfterRuleChange(); scheduleSave(); }
        });
        byId('metadata-file').addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const epoch = ++state.fileEpoch;
            state.csvReading = true;
            state.validation = null;
            state.csvText = '';
            byId('assignment-policy-equivalent').checked = false;
            byId('media-release-verified').checked = false;
            renderAll();
            try {
                if (file.size > 50 * 1024 * 1024) throw new Error('Metadata CSV must be 50 MB or smaller.');
                const text = await file.text();
                if (state.fileEpoch !== epoch) return;
                state.csvText = text;
                state.csvName = file.name;
                state.itemPage = 0;
                byId('csv-file-label').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
            } catch (error) {
                if (state.fileEpoch === epoch) { state.csvName = ''; byId('csv-file-label').textContent = 'Could not read CSV. Choose it again.'; showToast(error.message, 'error'); }
            } finally {
                if (state.fileEpoch === epoch) { state.csvReading = false; validateItems(); scheduleSave(); }
                event.target.value = '';
            }
        });
        const readMedia = async (event) => {
            const files = Array.from(event.target.files || []);
            if (!files.length) return;
            state.mediaFiles = files;
            byId('assignment-policy-equivalent').checked = false;
            byId('media-release-verified').checked = false;
            state.mediaSignatures = new Map();
            state.validation = null;
            state.mediaReading = true;
            const epoch = ++state.mediaReadEpoch;
            const bytes = files.reduce((sum, file) => sum + file.size, 0);
            byId('media-file-label').textContent = `Checking ${files.length} files…`;
            renderAll();
            // Bound concurrent disk reads even for collections with thousands of files.
            let next = 0;
            await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
                while (next < files.length && state.mediaReadEpoch === epoch) {
                    const file = files[next++];
                    try {
                        const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
                        if (state.mediaReadEpoch === epoch) state.mediaSignatures.set(file, signature);
                    } catch (error) { console.warn(`[launchpad] Could not read ${file.name}:`, error); }
                }
            }));
            if (state.mediaReadEpoch !== epoch) return;
            state.mediaReading = false;
            byId('media-file-label').textContent = `${files.length} files · ${(bytes / 1024 / 1024).toFixed(1)} MB`;
            validateItems();
            scheduleSave();
            event.target.value = '';
        };
        byId('media-files').addEventListener('change', readMedia);
        byId('media-individual-files').addEventListener('change', readMedia);
        byId('validate-items').addEventListener('click', () => validateItems(true));
        byId('items-previous').addEventListener('click', () => { state.itemPage = Math.max(0, state.itemPage - 1); renderItemTable(); });
        byId('items-next').addEventListener('click', () => { state.itemPage++; renderItemTable(); });
        byId('readiness-list').addEventListener('click', (event) => {
            const button = event.target.closest('[data-fix-step]');
            if (button) showStep(Number(button.dataset.fixStep));
        });
        byId('download-csv').addEventListener('click', () => download('metadata-template.csv', core.metadataExampleCsv(), 'text/csv;charset=utf-8'));
        byId('export-project').addEventListener('click', exportProject);
        byId('backup-project').addEventListener('click', exportProject);
        byId('export-bundle').addEventListener('click', exportBundle);
        byId('new-project').addEventListener('click', () => changeProject(null, newProject()));
        byId('project-switcher').addEventListener('change', (event) => changeProject(event.target.value));
        byId('project-file').addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                if (file.size > 10 * 1024 * 1024) throw new Error('Project JSON must be 10 MB or smaller.');
                const project = importableProject(JSON.parse(await file.text()));
                if (!await changeProject(null, project)) return;
                showToast('Project opened as a new draft. Select its CSV and images in Items.');
            } catch (error) { showToast(`Project import failed: ${error.message}`, 'error'); }
            event.target.value = '';
        });
        byId('reset-draft').addEventListener('click', async () => {
            if (state.switching || !window.confirm(`Delete “${value('collection-name') || 'Untitled collection'}” from this browser? Export a backup first if you need it.`)) return;
            state.resetting = true;
            state.switching = true;
            byId('builder-content').inert = true;
            clearTimeout(state.saveTimer);
            try {
                await drafts.remove(state.draftId);
                state.attachments.delete(state.draftId);
                state.projects = state.projects.filter((entry) => entry.id !== state.draftId);
                await activateDraft(state.projects[0] || { id: crypto.randomUUID(), project: newProject(), step: 0 });
            } catch (error) { showToast(`Could not delete project: ${error.message}`, 'error'); }
            finally { state.resetting = false; state.switching = false; byId('builder-content').inert = false; scheduleSave(); }
        });
        byId('collection-name').addEventListener('input', () => {
            const slug = byId('collection-slug');
            if (!slug.dataset.touched) slug.value = core.slugify(value('collection-name'));
        });
        byId('collection-slug').addEventListener('input', () => { byId('collection-slug').dataset.touched = 'true'; });
        document.querySelectorAll('input:not([type=file]), textarea:not(#phase-allowlist), select').forEach((element) => {
            if (element.closest('#phase-dialog') || element.id === 'project-switcher') return;
            const update = () => {
                if (element.id === 'media-base-url') {
                    byId('media-release-verified').checked = false;
                    byId('assignment-policy-equivalent').checked = false;
                }
                if (['collection-name', 'collection-slug', 'hero-file'].includes(element.id)) {
                    byId('media-release-verified').checked = false;
                }
                const itemRulesChanged = ['intended-supply', 'hero-file', 'assignment-policy-equivalent', 'media-base-url'].includes(element.id);
                if (itemRulesChanged) state.validation = null;
                byId('export-bundle').disabled = true;
                clearTimeout(state.renderTimer);
                state.renderTimer = setTimeout(() => { if (state.csvText && !state.validation) validateItems(false); else renderAll(); }, 180);
                scheduleSave();
            };
            element.addEventListener('input', update);
            element.addEventListener('change', update);
        });
        const flushStructuredDraft = () => {
            if (!state.loaded || state.resetting) return;
            try { drafts.flush(currentDraft()); } catch (_) {}
        };
        window.addEventListener('pagehide', flushStructuredDraft);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushStructuredDraft(); });
        window.addEventListener('beforeunload', () => { if (state.coverUrl) URL.revokeObjectURL(state.coverUrl); });
    }

    async function initialize() {
        byId('phase-timezone').textContent = `Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
        await loadDraft();
        bindEvents();
        byId('builder-content').inert = false;
        document.querySelectorAll('[data-project-control]').forEach((element) => { element.disabled = false; });
        scheduleSave();
    }

    window.AlphaCityLaunchpadBuilder = Object.freeze({ exactPercentToBps, formProject, parseAllowlist, importableProject });
    initialize().catch((error) => {
        console.error('[launchpad] Builder failed to initialize:', error);
        autosaveStatus('Builder failed to load', 'error');
        showToast('The collection builder could not load. Refresh the page to try again.', 'error');
    });
})();
