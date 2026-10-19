import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudyService} from '../ext/js/study/study-service.js';
import {SAVED_KEY} from '../ext/js/study/study-data.js';

const entry = {word: 'improve', sentence: 'We improve daily.', context: '', url: 'https://example.test/article', title: 'Article', language: 'en'};
function setup(native) {
    const data = {}, calls = [];
    const row = {id: 'a'.repeat(32), entry, favorite: true, learningState: 'favorite-only', ankiState: 'saved', vaultSaved: true};
    const service = new StudyService({get: async (key) => ({[key]: structuredClone(data[key])}),
        set: async (values) => Object.assign(data, structuredClone(values))}, (payload) => {
        calls.push(payload);
        return native ? native(payload, row) : {cancel() {}, promise: Promise.resolve({ok: true, library: row})};
    });
    return {service, data, calls, row};
}

test('saving the same favorite retains its local identity and known library link', async () => {
    const h = setup();
    await h.service.handle('saveWord', entry);
    await h.service.sync.flush();
    const first = (await h.service.handle('saved', {}))[0];
    assert.equal(first.libraryId, h.row.id);
    await h.service.handle('saveWord', entry);
    await h.service.sync.flush();
    const items = await h.service.handle('saved', {});
    assert.equal(items.length, 1);
    assert.equal(items[0].id, first.id);
    assert.equal(items[0].created, first.created);
    assert.equal(h.calls.filter((payload) => payload.action === 'libraryFavorite').at(-1).id, h.row.id);
});

for (const [name, a, b] of [
    ['languages', {...entry, word: 'AI', language: 'en'}, {...entry, word: 'AI', language: 'ja'}],
    ['local source titles', {...entry, url: '', title: 'Local A'}, {...entry, url: '', title: 'Local B'}],
    ['playback times on the same page', {...entry, videoTime: 12}, {...entry, videoTime: 45}],
]) {
    test(`favorite identity keeps different ${name} separate`, async () => {
        const h = setup();
        await h.service.handle('saveWord', a);
        await h.service.sync.flush();
        await h.service.handle('saveWord', b);
        await h.service.sync.flush();
        assert.equal((await h.service.handle('saved', {})).length, 2);
    });
}

test('an older favorite receipt cannot clear the pending flag of a newer failed action', async () => {
    let release, began;
    const started = new Promise((resolve) => { began = resolve; });
    const h = setup((_payload, row) => {
        if (!release) {
            return {cancel() {}, promise: new Promise((resolve) => {
                release = () => resolve({ok: true, library: row});
                began();
            })};
        }
        return {cancel() {}, promise: Promise.resolve({ok: false, error: 'offline'})};
    });
    const favorite = {...entry, id: 'local', created: 1, syncPending: true};
    h.data[SAVED_KEY] = [favorite];
    await h.service.sync.favorite(favorite, true);
    await started;
    await h.service.sync.favorite(favorite, true);
    release();
    await h.service.sync.flush();
    assert.equal((await h.service.sync.pending()).length, 1);
    const local = (await h.service.handle('saved', {}))[0];
    assert.equal(local.libraryId, h.row.id);
    assert.equal(local.syncPending, true, 'the older receipt does not confirm the new action');
    assert.equal(h.calls.some((payload) => /delete|cards|generate/.test(payload.action)), false);
});

test('a favorite is marked pending before its delivery can be picked up', async () => {
    const h = setup();
    const favorite = {...entry, id: 'local', created: 1, syncPending: false};
    h.data[SAVED_KEY] = [favorite];
    const write = h.service.storage.set;
    h.service.storage.set = async (values) => {
        if (values.studySyncOutboxV1?.some((task) => task.action === 'libraryFavorite')) {
            assert.equal(h.data[SAVED_KEY][0].syncPending, true);
        }
        return write(values);
    };
    await h.service.sync.favorite(favorite, true);
    await h.service.sync.flush();
    assert.equal(h.data[SAVED_KEY][0].syncPending, false);
});

test('a delayed library readback cannot remove a newer locally queued favorite', async () => {
    const h = setup(() => ({cancel() {}, promise: Promise.resolve({ok: false, error: 'offline'})}));
    const favorite = {...entry, id: 'local', libraryId: h.row.id, created: 1, syncPending: false};
    h.data[SAVED_KEY] = [favorite];
    const write = h.service.write.bind(h.service);
    let release, blocked;
    const waiting = new Promise((resolve) => { release = resolve; });
    const reached = new Promise((resolve) => { blocked = resolve; });
    let held = false;
    h.service.write = async (key, change) => {
        if (key === SAVED_KEY && !held) {
            held = true;
            blocked();
            await waiting;
        }
        return write(key, change);
    };
    const readback = h.service.sync.favoritesFrom([{...h.row, favorite: false}]);
    try {
        await reached;
        await h.service.handle('saveWord', entry);
        await h.service.sync.flush();
        assert.equal((await h.service.sync.pending()).length, 1);
    } finally { release(); }
    await readback;
    const local = await h.service.handle('saved', {});
    assert.equal(local.length, 1, 'stale remote unstar must not erase the newer local favorite');
    assert.equal(local[0].id, favorite.id);
    assert.equal(local[0].syncPending, true);
});

test('local favorite stays visible between its save and outbox publication', async () => {
    const h = setup();
    h.data[SAVED_KEY] = [{...entry, id: 'local', libraryId: h.row.id, created: 1, syncPending: true}];
    assert.deepEqual(await h.service.sync.pending(), []);
    await h.service.sync.favoritesFrom([{...h.row, favorite: false}]);
    assert.equal(h.data[SAVED_KEY].length, 1);
    assert.equal(h.data[SAVED_KEY][0].syncPending, true);
});
