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
import {Application} from '../application.js';
import {Frontend} from '../app/frontend.js';
import {PopupFactory} from '../app/popup-factory.js';
import {ThemeController} from '../app/theme-controller.js';
import {HotkeyHandler} from '../input/hotkey-handler.js';
import {studyCall} from '../study/study-client.js';
import {parseJson} from '../core/json.js';
import {sourceKey} from '../study/study-journal.js';

const PAGE_SIZE = 10;

/** @typedef {import('study').LibraryRecord & {favorite?: boolean, learningState?: string, syncState?: string | {status?: string}, conflicts?: {key: string, local: unknown, remote: unknown}[], reconcileState?: 'checking'|'verified'|'failed', reconcileError?: string}} StudyLibraryRecord */
/** @typedef {import('study').SavedWord & {language?: string, libraryId?: string, syncPending?: boolean}} LocalSavedWord */

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function noteIds(value) {
    if (!value || typeof value !== 'object') { return []; }
    const record = /** @type {{noteId?: unknown, cards?: unknown}} */ (value);
    const ids = [record.noteId, ...(Array.isArray(record.cards) ? record.cards.map((card) => (card && typeof card === 'object' ? /** @type {{noteId?: unknown}} */ (card).noteId : null)) : [])];
    return /** @type {number[]} */ ([...new Set(ids.filter((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0))]);
}

/**
 * @param {unknown} value
 * @param {string} category
 * @returns {boolean}
 */
export function matchesCategory(value, category) {
    if (!value || typeof value !== 'object') { return false; }
    const record = /** @type {{favorite?: boolean, learningState?: string, vaultSaved?: boolean, ankiState?: string, syncState?: string | {status?: string}, cards?: unknown}} */ (value);
    const syncState = typeof record.syncState === 'string' ? record.syncState : '';
    switch (category) {
        case 'favorites': return record.favorite === true;
        case 'saved': return record.vaultSaved === true && record.learningState !== 'favorite-only';
        case 'linked': return noteIds(record).length > 0 || record.ankiState === 'linked';
        case 'pending': return ['pending', 'conflict', 'error', 'failed', 'missing'].includes(syncState ?? '') || record.ankiState === 'pending';
        default: return true;
    }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function plainText(value) {
    if (typeof value === 'string') { return value; }
    if (value === null || typeof value === 'undefined') { return ''; }
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return '（无法显示）';
    }
}

/**
 * Recognizes the old article locator stored as JSON in the context field.
 * @param {unknown} value
 * @returns {?Record<string, unknown>}
 */
function parseLegacySourceLocator(value) {
    if (typeof value !== 'string') { return null; }
    let parsed;
    try {
        parsed = parseJson(value);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
    const locator = /** @type {Record<string, unknown>} */ (parsed);
    if (locator.kind !== 'article' || typeof locator.title !== 'string' || !Object.prototype.hasOwnProperty.call(locator, 'locator') || !Object.prototype.hasOwnProperty.call(locator, 'position')) { return null; }
    return locator;
}

/**
 * Build a regular dictionary lookup while retaining the saved source context.
 * This deliberately restores ordinary source metadata only; it does not create subtitle authorization.
 * @param {{id?: string, entry?: {word?: string, sentence?: string, context?: string, url?: string, title?: string, videoTime?: number, language?: string}}} record
 * @param {string} searchUrl
 * @returns {string}
 */
export function createResumeUrl(record, searchUrl) {
    const entry = record.entry ?? {};
    const word = entry.word ?? '';
    const sentence = entry.sentence ?? word;
    const params = new URLSearchParams({type: 'terms', query: word, full: sentence, offset: `${Math.max(0, sentence.toLocaleLowerCase().indexOf(word.toLocaleLowerCase()))}`, studyResume: '1'});
    params.set('studySourceUrl', entry.url ?? '');
    const legacySource = parseLegacySourceLocator(entry.context);
    const sourceTitle = entry.title?.trim() || (typeof legacySource?.title === 'string' ? legacySource.title.trim() : '');
    params.set('studySourceTitle', sourceTitle);
    params.set('studyContext', legacySource ? '' : (entry.context ?? ''));
    params.set('studyLanguage', entry.language ?? 'en');
    if (record.id) { params.set('studyRecordId', record.id); }
    if (typeof entry.videoTime === 'number' && Number.isFinite(entry.videoTime)) { params.set('studyVideoTime', `${entry.videoTime}`); }
    return `${searchUrl}?${params.toString()}`;
}

/**
 * @param {unknown} value
 * @returns {StudyLibraryRecord[]}
 */
function normalizeRecords(value) {
    if (Array.isArray(value)) { return /** @type {StudyLibraryRecord[]} */ (value); }
    if (!value || typeof value !== 'object') { return []; }
    const result = /** @type {{items?: unknown, entries?: unknown}} */ (value);
    const rows = Array.isArray(result.items) ? result.items : result.entries;
    return Array.isArray(rows) ? /** @type {StudyLibraryRecord[]} */ (rows) : [];
}

/**
 * @param {unknown} value
 * @returns {LocalSavedWord[]}
 */
function normalizeSavedWords(value) {
    return Array.isArray(value) ? /** @type {LocalSavedWord[]} */ (value) : [];
}

/**
 * @param {unknown} value
 * @param {string} id
 * @returns {?StudyLibraryRecord}
 */
function normalizeRecord(value, id) {
    if (!value || typeof value !== 'object') { return null; }
    const result = /** @type {{id?: string, items?: unknown, record?: unknown}} */ (value);
    if (result.id === id) { return /** @type {StudyLibraryRecord} */ (value); }
    const rows = normalizeRecords(value);
    return rows.find((row) => row.id === id) ?? (result.record && typeof result.record === 'object' && /** @type {{id?: string}} */ (result.record).id === id ? /** @type {StudyLibraryRecord} */ (result.record) : null);
}

/**
 * @param {StudyLibraryRecord|LocalSavedWord} record
 * @param {string} query
 * @returns {boolean}
 */
function matchesSearch(record, query) {
    if (!query) { return true; }
    return JSON.stringify(record).toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

/**
 * @param {StudyLibraryRecord} record
 * @returns {string}
 */
function stateSummary(record) {
    if (record.reconcileState === 'checking') { return '正在确认最近的保存和复习状态…'; }
    const cards = noteIds(record).length;
    const labels = [];
    const isFavorite = record.learningState === 'favorite-only' && record.favorite !== false;
    switch (isFavorite ? 'favorite' : record.vaultSaved) {
        case 'favorite': labels.push('已加入待学收藏'); break;
        case true:
            labels.push('笔记已保存');
            if (record.favorite === true) { labels.push('已收藏'); }
            break;
        case false: labels.push('笔记尚未保存'); break;
        default: labels.push('笔记状态待确认'); break;
    }
    if (record.ankiEnabled === false) {
        labels.push('复习卡已关闭');
    } else if (cards > 0) {
        labels.push(`已有 ${cards} 张复习卡`);
    } else {
        const ankiLabels = {pending: '复习卡待同步', missing: '复习卡关联未找到', error: '复习卡同步遇到问题', linked: '复习卡已关联'};
        labels.push(/** @type {Record<string,string>} */ (ankiLabels)[record.ankiState ?? ''] ?? '尚未关联复习卡');
    }
    const syncValue = /** @type {unknown} */ (record.syncState);
    let syncState = '';
    if (typeof syncValue === 'string') {
        syncState = syncValue;
    } else if (syncValue && typeof syncValue === 'object' && 'status' in syncValue && typeof syncValue.status === 'string') {
        syncState = syncValue.status;
    }
    const syncLabels = {synced: '同步完成', pending: '等待同步', conflict: '有内容需要确认', missing: '关联信息待确认', error: '同步遇到问题', failed: '同步未完成', paused: '同步已暂停', ['local-only']: '仅保存在笔记', saved: '笔记已保存'};
    if (syncState && syncState !== 'synced') { labels.push(/** @type {Record<string,string>} */ (syncLabels)[syncState] ?? '同步状态待确认'); }
    if (record.reconcileState === 'failed') { labels.push('未核对最新状态'); }
    if (record.error) { labels.push(`需留意：${record.error}`); }
    if (record.reconcileError) { labels.push(record.reconcileError); }
    return labels.join(' · ');
}

/**
 * @param {string|null|undefined} path
 * @param {unknown} subtitleLocator
 * @param {?Record<string, unknown>} legacyLocator
 * @returns {?HTMLElement}
 */
function makeTechnicalDetails(path, subtitleLocator, legacyLocator) {
    if (!path && !subtitleLocator && !legacyLocator) { return null; }
    const details = document.createElement('details');
    details.className = 'study-library-technical-details';
    const summary = document.createElement('summary');
    summary.textContent = '查看记录详情';
    details.append(summary);
    if (path) {
        const pathElement = document.createElement('p');
        pathElement.className = 'study-library-path';
        pathElement.textContent = `笔记位置：${path}`;
        details.append(pathElement);
    }
    for (const [labelText, value] of [['原始字幕定位资料', subtitleLocator], ['原始来源定位资料', legacyLocator]]) {
        if (!value) { continue; }
        const label = document.createElement('p');
        label.textContent = labelText;
        const data = document.createElement('pre');
        data.className = 'study-library-locator';
        try {
            data.textContent = JSON.stringify(value, null, 2) ?? '';
        } catch {
            data.textContent = '定位资料无法显示。';
        }
        details.append(label, data);
    }
    return details;
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * Extension pages do not receive the web content-script wrapper, so install the same
 * Frontend scanner/popup pair explicitly for the study-library page.
 * @param {Application} application
 * @returns {Promise<void>}
 */
export async function prepareStudyLibraryLookup(application) {
    const hotkeyHandler = new HotkeyHandler();
    hotkeyHandler.prepare(application.crossFrame);

    const popupFactory = new PopupFactory(application);
    popupFactory.prepare();

    const {browser} = await application.api.getEnvironmentInfo();
    const frontend = new Frontend({
        application,
        popupFactory,
        depth: 0,
        parentPopupId: null,
        parentFrameId: null,
        useProxyPopup: false,
        pageType: 'web',
        canUseWindowPopup: true,
        allowRootFramePopupProxy: true,
        childrenSupported: true,
        hotkeyHandler,
        browser,
    });
    await frontend.prepare();
}

/**
 * @returns {Promise<void>}
 */
async function initializePage() {
    await Application.main(true, async (application) => {
        const themeController = new ThemeController(document.documentElement);
        themeController.prepare();
        try {
            const optionsFull = await application.api.optionsGetFull();
            const {profiles, profileCurrent} = optionsFull;
            const defaultProfile = (profileCurrent >= 0 && profileCurrent < profiles.length) ? profiles[profileCurrent] : null;
            if (defaultProfile !== null) {
                themeController.theme = defaultProfile.options.general.popupTheme;
                themeController.siteOverride = true;
                themeController.updateTheme();
            }
        } catch { /* Keep the browser-preferred fallback if profile options are unavailable. */ }
        const status = byId('study-library-status');
        const list = byId('study-library-list');
        const search = /** @type {HTMLInputElement} */ (document.getElementById('study-library-search'));
        const more = /** @type {HTMLButtonElement} */ (document.getElementById('study-library-more'));
        let lookupWarning = '';
        /** @param {string} text */
        const setStatus = (text) => { status.textContent = lookupWarning ? `${text} · 选词查词未就绪：${lookupWarning}` : text; };
        void prepareStudyLibraryLookup(application).catch((error) => {
            lookupWarning = error instanceof Error ? error.message : '请刷新页面再试。';
            setStatus('学习库仍可使用');
        });
        /** @type {Map<string, StudyLibraryRecord>} */
        const records = new Map();
        /** @type {LocalSavedWord[]} */
        let savedWords = [];
        let savedReadError = '';
        let syncPendingError = '';
        let pendingSyncCount = 0;
        let listError = '';
        let total = 0;
        let offset = 0;
        let loading = false;
        let loaded = false;
        let category = 'all';

        /** @returns {Promise<void>} */
        async function refreshSavedWords() {
            try {
                const previous = savedWords;
                savedWords = normalizeSavedWords(await studyCall('saved'));
                for (const saved of previous) {
                    if (!savedWords.some((row) => row.id === saved.id)) { updateLoadedFavorite(saved, false); }
                }
                for (const saved of savedWords) { updateLoadedFavorite(saved, true); }
                savedReadError = '';
            } catch (error) {
                savedReadError = error instanceof Error ? error.message : '本地收藏读取失败。';
            }
            render();
        }

        /**
         * @param {LocalSavedWord} saved
         * @returns {StudyLibraryRecord[]}
         */
        function matchingRecordsForSaved(saved) {
            const key = sourceKey({...saved, url: saved.sourceUrl ?? saved.url});
            return [...records.values()].filter((record) => (saved.libraryId && record.id === saved.libraryId) || sourceKey(record.entry) === key);
        }

        /**
         * @param {LocalSavedWord} saved
         * @returns {boolean}
         */
        function hasNativeFavorite(saved) {
            return matchingRecordsForSaved(saved).some((record) => record.favorite === true || (record.favorite !== false && record.learningState === 'favorite-only'));
        }

        /**
         * @param {LocalSavedWord} saved
         * @param {boolean} favorite
         * @returns {void}
         */
        function updateLoadedFavorite(saved, favorite) {
            for (const record of matchingRecordsForSaved(saved)) { record.favorite = favorite; }
        }

        /**
         * @param {StudyLibraryRecord} record
         * @returns {?HTMLElement}
         */
        function renderConflicts(record) {
            const conflicts = Array.isArray(record.conflicts) ? record.conflicts : [];
            if (conflicts.length === 0) { return null; }
            const section = document.createElement('section');
            section.className = 'study-library-conflicts';
            const heading = document.createElement('h3');
            heading.textContent = '字段冲突：选择要保留的一侧';
            const description = document.createElement('p');
            description.textContent = '本地指 Obsidian，远端指 Anki；只提交这里逐字段选择的结果。';
            section.append(heading, description);
            /** @type {{field: HTMLFieldSetElement, key: string}[]} */
            const groups = [];
            for (const [index, conflict] of conflicts.entries()) {
                if (!conflict || typeof conflict.key !== 'string') { continue; }
                const field = document.createElement('fieldset');
                const legend = document.createElement('legend');
                legend.textContent = conflict.key;
                field.append(legend);
                for (const [side, label] of [['local', '保留 Obsidian 本地'], ['remote', '保留 Anki 远端']]) {
                    const wrapper = document.createElement('label');
                    wrapper.className = 'study-library-choice';
                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = `conflict-${record.id}-${index}`;
                    radio.value = side;
                    radio.required = true;
                    const value = document.createElement('code');
                    value.textContent = plainText(side === 'local' ? conflict.local : conflict.remote);
                    wrapper.append(radio, document.createTextNode(`${label}：`), value);
                    field.append(wrapper);
                }
                groups.push({field, key: conflict.key});
                section.append(field);
            }
            if (groups.length > 0) {
                const resolve = document.createElement('button');
                resolve.type = 'button';
                resolve.textContent = '应用冲突选择';
                resolve.addEventListener('click', () => {
                    void (async () => {
                        /** @type {Record<string, 'local'|'remote'>} */
                        const resolutions = {};
                        for (const {field, key} of groups) {
                            const selected = field.querySelector('input:checked');
                            if (!(selected instanceof HTMLInputElement)) {
                                setStatus(`请先为「${key}」选择保留本地或远端。`);
                                return;
                            }
                            resolutions[key] = selected.value === 'remote' ? 'remote' : 'local';
                        }
                        resolve.disabled = true;
                        await refreshOne(record.id, {resolutions});
                    })().catch((error) => setStatus(error instanceof Error ? error.message : '冲突处理未完成。'))
                        .finally(() => { resolve.disabled = false; });
                });
                section.append(resolve);
            }
            return section;
        }

        /**
         * @param {StudyLibraryRecord} record
         * @returns {HTMLElement}
         */
        function makeCard(record) {
            const article = document.createElement('article');
            article.className = 'study-library-record';
            article.dataset.recordId = record.id;
            const top = document.createElement('div');
            top.className = 'study-library-record-heading';
            const title = document.createElement('h2');
            title.textContent = record.entry?.word || '(未命名记录)';
            const state = document.createElement('p');
            state.className = 'study-library-state';
            state.textContent = stateSummary(record);
            top.append(title, state);
            article.append(top);
            if (record.entry?.sentence) {
                const sentence = document.createElement('p');
                sentence.className = 'study-library-sentence';
                sentence.textContent = record.entry.sentence;
                article.append(sentence);
            }
            const legacyLocator = parseLegacySourceLocator(record.entry?.context);
            if (record.entry?.context && !legacyLocator) {
                const context = document.createElement('p');
                context.className = 'study-library-context';
                context.textContent = record.entry.context;
                article.append(context);
            }
            let sourceName = record.entry?.title?.trim() ?? '';
            if (!sourceName && typeof legacyLocator?.title === 'string') { sourceName = legacyLocator.title.trim(); }
            if (!sourceName && record.entry?.url) {
                try {
                    sourceName = new URL(record.entry.url).hostname.replace(/^www\./, '');
                } catch { /* Keep malformed source URLs out of the visible source label. */ }
            }
            if (!sourceName && legacyLocator?.kind === 'article') { sourceName = '文章'; }
            if (sourceName) {
                const sourceLine = document.createElement('p');
                sourceLine.className = 'study-library-source';
                const label = document.createElement('span');
                label.textContent = '来源：';
                const name = document.createElement('strong');
                name.textContent = sourceName;
                sourceLine.append(label, name);
                article.append(sourceLine);
            }
            const technicalDetails = makeTechnicalDetails(record.path, record.entry?.subtitleSource, legacyLocator);
            if (technicalDetails) { article.append(technicalDetails); }
            const actions = document.createElement('div');
            actions.className = 'study-library-actions';
            const resume = document.createElement('a');
            resume.className = 'study-library-primary-action';
            resume.href = createResumeUrl(record, chrome.runtime.getURL('/search.html'));
            resume.target = '_blank';
            resume.rel = 'noopener noreferrer';
            resume.textContent = '继续学习 ↗';
            actions.append(resume);
            if (record.openUrl) {
                const note = document.createElement('a');
                note.href = record.openUrl;
                note.target = '_blank';
                note.rel = 'noopener noreferrer';
                note.textContent = '打开原笔记 ↗';
                actions.append(note);
            }
            const ids = noteIds(record);
            if (ids.length > 0) {
                const anki = document.createElement('button');
                anki.type = 'button';
                anki.textContent = 'Anki 查看';
                anki.addEventListener('click', () => {
                    anki.disabled = true;
                    void application.api.viewNotes(ids, 'browse', false)
                        .catch((error) => setStatus(error instanceof Error ? `Anki 尚未打开或卡片不可用：${error.message}` : 'Anki 查看未完成。'))
                        .finally(() => { anki.disabled = false; });
                });
                actions.append(anki);
            }
            if (record.entry?.url) {
                let sourceUrl = record.entry.url;
                try {
                    const parsed = new URL(sourceUrl);
                    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(parsed.hostname) && typeof record.entry.videoTime === 'number') {
                        parsed.searchParams.set('t', `${Math.max(0, Math.floor(record.entry.videoTime))}s`);
                        sourceUrl = parsed.href;
                    }
                    if (['http:', 'https:'].includes(parsed.protocol)) {
                        const source = document.createElement('a');
                        source.href = sourceUrl;
                        source.target = '_blank';
                        source.rel = 'noopener noreferrer';
                        source.textContent = '打开来源 ↗';
                        actions.append(source);
                    }
                } catch { /* Invalid or local source URLs remain visible through note text. */ }
            }
            const favorite = document.createElement('button');
            favorite.type = 'button';
            favorite.textContent = record.favorite ? '★ 已收藏' : '☆ 收藏';
            favorite.setAttribute('aria-pressed', `${record.favorite === true}`);
            favorite.addEventListener('click', () => {
                favorite.disabled = true;
                void studyCall('libraryFavorite', {id: record.id, language: 'en', favorite: record.favorite !== true}).then((value) => {
                    const updated = normalizeRecord(value, record.id);
                    if (updated) {
                        records.set(record.id, updated);
                    } else {
                        record.favorite = record.favorite !== true;
                    }
                    render();
                    setStatus((updated?.favorite ?? record.favorite) ? '已收藏到学习库。' : '已从学习库收藏中移除。');
                }).catch((error) => setStatus(error instanceof Error ? error.message : '收藏状态未改变。'))
                    .finally(() => { favorite.disabled = false; });
            });
            actions.append(favorite);
            const refresh = document.createElement('button');
            refresh.type = 'button';
            refresh.textContent = '刷新 / 同步';
            refresh.addEventListener('click', () => {
                refresh.disabled = true;
                void refreshOne(record.id).catch((error) => setStatus(error instanceof Error ? error.message : '同步尚未完成。')).finally(() => { refresh.disabled = false; });
            });
            actions.append(refresh);
            article.append(actions);
            const conflicts = renderConflicts(record);
            if (conflicts) { article.append(conflicts); }
            return article;
        }

        /**
         * @param {LocalSavedWord} saved
         * @returns {HTMLElement}
         */
        function makeLocalFavoriteCard(saved) {
            const article = document.createElement('article');
            article.className = 'study-library-record study-library-local-favorite';
            article.dataset.recordId = saved.id;
            const title = document.createElement('h2');
            title.textContent = saved.word || '(未命名收藏)';
            const state = document.createElement('p');
            state.className = 'study-library-state';
            state.textContent = saved.syncPending ? '已收藏待学 · 正等待同步确认' : '已收藏待学 · 尚未确认笔记和复习状态';
            article.append(title, state);
            const sentence = document.createElement('p');
            sentence.className = 'study-library-sentence';
            sentence.textContent = saved.sentence;
            article.append(sentence);
            const legacyLocator = parseLegacySourceLocator(saved.context);
            if (saved.context && !legacyLocator) {
                const context = document.createElement('p');
                context.className = 'study-library-context';
                context.textContent = saved.context;
                article.append(context);
            }
            let sourceName = saved.title?.trim() ?? '';
            if (!sourceName && typeof legacyLocator?.title === 'string') { sourceName = legacyLocator.title.trim(); }
            if (!sourceName && saved.url) {
                try {
                    sourceName = new URL(saved.url).hostname.replace(/^www\./, '');
                } catch { /* Keep malformed source URLs out of the visible source label. */ }
            }
            if (!sourceName && legacyLocator?.kind === 'article') { sourceName = '文章'; }
            if (sourceName) {
                const sourceLine = document.createElement('p');
                sourceLine.className = 'study-library-source';
                const label = document.createElement('span');
                label.textContent = '来源：';
                const name = document.createElement('strong');
                name.textContent = sourceName;
                sourceLine.append(label, name);
                article.append(sourceLine);
            }
            const technicalDetails = makeTechnicalDetails(null, null, legacyLocator);
            if (technicalDetails) { article.append(technicalDetails); }
            const actions = document.createElement('div');
            actions.className = 'study-library-actions';
            const resume = document.createElement('a');
            resume.className = 'study-library-primary-action';
            resume.href = createResumeUrl({entry: saved}, chrome.runtime.getURL('/search.html'));
            resume.target = '_blank';
            resume.rel = 'noopener noreferrer';
            resume.textContent = '继续学习 ↗';
            actions.append(resume);
            if (saved.url) {
                try {
                    const parsed = new URL(saved.url);
                    if (['http:', 'https:'].includes(parsed.protocol)) {
                        const source = document.createElement('a');
                        source.href = parsed.href;
                        source.target = '_blank';
                        source.rel = 'noopener noreferrer';
                        source.textContent = '打开来源 ↗';
                        actions.append(source);
                    }
                } catch { /* Keep malformed or local source values out of clickable links. */ }
            }
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '取消收藏';
            remove.addEventListener('click', () => {
                remove.disabled = true;
                void studyCall('removeWord', {id: saved.id}).then(async () => {
                    updateLoadedFavorite(saved, false);
                    await refreshSavedWords();
                    setStatus('已取消收藏；原有笔记和复习卡仍保留。');
                }).catch((error) => setStatus(error instanceof Error ? `取消收藏未完成：${error.message}` : '取消收藏未完成；原收藏仍保留。'))
                    .finally(() => { remove.disabled = false; });
            });
            actions.append(remove);
            const sync = document.createElement('button');
            sync.type = 'button';
            sync.dataset.localFavoriteSync = saved.id;
            sync.textContent = saved.syncPending ? '重试同步收藏' : '同步收藏';
            sync.addEventListener('click', () => { void syncLocalFavorite(saved, sync); });
            actions.append(sync);
            article.append(actions);
            return article;
        }

        /**
         * @param {LocalSavedWord} saved
         * @param {HTMLButtonElement} button
         * @returns {Promise<void>}
         */
        async function syncLocalFavorite(saved, button) {
            button.disabled = true;
            setStatus('正在同步这条本地收藏；不会调用模型或创建复习卡。');
            try {
                await studyCall('saveWord', {
                    language: saved.language ?? 'en',
                    word: saved.word,
                    sentence: saved.sentence,
                    context: saved.context ?? '',
                    url: saved.sourceUrl ?? saved.url ?? '',
                    title: saved.title ?? '',
                    ...(typeof saved.videoTime === 'number' ? {videoTime: saved.videoTime} : {}),
                });
                await loadPage(true);
                setStatus('已提交这条收藏同步；请以刷新后的 Obsidian / Anki 状态为准。');
            } catch (error) {
                setStatus(error instanceof Error ? `本地收藏未同步：${error.message}` : '本地收藏未同步；原收藏仍保留。');
            } finally {
                button.disabled = false;
            }
        }

        /** @returns {void} */
        function render() {
            list.replaceChildren();
            const query = search.value.trim();
            const rows = [...records.values()].filter((record) => matchesCategory(record, category) && matchesSearch(record, query));
            const localRows = category === 'favorites' ? savedWords.filter((saved) => !hasNativeFavorite(saved) && matchesSearch(saved, query)) : [];
            if (rows.length + localRows.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'study-library-empty';
                if (category === 'favorites' && savedReadError) {
                    empty.textContent = `本地收藏读取失败，不能确认是否为空：${savedReadError}`;
                } else if (listError) {
                    empty.textContent = `学习库未能核对，不能确认此分类为空：${listError}`;
                } else if (loaded) {
                    empty.textContent = query ? '当前已加载记录中没有匹配结果。' : '这个分类暂时没有已读取的记录。';
                } else {
                    empty.textContent = '正在读取学习库…';
                }
                list.append(empty);
            } else {
                for (const record of rows) { list.append(makeCard(record)); }
                for (const saved of localRows) { list.append(makeLocalFavoriteCard(saved)); }
            }
            more.hidden = loading || offset >= total;
            more.disabled = loading;
            const loadedLabel = `已读取 ${records.size} / ${total} 条`;
            if (query && offset < total) { setStatus(`${loadedLabel} · 搜索范围仅包含已读取部分，继续加载可扩大搜索。`); }
        }

        /**
         * @param {string} id
         * @param {{resolutions?: Record<string, 'local'|'remote'>}} [options]
         * @returns {Promise<void>}
         */
        async function refreshOne(id, options = {}) {
            setStatus('正在刷新该条记录的 Obsidian / Anki 状态…');
            const previous = records.get(id);
            try {
                const value = await studyCall('libraryReconcile', {id, language: previous?.entry?.language ?? 'en', ...options});
                const updated = normalizeRecord(value, id);
                if (!updated) { throw new Error('刷新没有返回这条记录。'); }
                records.set(id, {...updated, reconcileState: 'verified'});
                render();
                setStatus(Array.isArray(updated.conflicts) && updated.conflicts.length > 0 ? `已读取 ${updated.conflicts.length} 个字段冲突，请逐项选择。` : '该条记录已刷新。');
            } catch (error) {
                const message = error instanceof Error ? error.message : '刷新失败。';
                if (previous) { records.set(id, {...previous, reconcileState: 'failed', reconcileError: message}); }
                render();
                setStatus(`该条记录未核对最新状态，保留了原显示：${message}`);
            }
        }

        /** @param {boolean} reset */
        async function loadPage(reset) {
            if (loading) { return; }
            loading = true;
            more.disabled = true;
            setStatus(reset ? '正在读取学习库…' : '正在读取下一页…');
            render();
            const start = reset ? 0 : offset;
            syncPendingError = '';
            try {
                const pending = await studyCall('syncPending');
                pendingSyncCount = Array.isArray(pending) ? pending.length : 0;
            } catch (error) {
                syncPendingError = error instanceof Error ? error.message : '待同步队列检查失败。';
            }
            await refreshSavedWords();
            try {
                const value = await studyCall('libraryList', {language: 'en', url: '', title: '', scope: 'all', offset: start});
                const page = normalizeRecords(value).slice(0, PAGE_SIZE);
                if (reset) { records.clear(); }
                for (const record of page) {
                    if (record && typeof record.id === 'string') { records.set(record.id, {...record, reconcileState: 'checking'}); }
                }
                const result = value && typeof value === 'object' ? /** @type {{total?: unknown}} */ (value) : {};
                total = typeof result.total === 'number' && Number.isFinite(result.total) ? result.total : start + page.length;
                offset = start + page.length;
                loaded = true;
                listError = '';
                const target = value && typeof value === 'object' ? /** @type {{target?: {deck?: string, model?: string}}} */ (value).target : null;
                render();
                for (const record of page) {
                    if (!record || typeof record.id !== 'string') { continue; }
                    try {
                        const latest = await studyCall('libraryReconcile', {id: record.id, language: record.entry?.language ?? 'en'});
                        const reconciled = normalizeRecord(latest, record.id);
                        if (!reconciled) { throw new Error('刷新没有返回这条记录。'); }
                        records.set(record.id, {...reconciled, reconcileState: 'verified'});
                    } catch (error) {
                        records.set(record.id, {...record, reconcileState: 'failed', reconcileError: error instanceof Error ? error.message : '刷新失败。'});
                    }
                    render();
                }
                const unchecked = page.filter((record) => records.get(record.id)?.reconcileState === 'failed').length;
                let syncLabel = '待同步队列已检查';
                if (syncPendingError) {
                    syncLabel = `待同步队列未能核对：${syncPendingError}`;
                } else if (pendingSyncCount > 0) {
                    syncLabel = `仍有 ${pendingSyncCount} 项待同步`;
                }
                const checkLabel = unchecked > 0 ? `本页 ${unchecked} 条未核对最新状态` : `本页 ${page.length} 条已逐条核对`;
                setStatus(`已读取 ${records.size} / ${total} 条 · ${syncLabel} · ${checkLabel}${target?.deck ? ` · 牌组：${target.deck}` : ''}${target?.model ? ` · 模板：${target.model}` : ''}${savedReadError ? ` · 本地收藏读取失败：${savedReadError}` : ''}`);
            } catch (error) {
                listError = error instanceof Error ? error.message : '学习库读取失败。';
                setStatus(`${listError}${loaded ? ' 上次已读取的记录仍保留。' : ' 未读到记录，不代表学习库为空。'}${savedWords.length > 0 ? ` 本地收藏仍有 ${savedWords.length} 条。` : ''}`);
            } finally {
                loading = false;
                render();
            }
        }

        const exportSavedButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('study-library-export-saved'));
        const clearSavedButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('study-library-clear-saved'));
        exportSavedButton?.addEventListener('click', () => {
            exportSavedButton.disabled = true;
            void (async () => {
                const saved = normalizeSavedWords(await studyCall('saved'));
                const url = URL.createObjectURL(new Blob([JSON.stringify({format: 'study-saved-v1', saved}, null, 2)], {type: 'application/json'}));
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = '英语学习-收藏语境.json';
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 30000);
                setStatus(`已导出 ${saved.length} 条扩展中已收集收藏；包含已读取的同步收藏，未加载的原生收藏不会自动读入。`);
            })().catch((error) => setStatus(error instanceof Error ? `收藏导出未完成：${error.message}` : '收藏导出未完成。'))
                .finally(() => { exportSavedButton.disabled = false; });
        });
        clearSavedButton?.addEventListener('click', () => {
            // eslint-disable-next-line no-alert
            if (!confirm('清空扩展中已收集的收藏（包含已读取的同步收藏）？未加载的原生收藏不在内。只取消收藏标记，保留 Obsidian 笔记和 Anki 卡片。')) { return; }
            clearSavedButton.disabled = true;
            if (exportSavedButton) { exportSavedButton.disabled = true; }
            void (async () => {
                const saved = normalizeSavedWords(await studyCall('saved'));
                if (saved.length === 0) {
                    await refreshSavedWords();
                    setStatus('当前没有扩展中已收集的收藏；笔记和复习卡不受影响。');
                    return;
                }
                let removed = 0;
                /** @type {string[]} */
                const failed = [];
                for (const row of saved) {
                    try {
                        await studyCall('removeWord', {id: row.id});
                        updateLoadedFavorite(row, false);
                        removed++;
                    } catch {
                        failed.push(row.word || '未命名收藏');
                    }
                }
                await refreshSavedWords();
                if (failed.length > 0) {
                    const first = failed[0];
                    setStatus(`已移除 ${removed} 条 · ${failed.length} 条未完成，仍保留${first ? `（如：${first}）` : ''}。已关联的星标等待同步确认；笔记和卡片未删除。`);
                } else {
                    setStatus(`已移除 ${removed} 条收藏标记；已关联的星标等待同步确认。笔记和卡片未删除。`);
                }
            })().catch((error) => setStatus(error instanceof Error ? `收藏清理未完成，原收藏仍保留：${error.message}` : '收藏清理未完成，原收藏仍保留。'))
                .finally(() => {
                    clearSavedButton.disabled = false;
                    if (exportSavedButton) { exportSavedButton.disabled = false; }
                });
        });

        for (const button of document.querySelectorAll('[data-library-category]')) {
            button.addEventListener('click', () => {
                category = /** @type {HTMLElement} */ (button).dataset.libraryCategory ?? 'all';
                for (const tab of document.querySelectorAll('[data-library-category]')) {
                    tab.setAttribute('aria-pressed', `${tab === button}`);
                }
                render();
            });
        }
        search.addEventListener('input', render);
        more.addEventListener('click', () => { void loadPage(false); });
        document.getElementById('study-library-refresh')?.addEventListener('click', () => { void loadPage(true); });
        chrome.storage?.onChanged?.addListener((changes, area) => {
            if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, 'studySavedWordsV1')) {
                void refreshSavedWords();
            }
        });
        await loadPage(true);
    });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined') { void initializePage(); }
