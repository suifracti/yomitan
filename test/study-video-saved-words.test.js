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

test('explains saved video words, opens uncarded words for card selection, and reports a saved summary clearly', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<div id="movie_player"><video></video></div><div id="secondary-inner"></div>', url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const {youtubeStudyContext} = await import('../ext/js/study/youtube-study-context.js');
    const sentence = 'A successful project needs patient work from the whole team.';
    vi.stubGlobal('chrome', {runtime: {getURL: (p) => `chrome-extension://test/${p}`}});
    vi.stubGlobal('fetch', async () => ({ok: true, text: async () => JSON.stringify({events: [{tStartMs: 0, dDurationMs: 4000, segs: [{utf8: sentence}]}]})}));
    const open = vi.fn(async (range, panel) => { expect(range.toString()).toBe('successful'); expect(panel).toBe(true); });
    youtubeStudyContext.openCard = open;
    const reader = new YoutubeReader({prefs: {merge: false}, call: async (action) => action === 'libraryVideoWords' ? {items: [
        {id: '1'.repeat(32), word: 'successful', sentence, videoTime: null, cards: 0},
        {id: '2'.repeat(32), word: 'project', sentence, videoTime: 0, cards: 2},
    ]} : {words: 2, cards: 2, openUrl: 'obsidian://open?vault=test&file=summary'}});
    try {
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en'); reader.start();
        await vi.waitFor(() => expect(reader.session?.cues.length).toBe(1)); await reader._loadWords();
        expect(document.querySelector('[data-tab=words]').textContent).toBe('我在这个视频记的词');
        expect(reader._view.words.textContent).toContain('看视频时点过『记住它』的词。点时间可以回到那一刻。');
        expect(reader._view.words.textContent).toContain('还没制卡'); expect(reader._view.words.textContent).toContain('已制 2 张卡');
        expect(reader._view.words.textContent).not.toContain('—');
        reader._view.words.querySelector('[data-saved-card]').click(); await Promise.resolve();
        expect(open).toHaveBeenCalledOnce();
        expect(reader._view.words.textContent).toContain('暂时没有：至少要有一个还在学的词出现在字幕里');
        await reader.writeSummary();
        expect(reader._view.words.querySelector('.r-summary').textContent).toContain('已保存 · 打开笔记 ↗');
    } finally { reader._reset(); youtubeStudyContext.openCard = null; vi.unstubAllGlobals(); await env.teardown(global); }
});
