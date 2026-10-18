/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
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
// @vitest-environment jsdom

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, test} from 'vitest';

describe('action popup navigation', () => {
    test('renders labeled lookup, library, and settings actions without removing the existing controls', () => {
        const html = readFileSync(resolve(process.cwd(), 'ext/action-popup.html'), 'utf8');
        document.body.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);

        expect(document.querySelector('.action-open-search')?.textContent).toContain('查词');
        expect(document.querySelector('.action-open-study-library')?.textContent).toContain('学习库');
        expect(document.querySelector('.action-open-settings')?.textContent).toContain('设置');
        expect(document.querySelector('.enable-search')).not.toBeNull();
        expect(document.querySelector('.profile-select')).not.toBeNull();
        expect(document.querySelector('.action-open-info')?.textContent).toContain('帮助');
        expect([...document.querySelectorAll('.action-buttons .action-label')].slice(0, 3).map((node) => node.textContent)).toEqual(['查词', '学习库', '设置']);
    });

    test('honors explicit light and dark theme attributes, with OS dark as fallback', () => {
        const css = readFileSync(resolve(process.cwd(), 'ext/css/study-library.css'), 'utf8');
        expect(css).toContain(":root[data-theme='light']");
        expect(css).toContain(":root[data-theme='dark']");
        expect(css).toContain(':root:not([data-theme])');
    });

    test('uses the shared library and settings navigation on the library page', () => {
        const html = readFileSync(resolve(process.cwd(), 'ext/study-library.html'), 'utf8');
        document.body.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
        const links = [...document.querySelectorAll('.study-library-nav a')];

        expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
            ['查词', '/search.html'],
            ['学习库', '/study-library.html'],
            ['设置', '/settings.html#save'],
        ]);
        expect(links.find((link) => link.getAttribute('href') === '/study-library.html')?.getAttribute('aria-current')).toBe('page');
    });
});
