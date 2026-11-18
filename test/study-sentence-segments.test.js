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
import {prepareParallelSentence, splitStudySentence} from '../ext/js/display/study-translation.js';

test('keeps the white stripe sentence together instead of splitting at and', () => {
    const sentence = 'You have that white stripe running all the way down the middle of your back and you can keep moving forward and I know you can do it.';
    expect(sentence.split(' ').length).toBeGreaterThan(25);
    expect(splitStudySentence(sentence)).toEqual([]);
});

test('keeps a manually translated long sentence when subtitle preferences change', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {}});
    const prefs = {studyTranslationPrefs: {engine: 'google', autoTranslate: false}};
    const changes = new EventTarget();
    vi.stubGlobal('chrome', {
        storage: {local: {get: async () => prefs},
            onChanged: {
                addListener: (listener) => changes.addEventListener('prefs', () => listener({studySubtitlePrefs: {}}, 'local')),
                removeListener: () => {},
            }},
    });
    const sentence = 'We walked down to the quiet harbor after having breakfast with our old friends, but the captain had already left on the early ferry and nobody knew when he would return.';
    const translations = ['我们和老朋友吃过早饭后走到港口。', '船长已坐早班渡轮离开，没人知道他何时回来。'];
    const source = document.createElement('article');
    const original = document.createElement('p');
    original.textContent = sentence;
    const action = document.createElement('button');
    action.dataset.studyTranslateSentence = '';
    source.append(original, action);
    const call = vi.fn(async () => ({items: translations.map((translation, i) => ({id: `part-${i}`, translation}))}));
    const dispose = prepareParallelSentence(source, {call, isCurrent: () => true, language: 'en'});
    try {
        const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
        await settle();
        expect(call).not.toHaveBeenCalled();
        expect(source.querySelector('.sf-parallel-sentence')?.hasAttribute('hidden')).toBe(true);
        action.click();
        await vi.waitFor(() => expect(source.dataset.studySegmentTranslation).toBe(translations.join('')));
        changes.dispatchEvent(new Event('prefs'));
        await settle();
        expect([...source.querySelectorAll('.sf-segment-translation')].map((row) => row.textContent)).toEqual(translations);
        expect(action.hidden).toBe(true);
        expect(call).toHaveBeenCalledOnce();
    } finally {
        dispose();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
