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

// Exercise the reader load path directly without mounting the video UI.
/* eslint-disable no-underscore-dangle */

import {expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';

test('selects captured tracks before English fallback and finally refetch', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    vi.stubGlobal('chrome', {storage: {local: {get: async () => ({})}}});
    const fetcher = vi.fn(async () => ({ok: true, status: 200, text: async () => body}));
    vi.stubGlobal('fetch', fetcher);
    const body = JSON.stringify({events: [{tStartMs: 12645, dDurationMs: 1000, segs: [{utf8: 'So in college,'}]}]});
    try {
        const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
        const reader = new YoutubeReader({prefs: {merge: false, aiSegment: false}, call: async () => []});
        reader._videoId = 'abcdefghijk';
        reader._view = {load: document.createElement('button'), root: document.createElement('div')};
        const english = new URL('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&kind=asr');
        const french = new URL(english); french.searchParams.set('lang', 'fr');
        reader._capturedCaptions.set('en|asr|', {url: english, body});
        reader._capturedCaptions.set('fr|asr|', {url: french, body: body.replace('So in college,', 'À l’université,')});
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

/* eslint-enable no-underscore-dangle */
