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
const {mediaKeyOf, timedUrl} = await import('../ext/js/study/media-key.js');

test('media keys and time links match the bridge rules', () => {
    expect(mediaKeyOf('https://youtu.be/abcdefghijk?t=3')).toBe('youtube:abcdefghijk');
    expect(mediaKeyOf('https://www.youtube.com/shorts/abcdefghijk')).toBe('youtube:abcdefghijk');
    expect(mediaKeyOf('https://www.bilibili.com/video/BV1xx411c7mD/?p=2&spm=abc')).toBe('web:www.bilibili.com/video/BV1xx411c7mD?p=2');
    expect(mediaKeyOf('https://course.example.org/watch?id=7&utm=x#a')).toBe('web:course.example.org/watch?id=7');
    expect(mediaKeyOf('file:///x.mp4')).toBe('');
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
    const store = {studyVideoState: {'web:course.example.org/watch?id=7': {resumeMs: 95000, at: 1}}};
    vi.stubGlobal('chrome', {storage: {
        local: {
            get: async (/** @type {string} */ key) => ({[key]: store[key]}),
            set: async (/** @type {Record<string, unknown>} */ values) => { Object.assign(store, values); },
        },
        onChanged: {addListener() {}, removeListener() {}},
    }});
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
        expect(document.querySelector('#study-yt-reader output[data-offset]')?.textContent).toBe('+1.2 秒');
        await vi.waitFor(() => expect(store.studyVideoState).toMatchObject({'web:course.example.org/watch?id=7': {offsetMs: 1200, trackKey: 'track:0'}}));

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
