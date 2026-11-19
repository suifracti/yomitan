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
/**
 * Align matching words in order so one omission does not mark the rest of the sentence.
 * @param {string} written
 * @param {string} original
 * @returns {{written: {start: number, end: number}[], original: {start: number, end: number}[]}}
 */
export function differingWords(written, original) {
    const words = (/** @type {string} */ text) => Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu), (hit) => {
        const [word] = hit;
        const start = hit.index;
        return {start, end: start + word.length, key: word.normalize('NFC').toLowerCase().replaceAll('’', "'")};
    });
    const left = words(written);
    const right = words(original);
    const result = {written: /** @type {{start: number, end: number}[]} */ ([]), original: /** @type {{start: number, end: number}[]} */ ([])};
    if (left.length === right.length && left.every(({key}, i) => key === right[i].key)) { return result; }
    const shared = Array.from({length: left.length + 1}, () => new Uint16Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; --i) {
        for (let j = right.length - 1; j >= 0; --j) {
            shared[i][j] = left[i].key === right[j].key ? 1 + shared[i + 1][j + 1] : Math.max(shared[i + 1][j], shared[i][j + 1]);
        }
    }
    for (let i = 0, j = 0; i < left.length || j < right.length;) {
        if (i < left.length && j < right.length && left[i].key === right[j].key) {
            ++i;
            ++j;
        } else if (j === right.length || (i < left.length && shared[i + 1][j] >= shared[i][j + 1])) {
            result.written.push(left[i++]);
        } else {
            result.original.push(right[j++]);
        }
    }
    return result;
}

/**
 * @param {HTMLElement} line
 * @param {string} text
 * @param {{start: number, end: number}[]} offsets
 */
export function markDictation(line, text, offsets) {
    line.replaceChildren();
    let at = 0;
    for (const {start, end} of offsets) {
        line.append(text.slice(at, start), Object.assign(document.createElement('mark'), {textContent: text.slice(start, end)}));
        at = end;
    }
    line.append(text.slice(at));
}
