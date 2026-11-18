/*
 * Copyright (C) 2023-2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';

test('selection translation saves a sentence only on click, while Alt toggles the same sentence renderer', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<p id="source">We learn from real sentences.</p>', url: 'https://example.test/article'}});
    /** @typedef {(message: object, sender: object, reply: (value: unknown) => void) => boolean} Receive */
    /** @type {Receive} */
    let receive;
    const originalUrl = location.href;
    history.replaceState(null, '', '/different#/reading');
    const currentUrl = location.href;
    let tabUrl = `${currentUrl}:~:text=sentences`;
    const send = vi.fn((/** @type {{studyAction: string, data?: object}} */ message) => new Promise((resolve) => {
        receive(message, {id: 'test', url: originalUrl, frameId: 0, tab: {url: tabUrl, title: 'Article two'}}, resolve);
    }));
    vi.stubGlobal('chrome', {
        runtime: {id: 'test', sendMessage: send, onMessage: {addListener: (/** @type {Receive} */ listener) => { receive = listener; }}},
        storage: {local: {get: async () => ({studyTranslationPrefs: {engine: 'chrome'}}), set: async () => {}}},
    });
    const {prepareStudyService, StudyService} = await import('../ext/js/study/study-service.js');
    const handle = vi.spyOn(StudyService.prototype, 'handle').mockImplementation(async (action) => {
        return action === 'librarySave' ? {vaultSaved: true, localSyncIncomplete: true} : {model: 'fixture', effort: 'low'};
    });
    const {PageTranslate} = await import('../ext/js/study/page-translate.js');
    const controller = new PageTranslate({translate: async () => '我们从真实的句子学习。'});
    try {
        prepareStudyService();
        Range.prototype.getBoundingClientRect = () => ({left: 10, right: 200, bottom: 20});
        Range.prototype.getClientRects = () => [];
        const original = document.querySelector('#source');
        const range = document.createRange();
        range.selectNodeContents(original);
        window.getSelection().addRange(range);
        controller.showSelection();
        expect(controller.selectionUi.textContent).toBe('译');
        controller.selectionUi.querySelector('button').click();
        await vi.waitFor(() => expect(original.nextElementSibling?.classList.contains('study-selection-translation')).toBe(true));
        expect(send.mock.calls.some(([m]) => m.studyAction === 'pageSentenceSave')).toBe(false);
        const save = original.nextElementSibling.querySelector('button[title=记住这句]');
        save.click();
        await vi.waitFor(() => expect(save.textContent).toBe('★'));
        expect(save.title).toContain('笔记已保存；扩展未更新本地记录');
        expect(send.mock.calls.some(([m]) => m.studyAction === 'pageSentenceSave')).toBe(true);
        expect(handle.mock.calls.find(([action]) => action === 'librarySave')?.[1]).toMatchObject({
            entry: {url: currentUrl, title: 'Article two', kind: 'sentence'}, makeCard: false,
        });
        expect(original.textContent).toBe('We learn from real sentences.');
        await controller.openSelection('learn from', document.createElement('div'), original);
        expect(document.querySelectorAll('.study-selection-translation')).toHaveLength(1);
        expect(original.nextElementSibling.dataset.original).toBe('learn from');
        const oldSave = original.nextElementSibling.querySelector('button[title=记住这句]');
        history.replaceState(null, '', '/different#/later');
        tabUrl = location.href;
        const saveCalls = () => handle.mock.calls.filter(([action]) => action === 'librarySave').length;
        oldSave.click();
        await vi.waitFor(() => expect(oldSave.title).toContain('请在当前文章重新选中'));
        expect(send.mock.calls.filter(([m]) => m.studyAction === 'pageSentenceSave')).toHaveLength(1);
        expect(saveCalls()).toBe(1);
        await expect(send({studyAction: 'pageSentenceSave', data: {sentence: 'learn from', translation: '学习', source: currentUrl}})).resolves.toMatchObject({ok: false});
        expect(saveCalls()).toBe(1);
        controller.restore(original);
        window.getSelection().removeAllRanges();
        controller.showSelection();
        controller.bindSelection();
        document.caretRangeFromPoint = () => range;
        original.dispatchEvent(new MouseEvent('pointermove', {bubbles: true}));
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Alt'}));
        document.dispatchEvent(new KeyboardEvent('keyup', {key: 'Alt'}));
        await vi.waitFor(() => expect(original.nextElementSibling?.classList.contains('study-page-translation')).toBe(true));
    } finally {
        controller.stop();
        handle.mockRestore();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
