// @vitest-environment jsdom
import {test, expect, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {prepareStudySettings} from '../ext/js/pages/study-settings-main.js';
import {mountStudyLibrary} from '../ext/js/display/study-library.js';
const entry = {word: 'run', sentence: 'I run every day.', translation: '我每天跑步。', meaning: '跑', url: 'https://example.test', recordId: 'a'.repeat(32)};
function setup(enabled, supported = true) {
    let config = {model: 'fixture', effort: 'low', cacheEnabled: true, practiceEnabled: enabled};
    const calls = [];
    globalThis.chrome = {permissions: {contains: async () => false}, storage: {local: {get: async () => ({})}}, runtime: {sendMessage: async ({studyAction, data}) => {
        calls.push({action: studyAction, data});
        if (studyAction === 'settings') return {ok: true, value: config};
        if (studyAction === 'saveSettings') {config = data; return {ok: true, value: data};}
        if (studyAction === 'practiceCheck') return supported ? {ok: true, value: {verdict: 'almost', corrected: 'I run daily.', reason: '注意动词形式。'}} : {ok: false, error: '旧桥没有 practiceCheck，请同步本机桥。'};
        return {ok: true, value: {count: 0}};
    }}};
    return calls;
}
function card() {
    const root = document.createElement('div');
    document.body.append(root);
    mountStudyLibrary(root, () => entry, () => true);
    root.querySelector('[data-study-card-choice="make-sentence"]').click();
    return root;
}
test('practice stays absent by default; explicit AI setting enables the two production-card editors', async () => {
    const calls = setup(false);
    document.body.innerHTML = readFileSync('ext/settings.html', 'utf8');
    const settings = document.querySelector('.content-center');
    settings.dataset.activeSettingsCategory = 'ai';
    await prepareStudySettings(settings);
    expect(document.querySelector('#practiceEnabled').checked).toBe(false);
    const off = card();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(off.querySelector('.study-practice')).toBeNull();
    document.querySelector('#practiceEnabled').checked = true;
    document.querySelector('#settings-form').dispatchEvent(new Event('submit', {cancelable: true}));
    await vi.waitFor(() => expect(calls.some(c => c.action === 'saveSettings' && c.data.practiceEnabled)).toBe(true));
    const root = card();
    await vi.waitFor(() => expect(root.querySelector('[data-study-practice-answer]')).not.toBeNull());
    const input = root.querySelector('[data-study-practice-answer]');
    input.value = 'I runs daily.'; input.dispatchEvent(new Event('input'));
    root.querySelector('[data-study-practice-check]').click();
    await vi.waitFor(() => expect(root.querySelector('.study-practice').textContent).toContain('需要调整'));
    expect(root.querySelectorAll('.study-practice [role=status] p')).toHaveLength(3);
    expect(calls.some(c => /libraryCardsAdd|rememberEntry/.test(c.action))).toBe(false);
});
test('missing practiceCheck reports failure without affecting the draft or submitting any card', async () => {
    const calls = setup(true, false);
    document.body.replaceChildren();
    const root = card();
    await vi.waitFor(() => expect(root.querySelector('[data-study-practice-answer]')).not.toBeNull());
    const input = root.querySelector('[data-study-practice-answer]');
    input.value = 'I runs.'; input.dispatchEvent(new Event('input'));
    root.querySelector('[data-study-practice-check]').click();
    await vi.waitFor(() => expect(root.querySelector('.study-practice').textContent).toContain('请同步本机桥'));
    expect(root.querySelector('[data-study-card-front]').value).toContain('run');
    expect(calls.some(c => /libraryCardsAdd|rememberEntry/.test(c.action))).toBe(false);
});
