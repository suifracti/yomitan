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
import {prepareStudyService, StudyService} from '../ext/js/study/study-service.js';
import {VIDEO_STATE_KEY} from '../ext/js/study/subtitle-prefs.js';

test('explains saved video words, opens uncarded words for card selection, and reports a saved summary clearly', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<div id="movie_player"><video></video></div><div id="secondary-inner"></div>', url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const {youtubeStudyContext} = await import('../ext/js/study/youtube-study-context.js');
    const sentence = 'A successful project needs patient work from the whole team.';
    vi.stubGlobal('chrome', {
        runtime: {getURL: (/** @type {string} */ p) => `chrome-extension://test/${p}`},
        storage: {local: {get: async () => ({}), set: async () => {}}, onChanged: {addListener() {}, removeListener() {}}},
    });
    // A lecturer repeats the same sentence. The learner saved the second occurrence.
    const events = [0, 24500].map((tStartMs) => ({tStartMs, dDurationMs: 4000, segs: [{utf8: sentence}]}));
    vi.stubGlobal('fetch', async () => ({ok: true, text: async () => JSON.stringify({events})}));
    let opened;
    const open = vi.fn(async (/** @type {Range} */ range, /** @type {boolean|undefined} */ panel, /** @type {string|undefined} */ recordId) => {
        opened = {text: range.toString(), panel, recordId, at: youtubeStudyContext.read(range)?.videoTime};
    });
    youtubeStudyContext.openCard = open;
    const call = vi.fn(async (/** @type {string} */ action) => action === 'libraryVideoWords' ? {items: [
        {id: '1'.repeat(32), word: 'successful', sentence, videoTime: 24, cards: 0, sense: {gloss: '成功的'}},
        {id: '2'.repeat(32), word: 'project', sentence, videoTime: 0, cards: 2},
        {id: '3'.repeat(32), word: 'successful', sentence, videoTime: 24, cards: 1, sense: {gloss: '有成效的'}},
    ]} : {words: 2, cards: 2, openUrl: 'obsidian://open?vault=test&file=summary'});
    const reader = new YoutubeReader({prefs: {merge: false}, call});
    try {
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en'); reader.start();
        await vi.waitFor(() => expect(reader.session?.cues.length).toBe(2));
        const words = /** @type {HTMLButtonElement} */ (document.querySelector('[data-tab=words]'));
        words.click();
        const savedPanel = /** @type {HTMLElement} */ (document.querySelector('#study-yt-reader .r-words'));
        expect(words.textContent).toBe('我在这个视频记的词');
        await vi.waitFor(() => expect(savedPanel.textContent).toContain('已制 2 张卡'));
        expect(savedPanel.textContent).toContain('看视频时点过『记住它』的词。点时间可以回到那一刻。');
        expect(savedPanel.textContent).toContain('还没制卡'); expect(savedPanel.textContent).toContain('已制 2 张卡');
        expect(savedPanel.textContent).not.toContain('—');
        savedPanel.querySelector('[data-saved-card]').click(); await Promise.resolve();
        expect(open).toHaveBeenCalledOnce();
        expect(opened).toEqual({text: 'successful', panel: true, at: 24.5, recordId: '1'.repeat(32)});
        expect(savedPanel.textContent).toContain('暂时没有：至少要有一个还在学的词出现在字幕里');
        const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
        const play = vi.spyOn(video, 'play').mockResolvedValue();
        const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
        const translate = vi.spyOn(reader, '_autoTranslate');
        const progress = vi.spyOn(reader, '_saveProgress');
        /** @type {HTMLButtonElement} */ (savedPanel.querySelector('[data-listen-saved]')).click();
        const practice = /** @type {HTMLElement} */ (document.querySelector('.r-listen-practice'));
        expect(savedPanel.hidden).toBe(true);
        expect(practice.textContent).not.toContain(sentence);
        expect(practice.querySelector('[data-listen-note]')).toBeNull();
        /** @type {HTMLButtonElement} */ (practice.querySelector('[data-listen-play]')).click();
        expect(play).toHaveBeenCalledOnce();
        expect(video.currentTime).toBe(24.5);
        video.currentTime = 28.5;
        video.dispatchEvent(new Event('timeupdate'));
        expect(pause).toHaveBeenCalledOnce();
        expect(translate).not.toHaveBeenCalled();
        expect(progress).not.toHaveBeenCalled();
        expect(practice.textContent).not.toContain(sentence);
        /** @type {HTMLButtonElement} */ (practice.querySelector('[data-listen-reveal]')).click();
        expect(practice.textContent).toContain(sentence);
        const notes = [...practice.querySelectorAll('button[data-listen-note]')];
        expect(notes.map((button) => button.textContent)).toEqual(['继续学习：successful · 成功的', '继续学习：successful · 有成效的']);
        /** @type {HTMLButtonElement} */ (notes[1]).click();
        expect(call).toHaveBeenLastCalledWith('openStudyRecord', {id: '3'.repeat(32), word: 'successful', sentence, openPanel: false});
        const miss = /** @type {HTMLButtonElement} */ (practice.querySelector('[data-listen-miss]'));
        miss.click();
        expect(miss.getAttribute('aria-pressed')).toBe('true');
        const next = /** @type {HTMLButtonElement} */ (practice.querySelector('[data-listen-next]'));
        next.click();
        expect(practice.textContent).not.toContain(sentence);
        expect(practice.querySelector('[data-listen-note]')).toBeNull();
        const playSentence = /** @type {HTMLButtonElement} */ (practice.querySelector('[data-listen-play]'));
        playSentence.click();
        expect(video.currentTime).toBe(0);
        expect(miss.getAttribute('aria-pressed')).toBe('false');
        next.click();
        const retry = /** @type {HTMLButtonElement} */ (practice.querySelector('[data-listen-retry]'));
        expect(retry.textContent).toBe('重听这 1 句');
        retry.click();
        expect(practice.textContent).toContain('重听没听清的 · 1/1');
        expect(practice.textContent).not.toContain(sentence);
        playSentence.click();
        expect(video.currentTime).toBe(24.5);
        miss.click();
        miss.click();
        next.click();
        expect(retry.hidden).toBe(true);
        reader.setOffset(500, false);
        expect(document.querySelector('.r-listen-practice')).toBeNull();
        expect(savedPanel.hidden).toBe(false);
        await reader.writeSummary();
        expect(savedPanel.querySelector('.r-summary').textContent).toContain('已保存 · 打开笔记 ↗');
    } finally { reader._reset(); youtubeStudyContext.openCard = null; vi.unstubAllGlobals(); await env.teardown(global); }
});

test('a library video handoff keeps the saved occurrence and can prepare a full round in order', async () => {
    const url = 'https://www.youtube.com/watch?v=abcdefghijk';
    const id = '4'.repeat(32);
    const sentence = 'A successful project needs patient work from the whole team.';
    const record = {id, entry: {url: `${url}&t=25s`, videoTime: 25, sentence, word: 'successful', language: 'en'}};
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<div id="movie_player"><video></video></div><div id="secondary-inner"></div>', url}});
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    /** @type {Map<string, unknown>} */
    const session = new Map();
    const update = vi.fn();
    /** @typedef {{id: string, url: string, frameId?: number, tab?: {id: number, url: string}}} ListeningSender */
    /** @typedef {(message: unknown, sender: ListeningSender, reply: (value: unknown) => void) => boolean} ListeningReceiver */
    /** @type {ListeningReceiver} */
    let receive;
    vi.stubGlobal('chrome', {
        runtime: {id: 'test',
            getURL: (/** @type {string} */ path) => `chrome-extension://test/${path}`,
            onMessage: {addListener: (/** @type {ListeningReceiver} */ fn) => { receive = fn; }}},
        tabs: {create: async () => ({id: 41}), update},
        storage: {
            local: {
                get: async () => ({[VIDEO_STATE_KEY]: {'youtube:abcdefghijk': {offsetMs: 1000, trackKey: 'en|'}}}),
                set: async () => {},
            },
            session: {
                get: async (/** @type {string} */ key) => ({[key]: session.get(key)}),
                set: async (/** @type {Record<string, unknown>} */ values) => { for (const [key, value] of Object.entries(values)) { session.set(key, value); } },
                remove: async (/** @type {string} */ key) => { session.delete(key); },
            },
            onChanged: {addListener() {}, removeListener() {}},
        },
    });
    const handle = vi.spyOn(StudyService.prototype, 'handle').mockImplementation(async (action) => {
        if (action === 'libraryRead') { return {items: [{id, record}]}; }
        return {items: [
            {id, word: 'successful', sentence, videoTime: 25},
            {id: '5'.repeat(32), word: 'project', sentence, videoTime: 1},
            {id: '6'.repeat(32), word: 'missing', sentence: 'A sentence from the old subtitle.', videoTime: 8},
        ]};
    });
    const events = [0, 24500].map((tStartMs) => ({tStartMs, dDurationMs: 4000, segs: [{utf8: sentence}]}));
    vi.stubGlobal('fetch', async () => ({ok: true, text: async () => JSON.stringify({events})}));
    const sender = {id: 'test', frameId: 0, url, tab: {id: 41, url}};
    /**
     * @param {string} studyAction
     * @param {ListeningSender} from
     * @param {unknown} data
     * @returns {Promise<unknown>}
     */
    function request(studyAction, from, data = null) {
        return new Promise((resolve) => { receive({studyAction, data}, from, resolve); });
    }
    /** @type {import('../ext/js/study/study-client.js').studyCall} */
    const call = async (action) => {
        if (action !== 'claimVideoListening') { return []; }
        const reply = /** @type {{value?: unknown}} */ (await request(action, sender));
        return reply.value;
    };
    const reader = new YoutubeReader({prefs: {merge: false}, call});
    try {
        prepareStudyService();
        const libraryPage = {id: 'test', url: 'chrome-extension://test/study-library.html'};
        await request('openVideoListening', libraryPage, {id});
        expect(await request('claimVideoListening', sender)).toMatchObject({ok: true, value: [{id}]});
        await request('openVideoListening', libraryPage, {id, wholeVideo: true});
        expect(handle).toHaveBeenCalledWith('libraryVideoWords', {mediaKey: 'youtube:abcdefghijk', sourceUrl: url});
        expect(update).toHaveBeenCalledWith(41, {url});
        const otherVideo = 'https://www.youtube.com/watch?v=01234567890';
        expect(await request('claimVideoListening', {...sender, url: otherVideo, tab: {...sender.tab, url: otherVideo}})).toEqual({ok: true, value: null});
        expect(await request('claimVideoListening', {...sender, tab: {...sender.tab, id: 42}})).toEqual({ok: true, value: null});
        const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
        const play = vi.spyOn(video, 'play').mockResolvedValue();
        vi.spyOn(video, 'pause').mockImplementation(() => {});
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en');
        reader.start();
        await vi.waitFor(() => expect(document.querySelector('.r-listen-practice strong')?.textContent).toContain('1/2'));
        expect(session.size).toBe(0);
        expect(play).not.toHaveBeenCalled();
        expect(document.querySelector('.r-listen-practice')?.textContent).not.toContain(sentence);
        /** @type {HTMLButtonElement} */ (document.querySelector('[data-listen-play]')).click();
        expect(video.currentTime).toBe(1);
        /** @type {HTMLButtonElement} */ (document.querySelector('[data-listen-next]')).click();
        /** @type {HTMLButtonElement} */ (document.querySelector('[data-listen-play]')).click();
        expect(video.currentTime).toBe(25.5);
    } finally {
        reader.setPrefs({...reader.prefs, enabled: false});
        handle.mockRestore();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
