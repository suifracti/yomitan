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

const environment = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: '<!DOCTYPE html><div id="list"></div>'}});
afterAll(() => environment.teardown(global));

/** @type {((entries: {isIntersecting: boolean, target: Element}[]) => void)[]} */
const callbacks = [];
vi.stubGlobal('IntersectionObserver', class {
    /** @param {(entries: {isIntersecting: boolean, target: Element}[]) => void} callback */
    constructor(callback) { callbacks.push(callback); }
    /** */
    observe() {}
    /** */
    unobserve() {}
    /** */
    disconnect() {}
});

const {CaptionList} = await import('../ext/js/study/caption-sidebar.js');

test('long lists build rows only near the view or when a row is needed', () => {
    const list = /** @type {HTMLElement} */ (document.querySelector('#list'));
    /** @type {string[]} */
    const painted = [];
    const captions = new CaptionList((/** @type {{id: string}} */ item) => Object.assign(document.createElement('div'), {className: 'r-cue', textContent: item.id}), (id) => painted.push(id));
    const items = Array.from({length: 400}, (_, i) => ({id: `c${i}`}));
    captions.render(list, items);
    expect(list.querySelectorAll('.r-chunk')).toHaveLength(8);
    expect(list.querySelectorAll('.r-cue')).toHaveLength(0);

    // Scrolling near the first chunk builds just that chunk.
    callbacks.at(-1)?.([{isIntersecting: true, target: /** @type {Element} */ (list.firstElementChild)}]);
    expect(list.querySelectorAll('.r-cue')).toHaveLength(50);

    // Asking for a far row builds its chunk, in order, with states painted.
    const row = captions.ensure('c321');
    expect(row?.textContent).toBe('c321');
    expect(list.querySelectorAll('.r-cue')).toHaveLength(100);
    expect([...list.querySelectorAll('.r-chunk')][6].querySelector('.r-cue')?.textContent).toBe('c300');
    expect(painted).toContain('c321');
    expect(captions.ensure('missing')).toBeUndefined();

    // Short lists render at once.
    captions.render(list, items.slice(0, 20));
    expect(list.querySelectorAll('.r-cue')).toHaveLength(20);
    expect(captions.rows.size).toBe(20);
});
