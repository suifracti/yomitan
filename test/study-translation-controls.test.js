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

import {readFileSync} from 'node:fs';
import {expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';
import {prepareStudyService} from '../ext/js/study/study-service.js';
import {studyCall} from '../ext/js/study/study-client.js';
import {prepareSubtitleSettings} from '../ext/js/pages/subtitle-settings.js';
import {translationEngineSelect} from '../ext/js/study/youtube-overlay.js';
import {writeSubtitlePrefs} from '../ext/js/study/subtitle-prefs.js';

test('opens settings through the background and keeps video and settings engine controls in sync', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {html: readFileSync(new URL('../ext/settings.html', import.meta.url), 'utf8'), url: 'https://www.youtube.com/watch?v=abcdefghijk'}});
    const stored = {studyTranslationPrefs: {engine: 'chrome', autoTranslate: false}};
    const listeners = [];
    let receive;
    const create = vi.fn(async () => ({}));
    const runtime = {id: 'test', getURL: (p) => `chrome-extension://test/${p}`, onMessage: {addListener(fn) { receive = fn; }},
        sendMessage: (message) => new Promise((resolve) => receive(message, {id: 'test', url: location.href, frameId: 0}, resolve))};
    vi.stubGlobal('chrome', {runtime, tabs: {create}, storage: {onChanged: {addListener: (fn) => listeners.push(fn), removeListener() {}}, local: {
        get: async () => ({...stored}), set: async (value) => {
            Object.assign(stored, value);
            for (const fn of listeners) { fn(Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, {newValue}])), 'local'); }
        },
    }}});
    try {
        prepareStudyService();
        await studyCall('openStudySettings', {section: 'ai'});
        expect(create).toHaveBeenCalledWith({url: 'chrome-extension://test/settings.html#ai'});
        await prepareSubtitleSettings(document);
        const picker = translationEngineSelect((engine) => { void writeSubtitlePrefs({engine}); });
        document.body.append(picker);
        const select = picker.querySelector('select'); select.value = 'model'; select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(document.querySelector('[data-translation-model]').hidden).toBe(false));
        expect(document.querySelector('select[name=subtitle-engine]').value).toBe('model');
        expect(document.querySelectorAll('select[name=subtitle-engine]').length).toBe(1);
        expect(document.querySelectorAll('input[name=subtitle-engine]').length).toBe(0);
        expect(stored.studyTranslationPrefs.engine).toBe('model');
    } finally { vi.unstubAllGlobals(); await env.teardown(global); }
});
