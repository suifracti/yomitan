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

/**
 * @param {string} path
 * @returns {Document}
 */
function parsePage(path) {
    return new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), path), 'utf8'), 'text/html');
}

describe('action popup navigation', () => {
    test('renders the translation, learning and footer entries', () => {
        const page = parsePage('ext/action-popup.html');

        expect(page.querySelector('#page-toggle')?.textContent).toContain('翻译本页');
        expect(page.querySelector('#action-page-words')).not.toBeNull();
        expect(page.querySelector('.enable-search')).not.toBeNull();
        expect(page.querySelector('#page-marks')).not.toBeNull();
        expect(page.querySelector('#page-video')).not.toBeNull();
        expect([...page.querySelectorAll('footer a')].map((link) => [link.textContent.trim(), link.getAttribute('href')])).toEqual([
            ['学习库', '/study-library.html'],
            ['设置', '/settings.html'],
            ['帮助', '/info.html'],
        ]);
    });

    test('defaults to the light theme, honors a dark attribute, and follows OS dark', () => {
        const css = readFileSync(resolve(process.cwd(), 'ext/css/study-library.css'), 'utf8');
        expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/);
        expect(css).toContain(":root[data-theme='dark']");
        expect(css).toContain('@media (prefers-color-scheme: dark)');
        expect(css).toContain(':root:not([data-theme])');
    });

    test('links the library and settings pages from each other\'s header', () => {
        const libraryLink = parsePage('ext/study-library.html').querySelector('header .study-page-link');
        expect([libraryLink?.textContent, libraryLink?.getAttribute('href')]).toEqual(['设置 ↗', '/settings.html#save']);

        const settingsLink = parsePage('ext/settings.html').querySelector('header.settings-page-title a');
        expect([settingsLink?.textContent, settingsLink?.getAttribute('href')]).toEqual(['学习库 ↗', '/study-library.html']);
    });
});
