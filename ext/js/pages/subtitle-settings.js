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

import {chromeTranslate, ENGINE_LABELS} from '../study/free-translators.js';
import {studyCall} from '../study/study-client.js';
import {onSubtitlePrefsChanged, readSubtitlePrefs, writeSubtitlePrefs} from '../study/subtitle-prefs.js';

const PROBE = 'The brain can change itself.';

/**
 * Video caption preferences: saved immediately, shared with the open video pages.
 * @param {ParentNode} root
 * @param {{call?: typeof studyCall}} [options]
 */
export async function prepareSubtitleSettings(root, {call = studyCall} = {}) {
    const section = root.querySelector('#subtitle-settings');
    if (!section) { return; }
    const state = /** @type {HTMLElement} */ (section.querySelector('#subtitle-settings-state'));
    const result = /** @type {HTMLElement} */ (section.querySelector('#subtitle-engine-result'));
    const ahead = /** @type {HTMLInputElement} */ (section.querySelector('#subtitle-ahead'));
    const test = /** @type {HTMLButtonElement} */ (section.querySelector('#subtitle-engine-test'));
    /** @param {import('../study/subtitle-prefs.js').SubtitlePrefs} prefs */
    const paint = (prefs) => {
        const engine = /** @type {HTMLSelectElement} */ (section.querySelector('select[name="subtitle-engine"]'));
        if (!['apple', 'model'].includes(prefs.engine)) { engine.options[0].value = prefs.engine; }
        engine.value = prefs.engine; engine.dispatchEvent(new Event('study-ui-sync'));
        const model = /** @type {HTMLElement} */ (section.querySelector('[data-translation-model]'));
        model.hidden = prefs.engine !== 'model';
        for (const box of section.querySelectorAll('input[data-subtitle-pref]')) {
            const key = /** @type {keyof import('../study/subtitle-prefs.js').SubtitlePrefs} */ (/** @type {HTMLInputElement} */ (box).dataset.subtitlePref);
            /** @type {HTMLInputElement} */ (box).checked = Boolean(prefs[key]);
        }
        ahead.value = String(prefs.aheadSeconds);
    };
    /** @param {Partial<import('../study/subtitle-prefs.js').SubtitlePrefs>} patch */
    const save = async (patch) => {
        try {
            paint(await writeSubtitlePrefs(patch));
            state.textContent = '已保存，已打开的视频页会立即使用。';
        } catch (error) {
            state.textContent = `没有保存：${error instanceof Error ? error.message : String(error)}`;
        }
    };
    paint(await readSubtitlePrefs());
    state.textContent = '改动会立即保存。';
    onSubtitlePrefsChanged(paint);
    section.addEventListener('change', (event) => {
        const target = /** @type {HTMLInputElement} */ (event.target);
        if (target.name === 'subtitle-engine') {
            result.textContent = '';
            void save({engine: /** @type {import('../study/subtitle-prefs.js').SubtitleEngine} */ (target.value)});
        } else if (target.dataset.subtitlePref) {
            void save({[target.dataset.subtitlePref]: target.checked});
        } else if (target === ahead) {
            void save({aheadSeconds: Number(ahead.value)});
        }
    });
    test.addEventListener('click', () => {
        void (async () => {
            const prefs = await readSubtitlePrefs();
            const label = ENGINE_LABELS[prefs.engine];
            test.disabled = true;
            result.textContent = `正在用${label}翻译一句测试文字…`;
            try {
                let translation = '';
                if (prefs.engine === 'chrome') {
                    translation = (await chromeTranslate([PROBE]))[0];
                } else {
                    const config = /** @type {import('study').StudyConfig} */ (await call('subtitleSettings'));
                    const reply = /** @type {{items?: {translation?: string}[]}} */ (await call('subtitleTranslate', {
                        requestId: `probe-${Date.now().toString(36)}`,
                        items: [{id: 'probe', text: PROBE}],
                        language: 'en',
                        config: {model: config.model, effort: config.effort},
                    }));
                    translation = reply.items?.[0]?.translation ?? '';
                }
                result.textContent = translation ? `${label}可用：${translation}` : `${label}没有返回译文。`;
            } catch (error) {
                result.textContent = `${label}暂不可用：${error instanceof Error ? error.message : String(error)}`;
            } finally {
                test.disabled = false;
            }
        })();
    });
}
