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
import {splitStudySentence} from '../ext/js/display/study-translation.js';

test('keeps the white stripe sentence together instead of splitting at and', () => {
    const sentence = 'You have that white stripe running all the way down the middle of your back and you can keep moving forward and I know you can do it.';
    expect(sentence.split(' ').length).toBeGreaterThan(25);
    expect(splitStudySentence(sentence)).toEqual([]);
});
