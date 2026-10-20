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
import {readSubtitlePrefs, writeSubtitlePrefs} from '../ext/js/study/subtitle-prefs.js';
import {prepareParallelSentence} from '../ext/js/display/study-translation.js';

test('migrates the old engine once and shares manual sentence translation with auto-loaded captions', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {url: 'https://www.youtube.com/watch?v=abcdefghijk', html: '<div id="movie_player"><video></video></div><div id="secondary-inner"></div>'}});
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const store = {studySubtitlePrefs: {engine: 'google', autoTranslate: false}};
    vi.stubGlobal('chrome', {runtime: {getURL: (path) => `chrome-extension://test/${path}`}, storage: {local: {
        get: async () => ({...store}), set: async (value) => Object.assign(store, value),
    }, onChanged: {addListener() {}, removeListener() {}}}});
    vi.stubGlobal('fetch', async () => ({ok: true, text: async () => JSON.stringify({events: [{tStartMs: 0, dDurationMs: 3000, segs: [{utf8: 'A sentence for learning.'}]}]})}));
    let reader;
    let dispose;
    try {
        expect((await readSubtitlePrefs()).engine).toBe('google');
        expect(store.studyTranslationPrefs).toEqual({engine: 'google', autoTranslate: false});
        store.studySubtitlePrefs.engine = 'apple';
        expect((await readSubtitlePrefs()).engine).toBe('google');
        await writeSubtitlePrefs({engine: 'microsoft'});
        reader = new YoutubeReader({prefs: {engine: 'microsoft', autoTranslate: false}});
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en');
        reader.start();
        await vi.waitFor(() => expect(reader.session?.cues.length).toBe(1));
        expect(document.querySelector('#study-yt-reader select[data-engine]')).toBeNull();
        const source = document.createElement('div');
        source.innerHTML = '<p>A sentence for learning.</p><button data-study-translate-sentence>翻译本句</button>';
        document.body.append(source);
        const call = vi.fn(async (action) => action === 'subtitleTranslate' ? {items: [{id: 'part-0', translation: '一句学习用的句子。'}]} : {});
        dispose = prepareParallelSentence(source, {call, isCurrent: () => true, language: 'en'});
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(call).not.toHaveBeenCalled();
        source.querySelector('button').click();
        await vi.waitFor(() => expect(source.dataset.studySegmentTranslation).toBe('一句学习用的句子。'));
        expect(call.mock.calls.some(([action]) => action === 'subtitleTranslate')).toBe(true);
    } finally {
        dispose?.(); reader?._reset(); vi.unstubAllGlobals(); await env.teardown(global);
    }
});
