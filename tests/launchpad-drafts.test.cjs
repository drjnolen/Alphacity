'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../launchpad/draft-store.js');

function storage() {
    const data = new Map();
    return {
        get length() { return data.size; },
        key: (index) => [...data.keys()][index],
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: (key) => data.delete(key),
    };
}
function database(initial = []) {
    const data = new Map(initial.map((draft) => [draft.id, draft]));
    return { data, open() {
        const opening = {};
        setImmediate(() => {
            opening.result = {
                close() {},
                transaction() {
                    const transaction = { objectStore: () => ({
                        getAll: () => request(() => [...data.values()]),
                        put: (draft) => request(() => { data.set(draft.id, draft); return draft.id; }),
                    }) };
                    function request(action) {
                        const result = {};
                        setImmediate(() => { result.result = action(); transaction.oncomplete(); });
                        return result;
                    }
                    return transaction;
                },
            };
            opening.onsuccess();
        });
        return opening;
    } };
}
const draft = (id, name, savedAt = '2025-01-01T00:00:00Z') => ({ id, project: { name }, savedAt });

test('independent projects save, restore and delete with only localStorage', async () => {
    const localStorage = storage();
    const store = create({ localStorage });
    await store.save(draft('a', 'Alpha'));
    await store.save(draft('b', 'Beta'));
    assert.deepEqual((await store.list()).map((entry) => entry.project.name), ['Alpha', 'Beta']);
    await store.remove('a');
    assert.deepEqual((await store.list()).map((entry) => entry.id), ['b']);
    store.select('b');
    assert.equal(create({ localStorage }).active(), 'b');
});

test('newest legacy backup survives migration and malformed entries do not hide projects', async () => {
    const localStorage = storage();
    const indexedDB = database([draft('alpha-city-primary', 'Older')]);
    localStorage.setItem('alphacity-launchpad-primary-v2', JSON.stringify(draft('alpha-city-primary', 'Newer', '2025-02-01T00:00:00Z')));
    localStorage.setItem('alphacity-launchpad-draft-v3:broken', '{');
    const store = create({ indexedDB, localStorage });
    const [restored] = await store.list();
    assert.equal(restored.project.name, 'Newer');
    await store.save(restored);
    assert.equal(localStorage.getItem('alphacity-launchpad-primary-v2'), null);
    assert.equal(indexedDB.data.get(restored.id).project.name, 'Newer');
});

test('blocked localStorage does not turn a successful database save into an error', async () => {
    const indexedDB = database();
    const store = create({ indexedDB, localStorage: null });
    await store.save(draft('a', 'Alpha'));
    assert.equal((await store.list())[0].project.name, 'Alpha');
});

test('queued writes preserve their order and a later unload backup is retained', async () => {
    const indexedDB = database();
    const localStorage = storage();
    const store = create({ indexedDB, localStorage });
    await Promise.all([store.save(draft('a', 'First')), store.save(draft('a', 'Second'))]);
    assert.equal(indexedDB.data.get('a').project.name, 'Second');
    const pending = store.save(draft('a', 'Old pending save'));
    store.flush(draft('a', 'Latest unsaved edit', '2025-04-01T00:00:00Z'));
    await pending;
    assert.equal((await store.list())[0].project.name, 'Latest unsaved edit');
});

test('deleting in fallback storage suppresses a stale database copy', async () => {
    const localStorage = storage();
    const indexedDB = database([draft('a', 'Alpha'), draft('b', 'Beta')]);
    await create({ localStorage }).remove('a');
    assert.deepEqual((await create({ indexedDB, localStorage }).list()).map((entry) => entry.id), ['b']);
});

test('complete storage failure is reported and does not claim a save', async () => {
    const store = create({ indexedDB: null, localStorage: null });
    await assert.rejects(store.save(draft('a', 'Alpha')));
    await assert.rejects(store.list(), /storage is unavailable/);
});
