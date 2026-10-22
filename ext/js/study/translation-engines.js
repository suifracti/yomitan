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

/** @typedef {import('./subtitle-prefs.js').SubtitleEngine} SubtitleEngine */

/** @type {ReadonlyArray<{value: SubtitleEngine, label: string}>} */
export const ENGINE_CHOICES = Object.freeze([
    Object.freeze({value: 'google', label: 'Google 免费翻译（需要联网）'}),
    Object.freeze({value: 'chrome', label: 'Chrome 内置翻译（首次使用需要下载语言包）'}),
    Object.freeze({value: 'apple', label: 'Apple 翻译'}),
    Object.freeze({value: 'model', label: 'AI 模型'}),
]);

/** An existing Microsoft choice stays visible instead of being shown as Chrome. */
const MICROSOFT_CHOICE = Object.freeze({value: 'microsoft', label: 'Microsoft 免费翻译（需要联网）'});

/**
 * Rebuilds a select from the shared list and selects the saved service.
 * @param {HTMLSelectElement} select
 * @param {SubtitleEngine} current
 */
export function fillEngineSelect(select, current) {
    const choices = current === 'microsoft' ? [...ENGINE_CHOICES, MICROSOFT_CHOICE] : ENGINE_CHOICES;
    select.replaceChildren(...choices.map(({value, label}) => Object.assign(document.createElement('option'), {value, textContent: label})));
    select.value = current;
    select.dispatchEvent(new Event('study-ui-sync'));
}
