(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AlphaCityLaunchpadDrafts = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';

    const PREFIX = 'alphacity-launchpad-draft-v3:';
    const LEGACY_KEY = 'alphacity-launchpad-primary-v2';
    const ACTIVE_KEY = 'alphacity-launchpad-active-v3';
    const valid = (draft) => Boolean(draft && typeof draft.id === 'string' && draft.project && typeof draft.project === 'object' && !Array.isArray(draft.project));
    const time = (draft) => Date.parse(draft?.savedAt || '') || 0;
    const newest = (a, b) => !a || time(b) > time(a) ? b : a;

    function create({ indexedDB, localStorage }) {
        let queue = Promise.resolve();
        function databaseRequest(mode, operation) {
            return new Promise((resolve, reject) => {
                if (!indexedDB) return reject(new Error('Draft database unavailable.'));
                const opening = indexedDB.open('alphacity-launchpad', 1);
                let expired = false;
                const timer = setTimeout(() => { expired = true; reject(new Error('Draft storage timed out.')); }, 4000);
                opening.onupgradeneeded = () => {
                    if (!opening.result.objectStoreNames.contains('drafts')) opening.result.createObjectStore('drafts', { keyPath: 'id' });
                };
                opening.onerror = () => { clearTimeout(timer); reject(opening.error); };
                opening.onsuccess = () => {
                    clearTimeout(timer);
                    const db = opening.result;
                    if (expired) { db.close(); return; }
                    const transaction = db.transaction('drafts', mode);
                    const request = operation(transaction.objectStore('drafts'));
                    transaction.oncomplete = () => { db.close(); resolve(request.result); };
                    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Draft save was interrupted.')); };
                };
            });
        }
        function localDrafts() {
            const drafts = [];
            for (let index = 0; index < localStorage.length; index++) {
                const key = localStorage.key(index);
                if (key !== LEGACY_KEY && !key?.startsWith(PREFIX)) continue;
                try {
                    const draft = JSON.parse(localStorage.getItem(key));
                    if (valid(draft)) drafts.push(draft);
                } catch (_) { /* A damaged entry must not hide other projects. */ }
            }
            return drafts;
        }
        async function list() {
            const drafts = new Map();
            let available = false;
            try {
                for (const draft of await databaseRequest('readonly', (store) => store.getAll())) {
                    if (valid(draft)) drafts.set(draft.id, draft);
                }
                available = true;
            } catch (_) { /* Read the independent fallback below. */ }
            try {
                for (const draft of localDrafts()) drafts.set(draft.id, newest(drafts.get(draft.id), draft));
                available = true;
            } catch (_) { /* Saving/exporting still remains available in memory. */ }
            if (!available) throw new Error('Browser storage is unavailable. Export your project to keep a backup.');
            return [...drafts.values()].filter((draft) => !draft.deleted).sort((a, b) => time(b) - time(a));
        }
        function save(draft) {
            // Serialize writes so a slow older save cannot replace newer edits.
            const work = queue.catch(() => {}).then(async () => {
                try {
                    await databaseRequest('readwrite', (store) => store.put(draft));
                } catch (_) {
                    localStorage.setItem(PREFIX + draft.id, JSON.stringify(draft));
                    return;
                }
                // A successful database write does not depend on localStorage access.
                try {
                    const pending = JSON.parse(localStorage.getItem(PREFIX + draft.id) || 'null');
                    if (time(pending) <= time(draft)) localStorage.removeItem(PREFIX + draft.id);
                } catch (_) {}
                if (draft.id === 'alpha-city-primary') {
                    try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
                }
            });
            queue = work;
            return work;
        }
        return {
            list, save,
            // Tombstones also suppress an older copy in a temporarily unavailable backend.
            remove: (id) => save({ id, project: {}, deleted: true, savedAt: new Date().toISOString() }),
            flush(draft) { localStorage.setItem(PREFIX + draft.id, JSON.stringify(draft)); },
            active() { try { return localStorage.getItem(ACTIVE_KEY); } catch (_) { return null; } },
            select(id) { try { localStorage.setItem(ACTIVE_KEY, id); } catch (_) {} },
        };
    }
    return { create };
});
