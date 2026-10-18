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
const categoryHashes = new Map([
    ['lookup', 'lookup'],
    ['dictionaries', 'lookup'],
    ['scanning', 'lookup'],
    ['text-parsing', 'lookup'],
    ['ai', 'ai'],
    ['translation', 'ai'],
    ['save', 'save'],
    ['learning', 'save'],
    ['audio', 'audio'],
    ['interface', 'interface'],
    ['popup', 'interface'],
    ['appearance', 'interface'],
    ['result-display', 'interface'],
    ['popup-size', 'interface'],
    ['window', 'interface'],
    ['shortcuts', 'interface'],
    ['advanced', 'advanced'],
    ['anki', 'save'],
    ['profile', 'advanced'],
    ['general', 'advanced'],
    ['clipboard', 'advanced'],
    ['backup', 'advanced'],
    ['accessibility', 'advanced'],
    ['security', 'advanced'],
]);
/** @typedef {{update: () => string, dispose: () => void}} SettingsNavigationState */
/** @type {WeakMap<Document | Element, SettingsNavigationState>} */
const initializedRoots = new WeakMap();

/**
 * @param {string} [hash]
 * @returns {'lookup' | 'ai' | 'save' | 'audio' | 'interface' | 'advanced'}
 */
export function resolveSettingsCategory(hash = window.location.hash) {
    let key = hash.startsWith('#') ? hash.slice(1) : hash;
    try {
        key = decodeURIComponent(key);
    } catch { /* Keep the literal hash when it is malformed. */ }
    return /** @type {'lookup' | 'ai' | 'save' | 'audio' | 'interface' | 'advanced'} */ (categoryHashes.get(key) ?? 'lookup');
}

/**
 * Shows one unified settings category without rebuilding or moving its controls.
 * @param {Document | Element} root
 * @returns {SettingsNavigationState}
 */
export function prepareSettingsNavigation(root = document) {
    const previous = initializedRoots.get(root);
    if (previous) { return previous; }

    const panels = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-settings-category-panel]')]);
    const documentRoot = root.ownerDocument || document;
    const links = /** @type {HTMLAnchorElement[]} */ ([...documentRoot.querySelectorAll('[data-settings-category-link]')]);
    let activeCategory = null;
    const update = () => {
        const category = resolveSettingsCategory(window.location.hash);
        const categoryChanged = category !== activeCategory;
        activeCategory = category;
        for (const panel of panels) {
            panel.hidden = panel.dataset.settingsCategoryPanel !== category;
        }
        for (const link of links) {
            if (link.dataset.settingsCategoryLink === category) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        }
        if (root instanceof HTMLElement) { root.dataset.activeSettingsCategory = category; }
        if (category !== 'interface') { document.body.classList.remove('preview-sidebar-visible'); }

        const hashId = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
        if (categoryChanged && hashId === category) {
            const scrollContainer = root instanceof HTMLElement ? root.closest('.content') : document.querySelector('.content');
            if (scrollContainer instanceof HTMLElement) { scrollContainer.scrollTop = 0; }
        }
        if (hashId && hashId !== category && typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                const target = [...root.querySelectorAll('[id]')].find((element) => element.id === hashId);
                for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
                    if (parent instanceof HTMLDetailsElement) { parent.open = true; }
                }
                target?.scrollIntoView?.({block: 'start'});
            });
        }
        return category;
    };
    const onHashChange = () => { update(); };
    window.addEventListener('hashchange', onHashChange);
    update();

    const state = {
        update,
        dispose: () => { window.removeEventListener('hashchange', onHashChange); initializedRoots.delete(root); },
    };
    initializedRoots.set(root, state);
    return state;
}
