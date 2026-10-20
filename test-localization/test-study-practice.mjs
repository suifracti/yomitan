import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudyService} from '../ext/js/study/study-service.js';
import {studyConfig} from '../ext/js/study/study-data.js';

test('practice is disabled by default and calls the bridge only after explicit enablement', async () => {
    const db = {}, calls = [];
    const result = {verdict: 'good', corrected: '', reason: '正确。'};
    const service = new StudyService({get: async key => ({[key]: db[key]}), set: async values => Object.assign(db, values)}, payload => {
        calls.push(payload);
        return {cancel() {}, promise: Promise.resolve({ok: true, library: result})};
    });
    const request = {id: 'a'.repeat(32), kind: 'produce', prompt: '表达这个意思', answer: 'A brick wall.', config: {model: 'fixture', effort: 'low'}};
    assert.equal(studyConfig({}).practiceEnabled, false);
    await assert.rejects(service.handle('practiceCheck', request), /未开启/);
    assert.equal(calls.length, 0);
    const settings = await service.handle('saveSettings', {...studyConfig({}), practiceEnabled: true});
    assert.equal(settings.practiceEnabled, true);
    assert.deepEqual(await service.handle('practiceCheck', request), result);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {action: 'practiceCheck', ...request});
});
