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
import {explainWordForm, findFormExample} from '../ext/js/display/study-word-forms.js';

const senses = [{pos: 'n. 名词', text: '砖块, 积木'}, {pos: 'a. 形容词', text: '用砖做的'}];

test('plural explains the noun form and points at the noun sense', () => {
    const result = explainWordForm('复数', 'brick', senses);
    expect(result.kind).toBe('复数');
    expect(result.usage[0]).toContain('两个或更多');
    expect(result.sense).toEqual(senses[0]);
    expect(result.missing).toBe('');
});

test('a combined past label explains both roles', () => {
    const result = explainWordForm('过去式 / 过去分词', 'brick', senses);
    expect(result.kind).toBe('过去式 / 过去分词');
    expect(result.usage).toHaveLength(2);
});

test('a verb form without a listed verb sense says so instead of borrowing another sense', () => {
    const result = explainWordForm('现在分词', 'brick', senses);
    expect(result.sense).toBe(null);
    expect(result.missing).toContain('动词义');
});

test('English abbreviations and unknown labels are handled', () => {
    expect(explainWordForm('pl.', 'brick', senses).kind).toBe('复数');
    expect(explainWordForm('3sg.', 'brick', senses).kind).toBe('第三人称单数');
    expect(explainWordForm('古体', 'brick', senses).usage[0]).toContain('brick');
});

test('examples use the exact form and skip grammar lines', () => {
    const texts = ['brick (countable and uncountable, plural bricks)', 'A hardened block.', 'This wall is made of bricks.'];
    expect(findFormExample(texts, 'bricks')).toBe('This wall is made of bricks.');
    expect(findFormExample(['Bricklayers worked.'], 'brick')).toBe('');
});
