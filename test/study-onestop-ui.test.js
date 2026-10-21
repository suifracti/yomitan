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

test('custom menus keep native bindings and the player uses three submenus', async () => {
    const env = await builtinEnvironments.jsdom.setup(global,{jsdom:{html:'<div id="movie_player"><video></video><div class="ytp-right-controls"></div></div>',url:'https://www.youtube.com/watch?v=abcdefghijk'}});
    vi.stubGlobal('ResizeObserver',class {observe() {} disconnect() {}});
    try {
        const {menuSelect,switchRow} = await import('../ext/js/study/study-ui.js');
        const select = document.createElement('select'); select.innerHTML = '<option value="a">甲</option><option value="b">乙</option>'; document.body.append(select);
        const changed = vi.fn(); select.addEventListener('change',changed); const menu = menuSelect(select);
        menu.querySelector('.su-current').click(); menu.querySelector('[data-value=b]').click(); expect(select.value).toBe('b'); expect(changed).toHaveBeenCalledOnce();
        select.value = 'a'; select.dispatchEvent(new Event('study-ui-sync')); expect(menu.querySelector('.su-value').textContent).toContain('甲');
        const input = document.createElement('input'); input.type='checkbox'; document.body.append(input); const toggle=switchRow(input); toggle.querySelector('button').click(); expect(input.checked).toBe(true);
        const {YoutubeOverlay} = await import('../ext/js/study/youtube-overlay.js');
        const reader = new EventTarget(); reader.updatePrefs=vi.fn(); reader.setOffset=vi.fn(); reader.offsetMs=0;
        const overlay=new YoutubeOverlay(reader); const panel=overlay._makePanel(); document.body.append(panel);
        expect(panel.querySelectorAll('.study-ui-select').length).toBe(3);
        const mode=panel.querySelector('[data-subtitle-mode]').parentElement; mode.querySelector('.su-current').click(); mode.querySelector('[data-value=blur]').click();
        expect(reader.updatePrefs).toHaveBeenCalledWith({overlay:true,bilingual:true,blur:true});
    } finally {vi.unstubAllGlobals(); await env.teardown(global);}
});
