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

test('recommends distinct content words with glosses, skips carded contexts, and offers bounded replay and card lookup', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {url: 'https://www.youtube.com/watch?v=abcdefghijk', html: '<div id="movie_player"><video></video></div><div id="secondary-inner"></div>'}});
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const {youtubeStudyContext} = await import('../ext/js/study/youtube-study-context.js');
    const {learningCaptions} = await import('../ext/js/study/caption-sidebar.js');
    const texts = ['We can be successful today.', 'A successful project needs patient work from the whole team.', 'People improve skills through steady practice every single day.', 'We can do this because we have the time.'];
    const saved = [{word: 'improve', sentence: texts[2], cards: 1}];
    vi.stubGlobal('fetch', async () => ({ok: true, text: async () => JSON.stringify({events: texts.map((text, i) => ({tStartMs: i * 3000, dDurationMs: 3000, segs: [{utf8: text}]}))})}));
    vi.stubGlobal('chrome', {runtime: {getURL: (p) => `chrome-extension://test/${p}`}});
    const video = document.querySelector('video');
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const lookup = vi.fn(async (range) => { expect(youtubeStudyContext.read(range).sentence.text).toBe(texts[1]); expect(range.toString()).toBe('successful'); });
    youtubeStudyContext.openCard = lookup;
    const reader = new YoutubeReader({prefs: {merge: false}, call: async (action) => action === 'libraryVideoWords' ? {items: saved, cardContexts: saved} : {}});
    try {
        reader._learningWords = {we: {s: 'learning'}, successful: {s: 'new', gloss: '成功的'}, improve: {s: 'partial', gloss: '改善'}};
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en'); reader.start();
        await vi.waitFor(() => expect(reader.session?.cues.length).toBe(4));
        await reader._loadWords();
        expect(learningCaptions(reader.session, reader._learningWords).learning).toBe(2);
        const section = reader._view.words.querySelector('.r-recommend');
        expect(section.querySelectorAll('.r-recommend-item').length).toBe(1);
        expect(section.textContent).toContain('successful · 成功的');
        expect(section.querySelector('mark').textContent).toBe('successful');
        section.querySelector('[data-recommend-replay]').click();
        expect(play).toHaveBeenCalledOnce(); expect(video.currentTime).toBe(3);
        video.currentTime = 6; video.dispatchEvent(new Event('timeupdate'));
        expect(pause).toHaveBeenCalledOnce();
        section.querySelector('[data-recommend-card]').click();
        expect(lookup).toHaveBeenCalledOnce();
        saved.push(...texts.slice(0, 2).map((sentence) => ({word: 'successful', sentence, cards: 1})));
        await reader._loadWords();
        expect(reader._view.words.querySelector('.r-recommend').textContent).toContain('暂时没有：至少要有一个还在学的词出现在字幕里');
    } finally { reader._reset(); youtubeStudyContext.openCard = null; vi.unstubAllGlobals(); await env.teardown(global); }
});
