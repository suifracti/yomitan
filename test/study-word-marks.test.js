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

import {expect, test} from 'vitest';
import {siteExcluded, statusFor} from '../ext/js/study/word-marks.js';

const words = {brick: 'learning', run: 'known', study: 'learning', improve: 'learning'};

test('inflected forms map to the saved word', () => {
    expect(statusFor('Bricks', words)).toBe('learning');
    expect(statusFor('running', words)).toBe('known');
    expect(statusFor('studied', words)).toBe('learning');
    expect(statusFor('improving', words)).toBe('learning');
    expect(statusFor('brick’s', words)).toBe('learning');
    expect(statusFor('bring', words)).toBe('');
    expect(statusFor('constructor', words)).toBe('');
});

test('excluded sites cover their subdomains only', () => {
    expect(siteExcluded('mail.google.com', ['mail.google.com'])).toBe(true);
    expect(siteExcluded('a.example.com', ['*.example.com'])).toBe(true);
    expect(siteExcluded('notexample.com', ['example.com'])).toBe(false);
    expect(siteExcluded('example.com', [' '])).toBe(false);
});
