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

import {studyCall} from '../study/study-client.js';
import {DEFAULTS, SAVED_KEY} from '../study/study-data.js';

const status = /** @type {HTMLElement} */ (document.querySelector('#status'));
const model = /** @type {HTMLSelectElement} */ (document.querySelector('#model'));
const effort = /** @type {HTMLSelectElement} */ (document.querySelector('#effort'));
/** @type {import('study').Model[]} */
let catalog = [];
/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
const check = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
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
}
/** @returns {import('study').StudyConfig} */
function current() {
    return {
        model: model.value,
        effort: effort.value,
        autoDictionaryTranslate: check('autoDictionaryTranslate').checked,
        cacheEnabled: check('cacheEnabled').checked
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
/** @returns {Promise<void>} */
async function showSaved() {
    const rows = /** @type {import('study').SavedWord[]} */ (await studyCall('saved'));
    const list = /** @type {HTMLElement} */ (document.querySelector('#saved'));
    list.replaceChildren();
    if (rows.length === 0) {
        list.textContent = '还没有收藏。点击查词卡右上角 ☆ 即可收藏当前词、原句和来源；不调用 AI、不制卡。';
    }
    for (const row of [...rows].reverse()) {
        const item = document.createElement('div');
        item.className = 'saved-word';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '移除';
        remove.addEventListener('click', () => {
            void run(async () => {
                await studyCall('removeWord', {id: row.id});
                await showSaved();
            });
        });
        const title = document.createElement('strong');
        title.textContent = row.word;
        const sentence = document.createElement('p');
        sentence.textContent = row.sentence;
        item.append(remove, title, sentence);
        if (row.url) {
            const a = document.createElement('a');
            a.href = row.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = `${row.title || '打开来源'}${typeof row.videoTime === 'number' ? ` · 查词时 ${Math.floor(row.videoTime / 60)}:${String(row.videoTime % 60).padStart(2, '0')}` : ''} ↗`;
            item.append(a);
        }
        list.append(item);
    }
}
model.addEventListener('change', () => {
    refreshEffort();
});
document.querySelector('#load-models')?.addEventListener('click', () => {
    const button = /** @type {HTMLButtonElement} */ (document.querySelector('#load-models'));
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
document.querySelector('#settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
        const value = current();
        const found = catalog.find((m) => m.model === value.model);
        if (catalog.length > 0 && (!found || !found.efforts.includes(value.effort))) {
            throw new Error('请选择模型支持的推理强度。');
        }
        await studyCall('saveSettings', value);
        status.textContent = '已保存；下一次查词 AI 使用新设置。没有调用模型。';
    });
});
document.querySelector('#clear-cache')?.addEventListener('click', () => {
    void run(async () => {
        await studyCall('clearCache');
        status.textContent = '翻译缓存已清空；在途结果也不会写回此缓存。';
    });
});
// Explicit destructive action is confirmed before changing personal data.

document.querySelector('#clear-saved')?.addEventListener('click', () => {
    // eslint-disable-next-line no-alert
    if (confirm('清空所有主动收藏？此操作不能撤销。')) {
        void run(async () => {
            await studyCall('clearSaved');
            await showSaved();
            status.textContent = '收藏已清空。';
        });
    }
});
document.querySelector('#export-saved')?.addEventListener('click', () => {
    void run(async () => {
        const saved = await studyCall('saved');
        const url = URL.createObjectURL(new Blob([JSON.stringify({format: 'study-saved-v1', saved}, null, 2)], {type: 'application/json'}));
        const a = document.createElement('a');
        a.href = url;
        a.download = '英语学习-收藏语境.json';
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 30000);
        status.textContent = '已请求导出收藏（包含你保存的句子及来源链接）。';
    });
});
void run(async () => {
    fill(/** @type {import('study').StudyConfig} */ (await studyCall('settings')));
    await showSaved();
    status.textContent = '本地设置已读取。首次选择其他模型，请先读取可用模型。';
});

document.querySelector('#prepare-japanese')?.addEventListener('click', () => {
    void chrome.permissions.request({permissions: ['nativeMessaging']}).then(async (allowed) => {
        if (!allowed) { throw new Error('尚未允许本机通信。'); }
        status.textContent = '正在准备独立日语空牌组，请保持 Anki 运行…';
        const result = /** @type {{message: string}} */ (await studyCall('libraryPrepareJapanese', {language: 'ja'}));
        status.textContent = result.message;
    }).catch((error) => { status.textContent = error instanceof Error ? error.message : '准备失败，未开始日语学习。'; });
});

// Keep an already-open collection view in sync with card stars/removals.
chrome.storage?.onChanged.addListener((changes, area) => {
    if (area === 'local' && SAVED_KEY in changes) { void run(showSaved); }
});

/** @typedef {{vault: string, directory: string, ankiEnabled: boolean, deck: string, model: string}} LibraryTarget */
/** @typedef {LibraryTarget & {decks?: string[], message?: string, error?: string, status?: {vaultExists?: boolean, directoryExists?: boolean, saveAvailable?: boolean, saveMessage?: string, ankiConnected?: boolean, deckExists?: boolean, modelExists?: boolean, modelCompatible?: boolean}}} LibrarySettingsResult */
const libraryStatus = /** @type {HTMLElement} */ (document.querySelector('#library-status'));
const libraryDeck = /** @type {HTMLSelectElement} */ (document.querySelector('#library-deck'));
/** @type {LibraryTarget | null} */
let librarySaved = null;
/** @type {string[]} */
let libraryDecks = [];
const newDeckValue = '__new_deck__';
let libraryBusy = false;

/** @returns {LibraryTarget} */
function libraryCurrent() {
    return {vault: check('library-vault').value.trim(),
        directory: check('library-directory').value.trim(),
        ankiEnabled: check('library-anki-enabled').checked,
        deck: libraryDeck.value === newDeckValue ? check('library-new-deck').value.trim() : libraryDeck.value,
        model: check('library-model').value};
}

/** @param {boolean} loaded */
function libraryControls(loaded) {
    for (const element of document.querySelectorAll('#library-settings input, #library-settings select, #library-settings button')) {
        if (element.id !== 'library-check') {
            /** @type {HTMLInputElement | HTMLSelectElement | HTMLButtonElement} */ (element).disabled = !loaded;
        }
    }
}

/** Show the explicit new-deck name field without changing the saved target. */
function showNewDeck() {
    const label = /** @type {HTMLElement} */ (document.querySelector('#library-new-deck-label'));
    label.hidden = libraryDeck.value !== newDeckValue;
}

/** @param {LibrarySettingsResult} result */
function fillLibrary(result) {
    librarySaved = {vault: result.vault, directory: result.directory, ankiEnabled: result.ankiEnabled, deck: result.deck, model: result.model};
    check('library-vault').value = result.vault;
    check('library-directory').value = result.directory;
    check('library-anki-enabled').checked = result.ankiEnabled;
    check('library-model').value = result.model;
    if (Array.isArray(result.decks)) { libraryDecks = result.decks; }
    libraryDeck.replaceChildren();
    for (const deck of new Set([result.deck, ...libraryDecks])) {
        option(libraryDeck, deck, deck === result.deck && result.status?.deckExists === false ? `${deck}（缺失）` : deck);
    }
    option(libraryDeck, newDeckValue, '输入新牌组名称…');
    libraryDeck.value = result.deck;
    check('library-new-deck').value = '';
    showNewDeck();
    libraryControls(!libraryBusy);
}

/** @param {LibrarySettingsResult} result */
function showLibraryCheck(result) {
    const target = /** @type {HTMLElement} */ (document.querySelector('#library-check-result'));
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
    const buttons = [...document.querySelectorAll('#library-settings button')];
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
        /** @type {HTMLButtonElement} */ (document.querySelector('#library-check')).disabled = false;
    }
}

/** @typedef {{items?: {path: string, label: string}[], message?: string, path?: string, cancelled?: boolean}} FolderChoice */
for (const kind of ['vault', 'directory']) {
    const input = check(`library-${kind}`);
    const choices = /** @type {HTMLSelectElement} */ (document.getElementById(`library-${kind}-options`));
    /** @param {string} path */
    const choose = (path) => {
        input.value = path;
        choices.value = path;
        if (kind === 'vault') {
            /** @type {HTMLElement} */ (document.querySelector('#library-directory-options')).hidden = true;
        }
        libraryStatus.textContent = '目录已填入，点击「保存目标」才生效；没有移动或保存任何学习记录。';
    };
    choices.addEventListener('change', () => {
        if (choices.value) { choose(choices.value); }
    });
    for (const operation of ['detect', 'pick']) {
        document.getElementById(`library-${kind}-${operation}`)?.addEventListener('click', () => {
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
document.querySelector('#library-settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void runLibrary(async () => {
        const settings = libraryCurrent();
        if (!settings.vault || !settings.directory || !settings.deck) { throw new Error('请填写 Vault、语境根目录与牌组名称。'); }
        fillLibrary(/** @type {LibrarySettingsResult} */ (await studyCall('librarySettingsSave', {settings})));
        /** @type {HTMLElement} */ (document.querySelector('#library-check-result')).textContent = '目标已改变，请重新只读检查；未移动历史笔记或卡片。';
        libraryStatus.textContent = '保存目标已保存；没有创建笔记、牌组、模板或卡片。';
    });
});
document.querySelector('#library-check')?.addEventListener('click', () => {
    void runLibrary(async () => {
        requireLibrarySaved();
        const result = /** @type {LibrarySettingsResult} */ (await studyCall('librarySettingsCheck'));
        fillLibrary(result);
        showLibraryCheck(result);
        libraryStatus.textContent = '只读检查完成；没有生成内容或写入学习数据。';
    });
});
document.querySelector('#library-open')?.addEventListener('click', () => {
    void runLibrary(async () => {
        requireLibrarySaved();
        await studyCall('librarySettingsOpen');
        libraryStatus.textContent = '已请求打开语境目录；不会自动创建目录。';
    });
});
for (const [id, createDeck] of /** @type {[string, boolean][]} */ ([['library-create-deck', true], ['library-create-model', false]])) {
    document.getElementById(id)?.addEventListener('click', () => {
        void runLibrary(async () => {
            requireLibrarySaved();
            const result = /** @type {LibrarySettingsResult} */ (await studyCall('librarySettingsPrepare', {createDeck, createModel: !createDeck}));
            showLibraryCheck(result);
            libraryStatus.textContent = result.message ?? `${createDeck ? '所选空牌组' : '兼容模板'}已准备；没有创建卡片或修改已有模板。`;
        });
    });
}

libraryControls(false);
void (async () => {
    try {
        if (typeof chrome.permissions.contains !== 'function' || !await chrome.permissions.contains({permissions: ['nativeMessaging']})) {
            libraryStatus.textContent = '点击「只读检查」连接本机保存服务并读取目标；不会调用模型。';
            return;
        }
        fillLibrary(/** @type {LibrarySettingsResult} */ (await studyCall('librarySettingsGet')));
        libraryStatus.textContent = '保存目标已读取；Anki 与目录状态尚未检查。';
    } catch (error) {
        libraryStatus.textContent = `尚未连接本机保存服务，请点击「只读检查」重试。${error instanceof Error ? error.message : ''}`;
    }
})();
