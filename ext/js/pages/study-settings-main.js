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

import {readResponseJson} from '../core/json.js';
import {studyCall} from '../study/study-client.js';
import {DEFAULTS} from '../study/study-data.js';

/** @type {WeakMap<HTMLElement, Promise<void>>} */
const initializedRoots = new WeakMap();

/**
 * Installs the study settings controls once for the given settings page root.
 * @param {HTMLElement} root
 * @returns {Promise<void>}
 */
export function prepareStudySettings(root) {
    const initialized = initializedRoots.get(root);
    if (initialized) { return initialized; }
    const promise = initializeStudySettings(root);
    initializedRoots.set(root, promise);
    return promise;
}

/**
 * @param {HTMLElement} root
 * @returns {Promise<void>}
 */
async function initializeStudySettings(root) {
    /**
     * @param {string} selector
     * @returns {Element | null}
     */
    const query = (selector) => root.querySelector(selector);
    const status = /** @type {HTMLElement} */ (query('#status'));
    const model = /** @type {HTMLSelectElement} */ (query('#model'));
    const effort = /** @type {HTMLSelectElement} */ (query('#effort'));
    const settingsSaveState = /** @type {HTMLElement | null} */ (query('#settings-save-state'));
    const librarySaveState = /** @type {HTMLElement | null} */ (query('#library-save-state'));
    /** @type {import('study').Model[]} */
    let catalog = [];
    /**
     * @param {string} id
     * @returns {HTMLInputElement}
     */
    const check = (id) => /** @type {HTMLInputElement} */ (root.querySelector(`#${id}`));
    const effortNames = new Map([['none', '关闭'], ['minimal', '最小'], ['low', '低 · 更快'], ['medium', '中'], ['high', '高'], ['xhigh', '很高'], ['max', '最高'], ['ultra', '极高']]);
    /**
     *
     * @param {HTMLSelectElement} target
     * @param {string} value
     * @param {string} label
     */
    function option(target, value, label) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        target.append(o);
    }
    /**
     * @param {string} [preferred]
     */
    function refreshEffort(preferred) {
        const found = catalog.find((m) => m.model === model.value);
        effort.replaceChildren();
        for (const value of found?.efforts ?? [preferred ?? DEFAULTS.effort]) {
            option(effort, value, effortNames.get(value) ?? value);
        }
        effort.value = preferred && [...effort.options].some((o) => o.value === preferred) ? preferred : found?.defaultEffort ?? DEFAULTS.effort;
    }
    /**
     * @param {import('study').StudyConfig} config
     */
    function fill(config) {
        model.replaceChildren();
        option(model, config.model, `${config.model}（已保存；刷新可选列表）`);
        refreshEffort(config.effort);
        check('cacheEnabled').checked = config.cacheEnabled;
        check('autoDictionaryTranslate').checked = config.autoDictionaryTranslate === true;
        if (settingsSaveState) { settingsSaveState.textContent = '已保存'; }
    }
    /** @returns {import('study').StudyConfig} */
    function current() {
        return {
            model: model.value,
            effort: effort.value,
            autoDictionaryTranslate: check('autoDictionaryTranslate').checked,
            cacheEnabled: check('cacheEnabled').checked,
        };
    }
    /**
     * @param {() => Promise<void>} operation
     * @returns {Promise<void>}
     */
    async function run(operation) {
        try {
            await operation();
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : '操作未完成。';
        }
    }
    model.addEventListener('change', () => {
        refreshEffort();
    });
    root.querySelector('#load-models')?.addEventListener('click', () => {
        const button = /** @type {HTMLButtonElement} */ (root.querySelector('#load-models'));
        button.disabled = true;
        status.textContent = '正在读取本机模型目录，不会生成译文…';
        void chrome.permissions.request({permissions: ['nativeMessaging']}).then((allowed) => run(async () => {
            if (!allowed) {
                throw new Error('未授予本机通信权限。');
            }
            const previous = model.value;
            const previousEffort = effort.value;
            catalog = /** @type {import('study').Model[]} */ (await studyCall('models'));
            if (catalog.length === 0) {
                throw new Error('本机未返回可用的文本模型。');
            }
            model.replaceChildren();
            for (const m of catalog) {
                option(model, m.model, m.displayName);
            }
            if (catalog.some((m) => m.model === previous)) {
                model.value = previous;
            }
            refreshEffort(previousEffort);
            status.textContent = '模型目录已读取；选择后点击保存。目录支持不等于账号实际调用已验收。';
        })).catch(() => {
            status.textContent = '无法请求本机通信权限。';
        })
            .finally(() => {
                button.disabled = false;
            });
    });
    const settingsForm = root.querySelector('#settings-form');
    settingsForm?.addEventListener('input', () => {
        if (settingsSaveState) { settingsSaveState.textContent = '待保存'; }
    });
    settingsForm?.addEventListener('change', () => {
        if (settingsSaveState) { settingsSaveState.textContent = '待保存'; }
    });
    settingsForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        void run(async () => {
            const value = current();
            const found = catalog.find((m) => m.model === value.model);
            if (catalog.length > 0 && (!found || !found.efforts.includes(value.effort))) {
                throw new Error('请选择模型支持的推理强度。');
            }
            await studyCall('saveSettings', value);
            if (settingsSaveState) { settingsSaveState.textContent = '已保存'; }
            status.textContent = '已保存；下一次查词 AI 使用新设置。没有调用模型。';
        });
    });
    root.querySelector('#clear-cache')?.addEventListener('click', () => {
        void run(async () => {
            await studyCall('clearCache');
            status.textContent = '翻译缓存已清空；在途结果也不会写回此缓存。';
        });
    });
    const loadSavedSettings = run(async () => {
        fill(/** @type {import('study').StudyConfig} */ (await studyCall('settings')));
        status.textContent = '本地设置已读取。首次选择其他模型，请先读取可用模型。';
    });

    const japaneseStatus = query('#japanese-status') ?? status;
    root.querySelector('#prepare-japanese')?.addEventListener('click', () => {
        void chrome.permissions.request({permissions: ['nativeMessaging']}).then(async (allowed) => {
            if (!allowed) { throw new Error('尚未允许本机通信。'); }
            japaneseStatus.textContent = '正在准备独立日语空牌组，请保持 Anki 运行…';
            const result = /** @type {{message: string}} */ (await studyCall('libraryPrepareJapanese', {language: 'ja'}));
            japaneseStatus.textContent = result.message;
        }).catch((error) => { japaneseStatus.textContent = error instanceof Error ? error.message : '准备失败，未开始日语学习。'; });
    });

    /** @typedef {{vault: string, directory: string, ankiEnabled: boolean, deck: string, model: string, deckByKind: Record<string, string>}} LibraryTarget */
    /** @typedef {LibraryTarget & {decks?: string[], deckByKind?: Record<string, string>, message?: string, error?: string, status?: {vaultExists?: boolean, directoryExists?: boolean, saveAvailable?: boolean, saveMessage?: string, ankiConnected?: boolean, deckExists?: boolean, modelExists?: boolean, modelCompatible?: boolean}}} LibrarySettingsResult */
    const libraryStatus = /** @type {HTMLElement} */ (root.querySelector('#library-status'));
    const libraryDeck = /** @type {HTMLSelectElement} */ (root.querySelector('#library-deck'));
    const libraryKinds = ['meaning', 'context', 'expression', 'grammar', 'sentence', 'listening', 'produce'];
    /** @type {LibraryTarget | null} */
    let librarySaved = null;
    /** @type {string[]} */
    let libraryDecks = [];
    const newDeckValue = '__new_deck__';
    let libraryBusy = false;

    /** @returns {LibraryTarget} */
    function libraryCurrent() {
        const deckByKind = Object.fromEntries(libraryKinds.map((kind) => [kind, /** @type {HTMLSelectElement} */ (root.querySelector(`#library-deck-${kind}`)).value]));
        return {vault: check('library-vault').value.trim(),
            directory: check('library-directory').value.trim(),
            ankiEnabled: check('library-anki-enabled').checked,
            deck: libraryDeck.value === newDeckValue ? check('library-new-deck').value.trim() : libraryDeck.value,
            model: check('library-model').value,
            deckByKind};
    }

    /** @param {boolean} loaded */
    function libraryControls(loaded) {
        for (const element of root.querySelectorAll('#library-settings input, #library-settings select, #library-settings button')) {
            if (element.id !== 'library-check') {
                /** @type {HTMLInputElement | HTMLSelectElement | HTMLButtonElement} */ (element).disabled = !loaded;
            }
        }
    }

    /** Show the explicit new-deck name field without changing the saved target. */
    function showNewDeck() {
        const label = /** @type {HTMLElement} */ (root.querySelector('#library-new-deck-label'));
        label.hidden = libraryDeck.value !== newDeckValue;
    }

    /** @param {LibrarySettingsResult} result */
    function fillLibrary(result) {
        const deckByKind = Object.fromEntries(libraryKinds.map((kind) => [kind, result.deckByKind?.[kind] ?? '']));
        librarySaved = {vault: result.vault, directory: result.directory, ankiEnabled: result.ankiEnabled, deck: result.deck, model: result.model, deckByKind};
        check('library-vault').value = result.vault;
        check('library-directory').value = result.directory;
        check('library-anki-enabled').checked = result.ankiEnabled;
        check('library-model').value = result.model;
        const parent = root.querySelector('#library-parent-deck');
        if (parent) { /** @type {HTMLInputElement} */ (parent).value = result.deck.split('::')[0]; }
        if (Array.isArray(result.decks)) { libraryDecks = result.decks; }
        libraryDeck.replaceChildren();
        for (const deck of new Set([result.deck, ...libraryDecks])) {
            option(libraryDeck, deck, deck === result.deck && result.status?.deckExists === false ? `${deck}（缺失）` : deck);
        }
        option(libraryDeck, newDeckValue, '输入新牌组名称…');
        libraryDeck.value = result.deck;
        for (const kind of libraryKinds) {
            const select = /** @type {HTMLSelectElement} */ (root.querySelector(`#library-deck-${kind}`));
            select.replaceChildren();
            option(select, '', '使用默认牌组');
            const selectedDeck = deckByKind[kind];
            for (const deck of new Set([...libraryDecks, ...(selectedDeck ? [selectedDeck] : [])])) {
                option(select, deck, deck === selectedDeck && !libraryDecks.includes(deck) ? `${deck}（未在牌组列表中核对）` : deck);
            }
            select.value = selectedDeck;
        }
        check('library-new-deck').value = '';
        if (librarySaveState) { librarySaveState.textContent = '已保存'; }
        showNewDeck();
        libraryControls(!libraryBusy);
    }

    root.querySelector('#library-use-subdecks')?.addEventListener('click', () => {
        const parent = check('library-parent-deck').value.trim().replace(/::+$/, '');
        if (!parent) {
            libraryStatus.textContent = '请先填写大牌组名称。';
            return;
        }
        if (![...libraryDeck.options].some((item) => item.value === parent)) { option(libraryDeck, parent, parent); }
        libraryDeck.value = parent;
        for (const [kind, label] of [['meaning', '单词意思'], ['context', '原句中的意思'], ['listening', '视频声音字幕'], ['produce', '会用']]) {
            const select = /** @type {HTMLSelectElement} */ (root.querySelector(`#library-deck-${kind}`));
            const name = `${parent}::${label}`;
            if (![...select.options].some((item) => item.value === name)) { option(select, name, name); }
            select.value = name;
        }
        showNewDeck();
        if (librarySaveState) { librarySaveState.textContent = '待保存'; }
        libraryStatus.textContent = '已填入四个子牌组；点击“保存目标”生效，再按需“创建缺少的牌组”。已有卡片不移动。';
    });

    /** @param {LibrarySettingsResult} result */
    function showLibraryCheck(result) {
        const target = /** @type {HTMLElement} */ (root.querySelector('#library-check-result'));
        const state = result.status;
        if (!state) {
            target.textContent = result.error ?? '尚未检查。请点击只读检查读取当前目录与 Anki 状态。';
            return;
        }
        let modelState = '未核对';
        if (state.ankiConnected) {
            modelState = state.modelExists ? '不兼容；不会覆盖，请到高级设置检查' : '缺失；可单独点击创建';
            if (state.modelCompatible) { modelState = '兼容'; }
        }
        const lines = [
            `Vault：${state.vaultExists ? '存在' : '不存在或不可用'} · ${result.vault}`,
            `语境根目录：${state.directoryExists ? '已存在' : '尚未创建；首次保存时建立记录目录'} · ${result.directory}/记录`,
            `保存目标：${state.saveAvailable === false ? `不可用 · ${state.saveMessage ?? '请检查路径及写入权限'}` : '可保存'}`,
            `Anki：${state.ankiConnected ? '已连接' : '未连接'}${result.ankiEnabled ? '' : '（复习已关闭，仍可保存 Obsidian）'}`,
            `牌组：${result.deck} · ${state.ankiConnected ? (state.deckExists ? '存在' : '缺失；可单独点击创建') : '未核对'}`,
            `模板：${result.model} · ${modelState}`,
        ];
        for (const kind of ['meaning', 'context', 'listening']) {
            const deck = result.deckByKind?.[kind];
            if (deck) { lines.push(`子牌组：${deck} · ${!state.ankiConnected ? '未核对' : (result.decks?.includes(deck) ? '存在' : '缺失；点击创建缺少的牌组')}`); }
        }
        if (result.error) { lines.push(result.error); }
        target.textContent = lines.join('\n');
    }

    /**
     * Keep check/open/prepare bound to the target explicitly saved by the user.
     * @throws {Error} Target has unsaved changes.
     */
    function requireLibrarySaved() {
        if (!librarySaved || JSON.stringify(libraryCurrent()) !== JSON.stringify(librarySaved)) {
            throw new Error('请先保存目标，再检查、打开或创建。');
        }
    }

    /** @param {() => Promise<void>} operation */
    async function runLibrary(operation) {
        if (libraryBusy) { return; }
        libraryBusy = true;
        libraryControls(false);
        const buttons = [...root.querySelectorAll('#library-settings button')];
        try {
            for (const button of buttons) { /** @type {HTMLButtonElement} */ (button).disabled = true; }
            if (!await chrome.permissions.request({permissions: ['nativeMessaging']})) { throw new Error('未允许本机通信；保存目标尚未修改。'); }
            if (!librarySaved) {
                fillLibrary(/** @type {LibrarySettingsResult} */ (await studyCall('librarySettingsGet')));
            }
            await operation();
        } catch (error) {
            libraryStatus.textContent = error instanceof Error ? error.message : '保存与复习设置暂不可用。';
        } finally {
            libraryBusy = false;
            libraryControls(librarySaved !== null);
            /** @type {HTMLButtonElement} */ (root.querySelector('#library-check')).disabled = false;
        }
    }

    /** @typedef {{items?: {path: string, label: string}[], message?: string, path?: string, cancelled?: boolean}} FolderChoice */
    for (const kind of ['vault', 'directory']) {
        const input = check(`library-${kind}`);
        const choices = /** @type {HTMLSelectElement} */ (root.querySelector(`#library-${kind}-options`));
        /** @param {string} path */
        const choose = (path) => {
            input.value = path;
            choices.value = path;
            if (kind === 'vault') {
                /** @type {HTMLElement} */ (root.querySelector('#library-directory-options')).hidden = true;
            }
            if (librarySaveState) { librarySaveState.textContent = '待保存'; }
            libraryStatus.textContent = '目录已填入，点击「保存目标」才生效；没有移动或保存任何学习记录。';
        };
        choices.addEventListener('change', () => {
            if (choices.value) { choose(choices.value); }
        });
        for (const operation of ['detect', 'pick']) {
            root.querySelector(`#library-${kind}-${operation}`)?.addEventListener('click', () => {
                void runLibrary(async () => {
                    const result = /** @type {FolderChoice} */ (await studyCall(
                        'librarySettingsOpen',
                        {folderAction: operation, kind, vault: check('library-vault').value.trim(), directory: check('library-directory').value.trim()},
                    ));
                    if (operation === 'pick') {
                        if (result.cancelled) {
                            libraryStatus.textContent = '已取消选择；原设置和当前输入均未改变。';
                            return;
                        }
                        if (typeof result.path !== 'string' || !result.path) { throw new Error('未取得所选文件夹，原设置未改变。'); }
                        choose(result.path);
                        return;
                    }
                    choices.replaceChildren();
                    const items = result.items ?? [];
                    option(choices, '', `检测到 ${items.length} 个目录，请选择…`);
                    for (const item of items) { option(choices, item.path, item.label); }
                    choices.hidden = items.length === 0;
                    libraryStatus.textContent = items.length > 0 ? `${result.message ?? '检测完成，请从下拉列表选择。'} 点击保存目标才生效。` : '没有检测到可用目录，可点「选择文件夹」手动选择。';
                });
            });
        }
    }

    libraryDeck.addEventListener('change', showNewDeck);
    const librarySettingsForm = root.querySelector('#library-settings-form');
    librarySettingsForm?.addEventListener('input', () => {
        if (librarySaveState) { librarySaveState.textContent = '待保存'; }
    });
    librarySettingsForm?.addEventListener('change', () => {
        if (librarySaveState) { librarySaveState.textContent = '待保存'; }
    });
    librarySettingsForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        void runLibrary(async () => {
            const settings = libraryCurrent();
            if (!settings.vault || !settings.directory || !settings.deck) { throw new Error('请填写 Vault、语境根目录与牌组名称。'); }
            fillLibrary(/** @type {LibrarySettingsResult} */ (await studyCall('librarySettingsSave', {settings})));
            /** @type {HTMLElement} */ (root.querySelector('#library-check-result')).textContent = '目标已改变，请重新只读检查；未移动历史笔记或卡片。';
            libraryStatus.textContent = '保存目标已保存；没有创建笔记、牌组、模板或卡片。';
        });
    });
    root.querySelector('#library-check')?.addEventListener('click', () => {
        void runLibrary(async () => {
            requireLibrarySaved();
            const result = /** @type {LibrarySettingsResult} */ (await studyCall('librarySettingsCheck'));
            fillLibrary(result);
            showLibraryCheck(result);
            libraryStatus.textContent = '只读检查完成；没有生成内容或写入学习数据。';
        });
    });
    root.querySelector('#library-open')?.addEventListener('click', () => {
        void runLibrary(async () => {
            requireLibrarySaved();
            await studyCall('librarySettingsOpen');
            libraryStatus.textContent = '已请求打开语境目录；不会自动创建目录。';
        });
    });
    for (const [id, createDeck] of /** @type {[string, boolean][]} */ ([['library-create-deck', true], ['library-create-model', false]])) {
        root.querySelector(`#${id}`)?.addEventListener('click', () => {
            void runLibrary(async () => {
                requireLibrarySaved();
                const result = /** @type {LibrarySettingsResult} */ (await studyCall('librarySettingsPrepare', {createDeck, createModel: !createDeck}));
                showLibraryCheck(result);
                libraryStatus.textContent = result.message ?? `${createDeck ? '所选牌组' : '兼容模板'}已准备；没有创建卡片或修改已有模板。`;
            });
        });
    }

    libraryControls(false);
    prepareSystemStatus(root);
    const loadLibrarySettings = (async () => {
        try {
            if (typeof chrome.permissions.contains !== 'function' || !await chrome.permissions.contains({permissions: ['nativeMessaging']})) {
                libraryStatus.textContent = '点击「只读检查」连接本机保存服务并读取目标；不会调用模型。';
                if (librarySaveState) { librarySaveState.textContent = '尚未读取'; }
                return;
            }
            fillLibrary(/** @type {LibrarySettingsResult} */ (await studyCall('librarySettingsGet')));
            libraryStatus.textContent = '保存目标已读取；Anki 与目录状态尚未检查。';
        } catch (error) {
            libraryStatus.textContent = `尚未连接本机保存服务，请点击「只读检查」重试。${error instanceof Error ? error.message : ''}`;
            if (librarySaveState) { librarySaveState.textContent = '尚未读取'; }
        }
    })();
    await Promise.all([loadSavedSettings, loadLibrarySettings]);
}

/**
 * One read on opening Advanced and on an explicit refresh, never a polling loop.
 * @param {HTMLElement} root
 * @returns {void}
 */
export function prepareSystemStatus(root) {
    const section = root.querySelector('#study-system-status');
    if (!section) { return; }
    const refresh = /** @type {HTMLButtonElement} */ (section.querySelector('[data-health-refresh]'));
    const copy = /** @type {HTMLButtonElement} */ (section.querySelector('[data-health-copy]'));
    const command = /** @type {HTMLElement} */ (section.querySelector('[data-health-command]'));
    const summary = section.querySelector('[data-health-summary]');
    const labels = {bridge: '桥版本', anki: 'Anki', vault: 'Vault', apple: 'Apple 翻译', file: '本地文件访问'};
    /**
     * @param {'bridge'|'anki'|'vault'|'apple'|'file'} key
     * @param {boolean} ok
     */
    const show = (key, ok) => { section.querySelector(`[data-health=${key}]`).textContent = `${ok ? '✓' : '✗'} ${labels[key]}`; };
    const read = async () => {
        refresh.disabled = true;
        summary.textContent = '正在检查…';
        const allowed = /** @type {boolean} */ (await new Promise((resolve) => { chrome.extension.isAllowedFileSchemeAccess(resolve); }));
        show('file', allowed === true);
        try {
            const [health, expected] = await Promise.all([
                studyCall('bridgeHealth'),
                fetch(chrome.runtime.getURL('js/study/bridge-manifest.json')).then(readResponseJson),
            ]);
            const value = /** @type {{files: Record<string, string>, anki: {ok: boolean}, vault: {ok: boolean}, appleTranslate: boolean, errors: {action: string, message: string}[]}} */ (health);
            const same = Object.entries(/** @type {Record<string, string>} */ (expected)).every(([name, hash]) => value.files[name] === hash);
            show('bridge', same);
            show('anki', value.anki.ok);
            show('vault', value.vault.ok);
            show('apple', value.appleTranslate);
            command.hidden = same;
            section.querySelector('[data-health-errors]').textContent = value.errors.map((error) => `${error.action}：${error.message}`).join('\n') || '没有最近错误';
            summary.textContent = allowed ? '检查完成' : '请到 Chrome 扩展详情开启「允许访问文件网址」。';
        } catch {
            for (const key of /** @type {('bridge'|'anki'|'vault'|'apple')[]} */ (['bridge', 'anki', 'vault', 'apple'])) { show(key, false); }
            command.hidden = false;
            summary.textContent = '体检不可用：本机桥未连接或尚不支持此动作，请同步后刷新。';
            section.querySelector('[data-health-errors]').textContent = '暂时无法读取';
        } finally {
            refresh.disabled = false;
        }
    };
    copy.addEventListener('click', () => {
        void navigator.clipboard.writeText('python3 dev/sync-local.py').then(() => { copy.textContent = '已复制'; });
    });
    refresh.addEventListener('click', () => { void read(); });
    let visible = false;
    const opened = () => {
        const next = root.dataset.activeSettingsCategory === 'advanced';
        if (next && !visible) { void read(); }
        visible = next;
    };
    window.addEventListener('hashchange', opened);
    opened();
}
