import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudyService} from '../ext/js/study/study-service.js';

test('explicit sense save keeps its extras when an old record is already open', async () => {
    const db = {}, calls = [];
    const id = 'a'.repeat(32), targetId = 'b'.repeat(32);
    const entry = {word: 'run', sentence: 'I run a shop.', meaning: '经营', url: 'https://example.test/article'};
    const old = {id, entry, learningState: 'saved', targetId};
    const service = new StudyService({get: async key => ({[key]: db[key]}), set: async values => Object.assign(db, values)}, payload => {
        calls.push(payload);
        let library;
        if (payload.action === 'libraryRead') library = {items: [{record: old}]};
        else if (payload.action === 'libraryTargetResolve') library = {targetId};
        else if (payload.action === 'librarySave') library = {...old, entry: payload.entry};
        else throw new Error('Unexpected action: ' + payload.action);
        return {cancel() {}, promise: Promise.resolve({ok: true, library})};
    });
    const saved = await service.handle('rememberEntry', {entry: {...entry, sense: {key: 'new', gloss: '经营'}}, recordId: id});
    assert.deepEqual(saved.entry.sense, {key: 'new', gloss: '经营'});
    assert.equal(calls.some(p => /libraryUpdate|cards|generate/.test(p.action)), false);
});
