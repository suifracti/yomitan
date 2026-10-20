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

test('translates the full track forward then back, keeps progress on cancel, and confirms the model only once', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {url: 'https://www.youtube.com/watch?v=abcdefghijk', html: '<div id="movie_player"><video></video></div><div id="secondary-inner"></div>'}});
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const cues = Array.from({length: 20}, (_, i) => ({tStartMs: i * 1000, dDurationMs: 1000, segs: [{utf8: `Sentence number ${i}.`}]}));
    vi.stubGlobal('fetch', async () => ({ok: true, text: async () => JSON.stringify({events: cues})}));
    vi.stubGlobal('chrome', {runtime: {getURL: (p) => `chrome-extension://test/${p}`}});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const batches = [];
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const reader = new YoutubeReader({prefs: {merge: false, engine: 'model'}, call: async (action, data) => {
        if (action === 'subtitleSettings') { return {model: 'test-model', effort: 'low'}; }
        if (action === 'subtitleTranslate') {
            batches.push(data.items.map((item) => item.id));
            if (batches.length === 2) { await blocked; }
            return {items: data.items.map((item) => ({id: item.id, translation: `译文 ${item.id}`}))};
        }
        return true;
    }});
    try {
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en'); reader.start();
        await vi.waitFor(() => expect(reader.session?.cues.length).toBe(20));
        const session = reader.session;
        document.querySelector('video').currentTime = 10;
        const run = reader._translate(false, true);
        await vi.waitFor(() => expect(batches.length).toBe(2));
        reader._view.cancel.click(); release(); await run;
        expect(session.progress().translated).toBe(8);
        await reader._translate(false, true);
        expect(session.progress().translated).toBe(20);
        expect(batches[0]).toEqual(session.cues.slice(10, 18).map((c) => c.id));
        expect(batches.at(-1)).toEqual(session.cues.slice(6, 10).map((c) => c.id));
        expect(reader._view.progress.textContent).toBe('已翻译 20/20');
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm.mock.calls[0][0]).toContain('全文 20 句，大约消耗');
    } finally { release(); reader._reset(); vi.unstubAllGlobals(); await env.teardown(global); }
});
