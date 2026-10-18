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
/** @typedef {{width: number, height: number, collapsed: boolean}} PaneSize */
/** @typedef {{main: PaneSize, dictionary: PaneSize, open: boolean, opened: boolean, queue: Promise<void>}} WorkspaceState */
/** @type {WeakMap<object, WorkspaceState>} */
const preferences = new WeakMap();

/**
 * A layout over the original controls, not another Display or learning session.
 * @param {import('./display.js').Display} display
 * @param {{shell: HTMLElement, dictionary: HTMLElement, tabs: HTMLElement, word: string}} options
 * @returns {{dispose: () => void}}
 */
export function prepareStudyWorkspace(display, {shell, dictionary, tabs, word}) {
    const root = document.documentElement;
    const toolbar = /** @type {HTMLElement | null} */ (document.querySelector('.study-toolbar'));
    const tabButtons = [...tabs.querySelectorAll('button')];
    const dictionaryButton = tabButtons[1];
    const originalTitle = toolbar?.querySelector('.study-toolbar-title');
    const titleText = originalTitle?.textContent ?? '';
    let state = preferences.get(display);
    if (!state) {
        const size = {width: window.innerWidth, height: window.innerHeight, collapsed: false};
        state = {main: {...size}, dictionary: {...size}, open: false, opened: false, queue: Promise.resolve()};
        preferences.set(display, state);
    }
    const sizes = state;
    let active = true;
    let pending = false;
    /** @type {{name: 'main' | 'dictionary', id: number, x: number, y: number, width: number, height: number} | null} */
    let drag = null;
    /** @type {(() => void)[]} */
    const cleanup = [];
    /**
     * @template {keyof HTMLElementTagNameMap} T
     * @param {T} tag
     * @param {string} className
     * @returns {HTMLElementTagNameMap[T]}
     */
    const make = (tag, className) => {
        const node = document.createElement(tag);
        node.className = className;
        return node;
    };
    /**
     * @param {string} text
     * @param {string} label
     * @returns {HTMLButtonElement}
     */
    const button = (text, label) => {
        const node = document.createElement('button');
        node.type = 'button'; node.className = 'sf-pane-button scan-disable';
        node.textContent = text; node.setAttribute('aria-label', label);
        return node;
    };
    /**
     * @param {HTMLElement | null} node
     * @param {HTMLElement} parent
     */
    const move = (node, parent) => {
        if (!node?.parentNode) { return; }
        const marker = document.createComment('study-workspace-home');
        node.before(marker); parent.append(node);
        cleanup.push(() => {
            if (marker.isConnected) { marker.before(node); }
            marker.remove();
        });
    };
    const workspace = make('div', 'sf-workspace');
    const main = make('section', 'sf-main-card');
    const companion = make('section', 'sf-dictionary-card');
    companion.setAttribute('aria-label', `${word} 详细词典`);
    const companionHead = make('header', 'sf-pane-heading');
    const companionTitle = make('strong', 'sf-pane-title');
    companionTitle.textContent = `${word} · 详细词典`;
    const foldDictionary = button('收起', '收起词典卡');
    const closeDictionary = button('×', '关闭词典卡');
    const foldMain = button('收起', '收起主卡');
    foldMain.classList.add('sf-main-fold');
    companionHead.append(companionTitle, foldDictionary, closeDictionary);
    companion.append(companionHead);
    workspace.append(main, companion);
    shell.before(workspace);
    move(toolbar, main);
    move(shell, main);
    move(dictionary, companion);
    const closeMain = toolbar?.querySelector('.study-close, #close-button');
    if (closeMain) {
        closeMain.before(foldMain);
    } else {
        toolbar?.append(foldMain);
    }
    const originalRole = dictionaryButton?.getAttribute('role');
    const originalButtonText = dictionaryButton?.textContent;
    if (dictionaryButton) {
        dictionaryButton.textContent = '详细词典 ↗';
        dictionaryButton.setAttribute('aria-label', '详细词典');
    }
    dictionaryButton?.setAttribute('role', 'button');
    dictionaryButton?.removeAttribute('aria-selected');
    root.dataset.studyWorkspace = 'true';

    const request = () => {
        if (!active || pending) { return; }
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            sizes.queue = sizes.queue.catch(() => {}).then(async () => {
                if (!active) { return; }
                const id = display.parentPopupId;
                if (id && typeof display.invokeParentFrame === 'function') {
                    try {
                        const before = await display.invokeParentFrame('popupFactoryGetFrameSize', {id});
                        if (!active || !before.valid) { return; }
                        const mainWidth = sizes.main.collapsed ? 180 : sizes.main.width;
                        const sideWidth = sizes.dictionary.collapsed ? 220 : sizes.dictionary.width;
                        const width = mainWidth + (sizes.open ? sideWidth + 12 : 0);
                        const height = Math.max(sizes.main.collapsed ? 36 : sizes.main.height, sizes.open ? (sizes.dictionary.collapsed ? 36 : sizes.dictionary.height) : 0);
                        await display.invokeParentFrame('popupFactorySetFrameSize', {id, width, height});
                        // The setter fits to the host viewport; true does not mean requested size fits.
                        if (active) { await display.invokeParentFrame('popupFactoryGetFrameSize', {id}); }
                    } catch { /* A standalone window or vanished parent still has an in-window reader. */ }
                }
                if (active) { layout(); }
            });
        });
    };
    /**
     * @param {HTMLButtonElement} node
     * @param {boolean} collapsed
     * @param {string} name
     */
    const setFoldLabel = (node, collapsed, name) => {
        node.textContent = collapsed ? '展开' : '收起';
        node.setAttribute('aria-label', `${collapsed ? '展开' : '收起'}${name}`);
        node.setAttribute('aria-expanded', String(!collapsed));
    };
    const layout = () => {
        if (!active) { return; }
        const width = window.innerWidth;
        const height = Math.max(36, window.innerHeight - Math.max(0, workspace.getBoundingClientRect().top));
        workspace.style.height = `${height}px`;
        const a = sizes.main.collapsed ? 180 : sizes.main.width;
        const b = sizes.dictionary.collapsed ? 220 : sizes.dictionary.width;
        const minimum = (sizes.main.collapsed ? 180 : 280) + (sizes.dictionary.collapsed ? 220 : 280) + 12;
        const overlay = sizes.open && width < minimum;
        workspace.dataset.layout = overlay ? 'overlay' : 'beside';
        workspace.classList.toggle('sf-companion-open', sizes.open);
        workspace.classList.toggle('sf-reader-expanded', overlay && !sizes.dictionary.collapsed);
        companion.hidden = !sizes.open;
        dictionary.hidden = !sizes.open || sizes.dictionary.collapsed;
        main.classList.toggle('sf-pane-collapsed', sizes.main.collapsed);
        companion.classList.toggle('sf-pane-collapsed', sizes.dictionary.collapsed);
        setFoldLabel(foldMain, sizes.main.collapsed, '主卡');
        setFoldLabel(foldDictionary, sizes.dictionary.collapsed, '词典卡');
        if (originalTitle) { originalTitle.textContent = sizes.main.collapsed ? word : titleText; }
        dictionaryButton?.setAttribute('aria-expanded', String(sizes.open && !sizes.dictionary.collapsed));
        dictionaryButton?.removeAttribute('aria-selected');
        if (dictionaryButton) { dictionaryButton.tabIndex = 0; }
        const mainWidth = sizes.open && !overlay ? Math.max(sizes.main.collapsed ? 180 : 280, Math.min((width - 12) * a / (a + b), width - 12 - (sizes.dictionary.collapsed ? 220 : 280))) : width;
        const sideWidth = overlay ? width : Math.max(0, width - mainWidth - 12);
        workspace.style.gridTemplateColumns = sizes.open && !overlay ? `${mainWidth}px ${sideWidth}px` : 'minmax(0,1fr)';
        main.style.height = `${sizes.main.collapsed ? 36 : Math.min(sizes.main.height, Math.max(0, height - (overlay && sizes.dictionary.collapsed ? 48 : 0)))}px`;
        companion.style.height = `${sizes.dictionary.collapsed ? 36 : Math.min(sizes.dictionary.height, height)}px`;
        // A clipped host is a full-width reader, not two unusably narrow columns.
        if (overlay && !sizes.dictionary.collapsed) { companion.style.height = `${height}px`; }
        companion.style.width = !overlay && sizes.open && a + b + 12 < width ? `${Math.min(b, sideWidth)}px` : '';
    };
    const open = () => {
        if (!sizes.opened) {
            sizes.main.height = Math.max(500, sizes.main.height);
            sizes.dictionary.height = sizes.main.height;
            sizes.dictionary.width = sizes.main.width;
            sizes.opened = true;
        }
        // The original dictionary lives alongside whichever main page is active.
        sizes.open = true; sizes.dictionary.collapsed = false;
        layout(); request();
    };
    /** @param {MouseEvent} event */
    const onClick = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('.sf-forms-preview') || target?.closest('button') === dictionaryButton) {
            event.preventDefault(); event.stopImmediatePropagation();
            open();
        }
    };
    /** @param {KeyboardEvent} event */
    const onTabsKey = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.target === dictionaryButton) { return; }
        event.preventDefault(); event.stopImmediatePropagation();
        let next = event.target === tabButtons[0] ? 2 : 0;
        if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = 2;
        }
        tabButtons[next]?.click(); tabButtons[next]?.focus();
    };
    const onMainTab = () => { queueMicrotask(layout); };
    /** @param {KeyboardEvent} event */
    const onEscape = (event) => {
        if (event.key !== 'Escape' || !sizes.open || sizes.dictionary.collapsed) { return; }
        // Let the original menu/mini-card handle its own Escape first.
        if ([...document.querySelectorAll('.popup-menu, .study-mini')].some((node) => node.getClientRects().length)) { return; }
        event.preventDefault(); event.stopImmediatePropagation();
        sizes.dictionary.collapsed = true;
        layout(); request();
    };
    foldMain.onclick = () => {
        sizes.main.collapsed = !sizes.main.collapsed;
        layout(); request();
    };
    foldDictionary.onclick = () => {
        sizes.dictionary.collapsed = !sizes.dictionary.collapsed;
        layout(); request();
    };
    closeDictionary.onclick = () => {
        sizes.open = false;
        layout(); request();
    };
    workspace.addEventListener('click', onClick, true);
    tabs.addEventListener('keydown', onTabsKey, true);
    tabs.addEventListener('click', onMainTab);
    window.addEventListener('keydown', onEscape, true);
    window.addEventListener('resize', layout);

    /** @param {PointerEvent} event */
    const onMove = (event) => {
        if (!drag || event.pointerId !== drag.id) { return; }
        const size = sizes[drag.name];
        size.width = Math.max(280, Math.min(1100, drag.width + event.screenX - drag.x));
        size.height = Math.max(240, Math.min(1200, drag.height + event.screenY - drag.y));
        layout(); request();
    };
    const onUp = () => { drag = null; };
    /** @type {['main' | 'dictionary', HTMLElement, string][]} */
    const panes = [['main', main, '主卡'], ['dictionary', companion, '词典卡']];
    for (const [name, pane, label] of panes) {
        const handle = button('◢', `调整${label}大小`);
        handle.classList.add('sf-pane-resize'); handle.title = '拖动调整大小';
        pane.append(handle);
        handle.onpointerdown = (event) => {
            if (event.button !== 0) { return; }
            event.preventDefault();
            const rect = pane.getBoundingClientRect();
            drag = {name, id: event.pointerId, x: event.screenX, y: event.screenY, width: rect.width, height: rect.height};
            handle.setPointerCapture(event.pointerId);
        };
        handle.onpointermove = onMove;
        handle.onpointerup = onUp;
        handle.onpointercancel = onUp;
    }
    const chromeObserver = new MutationObserver(layout);
    chromeObserver.observe(root, {attributes: true, attributeFilter: ['class']});
    layout();
    if (sizes.open || sizes.main.collapsed || Math.abs(sizes.main.width - window.innerWidth) > 1 || Math.abs(sizes.main.height - window.innerHeight) > 1) { request(); }
    return {
        dispose: () => {
            active = false; drag = null;
            chromeObserver.disconnect();
            workspace.removeEventListener('click', onClick, true);
            tabs.removeEventListener('keydown', onTabsKey, true);
            tabs.removeEventListener('click', onMainTab);
            window.removeEventListener('keydown', onEscape, true);
            window.removeEventListener('resize', layout);
            foldMain.remove();
            if (originalTitle) { originalTitle.textContent = titleText; }
            if (originalRole === null) {
                dictionaryButton?.removeAttribute('role');
            } else if (originalRole) {
                dictionaryButton?.setAttribute('role', originalRole);
            }
            dictionaryButton?.removeAttribute('aria-expanded');
            dictionaryButton?.removeAttribute('aria-label');
            if (dictionaryButton && originalButtonText !== null) { dictionaryButton.textContent = originalButtonText ?? ''; }
            for (const restore of cleanup.reverse()) { restore(); }
            workspace.remove(); delete root.dataset.studyWorkspace;
        },
    };
}
