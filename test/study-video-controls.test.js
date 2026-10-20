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

test('keeps three video controls and three rare-setting groups, preserving old values inside the player', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<div id="movie_player"><video></video><div class="ytp-right-controls"></div></div><div id="secondary-inner"></div>', url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    const {YoutubeReader} = await import('../ext/js/study/youtube-reader.js');
    const {YoutubeOverlay} = await import('../ext/js/study/youtube-overlay.js');
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('chrome', {runtime: {getURL: (p) => `chrome-extension://test/${p}`}});
    vi.stubGlobal('fetch', async () => ({ok: true, text: async () => JSON.stringify({events: [{tStartMs: 0, dDurationMs: 3000, segs: [{utf8: 'A sentence to learn.'}]}]})}));
    const reader = new YoutubeReader({prefs: {overlay: true, bilingual: true, blur: true, shadow: true, shadowRepeats: 5, merge: false}});
    const overlay = new YoutubeOverlay(reader);
    try {
        const player = document.getElementById('movie_player');
        player.getBoundingClientRect = () => ({left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360});
        reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en'); overlay.start(); reader.start();
        await vi.waitFor(() => expect(reader.session?.cues.length).toBe(1));
        overlay._button.getBoundingClientRect = () => ({left: 560, top: 320, right: 608, bottom: 356, width: 48, height: 36});
        overlay._togglePanel(true);
        const panel = overlay._panel;
        expect(panel.querySelectorAll('.p-row').length).toBe(3);
        expect(panel.querySelector('[data-subtitle-mode=blur]').getAttribute('aria-pressed')).toBe('true');
        expect(panel.querySelector('[data-shadow-mode]').value).toBe('5');
        expect(panel.querySelectorAll('select[data-engine],input,[data-download],[data-action]').length).toBe(0);
        panel.querySelector('[data-subtitle-mode=original]').click();
        expect([reader.prefs.overlay, reader.prefs.bilingual, reader.prefs.blur]).toEqual([true, false, false]);
        const shadow = panel.querySelector('[data-shadow-mode]'); shadow.value = '3'; shadow.dispatchEvent(new Event('change'));
        expect(reader.prefs.shadowRepeats).toBe(3); expect(reader.prefs.shadow).toBe(true);
        const menu = reader._view.menu;
        expect([...menu.querySelectorAll('legend')].map((n) => n.textContent)).toEqual(['翻译', '字幕处理', '文件']);
        expect([...menu.querySelectorAll('[data-pref]')].map((n) => n.dataset.pref)).toEqual(['merge', 'aiSegment', 'resume']);
        expect(menu.querySelector('[data-offset], [data-repeats]')).toBeNull();
        expect(menu.querySelector('details summary').textContent).toBe('下载 ▾');
        expect(parseFloat(panel.style.left) + parseFloat(panel.style.width)).toBeLessThanOrEqual(640);
        expect(parseFloat(panel.style.bottom) + parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(360);
        Object.defineProperty(document, 'fullscreenElement', {configurable: true, value: player}); document.dispatchEvent(new Event('fullscreenchange'));
        expect(panel.querySelector('.p-note').hidden).toBe(true);
        expect(getComputedStyle(panel.querySelector('.p-note')).display).toBe('none');
    } finally { reader._reset(); clearInterval(overlay._timer); vi.unstubAllGlobals(); await env.teardown(global); }
});
