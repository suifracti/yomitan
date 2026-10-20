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

import {afterAll, expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';

const environment = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<!DOCTYPE html><body></body>'}});
afterAll(() => environment.teardown(global));

const store = {
    studyWordStatus: {version: 2, words: {run: {s: 'familiar', gloss: '跑'}, brick: {s: 'learning'}}, phrases: {}},
    studyEncounters: {run: {days: {[new Date().toISOString().slice(0, 10)]: {n: 3, sites: ['a', 'b']}}}},
};
vi.stubGlobal('chrome', {storage: {local: {get: async (/** @type {string[]} */ keys) => Object.fromEntries(keys.map((key) => [key, /** @type {Record<string, unknown>} */ (store)[key]]))}}});

const {mountStuckHint} = await import('../ext/js/display/study-stuck.js');

/**
 * @param {string} word
 * @param {(action: string, data?: Record<string, unknown>) => Promise<unknown>} call
 * @returns {{box: HTMLElement, choices: [string, Record<string, unknown>][]}}
 */
function mount(word, call) {
    /** @type {[string, Record<string, unknown>][]} */
    const choices = [];
    const box = mountStuckHint({
        doc: document,
        getEntry: () => /** @type {import('study').LibraryEntry} */ ({word, sentence: 'They run into trouble.', language: 'en', meaning: '', url: 'https://x.org/a'}),
        call,
        isCurrent: () => true,
        onChoice: (kind, detail) => choices.push([kind, detail]),
    });
    document.body.replaceChildren(box);
    return {box, choices};
}

test('a familiar word asks where the learner is stuck; choices are recorded with a new bridge', async () => {
    /** @type {unknown[][]} */
    const calls = [];
    const {box, choices} = mount('run', async (action, data) => {
        calls.push([action, data]);
        return action === 'libraryWordSenses' ? {senses: [{key: 'run#1', gloss: '跑', s: 'known'}]} : {ok: true};
    });
    await vi.waitFor(() => expect(box.querySelector('.study-stuck-senses')?.textContent).toContain('跑（已会）'));
    expect(box.hidden).toBe(false);
    expect(box.querySelector('.study-stuck-question')?.textContent).toContain('这句里卡在哪');
    expect(box.querySelector('.study-stuck-met')?.textContent).toContain('2 个网站遇到 3 次');

    /** @type {HTMLButtonElement} */ (box.querySelector('[data-stuck=newSense]')).click();
    expect(choices.at(-1)).toEqual(['newSense', {supported: true, senseKey: 'run#1', phrase: '', gloss: ''}]);
    expect(calls).toContainEqual(['libraryContextMiss', expect.objectContaining({word: 'run', kind: 'newSense', senseKey: 'run#1', url: 'https://x.org/a'})]);

    /** @type {HTMLButtonElement} */ (box.querySelector('[data-stuck=collocation]')).click();
    const input = /** @type {HTMLInputElement} */ (box.querySelector('.study-stuck-phrase input'));
    expect(input.value).toBe('run into');
    /** @type {HTMLButtonElement} */ (box.querySelector('.study-stuck-phrase button')).click();
    expect(choices.at(-1)?.[0]).toBe('collocation');
    expect(choices.at(-1)?.[1].phrase).toBe('run into');
    input.value = 'run';
    /** @type {HTMLButtonElement} */ (box.querySelector('[data-stuck=collocation]')).click();
    input.value = 'x';
    /** @type {HTMLButtonElement} */ (box.querySelector('.study-stuck-phrase button')).click();
    expect(box.querySelector('.study-stuck-result')?.textContent).toContain('两个词以上');
    // The model is never asked unless the learner presses "AI 判断".
    expect(calls.some(([action]) => action === 'senseMatch')).toBe(false);
});

test('with an older bridge the choices still prepare cards, without recording', async () => {
    /** @type {unknown[][]} */
    const calls = [];
    const {box, choices} = mount('run', async (action) => {
        calls.push([action]);
        throw new Error('不支持的学习库请求');
    });
    await vi.waitFor(() => expect(box.hidden).toBe(false));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    /** @type {HTMLButtonElement} */ (box.querySelector('[data-stuck=recall]')).click();
    expect(choices.at(-1)).toEqual(['recall', {supported: false, senseKey: '', phrase: '', gloss: ''}]);
    expect(calls).toHaveLength(1);
    expect(/** @type {HTMLElement} */ (box.querySelector('.study-stuck-ai')).hidden).toBe(true);
});

test('a word still being learned shows no question', async () => {
    const {box} = mount('brick', async () => ({senses: []}));
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(/** @type {HTMLElement} */ (box.querySelector('.study-stuck-panel')).hidden).toBe(true);
});
