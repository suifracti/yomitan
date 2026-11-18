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

import {createHash} from 'node:crypto';
import {afterAll, expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';
import {installReaderStorage} from './mocks/study-reader-storage.js';

const html = '<!DOCTYPE html><html><head></head><body><main><video></video></main><div id="dock"></div><div id="layer"></div></body></html>';
const environment = await builtinEnvironments.jsdom.setup(global, {jsdom: {html, url: 'https://course.example.org/watch?id=7&utm=x'}});
afterAll(() => environment.teardown(global));
vi.stubGlobal('ResizeObserver', class {
    /** */
    observe() {}
    /** */
    disconnect() {}
});

const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
const {YoutubeOverlay} = await import('../ext/js/study/youtube-overlay.js');
const {mediaKeyOf, pageSourceKey, timedUrl} = await import('../ext/js/study/media-key.js');
const {WebVideoSite} = await import('../ext/js/study/web-video-site.js');
const {readVideoState, videoStateScope, writeVideoState} = await import('../ext/js/study/subtitle-prefs.js');

/**
 * @param {string} url
 * @returns {string}
 */
const persistedScope = (url) => `source:${createHash('sha256').update(url).digest('hex')}`;

test('media keys and time links match the bridge rules', () => {
    expect(mediaKeyOf('https://youtu.be/abcdefghijk?t=3')).toBe('youtube:abcdefghijk');
    expect(mediaKeyOf('https://www.youtube.com/shorts/abcdefghijk')).toBe('youtube:abcdefghijk');
    expect(mediaKeyOf('https://www.bilibili.com/video/BV1xx411c7mD/?p=2&spm=abc')).toBe('web:www.bilibili.com/video/BV1xx411c7mD?p=2');
    expect(mediaKeyOf('https://course.example.org/watch?id=7&utm=x#a')).toBe('web:course.example.org/watch?id=7');
    expect(mediaKeyOf('file:///x.mp4')).toBe('');
    expect(pageSourceKey('https://course.example.org/watch?id=7#/unit/2:~:text=example')).toBe('https://course.example.org/watch?id=7#/unit/2');
    expect(pageSourceKey('https://course.example.org/watch?id=7#heading')).toBe('https://course.example.org/watch?id=7');
    expect(pageSourceKey('https://m.bilibili.com/video/BV1xx411c7mD/?p=02&t=9')).toBe('web:bilibili.com/video/BV1xx411c7mD?p=2');
    expect(videoStateScope({mediaKey: 'youtube:abcdefghijk', url: 'https://youtu.be/abcdefghijk?t=3'})).toBe('youtube:abcdefghijk');
    expect(videoStateScope({mediaKey: 'web:www.bilibili.com/video/BV1xx411c7mD?p=2', url: 'https://www.bilibili.com/video/BV1xx411c7mD?p=2'})).toBe('web:www.bilibili.com/video/BV1xx411c7mD?p=2');
    const localFile = 'file:///folder-a/lesson.mp4#study-duration=90';
    expect(videoStateScope({mediaKey: mediaKeyOf(localFile), url: localFile})).toBe(localFile);
    expect(videoStateScope({mediaKey: mediaKeyOf(localFile), url: localFile.replace('folder-a', 'folder-b')})).not.toBe(localFile);
    expect(timedUrl('https://www.youtube.com/watch?v=abcdefghijk', 72.6)).toEqual({url: 'https://www.youtube.com/watch?v=abcdefghijk&t=72s', timed: true});
    expect(timedUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=2', 72)).toEqual({url: 'https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=72', timed: true});
    expect(timedUrl('https://course.example.org/watch?id=7', 72)).toEqual({url: 'https://course.example.org/watch?id=7', timed: false});
});

/**
 * A stand-in for WebVideoSite: jsdom has no layout, so the real one never finds a video.
 * @param {{cues: {id: string, sourceIndex: number, startMs: number, endMs: number, text: string}[], language: string, label: string, id: string, all: {id: string, label: string}[]}|null} found
 * @returns {Record<string, unknown> & {dockOpen: () => boolean}}
 */
function fakeSite(found) {
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    let open = false;
    return {
        kind: /** @type {const} */ ('web'),
        mediaKey: () => mediaKeyOf(location.href),
        video: () => video,
        pageUrl: () => location.href,
        host: () => /** @type {HTMLElement} */ (document.querySelector('#dock')),
        pinFirst: () => false,
        watch: (/** @type {() => void} */ onChange) => onChange(),
        remember: () => {},
        sources: () => [],
        load: async () => found,
        toggleDock: (/** @type {boolean|undefined} */ value) => (open = value ?? !open),
        dockOpen: () => open,
        active: () => true,
        player: () => /** @type {HTMLElement} */ (document.querySelector('#layer')),
        controls: () => /** @type {HTMLElement} */ (document.querySelector('#layer')),
        hideNative: () => {},
        height: () => 360,
    };
}

test('web captions prefer regional English and fall back only for automatic selection', async () => {
    const video = document.createElement('video');
    video.style.opacity = '1';
    video.getBoundingClientRect = () => new DOMRect(0, 0, 640, 360);
    const track = (/** @type {string} */ language, /** @type {string} */ text) => ({
        language,
        kind: 'subtitles',
        label: language || 'CC',
        mode: 'disabled',
        cues: [{startTime: 0, endTime: 2, text}],
    });
    const english = track('en-GB', 'Keep learning at your own pace.');
    Object.defineProperty(video, 'textTracks', {value: [track('', '我们现在准备开始学习这一节课程。'), track('fr', 'Commençons par lire.'), english]});
    document.body.append(video);
    try {
        const site = new WebVideoSite();
        const signal = new AbortController().signal;
        expect(await site.load({signal})).toMatchObject({id: 'track:2', language: 'en-GB'});
        expect(await site.load({signal, sourceId: 'track:1'})).toMatchObject({id: 'track:1', language: 'fr'});
        english.language = 'en';
        english.cues[0].endTime = 0;
        expect(await site.load({signal, sourceId: 'track:2'})).toBeNull();
        expect(await site.load({signal})).toMatchObject({id: 'track:0', language: 'zh'});
    } finally {
        video.remove();
    }
});

test('other sites: page subtitles load, a bilingual file brings its translations, and the panel is a launcher', async () => {
    const cues = [{id: '0', sourceIndex: 0, startMs: 0, endMs: 1500, text: 'The brain can change.'}, {id: '1', sourceIndex: 1, startMs: 2000, endMs: 3000, text: 'Keep going.'}];
    const site = fakeSite({cues, language: 'en', label: 'English（播放器字幕）', id: 'track:0', all: [{id: 'track:0', label: 'English（播放器字幕）'}, {id: 'track:1', label: '中文（播放器字幕）'}]});
    /** @type {unknown[][]} */
    const calls = [];
    const reader = new YoutubeReader({prefs: {merge: false, engine: 'model'},
        call: async (action, data) => {
            calls.push([action, data]);
            return {items: []};
        },
        site: /** @type {never} */ (site)});
    new YoutubeOverlay(reader, /** @type {never} */ (site)).start();
    reader.start();
    await vi.waitFor(() => expect(document.querySelector('#dock #study-yt-reader')).not.toBe(null));
    // No YouTube player bar here: the launcher sits on the video layer instead.
    expect(document.querySelector('#layer #study-yt-button.w-launch')).not.toBe(null);
    expect(document.querySelector('#layer [data-action=dock]')).not.toBe(null);

    reader.loadCaptions();
    await vi.waitFor(() => expect(document.querySelectorAll('#study-yt-reader .r-cue').length).toBe(2));
    expect(reader.session?.source).toMatchObject({mediaKey: 'web:course.example.org/watch?id=7', acquisition: 'provider', language: 'en'});
    // Two page tracks: the source picker appears in the menu.
    const picker = /** @type {HTMLElement} */ (document.querySelector('#study-yt-reader .r-source'));
    expect(picker.hidden).toBe(false);
    expect([...picker.querySelectorAll('option')].map((option) => option.value)).toEqual(['track:0', 'track:1']);
    // Rows keep the plain page link: this site has no time parameter.
    expect(reader.rowInfo('0')?.url).toBe('https://course.example.org/watch?id=7&utm=x');

    const srt = ['1', '00:00:01,000 --> 00:00:02,000', 'I love bricks.', '我爱砖块。', '', '2', '00:00:03,000 --> 00:00:04,000', 'Walls are made of them.', '墙是用它们砌的。', '', '3', '00:00:05,000 --> 00:00:06,000', 'Really.', '真的。'].join('\n');
    reader.importText(srt, 'lesson.srt');
    await vi.waitFor(() => expect(document.querySelectorAll('#study-yt-reader .r-cue').length).toBe(3));
    expect(reader.session?.source).toMatchObject({acquisition: 'import', language: 'en'});
    expect([...document.querySelectorAll('#study-yt-reader .r-text')].map((node) => node.textContent?.trim())).toEqual(['I love bricks.', 'Walls are made of them.', 'Really.']);
    expect([...document.querySelectorAll('#study-yt-reader .r-translation')].map((node) => node.textContent)).toEqual(['我爱砖块。', '墙是用它们砌的。', '真的。']);

    reader.importText('not subtitles at all', 'notes.txt');
    expect(document.querySelector('#study-yt-reader .r-status')?.textContent).toContain('导入失败');

    // Revealing a row opens the floating panel.
    expect(site.dockOpen()).toBe(false);
    reader.revealRow('0');
    expect(site.dockOpen()).toBe(true);

    /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-reader .r-tab[data-tab=words]')).click();
    await vi.waitFor(() => expect(calls).toContainEqual(['libraryVideoWords', {mediaKey: 'web:course.example.org/watch?id=7'}]));
});

test('finds a caption by its saved translation and jumps using the same row', async () => {
    document.querySelector('#study-yt-reader')?.remove();
    installReaderStorage({get: async () => ({}), set: async () => {}});
    const site = fakeSite(null);
    const calls = vi.fn(async (/** @type {string} */ _action) => null);
    const reader = new YoutubeReader({prefs: {merge: false, resume: false}, site: /** @type {never} */ (site), call: calls});
    try {
        reader.start();
        await vi.waitFor(() => expect(document.querySelector('#study-yt-reader')).not.toBeNull());
        const file = [
            '1',
            '00:00:01,000 --> 00:00:02,000',
            'I love bricks.',
            '我爱砖块。',
            '',
            '2',
            '00:00:03,000 --> 00:00:04,000',
            'Walls are made of them.',
            '墙是用它们砌的。',
        ].join('\n');
        reader.importText(file, 'lesson.srt');
        const search = /** @type {HTMLInputElement|null} */ (document.querySelector('input[aria-label="找字幕"]'));
        expect(search).not.toBeNull();
        if (!search) { return; }
        const input = (/** @type {string} */ value) => {
            search.value = value;
            search.dispatchEvent(new Event('input', {bubbles: true}));
        };
        const rows = () => [...document.querySelectorAll('#study-yt-reader .r-text')].map((node) => node.textContent?.trim());
        const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
        video.currentTime = 0;
        input('砖块');
        expect(video.currentTime).toBe(0);
        expect(rows()).toEqual(['I love bricks.']);
        /** @type {HTMLButtonElement|null} */ (document.querySelector('#study-yt-reader .r-time'))?.click();
        expect(video.currentTime).toBe(1);
        input('  WALLS  ');
        expect(rows()).toEqual(['Walls are made of them.']);
        reader.revealRow(reader.session?.cues[0].id ?? '');
        expect(search.value).toBe('');
        expect(rows()).toEqual(['I love bricks.', 'Walls are made of them.']);
        input('没匹配');
        expect(rows()).toEqual([]);
        expect(document.querySelector('.r-search small')?.textContent).toContain('没找到');
        input('');
        expect(rows()).toEqual(['I love bricks.', 'Walls are made of them.']);
        expect(calls.mock.calls.some(([action]) => action === 'subtitleTranslate')).toBe(false);
    } finally {
        vi.unstubAllGlobals();
    }
});

test('finds and replays a phrase split across connected captions without crossing speech pauses', async () => {
    document.querySelector('#study-yt-reader')?.remove();
    installReaderStorage({get: async () => ({}), set: async () => {}});
    const calls = vi.fn(async (/** @type {string} */ _action) => null);
    const reader = new YoutubeReader({prefs: {merge: false, resume: false}, site: /** @type {never} */ (fakeSite(null)), call: calls});
    try {
        reader.start();
        reader.importText([
            '1\n00:00:01,000 --> 00:00:02,000\nI can\n我能',
            '2\n00:00:02,200 --> 00:00:03,000\ntake it\n接手',
            '3\n00:00:03,100 --> 00:00:04,000\nfrom here.\n这里的事。',
            '4\n00:00:06,000 --> 00:00:07,000\nPlease wait\n请等等',
            '5\n00:00:09,000 --> 00:00:10,000\nfor me.\n等我。',
        ].join('\n\n'), 'lesson.srt');
        const search = /** @type {HTMLInputElement} */ (document.querySelector('input[aria-label="找字幕"]'));
        const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
        video.currentTime = 0;
        const rows = (/** @type {string} */ value) => {
            search.value = value;
            search.dispatchEvent(new Event('input', {bubbles: true}));
            return [...document.querySelectorAll('#study-yt-reader .r-text')].map((node) => node.textContent?.trim());
        };
        expect(rows('CAN take it from')).toEqual(['I can', 'take it', 'from here.']);
        expect(video.currentTime).toBe(0);
        const play = vi.spyOn(video, 'play').mockResolvedValue();
        const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
        const replay = /** @type {HTMLButtonElement|null} */ (document.querySelector('.r-search-play'));
        expect(replay?.textContent).toBe('▶ 回听 3 行');
        reader.setOffset(100, false);
        replay?.click();
        expect(play).toHaveBeenCalledOnce();
        expect(video.currentTime).toBe(1.1);
        video.currentTime = 3.2;
        video.dispatchEvent(new Event('timeupdate'));
        expect(pause).not.toHaveBeenCalled();
        video.currentTime = 4.1;
        video.dispatchEvent(new Event('timeupdate'));
        expect(pause).toHaveBeenCalledOnce();
        play.mockRestore();
        pause.mockRestore();
        reader.setOffset(0, false);
        expect(rows('能接手')).toEqual(['I can', 'take it']);
        /** @type {HTMLButtonElement} */ (document.querySelectorAll('.r-time')[1]).click();
        expect(video.currentTime).toBe(2.2);
        expect(rows('wait for')).toEqual([]);
        expect(rows('接手 from')).toEqual([]);
        expect(calls.mock.calls.some(([action]) => action === 'subtitleTranslate')).toBe(false);
    } finally {
        vi.unstubAllGlobals();
    }
});

test('regrouping retains finished translations only for exact rows of the same loaded track', async () => {
    document.querySelector('#study-yt-reader')?.remove();
    installReaderStorage({get: async () => ({}), set: async () => {}});
    const site = fakeSite(null);
    const translated = new Map([
        ['The brain', '大脑'],
        ['can change.', '可以改变。'],
        ['The brain can change.', '大脑是可以改变的。'],
        ['Keep going.', '继续。'],
    ]);
    const request = vi.fn(async (/** @type {string} */ action, /** @type {unknown} */ data) => {
        if (action === 'subtitleSettings') { return {model: 'fixture', effort: 'low'}; }
        if (action === 'subtitleTranslate') {
            const {items} = /** @type {{items: {id: string, text: string}[]}} */ (data);
            return {items: items.map(({id, text}) => ({id, translation: translated.get(text)}))};
        }
        return {items: []};
    });
    const reader = new YoutubeReader({prefs: {merge: false, autoTranslate: false, engine: 'google', resume: false}, site: /** @type {never} */ (site), call: request});
    try {
        reader.start();
        await vi.waitFor(() => expect(document.querySelector('#study-yt-reader')).not.toBeNull());
        const file = '1\n00:00:01,000 --> 00:00:02,000\nThe brain\n\n2\n00:00:02,100 --> 00:00:03,000\ncan change.\n\n3\n00:00:05,000 --> 00:00:06,000\nKeep going.\n';
        reader.importText(file, 'lesson.srt');
        const rows = () => [...document.querySelectorAll('#study-yt-reader .r-translation')].map((node) => node.textContent);
        const requests = () => request.mock.calls.filter(([action]) => action === 'subtitleTranslate').map(([, data]) => data);
        reader.translateNext();
        await vi.waitFor(() => expect(rows()).toEqual(['大脑', '可以改变。', '继续。']));
        reader.updatePrefs({merge: true});
        expect(rows()).toEqual(['', '继续。']);
        expect(requests()).toHaveLength(1);
        reader.translateNext();
        await vi.waitFor(() => expect(rows()).toEqual(['大脑是可以改变的。', '继续。']));
        expect(requests()[1]).toMatchObject({items: [{text: 'The brain can change.'}]});
        reader.updatePrefs({merge: false});
        expect(rows()).toEqual(['大脑', '可以改变。', '继续。']);
        reader.updatePrefs({merge: true});
        expect(rows()).toEqual(['大脑是可以改变的。', '继续。']);
        reader.importText(file, 'lesson.srt');
        expect(rows()).toEqual(['', '']);
        expect(requests()).toHaveLength(2);
    } finally {
        vi.unstubAllGlobals();
    }
});

test('a free subtitle run keeps finished rows but cannot send its next batch to a newly selected model', async () => {
    document.querySelector('#study-yt-reader')?.remove();
    installReaderStorage({get: async () => ({}), set: async () => {}});
    const {StudyService} = await import('../ext/js/study/study-service.js');
    const {TRANSLATION_PREFS_KEY} = await import('../ext/js/study/subtitle-prefs.js');
    const {SETTINGS_KEY} = await import('../ext/js/study/study-data.js');
    const prefs = {engine: 'google'};
    /** @type {Record<string, unknown>} */
    const data = {[TRANSLATION_PREFS_KEY]: prefs, [SETTINGS_KEY]: {model: 'gpt-5-mini', effort: 'low', cacheEnabled: false}};
    const native = vi.fn(() => { throw new Error('The test must never send a model request'); });
    const service = new StudyService({get: async (key) => ({[key]: data[key]}), set: async () => {}}, native);
    const free = vi.fn().mockImplementationOnce(async () => {
        // Change the actual preference without notifying the open reader yet.
        prefs.engine = 'model';
        return new Response(JSON.stringify([Array.from({length: 8}, () => '免费译文')]));
    }).mockResolvedValueOnce(new Response(JSON.stringify([['免费译文']])));
    vi.stubGlobal('fetch', free);
    const cues = Array.from({length: 9}, (_, i) => ({id: String(i), sourceIndex: i, startMs: i * 2000, endMs: i * 2000 + 1000, text: `Sentence ${i}.`}));
    const site = fakeSite({cues, language: 'en', label: 'English', id: 'track:0', all: []});
    const reader = new YoutubeReader({prefs: {merge: false, autoTranslate: false, engine: 'google', resume: false}, site: /** @type {never} */ (site), call: service.handle.bind(service)});
    try {
        reader.start();
        reader.loadCaptions();
        await vi.waitFor(() => expect(reader.session?.cues).toHaveLength(9));
        /** @type {HTMLVideoElement} */ (document.querySelector('video')).currentTime = 0;
        const translate = /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-reader .r-translate'));
        translate.click();
        await vi.waitFor(() => expect(translate.disabled).toBe(false));
        expect(native).not.toHaveBeenCalled();
        expect(reader.session?.progress().translated).toBe(8);
        expect(document.querySelector('#study-yt-reader .r-cue:last-child .r-translation')?.textContent).toContain('翻译服务刚换了');

        prefs.engine = 'google';
        const retry = [...document.querySelectorAll('#study-yt-reader button')].find((button) => button.textContent === '重试失败');
        retry?.click();
        await vi.waitFor(() => expect(reader.session?.progress().translated).toBe(9));
        expect(free).toHaveBeenCalledTimes(2);
        expect(native).not.toHaveBeenCalled();
    } finally {
        vi.unstubAllGlobals();
    }
});

test('keyboard replay stops on the shared media clock and releases slow speed on exit', async () => {
    document.querySelector('#study-yt-reader')?.remove();
    installReaderStorage({get: async () => ({}), set: async () => {}});
    const reader = new YoutubeReader({prefs: {merge: false, autoTranslate: false, resume: false}, site: /** @type {never} */ (fakeSite(null)), call: async () => ({items: []})});
    reader.start();
    await vi.waitFor(() => expect(document.querySelector('#study-yt-reader')).not.toBeNull());
    reader.importText('1\n00:00:01,000 --> 00:00:02,000\nWe learn from sentences.\n', 'lesson.srt');
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    const paused = vi.spyOn(video, 'paused', 'get').mockReturnValue(false);
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    let time = 1.4;
    const readTime = vi.spyOn(video, 'currentTime', 'get').mockImplementation(() => time);
    const seek = vi.spyOn(video, 'currentTime', 'set').mockImplementation((value) => { time = value; });
    vi.useFakeTimers();
    video.playbackRate = 1.25;
    try {
        expect(reader.captionShortcut('s', true)).toBe(true);
        expect(time).toBe(1);
        expect(video.playbackRate).toBe(0.75);
        video.dispatchEvent(new Event('playing'));
        vi.advanceTimersByTime(1300);
        expect(pause).not.toHaveBeenCalled();
        time = 2;
        vi.advanceTimersByTime(40);
        expect(pause).toHaveBeenCalledOnce();
        expect(video.playbackRate).toBe(1.25);

        reader.captionShortcut('s', true);
        time = 8;
        video.dispatchEvent(new Event('seeking'));
        expect(video.playbackRate).toBe(1.25);
        expect(pause).toHaveBeenCalledOnce();
        reader.setOffset(-1500, false);
        expect(() => reader.captionShortcut('s', true)).not.toThrow();
        expect(play).toHaveBeenCalledTimes(2);
        expect(document.querySelector('#study-yt-reader .r-status')?.textContent).toContain('请调整偏移');
    } finally {
        reader.updatePrefs({shortcuts: false});
        paused.mockRestore();
        pause.mockRestore();
        play.mockRestore();
        readTime.mockRestore();
        seek.mockRestore();
        video.playbackRate = 1;
        vi.useRealTimers();
        vi.unstubAllGlobals();
    }
});

test('other sites: nothing found explains how to get subtitles', async () => {
    document.querySelector('#study-yt-reader')?.remove();
    const reader = new YoutubeReader({prefs: {merge: false, engine: 'model'}, site: /** @type {never} */ (fakeSite(null))});
    reader.start();
    await vi.waitFor(() => expect(document.querySelector('#study-yt-reader')).not.toBe(null));
    reader.loadCaptions();
    await vi.waitFor(() => expect(document.querySelector('#study-yt-reader .r-status')?.textContent).toContain('导入字幕文件'));
});

test('shadowing pauses after each sentence (after the chosen repeats); offset and progress are remembered per video', async () => {
    document.querySelector('#study-yt-reader')?.remove();
    /** @type {Record<string, unknown>} */
    const store = {studyVideoState: {[persistedScope(location.href)]: {resumeMs: 95000, at: 1}}};
    installReaderStorage({
        get: async (key) => ({[key]: store[key]}),
        set: async (values) => { Object.assign(store, values); },
    });
    try {
        const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
        let current = 0;
        let paused = false;
        Object.defineProperty(video, 'currentTime', {configurable: true, get: () => current, set: (/** @type {number} */ v) => { current = v; }});
        Object.defineProperty(video, 'paused', {configurable: true, get: () => paused});
        video.pause = () => { paused = true; };
        const cues = [{id: '0', sourceIndex: 0, startMs: 0, endMs: 2000, text: 'One.'}, {id: '1', sourceIndex: 1, startMs: 2000, endMs: 4000, text: 'Two.'}];
        const reader = new YoutubeReader({prefs: {merge: false, engine: 'model', shadow: true, shadowRepeats: 2, resume: true}, site: /** @type {never} */ (fakeSite({cues, language: 'en', label: 'English', id: 'track:0', all: []}))});
        reader.start();
        await vi.waitFor(() => expect(document.querySelector('#study-yt-reader')).not.toBe(null));
        reader.loadCaptions();
        await vi.waitFor(() => expect(document.querySelectorAll('#study-yt-reader .r-cue').length).toBe(2));
        // A resume point is offered, never applied by itself.
        await vi.waitFor(() => expect(reader.resumeMs).toBe(95000));
        expect(current).toBe(0);
        const resume = /** @type {HTMLButtonElement} */ ([...document.querySelectorAll('#study-yt-reader .r-btn')].find((button) => button.textContent?.startsWith('从 1:35')));
        expect(resume.hidden).toBe(false);

        // eslint-disable-next-line no-underscore-dangle -- drive the 60 ms shadowing check directly
        const tick = () => reader._shadowTick();
        current = 0.5;
        tick();
        current = 1.98;
        tick();
        // First play done: back to the start for the second.
        expect(current).toBe(0);
        expect(paused).toBe(false);
        current = 1.97;
        tick();
        expect(paused).toBe(true);
        expect(document.querySelector('#study-yt-reader .r-status')?.textContent).toContain('跟读');
        // Playing on from the same spot does not pause again on the same sentence.
        paused = false;
        current = 1.99;
        tick();
        current = 2.5;
        tick();
        expect(paused).toBe(false);

        reader.setOffset(1200);
        expect(reader.session?.offsetMs).toBe(1200);
        expect(reader.rowInfo('1')?.start).toBe(3.2);
        // Offset controls live in the video panel; verify the shared timing and saved state here.
        await vi.waitFor(() => expect(store.studyVideoState).toMatchObject({[persistedScope(location.href)]: {offsetMs: 1200, trackKey: 'track:0'}}));

        resume.click();
        expect(current).toBe(95);
        expect(resume.hidden).toBe(true);
    } finally {
        vi.unstubAllGlobals();
        vi.stubGlobal('ResizeObserver', class {
            /** */
            observe() {}
            /** */
            disconnect() {}
        });
    }
});

test('the words tab writes a study summary only on a real click', async () => {
    document.querySelector('#study-yt-reader')?.remove();
    /** @type {unknown[][]} */
    const calls = [];
    const reader = new YoutubeReader({prefs: {merge: false, engine: 'model'},
        site: /** @type {never} */ (fakeSite(null)),
        call: async (action, data) => {
            calls.push([action, data]);
            if (action === 'libraryVideoWords') { return {items: [{id: 'a', word: 'brick', sentence: 'A brick.', videoTime: 12, stage: 0, cards: 0}]}; }
            return {path: '视频记录/Lesson--x.md', words: 1, cards: 0, openUrl: 'obsidian://open?file=x'};
        }});
    reader.start();
    await vi.waitFor(() => expect(document.querySelector('#study-yt-reader')).not.toBe(null));
    /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-reader .r-tab[data-tab=words]')).click();
    await vi.waitFor(() => expect(document.querySelector('#study-yt-reader .r-summary button')).not.toBe(null));
    // A script-made click (isTrusted false) is ignored.
    /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-reader .r-summary button')).click();
    expect(calls.some(([action]) => action === 'libraryVideoSummary')).toBe(false);
    await reader.writeSummary();
    expect(calls).toContainEqual(['libraryVideoSummary', {mediaKey: 'web:course.example.org/watch?id=7', title: document.title}]);
    expect(document.querySelector('#study-yt-reader .r-summary [role=status]')?.textContent).toContain('已写入 1 个词');
});


test('web captions restore the chosen track and its learning position, with default fallback when unavailable', async () => {
    document.querySelector('#study-yt-reader')?.remove();
    const key = mediaKeyOf(location.href);
    const firstSource = {mediaKey: key, url: location.href};
    const firstStorageKey = persistedScope(firstSource.url);
    const legacy = {selectedTrackKey: 'track:1', trackKey: 'track:1', offsetMs: -200, resumeMs: 222000, at: 1};
    /** @type {Record<string, unknown>} */
    const store = {studyVideoState: {[key]: legacy, [firstStorageKey]: {selectedTrackKey: 'track:1', trackKey: 'track:1', offsetMs: 1200, resumeMs: 95000, at: 1}}};
    let sourceUrl = location.href;
    installReaderStorage({
        get: async (name) => ({[name]: store[name]}),
        set: async (values) => { Object.assign(store, values); },
    }, () => sourceUrl);
    try {
        const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
        Object.defineProperty(video, 'currentTime', {configurable: true, writable: true, value: 0});
        Object.defineProperty(video, 'paused', {configurable: true, value: false});
        const cues = [{id: '0', sourceIndex: 0, startMs: 0, endMs: 2000, text: 'Keep going.'}];
        // An independent reader instance like a second tab, sharing only the worker/storage.
        vi.resetModules();
        const secondTab = await import('../ext/js/study/subtitle-prefs.js');
        let chooseChineseWhileLoading = false;
        const sources = [
            {id: 'track:0',
                label: 'English',
                language: 'en',
                read: async () => {
                    if (chooseChineseWhileLoading) { await secondTab.writeVideoState(firstSource, {selectedTrackKey: 'track:1'}); }
                    return cues;
                }},
            {id: 'track:1', label: '中文', language: 'zh', read: async () => [{...cues[0], text: '继续学习。'}]},
        ];
        const site = fakeSite(null);
        let refresh = () => {};
        site.watch = (/** @type {() => void} */ change) => {
            refresh = change;
            change();
        };
        site.sources = async () => sources;
        site.load = (/** @type {Parameters<import('../ext/js/study/web-video-site.js').WebVideoSite['load']>[0]} */ options) => WebVideoSite.prototype.load.call(/** @type {never} */ (site), options);
        const reader = new YoutubeReader({prefs: {merge: false, resume: true}, site: /** @type {never} */ (site), call: async () => ({items: []})});
        reader.start();
        await vi.waitFor(() => expect(reader.session?.source.language).toBe('zh'));
        await vi.waitFor(() => expect(reader.session?.offsetMs).toBe(1200));
        expect(reader.resumeMs).toBe(95000);
        expect(video.currentTime).toBe(0);
        expect(store.studyVideoState).toMatchObject({[firstStorageKey]: {resumeMs: 95000}});
        const resume = /** @type {HTMLButtonElement} */ (document.querySelector('#study-yt-reader button[title="回到上次学到的句子"]'));
        expect(resume.isConnected).toBe(true);
        expect(resume.hidden).toBe(false);
        expect(resume.textContent).toBe('从 1:35 继续');
        expect((await readVideoState(firstSource))?.at).toBe(1); // Restoring a saved choice/offset is not a new edit.

        const language = /** @type {HTMLSelectElement} */ (document.querySelector('#study-yt-reader select[data-source]'));
        language.value = 'track:0';
        language.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(reader.session?.source.language).toBe('en'));
        await vi.waitFor(() => expect(store.studyVideoState).toMatchObject({[firstStorageKey]: {selectedTrackKey: 'track:0', resumeMs: 95000}}));
        expect(reader.session?.offsetMs).toBe(0);

        // A fallback may play here, but it must not undo a newer choice in the other tab.
        store.studyVideoState = {[key]: legacy, [firstStorageKey]: {selectedTrackKey: 'removed-track', at: 1}};
        chooseChineseWhileLoading = true;
        const before = reader.session;
        reader.loadCaptions();
        await vi.waitFor(() => expect(reader.session).not.toBe(before));
        expect(reader.session?.source.language).toBe('en');
        expect(document.querySelector('#study-yt-reader .r-status')?.textContent).toContain('English');
        expect((await readVideoState(firstSource))?.selectedTrackKey).toBe('track:1');
        chooseChineseWhileLoading = false;

        // Concurrent edits to two videos, including different parts of one saved position.
        const firstChoice = writeVideoState(firstSource, {selectedTrackKey: 'track:1'});
        sourceUrl = 'https://course.example.org/watch?id=8';
        const secondSource = {mediaKey: mediaKeyOf(sourceUrl), url: sourceUrl};
        const otherProgress = secondTab.writeVideoState(secondSource, {resumeMs: 45000});
        sourceUrl = location.href;
        await Promise.all([
            firstChoice,
            otherProgress,
            secondTab.writeVideoState(firstSource, {resumeMs: 120000}),
            writeVideoState(firstSource, {offsetMs: 500, trackKey: 'track:1'}),
        ]);
        expect(store.studyVideoState).toMatchObject({[firstStorageKey]: {selectedTrackKey: 'track:1', resumeMs: 120000, offsetMs: 500}, [persistedScope(secondSource.url)]: {resumeMs: 45000}});
        reader.loadCaptions();
        await vi.waitFor(() => expect(reader.session?.source.language).toBe('zh'));
        await vi.waitFor(() => expect(reader.session?.offsetMs).toBe(500));
        expect(reader.resumeMs).toBe(120000);
        expect(video.currentTime).toBe(0);

        const previousUrl = location.href;
        const oldRow = reader.rowInfo('0');
        expect(oldRow?.isCurrent()).toBe(true);
        try {
            history.replaceState(null, '', '#/lessons/next');
            sourceUrl = location.href;
            expect(mediaKeyOf(location.href)).toBe(key);
            expect(oldRow?.isCurrent()).toBe(false);
            const previousSession = reader.session;
            refresh();
            await vi.waitFor(() => expect(reader.session?.source.url).toBe(previousUrl + '#/lessons/next'));
            expect(reader.session).not.toBe(previousSession);
            expect(reader.session?.source.language).toBe('en');
            expect(reader.session?.offsetMs).toBe(0);
            expect(reader.resumeMs).toBe(-1);
            expect(video.currentTime).toBe(0);

            const nextSource = {mediaKey: key, url: sourceUrl};
            await writeVideoState(firstSource, {resumeMs: 999000}); // Late event from the old lesson must not enter either course.
            expect(await readVideoState(firstSource)).toBeNull();
            expect((await readVideoState(nextSource))?.resumeMs).toBeUndefined();
            reader.setOffset(-750);
            await secondTab.writeVideoState(nextSource, {resumeMs: 62000});
            reader.loadCaptions();
            await vi.waitFor(() => expect(reader.resumeMs).toBe(62000));
            expect(reader.session?.source.language).toBe('en');
            expect(reader.session?.offsetMs).toBe(-750);
            expect(video.currentTime).toBe(0);
            expect(store.studyVideoState).toMatchObject({
                [key]: legacy,
                [firstStorageKey]: {offsetMs: 500, resumeMs: 120000},
                [persistedScope(nextSource.url)]: {offsetMs: -750, resumeMs: 62000, selectedTrackKey: 'track:0'},
            });
            expect(Object.keys(/** @type {object} */ (store.studyVideoState))).not.toContain(nextSource.url);
        } finally {
            history.replaceState(null, '', previousUrl);
            sourceUrl = location.href;
        }
    } finally {
        vi.unstubAllGlobals();
    }
});
