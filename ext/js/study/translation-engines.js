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

// One list shared by every translation menu: the popup, the settings page, the
// caption menu and the sentence card. Google and Microsoft work online; Chrome's
// translator needs a language pack on first use.

// Menu copy and compact status text name the same service. Microsoft stays
// compatible with saved profiles without becoming a new default choice.
const ENGINES = /** @type {const} */ ([
    {value: 'google', label: 'Google 免费翻译（需要联网）', name: 'Google 翻译'},
    {value: 'chrome', label: 'Chrome 内置翻译（首次使用需要下载语言包）', name: 'Chrome 内置翻译'},
    {value: 'apple', label: 'Apple 翻译', name: 'Apple 翻译'},
    {value: 'model', label: 'AI 模型', name: '你的模型'},
    {value: 'microsoft', label: 'Microsoft 免费翻译（需要联网）', name: '微软翻译'},
]);

/** @typedef {typeof ENGINES[number]['value']} SubtitleEngine */

export const SUBTITLE_ENGINES = Object.freeze(ENGINES.map(({value}) => value));

export const ENGINE_LABELS = /** @type {Readonly<Record<SubtitleEngine, string>>} */ (Object.freeze(Object.fromEntries(ENGINES.map(({value, name}) => [value, name]))));

export const ENGINE_CHOICES = Object.freeze(ENGINES.filter(({value}) => value !== 'microsoft'));

/**
 * Rebuilds a select from the shared list and selects the saved service.
 * @param {HTMLSelectElement} select
 * @param {SubtitleEngine} current
 */
export function fillEngineSelect(select, current) {
    const choices = current === 'microsoft' ? ENGINES : ENGINE_CHOICES;
    select.replaceChildren(...choices.map(({value, label}) => Object.assign(document.createElement('option'), {value, textContent: label})));
    select.value = current;
    select.dispatchEvent(new Event('study-ui-sync'));
}
