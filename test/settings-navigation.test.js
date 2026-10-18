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
// @vitest-environment jsdom

import {afterEach, describe, expect, test, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {resolveSettingsCategory, prepareSettingsNavigation} from '../ext/js/pages/settings/settings-navigation.js';
import {prepareStudySettings} from '../ext/js/pages/study-settings-main.js';

const mocks = vi.hoisted(() => ({studyCall: vi.fn()}));
vi.mock('../ext/js/study/study-client.js', () => ({studyCall: mocks.studyCall}));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.body.replaceChildren();
    window.history.replaceState(null, '', '/');
});

/** @returns {HTMLElement} */
function makeNavigationRoot() {
    document.body.innerHTML = `
        <main id="settings-root">
            <nav class="settings-category-nav">
                <a href="#lookup" data-settings-category-link="lookup">查词与词典</a>
                <a href="#ai" data-settings-category-link="ai">AI 与翻译</a>
                <a href="#save" data-settings-category-link="save">保存与复习</a>
                <a href="#audio" data-settings-category-link="audio">发音</a>
                <a href="#interface" data-settings-category-link="interface">界面与快捷键</a>
                <a href="#advanced" data-settings-category-link="advanced">高级与维护</a>
            </nav>
            <section data-settings-category-panel="lookup"></section>
            <section data-settings-category-panel="ai"></section>
            <section data-settings-category-panel="save"><input id="library-directory" value="saved"></section>
            <section data-settings-category-panel="audio"></section>
            <section data-settings-category-panel="interface"></section>
            <section data-settings-category-panel="advanced"></section>
        </main>`;
    return document.querySelector('#settings-root');
}

/** @returns {HTMLElement} */
function makeStudySettingsRoot() {
    const root = document.createElement('main');
    root.innerHTML = `
        <p id="status"></p>
        <form id="settings-form">
            <select id="model"></select><select id="effort"></select>
            <input id="autoDictionaryTranslate" type="checkbox"><input id="cacheEnabled" type="checkbox">
            <button id="load-models" type="button"></button><button id="clear-cache" type="button"></button>
        </form>
        <section id="library-settings">
            <p id="library-status"></p><form id="library-settings-form"></form>
            <input id="library-vault"><input id="library-directory"><input id="library-anki-enabled" type="checkbox"><input id="library-model"><input id="library-new-deck"><label id="library-new-deck-label"></label>
            <select id="library-vault-options"></select><select id="library-directory-options"></select>
            <select id="library-deck"></select><button id="library-check" type="button"></button>
        </section>`;
    document.body.append(root);
    return root;
}

describe('unified settings navigation', () => {
    test('routes all six categories and legacy hashes to their matching category', () => {
        const cases = {
            '#lookup': 'lookup',
            '#ai': 'ai',
            '#save': 'save',
            '#audio': 'audio',
            '#interface': 'interface',
            '#advanced': 'advanced',
            '#learning': 'save',
            '#anki': 'save',
            '#dictionaries': 'lookup',
            '#scanning': 'lookup',
            '#text-parsing': 'lookup',
            '#translation': 'ai',
            '#appearance': 'interface',
            '#result-display': 'interface',
            '#popup-size': 'interface',
            '#popup': 'interface',
            '#window': 'interface',
            '#shortcuts': 'interface',
            '#profile': 'advanced',
            '#general': 'advanced',
            '#backup': 'advanced',
            '#clipboard': 'advanced',
            '#accessibility': 'advanced',
            '#security': 'advanced',
        };
        for (const [hash, category] of Object.entries(cases)) {
            expect(resolveSettingsCategory(hash), hash).toBe(category);
        }
    });

    test('shows exactly one category and keeps the same draft node while navigating', () => {
        const root = makeNavigationRoot();
        window.history.replaceState(null, '', '/settings.html#interface');
        prepareSettingsNavigation(root);
        const visible = () => [...root.querySelectorAll('[data-settings-category-panel]')].filter((panel) => !panel.hidden);
        expect(visible().map((panel) => panel.dataset.settingsCategoryPanel)).toEqual(['interface']);
        expect(root.ownerDocument.querySelector('[data-settings-category-link=interface]').getAttribute('aria-current')).toBe('page');

        const draft = root.querySelector('#library-directory');
        draft.value = 'English/notes-in-progress';
        window.history.replaceState(null, '', '/settings.html#ai');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        expect(visible().map((panel) => panel.dataset.settingsCategoryPanel)).toEqual(['ai']);
        expect(root.ownerDocument.querySelector('[data-settings-category-link=ai]').getAttribute('aria-current')).toBe('page');
        window.history.replaceState(null, '', '/settings.html#save');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        expect(visible().map((panel) => panel.dataset.settingsCategoryPanel)).toEqual(['save']);
        expect(root.querySelector('#library-directory')).toBe(draft);
        expect(draft.value).toBe('English/notes-in-progress');
    });

    test('initializes study settings once per root and keeps selectors scoped to that root', async () => {
        const outsideStatus = document.createElement('p');
        outsideStatus.id = 'status';
        outsideStatus.textContent = 'outside';
        document.body.append(outsideStatus);
        const root = makeStudySettingsRoot();
        vi.stubGlobal('chrome', {
            permissions: {contains: vi.fn().mockResolvedValue(false)},
            storage: {onChanged: {addListener: vi.fn()}},
        });
        mocks.studyCall.mockResolvedValue({model: 'gpt-test', effort: 'low', cacheEnabled: true, autoDictionaryTranslate: false});

        const first = prepareStudySettings(root);
        const second = prepareStudySettings(root);
        expect(second).toBe(first);
        await first;

        expect(mocks.studyCall.mock.calls.map(([action]) => action)).toEqual(['settings']);
        expect(root.querySelector('#status').textContent).toContain('本地设置已读取');
        expect(outsideStatus.textContent).toBe('outside');
    });

    test('canonical settings page has six panels and no learning-settings iframe', () => {
        const html = readFileSync(resolve(process.cwd(), 'ext/settings.html'), 'utf8');
        const page = new DOMParser().parseFromString(html, 'text/html');
        const panels = [...page.querySelectorAll('[data-settings-category-panel]')];
        expect(panels.map((panel) => panel.dataset.settingsCategoryPanel)).toEqual(['lookup', 'ai', 'save', 'audio', 'interface', 'advanced']);
        expect(page.querySelector('#study-settings-frame')).toBeNull();
        expect(page.querySelector('#library-settings-form')).not.toBeNull();
        expect(page.querySelector('details#legacy-anki-settings')?.open).toBe(false);
        expect(page.querySelector('[data-settings-category-panel=save] #anki')).not.toBeNull();
        expect(page.querySelector('[data-settings-category-panel=ai] #status')).not.toBeNull();
        expect(page.querySelector('[data-settings-category-panel=save] #status')).toBeNull();
        expect(page.querySelector('#library-save-state').textContent).toBe('尚未读取');
        expect(page.querySelector('.deck-routing-details').open).toBe(false);
        expect(page.querySelector('[data-settings-category-panel=advanced] #anki')).toBeNull();
        expect(page.querySelector('[data-settings-category-panel=advanced] #advanced-checkbox')?.dataset.setting).toBe('general.showAdvanced');
        expect(page.querySelector('[data-settings-category-panel=advanced] #debug-checkbox')?.dataset.setting).toBe('general.showDebug');
        expect(page.querySelector('#advanced-checkbox').closest('[data-settings-category-panel]')?.dataset.settingsCategoryPanel).toBe('advanced');
        expect(page.querySelector('[data-settings-category-panel=advanced] a[href="/info.html"]')).not.toBeNull();
        expect(page.querySelector('.sidebar-bottom')).toBeNull();
        expect(page.querySelector('#popup-preview-frame')).not.toBeNull();
        expect(page.querySelector('#open-popup-preview')).not.toBeNull();
    });
});
