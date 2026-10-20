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

test('v2 status objects, old strings, encounter counts and site tags', async () => {
    const {addEncounters, normalizeInfo, recentEncounters, siteTag, wordInfo} = await import('../ext/js/study/word-marks.js');
    expect(normalizeInfo('learning')).toEqual({s: 'learning'});
    expect(normalizeInfo({s: 'partial', gloss: '跑；经营'.repeat(10)})?.gloss).toHaveLength(40);
    expect(normalizeInfo({gloss: 'x'})).toBe(null);
    const v2 = {run: {s: 'partial', gloss: '跑'}, brick: 'learning'};
    expect(wordInfo('running', v2)).toMatchObject({s: 'partial', gloss: '跑', word: 'run'});
    expect(statusFor('Bricks', v2)).toBe('learning');

    const monday = new Date(2026, 9, 19, 10);
    let all = addEncounters({}, ['brick', 'run'], siteTag('a.example'), monday);
    all = addEncounters(all, ['brick'], siteTag('b.example'), monday);
    all = addEncounters(all, ['brick'], siteTag('a.example'), new Date(2026, 9, 20, 9));
    expect(recentEncounters(all, 'Brick', 7, new Date(2026, 9, 20, 12))).toEqual({times: 3, sites: 2});
    // Older than 30 days is dropped on the next write; outside 7 days is not counted.
    all = addEncounters(all, ['run'], siteTag('a.example'), new Date(2026, 10, 25));
    expect(all.brick).toBeUndefined();
    expect(recentEncounters(all, 'run', 7, new Date(2026, 10, 25))).toEqual({times: 1, sites: 1});
    expect(siteTag('a.example')).toMatch(/^[0-9a-z]+$/);
    expect(JSON.stringify(all)).not.toContain('example');
});

test('a phrase guess takes the word and the one after it', async () => {
    const {guessPhrase} = await import('../ext/js/display/study-stuck.js');
    expect(guessPhrase('I ran into an old friend.', 'ran')).toBe('ran into');
    expect(guessPhrase('Just run.', 'run')).toBe('run');
    expect(guessPhrase('Nothing here.', 'run')).toBe('run');
});
