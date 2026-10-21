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

import {expect,test,vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';

test('lists all tracks, defaults to English, remembers another language and skips Chinese translation',async()=>{
 const env=await builtinEnvironments.jsdom.setup(global,{jsdom:{html:'<div id="secondary-inner"></div>',url:'https://www.youtube.com/watch?v=abcdefghijk'}});
    /** @type {URL[]} */
    const requests = [];
    /** @type {Record<string, unknown>} */
    const stored = {};
    vi.stubGlobal('chrome', {storage: {local: {get: async () => stored, set: async (/** @type {Record<string, unknown>} */ v) => Object.assign(stored, v)}, onChanged: {addListener() {}}}, runtime: {getURL: (/** @type {string} */ p) => '/' + p}});
    vi.stubGlobal('fetch', async (/** @type {string} */ url) => {
        const request = new URL(url);
        requests.push(request);
        return {ok: true, text: async () => JSON.stringify({events: [{tStartMs: 0, dDurationMs: 3000, segs: [{utf8: request.searchParams.get('lang') === 'en' ? 'An English sentence.' : 'Une phrase française.'}]}]})};
    });
 const tracks=['fr','zh','en'].map(languageCode=>({vssId:'.'+languageCode,languageCode,name:{simpleText:languageCode},baseUrl:`https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=${languageCode}`}));
 const call=vi.fn(async action=>action==='youtubeCaptionTracks'?tracks:({items:[]}));
 const {YoutubeReader}=await import('../ext/js/study/youtube-reader.js'); const reader=new YoutubeReader({prefs:{merge:false},call});
 try {
    reader._seen.push('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&pot=player-proof&signature=player-signature');
  reader._mediaKey='youtube:abcdefghijk';reader._videoId='abcdefghijk';await reader._mount(0);await vi.waitFor(()=>expect(reader.session?.source.language).toBe('en'));
  expect(reader.session.source.language).toBe('en');expect(reader._sources.length).toBe(3);
  await reader._load(0,reader._sources[0].id);expect(reader.session.source.language).toBe('fr');
    expect(requests[0].searchParams.get('pot')).toBe('player-proof');
    expect(requests[1].searchParams.get('pot')).toBe('player-proof');
    expect(requests[1].searchParams.get('signature')).toBe('player-signature');
  expect(document.querySelector('.r-text').classList.contains('scan-disable')).toBe(true);
  await reader._load(0);expect(reader.session.source.language).toBe('fr');
  await reader._load(0,reader._sources[1].id);const before=call.mock.calls.length;await reader._translate(false,true);expect(call.mock.calls.length).toBe(before);expect(reader._view.translate.hidden).toBe(true);
 } finally {reader._reset();vi.unstubAllGlobals();await env.teardown(global);}
});
