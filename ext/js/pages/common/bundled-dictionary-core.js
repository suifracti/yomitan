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

export const bundledDictionaryTitle = 'ECDICT 英语学习词典';

/**
 * @param {{getInfo: () => Promise<import('dictionary-importer').Summary[]>, importArchive: () => Promise<import('dictionary-importer').ImportResult>, enable: (summary: import('dictionary-importer').Summary) => Promise<void>}} services
 * @returns {Promise<'exists'|'imported'>}
 */
export async function initializeBundledDictionary({getInfo, importArchive, enable}) {
    const current = (await getInfo()).find(({title}) => title === bundledDictionaryTitle);
    if (current) {
        if (current.importSuccess === false) { throw new Error('词典上次导入未完成，请在词典管理中检查；不会自动删除现有数据。'); }
        await enable(current);
        return 'exists';
    }
    const {result, errors} = await importArchive();
    if (!result || result.importSuccess === false || errors.length > 0) {
        throw new Error('内置词典导入未完成，请保持页面打开，检查存储空间后重试。');
    }
    await enable(result);
    return 'imported';
}

/**
 * Non-destructive migration of our identified package only. Disabled predecessor stays disabled.
 * @param {import('settings').DictionaryOptions[]} previous
 * @param {import('dictionary-importer').Summary} summary
 * @param {import('dictionary-importer').Summary[]} installed
 * @returns {import('settings').DictionaryOptions[]}
 */
export function planStudyDictionary(previous, summary, installed) {
    if (previous.some(({name}) => name === summary.title)) { return previous; }
    const owned = installed.some(({title, revision}) => title === 'ECDICT 英汉词典' && revision === 'ECDICT-2026-10-07');
    const predecessor = owned ? previous.find(({name}) => name === 'ECDICT 英汉词典') : void 0;
    return [
        ...previous.map((d) => (d === predecessor ? {...d, enabled: false} : d)),
        {
            name: summary.title,
            alias: summary.title,
            enabled: predecessor?.enabled ?? true,
            allowSecondarySearches: false,
            definitionsCollapsible: 'not-collapsible',
            partsOfSpeechFilter: true,
            useDeinflections: true,
            styles: summary.styles ?? '',
        },
    ];
}
