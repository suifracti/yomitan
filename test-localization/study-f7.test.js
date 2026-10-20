// @vitest-environment jsdom
import {test, expect, vi} from 'vitest';
import {StudyService} from '../ext/js/study/study-service.js';
import {refreshToday} from '../ext/js/pages/study-library.js';
function setup(today) {
    document.body.innerHTML = '<p id="study-library-today" hidden></p><button id="study-library-open-anki" hidden>打开 Anki</button>';
    const badge = vi.fn(async () => {});
    const calls = [];
    const service = new StudyService({get: async () => ({}), set: async () => {}}, payload => {
        calls.push(payload.action);
        const response = payload.action === 'ankiToday' ? today : {ok: true, library: {opened: true}};
        return {promise: Promise.resolve(response), cancel() {}};
    });
    globalThis.chrome = {permissions: {contains: async () => true}, action: {setBadgeText: badge}, runtime: {sendMessage: async ({studyAction, data}) => {
        try {return {ok: true, value: await service.handle(studyAction, data)};} catch {return {ok: false, error: 'unknown action'};}
    }}};
    return {service, badge, calls};
}
test('existing auto-sync refreshes the due badge; library strip opens Anki explicitly', async () => {
    const {service, badge, calls} = setup({ok: true, library: {due: 23, reviewed: 40, newDue: 5, decks: ['外语']}});
    await service.autoSync();
    expect(badge).toHaveBeenLastCalledWith({text: '23'});
    await refreshToday();
    expect(document.querySelector('p').textContent).toBe('今天还有 23 张 · 已复习 40');
    document.querySelector('button').click();
    await vi.waitFor(() => expect(calls).toContain('ankiOpen'));
});
test('old backend without today data clears the badge and hides only the optional strip', async () => {
    const {service, badge} = setup({ok: false, error: 'unknown action'});
    await service.autoSync();
    await refreshToday();
    expect(badge).toHaveBeenCalledWith({text: ''});
    expect(document.querySelector('p').hidden).toBe(true);
    expect(document.querySelector('button').hidden).toBe(true);
});
