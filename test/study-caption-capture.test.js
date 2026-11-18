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

// Exercise caption loading and track changes with controlled player responses.
/* eslint-disable no-underscore-dangle */

import {expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';
import {installReaderStorage} from './mocks/study-reader-storage.js';

/**
 * @param {string} url
 * @param {string} body
 */
function capture(url, body) {
    window.dispatchEvent(new MessageEvent('message', {
        origin: location.origin,
        source: window,
        data: {type: 'yomitan-caption-response', url, body},
    }));
}

test('selects captured tracks before English fallback and finally refetch', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    installReaderStorage({get: async () => ({}), set: async () => {}});
    const fetcher = vi.fn(async () => ({ok: true, status: 200, text: async () => body}));
    vi.stubGlobal('fetch', fetcher);
    const body = JSON.stringify({events: [{tStartMs: 12645, dDurationMs: 1000, segs: [{utf8: 'So in college,'}]}]});
    try {
        const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
        const reader = new YoutubeReader({prefs: {enabled: false, merge: false, aiSegment: false}, call: async () => []});
        reader.start();
        reader._videoId = 'abcdefghijk';
        const english = new URL('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&kind=asr');
        const french = new URL(english); french.searchParams.set('lang', 'fr');
        capture(english.href, body);
        capture(french.href, body.replace('So in college,', 'À l’université,'));
        reader._view = {load: document.createElement('button'), root: document.createElement('div')};
        const find = vi.spyOn(reader, '_findCaptionUrl').mockImplementation(async () => new URL(french));
        vi.spyOn(reader, '_status').mockImplementation(() => {});
        vi.spyOn(reader, '_present').mockImplementation(() => {});
        vi.spyOn(reader, '_restoreVideoState').mockResolvedValue();
        await reader._load(0);
        expect(fetcher).not.toHaveBeenCalled();
        expect(reader._rawSession.cues[0].text).toBe('À l’université,');
        expect(reader._view.root.dataset).toMatchObject({captionSource: 'capture', captionTrack: 'fr|asr'});
        const arabic = new URL(english); arabic.searchParams.set('lang', 'ar');
        find.mockImplementation(async () => new URL(arabic));
        await reader._load(0);
        expect(fetcher).not.toHaveBeenCalled();
        expect(reader._rawSession.cues[0].text).toBe('So in college,');
        expect(reader._rawSession.source.language).toBe('en');
        expect(reader._view.root.dataset).toMatchObject({captionSource: 'capture', captionTrack: 'en|asr'});
        reader._capturedCaptions.clear();
        await reader._load(0);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(reader._view.root.dataset).toMatchObject({captionSource: 'refetch', captionTrack: 'ar|asr'});
    } finally {
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

test('does not publish an old video after its track preference finishes saving', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    /** @type {() => void} */
    let release = () => {};
    /** @type {() => void} */
    let saving = () => {};
    const gate = new Promise((resolve) => { release = () => resolve(void 0); });
    const started = new Promise((resolve) => { saving = () => resolve(void 0); });
    installReaderStorage({get: async () => ({}),
        set: async () => {
            saving();
            await gate;
        }});
    const url = new URL('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en');
    const body = JSON.stringify({events: [{tStartMs: 0, dDurationMs: 1000, segs: [{utf8: 'The old video sentence.'}]}]});
    vi.stubGlobal('fetch', async () => new Response(body));
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const reader = new YoutubeReader({prefs: {merge: false, aiSegment: false}, call: async () => [{baseUrl: url.href, languageCode: 'en', vssId: '.en'}]});
    reader._videoId = 'abcdefghijk';
    reader._view = {load: document.createElement('button'), root: document.createElement('div')};
    vi.spyOn(reader, '_findCaptionUrl').mockResolvedValue(url);
    vi.spyOn(reader, '_status').mockImplementation(() => {});
    const present = vi.spyOn(reader, '_present').mockImplementation(() => {});
    vi.spyOn(reader, '_restoreVideoState').mockResolvedValue();
    try {
        const loading = reader._load(0);
        await started;
        reader._reset();
        reader._videoId = 'zyxwvutsrqp';
        reader._view = {load: document.createElement('button'), root: document.createElement('div')};
        release();
        await loading;
        expect(reader._rawSession).toBeNull();
        expect(present).not.toHaveBeenCalled();
        expect(reader._view.root.dataset.captionSource).toBeUndefined();
    } finally {
        release();
        reader._reset();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

test('switching tracks during translation releases the new track and discards the old reply', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {url: 'https://www.youtube.com/watch?v=abcdefghijk',
        html: '<div id="movie_player"><video></video></div><div id="secondary-inner"></div>'}});
    installReaderStorage({get: async () => ({}), set: async () => {}});
    const urls = ['en', 'fr&name=French'].map((lang) => `https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=${lang}`);
    const fetcher = vi.fn(async (/** @type {string} */ url) => new Response(JSON.stringify({events: [
        {tStartMs: 0, dDurationMs: 1000, segs: [{utf8: new URL(url).searchParams.get('lang') === 'fr' ? 'Bonjour.' : 'Good morning.'}]},
    ]})));
    vi.stubGlobal('fetch', fetcher);
    /** @type {() => void} */
    let release = () => {};
    const oldReply = new Promise((resolve) => { release = () => resolve(void 0); });
    const languages = [];
    const cancelled = [];
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const reader = new YoutubeReader({
        prefs: {merge: false, engine: 'google', autoTranslate: false},
        call: async (action, data) => {
            if (action === 'youtubeCaptionTracks') {
                return urls.map((baseUrl, i) => ({baseUrl, languageCode: i ? 'fr' : 'en', vssId: i ? '.fr' : '.en'}));
            }
            if (action === 'subtitleSettings') { return {model: 'fixture', effort: 'low'}; }
            if (action === 'subtitleCancel') { cancelled.push(data.requestId); }
            if (action !== 'subtitleTranslate') { return []; }
            const {language, items, requestId} = /** @type {{language: string, items: {id: string}[], requestId: string}} */ (data);
            languages.push({language, requestId});
            if (language === 'en') { await oldReply; }
            return {items: items.map(({id}) => ({id, translation: language === 'fr' ? '你好。' : '早上好。'}))};
        },
    });
    try {
        reader.rememberRequest(urls[0]);
        reader.start();
        await vi.waitFor(() => expect(reader.session?.source.language).toBe('en'));
        capture(urls[0], JSON.stringify({events: [{tStartMs: 0, dDurationMs: 1000, segs: [{utf8: 'Good morning.'}]}]}));
        capture(urls[1].replace('name=French', 'name=French-alternate'), JSON.stringify({events: [
            {tStartMs: 0, dDurationMs: 1000, segs: [{utf8: 'La mauvaise piste.'}]},
        ]}));
        const button = /** @type {HTMLButtonElement} */ (document.querySelector('.r-translate'));
        const original = reader._translate(false, true);
        await vi.waitFor(() => expect(languages.map((x) => x.language)).toEqual(['en']));
        expect(button.disabled).toBe(true);
        const select = /** @type {HTMLSelectElement} */ (document.querySelector('select[data-source]'));
        select.value = select.options[1].value;
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(reader.session?.source.language).toBe('fr'));
        expect(reader.session?.cues[0].text).toBe('Bonjour.');
        expect(new URL(fetcher.mock.lastCall?.[0] ?? '').searchParams.get('name')).toBe('French');
        expect(document.querySelector('#study-yt-reader')?.getAttribute('data-caption-source')).toBe('refetch');
        expect(cancelled).toEqual([languages[0].requestId]);
        expect(button.disabled).toBe(false);
        button.click();
        await vi.waitFor(() => expect(document.querySelector('.r-translation')?.textContent).toBe('你好。'));
        release();
        await original;
        expect(languages.map((x) => x.language)).toEqual(['en', 'fr']);
        expect(document.querySelector('.r-translation')?.textContent).toBe('你好。');

        select.value = select.options[0].value;
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(reader.session?.source.language).toBe('en'));
        reader.updatePrefs({engine: 'model'});
        const pending = reader._translate(false, true);
        const consent = await vi.waitFor(() => {
            const approve = /** @type {HTMLButtonElement|null} */ (document.querySelector('.study-translation-confirm button'));
            expect(approve).not.toBeNull();
            return approve;
        });
        select.value = select.options[1].value;
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(reader.session?.source.language).toBe('fr'));
        expect(document.querySelector('.study-translation-confirm')).toBeNull();
        consent?.click();
        await pending;
        expect(languages.map((x) => x.language)).toEqual(['en', 'fr']);

        select.value = select.options[0].value;
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(reader.session?.source.language).toBe('en'));
        fetcher.mockResolvedValueOnce(new Response(''));
        select.value = select.options[1].value;
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(document.querySelector('.r-status')?.textContent).toContain('YouTube 没有返回字幕内容'));
        expect(reader.session?.source.language).toBe('en');
        expect(select.value).toBe(reader.session?.source.trackKey);
    } finally {
        release();
        reader._reset();
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});

/* eslint-enable no-underscore-dangle */
