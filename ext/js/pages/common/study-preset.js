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

/* Personal study defaults for fresh installs only. Existing saved profiles are never rewritten. */
/**
 * @param {import('settings').Options} options
 * @returns {import('settings').Options}
 */
export function applyStudyPreset(options) {
    for (const profile of options.profiles) {
        profile.name = '英语学习';
        const {general, scanning, translation, anki} = profile.options;
        general.language = 'en';
        scanning.scanResolution = 'word';
        translation.searchResolution = 'word';
        anki.enable = true;
        anki.server = 'http://127.0.0.1:8766';
        anki.tags = ['english-context'];
        anki.cardFormats = [{
            name: '英语语境',
            icon: 'big-circle',
            type: 'term',
            deck: '外语::英语语境',
            model: '外语语境卡',
            fields: Object.fromEntries(Object.entries({
                Word: '{expression}',
                Sentence: '{sentence}',
                Definition: '{glossary}',
                Source: '{document-title}',
                URL: '{url}',
                Audio: '{audio}',
                Image: '{screenshot}',
            }).map(([name, value]) => [name, {value, overwriteMode: 'coalesce'}])),
        }];
    }
    return options;
}
