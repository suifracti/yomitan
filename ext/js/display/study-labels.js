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
/** @type {Record<string, string>} */
const partOfSpeech = {a: '形容词', adj: '形容词', adv: '副词', n: '名词', v: '动词', vt: '及物动词', vi: '不及物动词', prep: '介词', pron: '代词', conj: '连词', interj: '感叹词'};
/** @type {Record<string, string>} */
const forms = {复数: 'pl.', 第三人称: '3sg.', 过去式: 'past.', 过去分词: 'p.p.', 现在分词: 'V-ing', 比较级: 'comp.', 最高级: 'superl.'};

/**
 * @param {string} tag
 * @returns {string}
 */
export function studyPartOfSpeech(tag) {
    return partOfSpeech[tag.replace(/\.$/, '').toLowerCase()] ?? '';
}

/**
 * @param {string} name
 * @returns {string}
 */
export function studyFormLabel(name) {
    return forms[name] ? `${forms[name]} ${name}` : name;
}
