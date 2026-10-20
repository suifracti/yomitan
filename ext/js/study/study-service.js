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

import {mediaKeyOf, timedUrl} from './media-key.js';
import {StudySync} from './study-sync.js';
import {SubtitleTranslation} from './subtitle-translation.js';
import {log} from '../core/log.js';
import {AUTO_SYNC_KEY, AUTO_SYNC_STATE_KEY, WORD_STATUS_KEY, CACHE_KEY, CACHE_LIMIT, DETAIL_KEY, detailSource, DICTIONARY_CACHE_KEY, dictionaryKey, dictionaryLookup, isDictionaryResult, isStudyResult, resultKey, SAVED_KEY, SAVE_TARGETS_KEY, sentenceKey, SETTINGS_KEY, studyConfig, studyLookup, TTL} from './study-data.js';
import {StudyJournal, sourceKey} from './study-journal.js';
import {nativeStudyCall} from './study-client.js';
import {attestStudyCue} from './study-cue-attestation.js';
import {prepareStudyCompanion} from './study-companion.js';
import {normalizeSubtitlePrefs, SUBTITLE_PREFS_KEY, TRANSLATION_PREFS_KEY} from './subtitle-prefs.js';

/** @type {WeakSet<object>} */
const preparedRuntimes = new WeakSet();

/**
 * Chrome storage may reorder object keys; compare the complete JSON snapshot structurally.
 * @param {unknown} value
 * @returns {string|undefined}
 */
const cueIntentFingerprint = (value) => JSON.stringify(value, (_key, /** @type {unknown} */ part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) { return part; }
    return Object.fromEntries(Object.entries(/** @type {Record<string, unknown>} */ (part)).sort(([a], [b]) => a.localeCompare(b)));
});

export class StudyService {
    /** @type {boolean} */
    #autoSyncing = false;

    /** @type {Map<string, {entry: import('study').LibraryEntry, owner: string, sender: chrome.runtime.MessageSender}>} */
    #verifiedCues = new Map();
    /** @type {Map<number, string>} */
    #cueQueries = new Map();
    /** @type {Map<string, Promise<import('study').LibraryRecord>>} */
    #cueSaves = new Map();
    /** @type {Promise<import('study').LibraryRecord[]> | null} */
    #cueResume = null;
    /** @type {Map<string, string>} */
    #cueSessions = new Map();
    /** @type {Map<string, {requestId: string, cancelled: boolean, cancel: () => void}>} */
    #cueRuns = new Map();
    /** @type {Map<string, Promise<import('study').LibraryRecord>>} */
    #cueSaving = new Map();
    /** @type {Map<string, () => Promise<void>>} */
    #cueSaveGuards = new Map();
    /** @type {Map<string, Promise<void>>} */
    #cueChecks = new Map();
    /** @type {(() => boolean)|null} */
    #cueJournalGuard = null;

    /**
     *
     * @param {import('study').Storage} storage
     * @param {import('study').NativeCall} [native]
     */
    constructor(storage, native = nativeStudyCall) {
        /** @type {import('study').Storage} */
        this.storage = storage;
        /** @type {import('study').NativeCall} */
        this.native = native;
        /** @type {Map<string, {promise: Promise<import('study').Result>, cancel: () => void}>} */
        this.pending = new Map();
        /** @type {Map<string, {promise: Promise<import('study').DictionaryResult>, cancel: () => void, lookup: import('study').DictionaryLookup}>} */
        this.dictionaryPending = new Map();
        /** @type {SubtitleTranslation} */
        this.subtitles = new SubtitleTranslation(this);
        /** @type {number} */
        this.epoch = 0;
        /** @type {Promise<void>} */
        this.writes = Promise.resolve();
        /** @type {StudyJournal} */
        this.journal = new StudyJournal(this);
        /**
         *
         */
        this.sync = new StudySync(this);
        /** @type {Map<string, {generation: number, active: number}>} */
        this.cancelScopes = new Map();
        /** @type {Map<string, Promise<import('study').LibraryRecord>>} */
        this.rememberPending = new Map();
        /** @type {Map<string, Promise<import('study').LibraryRecord>>} */
        this.rememberSavePending = new Map();
    }

    /**
     * Reads the saved words and their status from the bridge for page colouring.
     * Only words and statuses are stored; nothing else from the notes.
     * @returns {Promise<void>}
     */
    async refreshWordStatus() {
        if (typeof chrome === 'undefined' || !await chrome.permissions?.contains?.({permissions: ['nativeMessaging']})) { return; }
        try {
            const response = await this.native({action: 'libraryWordStatus'}).promise;
            // v1: {words: {word: status}}; v2 adds per-word details and saved phrases (docs/roadmap-2026-10.md).
            const library = /** @type {{words?: unknown, phrases?: unknown, version?: unknown}|undefined} */ (response.library);
            const words = library?.words;
            const phrases = library?.phrases && typeof library.phrases === 'object' ? library.phrases : {};
            if (response.ok && words && typeof words === 'object') { await this.write(WORD_STATUS_KEY, () => ({at: Date.now(), version: library?.version === 2 ? 2 : 1, words, phrases})); }
        } catch { /* Keep the last list; colouring is optional. */ }
    }

    /**
     * One automatic Obsidian↔Anki pass, run by an alarm about every 30 seconds.
     * Skips quietly when the learner turned it off or never granted the bridge.
     * @returns {Promise<void>}
     */
    async autoSync() {
        if (this.#autoSyncing) { return; }
        const settings = /** @type {{enabled?: unknown}|undefined} */ (await this.read(AUTO_SYNC_KEY));
        if (settings?.enabled === false) { return; }
        if (typeof chrome === 'undefined' || !await chrome.permissions?.contains?.({permissions: ['nativeMessaging']})) { return; }
        this.#autoSyncing = true;
        try {
            const response = await this.native({action: 'libraryAutoSync'}).promise;
            const result = response.ok ? /** @type {Record<string, unknown>} */ (response.library) : {error: response.error ?? '自动同步未完成。'};
            await this.write(AUTO_SYNC_STATE_KEY, () => ({...result, at: Date.now()}));
        } catch (error) {
            await this.write(AUTO_SYNC_STATE_KEY, (old) => {
                const previous = /** @type {Record<string, unknown>|undefined} */ (old);
                return {...previous, error: error instanceof Error ? error.message : '自动同步未完成。', at: Date.now()};
            });
        } finally {
            await this.refreshTodayBadge();
            this.#autoSyncing = false;
        }
    }

    /** @returns {Promise<void>} */
    async refreshTodayBadge() {
        let text = '';
        try {
            const response = await this.native({action: 'ankiToday'}).promise;
            const today = /** @type {{due: number, paused?: boolean}} */ (response.library);
            if (response.ok && !today.paused && today.due > 0) { text = String(today.due); }
        } catch { /* An old or disconnected bridge simply has no badge. */ }
        await chrome.action.setBadgeText({text});
    }

    /**
     * Only the existing private consume chain can populate this store. No save endpoint is installed.
     * @param {Pick<typeof chrome.runtime, 'id'|'sendMessage'>} runtime
     * @param {chrome.runtime.MessageSender} sender
     * @param {{queryId?: string, cue?: Record<string, unknown>}} data
     * @returns {Promise<Record<string, unknown>>}
     */
    async attestCue(runtime, sender, data) {
        const denied = {ok: false, writeAuthorized: false};
        const tab = sender.tab?.id;
        if (sender.id !== runtime.id || !Number.isInteger(tab) || sender.frameId !== 0 || !sender.documentId || !data.queryId) { return denied; }
        const slot = /** @type {number} */ (tab);
        const generation = crypto.randomUUID();
        this.#cueQueries.set(slot, generation);
        for (const [key, row] of this.#verifiedCues) {
            if (row.entry.subtitleSource?.provenance.tabId === slot) {
                this.#cueRuns.get(key)?.cancel();
                this.#verifiedCues.delete(key);
                this.#cueSessions.delete(key);
            }
        }
        const result = await attestStudyCue(runtime, sender, data);
        if (!result.ok || this.#cueQueries.get(slot) !== generation) { return denied; }
        const c = /** @type {Record<string, unknown>} */ (result.cue);
        const fields = ['version', 'sourceRevision', 'text', 'cueIndex', 'trackIndex', 'trackName', 'language', 'originalStartMs', 'originalEndMs', 'subtitleOffsetMs', 'url', 'selectionStart', 'selectionEnd', 'word'];
        if (!c || Object.keys(c).length !== fields.length || fields.some((k) => !(k in c)) || c.version !== 1 ||
        !['en', 'ja'].includes(/** @type {string} */ (c.language)) ||
        ['text', 'word', 'trackName', 'sourceRevision'].some((k) => typeof c[k] !== 'string' || !c[k].trim()) ||
        ['cueIndex', 'trackIndex', 'originalStartMs', 'originalEndMs', 'subtitleOffsetMs', 'selectionStart', 'selectionEnd'].some((k) => !Number.isSafeInteger(c[k])) ||
        /** @type {number} */ (c.trackIndex) < 0 || /** @type {number} */ (c.cueIndex) < 0 ||
        /** @type {number} */ (c.originalStartMs) < 0 || /** @type {number} */ (c.originalEndMs) <= /** @type {number} */ (c.originalStartMs) ||
        /** @type {number} */ (c.selectionStart) < 0 || /** @type {number} */ (c.selectionEnd) <= /** @type {number} */ (c.selectionStart)) { return denied; }
        const text = /** @type {string} */ (c.text),
            word = /** @type {string} */ (c.word);
        if (text.length > 2400 || word.length > 128 || word !== word.trim() || text.slice(/** @type {number} */ (c.selectionStart), /** @type {number} */ (c.selectionEnd)) !== word) { return denied; }
        const url = new URL(/** @type {string} */ (c.url));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { return denied; }
        url.hash = '';
        const source = /** @type {import('study').SubtitleSourceV1} */ ({version: 1,
            url: url.href,
            language: c.language,
            trackIndex: c.trackIndex,
            trackName: c.trackName,
            text,
            originalStartMs: c.originalStartMs,
            originalEndMs: c.originalEndMs,
            subtitleOffsetMs: c.subtitleOffsetMs,
            selectionStart: c.selectionStart,
            selectionEnd: c.selectionEnd,
            word,
            provenance: {queryId: data.queryId,
                sourceRevision: c.sourceRevision,
                cueIndex: c.cueIndex,
                tabId: slot,
                frameId: 0,
                documentId: sender.documentId}});
        const returned = /** @type {{title?: string}} */ (result.source);
        const entry = {word,
            sentence: text,
            language: source.language,
            context: '',
            meaning: '',
            translation: '',
            notes: '',
            url: source.url,
            title: (returned.title ?? '').slice(0, 300),
            subtitleSource: source};
        if (this.#verifiedCues.size >= 128) { return denied; }
        this.#verifiedCues.set(data.queryId, {entry: structuredClone(entry), sender: structuredClone(sender), owner: JSON.stringify([sender.id, slot, sender.frameId, sender.documentId, sender.url])});
        return result; // still writeAuthorized:false; the page never receives an internal save capability.
    }

    /**
     * Revalidate the original top-level document and private ASB cue; no UI source fields are accepted.
     * @param {Pick<typeof chrome.runtime, 'id'|'sendMessage'>} runtime
     * @param {string} queryId
     * @returns {Promise<void>}
     */
    async #liveCue(runtime, queryId) {
        let checking = this.#cueChecks.get(queryId);
        if (!checking) {
            checking = this.#checkCueLive(runtime, queryId).finally(() => { this.#cueChecks.delete(queryId); });
            this.#cueChecks.set(queryId, checking);
        }
        await checking;
    }

    /**
     * @param {Pick<typeof chrome.runtime, 'id'|'sendMessage'>} runtime
     * @param {string} queryId
     * @param {'revalidate'|'seek'} [phase]
     * @returns {Promise<void>}
     */
    async #checkCueLive(runtime, queryId, phase = 'revalidate') {
        const row = this.#verifiedCues.get(queryId);
        const s = row?.entry.subtitleSource;
        if (!row || !s || s.language !== 'en') { throw new Error('当前英文字幕来源未确认或查询已失效。'); }
        const p = s.provenance;
        const live = /** @type {{ok?: boolean}|undefined} */ (await chrome.tabs.sendMessage(
            p.tabId,
            {action: 'studyCueValidate', params: {queryId}},
            {frameId: 0, documentId: p.documentId},
        ));
        const cue = {version: 1,
            sourceRevision: p.sourceRevision,
            text: s.text,
            cueIndex: p.cueIndex,
            trackIndex: s.trackIndex,
            trackName: s.trackName,
            language: s.language,
            originalStartMs: s.originalStartMs,
            originalEndMs: s.originalEndMs,
            subtitleOffsetMs: s.subtitleOffsetMs,
            url: row.sender.url,
            selectionStart: s.selectionStart,
            selectionEnd: s.selectionEnd,
            word: s.word};
        const confirmed = live?.ok ? await attestStudyCue(runtime, row.sender, {queryId, cue, phase: /** @type {'revalidate'|'seek'} */ (phase)}) : null;
        if (!confirmed?.ok || this.#verifiedCues.get(queryId) !== row) {
            this.#verifiedCues.delete(queryId);
            this.#cueRuns.get(queryId)?.cancel();
            throw new Error('字幕选区、轨道或所属页面已改变；没有写入新的学习结果。');
        }
    }

    /**
     * Narrow popup reference-only actions; public R1 dispatch never accepts subtitle payloads.
     * @param {Pick<typeof chrome.runtime, 'id'|'sendMessage'|'getURL'>} runtime
     * @param {chrome.runtime.MessageSender} sender
     * @param {unknown} value
     * @returns {Promise<unknown>}
     */
    async cueAction(runtime, sender, value) {
        const data = /** @type {{queryId?: string, action?: string, question?: string, requestId?: string}} */ (value ?? {});
        const row = this.#verifiedCues.get(data.queryId ?? '');
        const queryId = data.queryId ?? '';
        if (!value || typeof value !== 'object' || Object.keys(value).some((k) => !['queryId', 'action', 'question', 'requestId'].includes(k)) ||
        !row || sender.id !== runtime.id || sender.url !== runtime.getURL('popup.html') ||
        sender.tab?.id !== row.entry.subtitleSource?.provenance.tabId || !sender.documentId || !Number.isInteger(sender.frameId) || /** @type {number} */ (sender.frameId) <= 0 ||
        !['open', 'generate', 'save', 'remember', 'cancel', 'return'].includes(data.action ?? '')) { throw new Error('字幕学习会话身份无效；没有调用模型或保存。'); }
        const owner = JSON.stringify([sender.id, sender.tab?.id, sender.frameId, sender.documentId, sender.url]);
        const bound = this.#cueSessions.get(queryId);
        if (bound && bound !== owner) { throw new Error('字幕学习弹窗身份已改变。'); }
        if (data.action === 'cancel') {
            const run = this.#cueRuns.get(queryId);
            if (bound === owner && run && run.requestId === data.requestId) { run.cancel(); }
            return true;
        }
        /** @type {{requestId: string, cancelled: boolean, cancel: () => void}|null} */
        let run = null;
        if (data.action === 'generate') {
            if (typeof data.question !== 'string' || data.question.length > 500 || typeof data.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(data.requestId)) { throw new Error('字幕追问参数无效。'); }
            if (this.#cueRuns.has(queryId) || this.#cueSaving.has(queryId)) { throw new Error('本句操作尚未完成，请稍后。'); }
            const pending = {requestId: data.requestId, cancelled: false, cancel: () => {}};
            pending.cancel = () => { pending.cancelled = true; };
            run = pending;
            this.#cueRuns.set(queryId, pending);
            this.#cueSessions.set(queryId, owner);
        }
        try {
            await this.#liveCue(runtime, queryId);
            if (data.action === 'return') {
                await this.#checkCueLive(runtime, queryId, 'seek');
                return true;
            }
            if (run?.cancelled) { throw new Error('已取消，未启动模型请求。'); }
            if (this.#cueSessions.has(queryId) && this.#cueSessions.get(queryId) !== owner) { throw new Error('字幕弹窗已失效。'); }
            this.#cueSessions.set(queryId, owner);
            if (data.action === 'open') { return {turns: await this.journal.conversation(row.entry)}; }
            if (data.action === 'save' || data.action === 'remember') {
                let saving = this.#cueSaving.get(queryId);
                if (!saving) {
                    saving = (async () => {
                        if (this.#cueRuns.has(queryId)) { throw new Error('请先完成或取消当前回答；草稿不会保存。'); }
                        this.#cueSaveGuards.set(queryId, () => this.#liveCue(runtime, queryId));
                        // Remember saves notes only, just like an ordinary word.
                        return await this.saveVerifiedCue(queryId, row.sender);
                    })().finally(() => { this.#cueSaving.delete(queryId); this.#cueSaveGuards.delete(queryId); });
                    this.#cueSaving.set(queryId, saving);
                }
                return await saving;
            }
            if (!run || typeof data.question !== 'string') { throw new Error('字幕追问参数无效。'); }
            const config = studyConfig(await this.read(SETTINGS_KEY));
            const recent = await this.journal.conversation(row.entry);
            await this.#liveCue(runtime, queryId);
            if (run.cancelled) { throw new Error('已取消。'); }
            const call = this.native({action: 'explain',
                language: 'en',
                word: row.entry.word,
                sentence: row.entry.sentence,
                context: '',
                question: data.question.trim(),
                config: {model: config.model, effort: config.effort},
                learningMemory: JSON.stringify({saved: {items: [], total: 0}, recent: recent.slice(-6), earlierLocalTurnsNotIncluded: Math.max(0, recent.length - 6)})});
            run.cancel = () => {
                run.cancelled = true;
                call.cancel();
            };
            const response = await call.promise;
            if (run.cancelled || response.ok !== true || !isStudyResult(response.result) || !response.result.meaning.trim()) { throw new Error(response.error ?? '回答未完成；已完成问答保留。'); }
            await this.#liveCue(runtime, queryId);
            if (run.cancelled) { throw new Error('已取消，未写入迟到回答。'); }
            // append enters service.write synchronously; write captures this guard before its storage awaits.
            this.#cueJournalGuard = () => !run.cancelled && this.#verifiedCues.get(queryId) === row;
            const appending = this.journal.append({...row.entry, question: data.question.trim()}, response.result, 'unconfirmed', response.usage);
            this.#cueJournalGuard = null;
            await appending;
            return response.result;
        } finally {
            if (run && this.#cueRuns.get(queryId) === run) { this.#cueRuns.delete(queryId); }
        }
    }

    /**
     * Internal contract only, deliberately absent from receive/handle dispatch.
     * @param {string} queryId
     * @param {chrome.runtime.MessageSender} sender
     * @returns {Promise<import('study').LibraryRecord>}
     */
    async saveVerifiedCue(queryId, sender) {
        const row = this.#verifiedCues.get(queryId);
        if (!row || row.owner !== JSON.stringify([sender.id, sender.tab?.id, sender.frameId, sender.documentId, sender.url])) {
            throw new Error('字幕来源未确认或当前查询已失效；没有保存。');
        }
        const key = sourceKey(row.entry);
        const turns = structuredClone(await this.journal.get(row.entry));
        await this.#cueSaveGuards.get(queryId)?.();
        if (this.#verifiedCues.get(queryId) !== row) { throw new Error('字幕查询已失效；没有排入保存意图。'); }
        const targetId = await this.resolveSaveTarget(row.entry);
        await this.#cueSaveGuards.get(queryId)?.();
        /** @type {import('study').CueSaveIntent} */
        let task = {key, entry: structuredClone(row.entry), turns, ...(targetId ? {targetId} : {})};
        await this.write('studyCueSaveIntentsV1', (value) => {
            if (this.#verifiedCues.get(queryId) !== row) { throw new Error('字幕查询已失效；没有排入保存意图。'); }
            const rows = /** @type {import('study').CueSaveIntent[]} */ (Array.isArray(value) ? value : []);
            const previous = rows.find((r) => r.key === key);
            if (previous) {
                task = previous;
                return rows;
            }
            const next = [...rows, task];
            if (new TextEncoder().encode(JSON.stringify(next)).length > 2000000) { throw new Error('字幕待保存意图已满，请先恢复。'); }
            return next;
        });
        return await this.resumeCueIntent(task);
    }

    /**
     * @param {{id: string, language: string, key: string, source: NonNullable<import('study').LibraryEntry['subtitleSource']>}} task
     * @param {(() => Promise<unknown>) | null} [check]
     * @returns {Promise<import('study').LibraryRecord>}
     */
    async #rememberCue(task, check = null) {
        if (!task || Object.keys(task).sort().join(',') !== 'id,key,language,source' || !/^[a-f0-9]{32}$/.test(task.id) ||
        task.language !== 'en' || task.source?.version !== 1 || !task.key?.startsWith('r2:')) { throw new Error('字幕记住意图无效，未制卡。'); }
        await check?.();
        const read = await this.native({action: 'libraryRead', ids: [task.id], language: task.language}).promise;
        const materials = /** @type {{items?: import('study').LearningMaterial[]}} */ (read.library);
        const entry = materials?.items?.[0]?.record?.entry;
        if (!read.ok || !entry || sourceKey(entry) !== task.key ||
        sourceKey({...entry, subtitleSource: task.source}) !== task.key || !entry.subtitleSource) { throw new Error('字幕记住意图与记录来源不一致。'); }
        const record = materials?.items?.[0]?.record;
        if (record?.ankiEnabled === false) { return record; }
        // Old durable intents may retry already-confirmed cards, never select new ones.
        const row = await this.remember({id: task.id, language: task.language});
        if (row.ankiState !== 'pending') {
            await this.write('studyCueRememberIntentsV1', (v) => (/** @type {typeof task[]} */ (Array.isArray(v) ? v : [])).filter((r) => r.id !== task.id || cueIntentFingerprint(r) !== cueIntentFingerprint(task)));
        }
        return row;
    }

    /** @returns {Promise<void>} */
    async resumeCueRemembers() {
        const tasks = await this.read('studyCueRememberIntentsV1');
        if (typeof tasks === 'undefined') { return; }
        if (!Array.isArray(tasks)) { throw new Error('字幕记住队列损坏，原值保留。'); }
        /** @type {string[]} */
        const errors = [];
        const rows = /** @type {{id: string, language: string, key: string, source: NonNullable<import('study').LibraryEntry['subtitleSource']>}[]} */ (tasks);
        for (const task of rows) {
            try { await this.#rememberCue(task); } catch (error) {
                errors.push(error instanceof Error ? error.message : '字幕记住未确认');
            }
        }
        await this.write('studyCueRememberResumeErrorsV1', () => errors);
    }

    /**
     * @param {import('study').CueSaveIntent} task
     * @returns {Promise<import('study').LibraryRecord>}
     */
    async resumeCueIntent(task) {
        // Durable intent is historical authority, not a new DOM/query capability. Never downgrade it to R1.
        const s = task?.entry?.subtitleSource,
            p = s?.provenance;
        if (!task || Object.keys(task).filter((k) => k !== 'targetId').sort()
            .join(',') !== 'entry,key,turns' || (typeof task.targetId !== 'undefined' && !/^[a-f0-9]{32}$/.test(task.targetId)) || !Array.isArray(task.turns) ||
            !s || s.version !== 1 || !p || p.frameId !== 0 || !Number.isSafeInteger(p.tabId) || p.tabId < 0 ||
            ![p.documentId, p.queryId, p.sourceRevision].every((v) => typeof v === 'string' && v.length > 0) ||
            !Number.isSafeInteger(p.cueIndex) || p.cueIndex < 0 ||
            task.key !== sourceKey(task.entry) || !task.key.startsWith('r2:') ||
            task.entry.word !== s.word || task.entry.sentence !== s.text || task.entry.url !== s.url || task.entry.language !== s.language ||
            !['en', 'ja'].includes(s.language)) {
            throw new Error('字幕保存意图损坏、版本不支持或来源身份不一致；保留意图，不降级为文章。');
        }
        let operation = this.#cueSaves.get(task.key);
        if (!operation) {
            operation = (async () => {
                const saved = /** @type {import('study').LibraryRecord} */ (await this.journal.save(task.entry, false, task.turns, task.targetId));
                if (saved.entry?.subtitleSource?.version !== 1 || sourceKey(saved.entry) !== task.key || !saved.vaultSaved) {
                    throw new Error('字幕保存身份回执不一致；意图保留，可重试。');
                }
                await this.write('studyCueSaveIntentsV1', (value) => (/** @type {import('study').CueSaveIntent[]} */ (Array.isArray(value) ? value : [])).filter((r) => cueIntentFingerprint(r) !== cueIntentFingerprint(task)));
                return saved;
            })().finally(() => { this.#cueSaves.delete(task.key); });
            this.#cueSaves.set(task.key, operation);
        }
        return await operation;
    }

    /**
     * Recovery of a previously explicit internal save; no re-attest against the new playing cue.
     * @returns {Promise<import('study').LibraryRecord[]>}
     */
    async resumeCueSaves() {
        if (!this.#cueResume) {
            this.#cueResume = (async () => {
                const value = await this.read('studyCueSaveIntentsV1');
                const result = [];
                /** @type {{index: number, error: string}[]} */
                const errors = [];
                if (typeof value !== 'undefined' && !Array.isArray(value)) {
                    errors.push({index: -1, error: '字幕保存意图队列格式损坏；原队列保留。'});
                } else {
                    const tasks = /** @type {import('study').CueSaveIntent[]} */ (value ?? []);
                    for (const [index, task] of tasks.entries()) {
                        try {
                            result.push(await this.resumeCueIntent(task));
                        } catch (error) {
                            errors.push({index, error: error instanceof Error ? error.message : '字幕保存未确认，意图保留。'});
                        }
                    }
                }
                await this.write('studyCueSaveRecoveryV1', () => ({checkedAt: new Date().toISOString(), errors}));
                await this.resumeCueRemembers();
                return result;
            })().finally(() => { this.#cueResume = null; });
        }
        return await this.#cueResume;
    }

    /**
     * @param {string} key
     * @returns {Promise<unknown>}
     */
    async read(key) {
        await this.writes;
        return (await this.storage.get(key))[key];
    }

    /**
     *
     * @param {string} key
     * @param {(value: unknown) => unknown} change
     */
    async write(key, change) {
        const guard = key === 'studyLearningJournalV1' ? this.#cueJournalGuard : null;
        const operation = this.writes.then(async () => {
            const value = (await this.storage.get(key))[key];
            const next = await change(value);
            if (guard && !guard()) { throw new Error('字幕请求已取消或失效，未写入迟到回答。'); }
            await this.storage.set({[key]: next});
        });
        this.writes = operation.catch(() => {});
        await operation;
    }

    /**
     * @param {unknown} value
     * @returns {{id: string, language: string}[]}
     */
    outboxRows(value) {
        if (!Array.isArray(value)) { return []; }
        return /** @type {unknown[]} */ (value).flatMap((v) => {
            if (!v || typeof v !== 'object') { return []; }
            const {id, language} = /** @type {{id?: unknown, language?: unknown}} */ (v);
            return (typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) && typeof language === 'string' && ['en', 'ja'].includes(language)) ? [{id, language}] : [];
        });
    }

    /** @returns {Promise<{id: string, language: string}[]>} */
    async outbox() {
        return this.outboxRows(await this.read('studyRememberOutbox'));
    }

    /**
     * @param {{id: string, language: string}} task
     * @returns {Promise<import('study').LibraryRecord>}
     */
    async remember(task) {
        const wasQueued = (await this.outbox()).some((r) => r.id === task.id && r.language === task.language);
        await this.write('studyRememberOutbox', (v) => {
            const rows = this.outboxRows(v);
            return rows.some((r) => r.id === task.id && r.language === task.language) ? rows : [...rows, task];
        });
        const read = /** @type {{items: import('study').LearningMaterial[]}} */ (await this.handle('libraryRead', {ids: [task.id], language: task.language}));
        let row = read.items?.find((item) => item.record?.id === task.id)?.record;
        if (!row) { throw new Error('已保存笔记暂不可读；没有送入 Anki。'); }
        // Ordinary word saves never select cards, including old save retries.
        // Only cards the user already confirmed may be retried here.
        const hasCards = Boolean(row.cards?.length || row.noteId);
        if (hasCards && row.ankiEnabled !== false) {
            const result = /** @type {{items: import('study').LibraryRecord[]}} */ (await this.handle('librarySync', {ids: [task.id], language: task.language}));
            row = result.items[0];
            if (!row) { throw new Error('卡片同步未返回确认；笔记已保留。'); }
        }
        if ((!hasCards || row.ankiState !== 'pending') && !(row.ankiEnabled === false && wasQueued)) {
            await this.write('studyRememberOutbox', (v) => this.outboxRows(v).filter((r) => r.id !== task.id || r.language !== task.language));
        }
        return row;
    }

    /**
     * Resolve once for a new explicit save; legacy queued intents intentionally omit targetId.
     * @param {import('study').LibraryEntry} entry
     * @returns {Promise<string | undefined>}
     */
    async resolveSaveTarget(entry) {
        if ((entry.language ?? 'en') !== 'en') { return void 0; }
        const response = await this.native({action: 'libraryTargetResolve', entry}).promise;
        const target = /** @type {import('study').SaveTargetSettings | undefined} */ (response.library);
        if (!response.ok || !target || !/^[a-f0-9]{32}$/.test(target.targetId)) {
            throw new Error(response.error ?? '保存目标未确认；完整问答仍留在本地。');
        }
        return target.targetId;
    }

    /** @returns {Promise<import('study').RememberSaveIntent[]>} */
    async saveIntents() {
        const value = await this.read('studyRememberSaveIntents');
        return /** @type {import('study').RememberSaveIntent[]} */ (Array.isArray(value) ? value : []);
    }

    /**
     * Persist explicit intent before the first native write, including the frozen Q/A snapshot.
     * @param {import('study').LibraryEntry} entry
     * @returns {Promise<import('study').LibraryRecord>}
     */
    async rememberEntry(entry) {
        studyLookup(entry); // Reject invalid language/word/sentence before queueing.
        entry = {...entry};
        delete entry.recordId;
        const turns = structuredClone(await this.journal.get(entry));
        const targetId = await this.resolveSaveTarget(entry);
        /** @type {import('study').RememberSaveIntent} */
        let task = {key: crypto.randomUUID(), entry: structuredClone(entry), turns, ...(targetId ? {targetId} : {})};
        await this.write('studyRememberSaveIntents', (value) => {
            const rows = /** @type {import('study').RememberSaveIntent[]} */ (Array.isArray(value) ? value : []);
            const existing = rows.find((r) => JSON.stringify([r.entry, r.turns]) === JSON.stringify([task.entry, task.turns]));
            if (existing) {
                task = existing;
                return rows;
            }
            const next = [...rows, task];
            if (new TextEncoder().encode(JSON.stringify(next)).length > 2000000) {
                throw new Error('待保存学习较多，请先继续补齐；不会自动丢弃保存意图。');
            }
            return next;
        });
        return await this.resumeSaveIntent(task);
    }

    /**
     * @param {import('study').RememberSaveIntent} task
     * @returns {Promise<import('study').LibraryRecord>}
     */
    async resumeSaveIntent(task) {
        let operation = this.rememberSavePending.get(task.key);
        if (!operation) {
            operation = (async () => {
                const saved = /** @type {import('study').LibraryRecord} */ (await this.journal.save(task.entry, false, task.turns, task.targetId));
                // This action saves the note only. Card creation is a separate explicit choice.
                const row = saved;
                await this.write('studyRememberSaveIntents', (value) => {
                    const rows = /** @type {import('study').RememberSaveIntent[]} */ (Array.isArray(value) ? value : []);
                    return rows.filter((r) => r.key !== task.key);
                });
                return row;
            })().finally(() => { this.rememberSavePending.delete(task.key); });
            this.rememberSavePending.set(task.key, operation);
        }
        return await operation;
    }

    /**
     * @returns {Promise<import('study').CacheEntry[]>}
     */
    async cache() {
        const rows = this.rows(await this.read(CACHE_KEY));
        return rows.filter((r) => typeof r.created === 'number' && r.created > Date.now() - TTL && isStudyResult(r.result)).slice(-CACHE_LIMIT);
    }

    /**
     * @param {unknown} value
     * @returns {import('study').CacheEntry[]}
     */
    rows(value) {
        return Array.isArray(value) ? value : [];
    }

    /**
     * @param {unknown} value
     * @returns {string}
     */
    cancelScopeKey(value) {
        const lookup = studyLookup(value);
        const source = /** @type {Partial<import('study').LibraryEntry>} */ (value ?? {});
        return JSON.stringify([
            lookup.language,
            lookup.word,
            lookup.sentence,
            lookup.context,
            lookup.question ?? '',
            lookup.dictionaryNotes ?? '',
            source.url ?? '',
            source.url ? '' : source.title ?? '',
            source.videoTime ?? null,
        ]);
    }

    /**
     *
     * @param {string} action
     * @param {unknown} value
     * @returns {Promise<unknown>}
     */
    async handle(action, value) {
        // Saving or making cards changes word colours on pages; refresh them shortly after.
        if (['rememberEntry', 'libraryCardsAdd', 'removeWord', 'libraryContextMiss'].includes(action)) {
            setTimeout(() => { void this.refreshWordStatus(); }, 3000);
        }
        if (action !== 'generate') { return await this.handleRequest(action, value); }
        const scopeKey = this.cancelScopeKey(value);
        let scope = this.cancelScopes.get(scopeKey);
        if (!scope) {
            scope = {generation: 0, active: 0};
            this.cancelScopes.set(scopeKey, scope);
        }
        ++scope.active;
        try {
            return await this.handleRequest(action, value, scope);
        } finally {
            --scope.active;
            if (scope.active === 0 && this.cancelScopes.get(scopeKey) === scope) { this.cancelScopes.delete(scopeKey); }
        }
    }

    /**
     * @param {string} action
     * @param {unknown} value
     * @param {{generation: number, active: number} | null} [requestScope]
     * @param {{id: string, source: NonNullable<import('study').LibraryEntry['subtitleSource']>, check: (() => Promise<unknown>) | null} | null} [authority]
     * @returns {Promise<unknown>}
     */
    async handleRequest(action, value, requestScope = null, authority = null) {
        const containsCue = (/** @type {unknown} */ v) => v && typeof v === 'object' &&
        (['subtitleSource', 'subtitle', 'studySubtitle', 'sourceConfirmed', 'cueAuthorization'].some((k) => k in v) || Object.values(v).some(containsCue));
        if (containsCue(value)) { throw new Error('字幕来源须由私有校验取得，不能从页面参数伪造。'); }
        if (authority) {
            await authority.check?.();
            const v = /** @type {{ids?: string[], items?: {id: string}[]}} */ (value ?? {});
            const ids = v.ids ?? v.items?.map((r) => r.id);
            if (!['libraryRead', 'librarySync', 'libraryDraftSave', 'libraryDraftDiscard', 'libraryDraftCommit', 'draftCards'].includes(action) ||
            !Array.isArray(ids) || ids.length !== 1 || ids[0] !== authority.id) { throw new Error('字幕动作超出已确认单条记录。'); }
        }


        if (['subtitleSettings', 'subtitleTranslate', 'subtitleCancel', 'subtitleSegment'].includes(action)) { return await this.subtitles.handle(action, value); }

        if (action === 'pendingPeek' || action === 'retryPending') {
            const {language = 'en'} = /** @type {{language?: string}} */ (value ?? {});
            if (!['en', 'ja'].includes(language)) { throw new Error('学习语言无效。'); }
            const tasks = (await this.outbox()).filter((r) => r.language === language);
            const saves = (await this.saveIntents()).filter((r) => (r.entry.language ?? 'en') === language);
            if (action === 'pendingPeek') { return {count: tasks.length + saves.length}; }
            if (saves.length > 0) { return await this.resumeSaveIntent(saves[0]); }
            return tasks.length > 0 ? await this.handle('remember', tasks[0]) : null;
        }
        if (action === 'rememberEntry') {
            if (!value || typeof value !== 'object' || Object.keys(value).some((k) => !['entry', 'recordId'].includes(k))) { throw new Error('学习保存参数无效。'); }
            const {entry, recordId} = /** @type {{entry: import('study').LibraryEntry; recordId?: string}} */ (value);
            const existingId = recordId ?? entry.recordId;
            if (existingId) {
                if (!/^[a-f0-9]{32}$/.test(existingId)) { throw new Error('原学习记录编号无效。'); }
                const original = await this.native({action: 'libraryRead', ids: [existingId], language: entry.language ?? 'en'}).promise;
                const originalRecord = /** @type {{items?: import('study').LearningMaterial[]}|undefined} */ (original.library)?.items?.[0]?.record;
                if (!original.ok || !originalRecord) { throw new Error(original.error ?? '原学习记录暂不可读；未改投其他对象。'); }
                if (entry.sense || originalRecord.entry.word.toLocaleLowerCase() !== entry.word.toLocaleLowerCase()) { return await this.rememberEntry(entry); }
                const update = {...entry};
                delete update.recordId;
                const turns = await this.journal.get(entry);
                await this.sync.enqueue({key: `update:${entry.language ?? 'en'}:${existingId}`,
                    action: 'libraryUpdate',
                    id: existingId,
                    language: entry.language ?? 'en',
                    remember: true,
                    entry: update,
                    turns});
                await this.sync.flush();
                const response = await this.native({action: 'libraryRead', ids: [existingId], language: entry.language ?? 'en'}).promise;
                const row = /** @type {{items?: import('study').LearningMaterial[]}|undefined} */ (response.library)?.items?.[0]?.record;
                if (!response.ok || !row) { throw new Error(response.error ?? '更新待同步；不会另建记录。'); }
                await this.sync.bind(entry, row);
                const pending = (await this.sync.pending()).find((task) => task.id === existingId);
                return pending ? {...row, syncState: 'pending', error: pending.error ?? '学习更新待同步'} : row;
            }
            return await this.rememberEntry(entry);
        }
        if (action === 'remember') {
            const {id, language = 'en'} = /** @type {{id: string, language?: string}} */ (value ?? {});
            if (!/^[a-f0-9]{32}$/.test(id) || !['en', 'ja'].includes(language)) { throw new Error('学习记录编号或语言无效。'); }
            const key = `${language}:${id}`;
            let operation = this.rememberPending.get(key);
            if (!operation) {
                operation = this.remember({id, language}).finally(() => { this.rememberPending.delete(key); });
                this.rememberPending.set(key, operation);
            }
            return await operation;
        }
        if (action === 'journalConversation') { return await this.journal.conversation(value); }
        if (action === 'syncPending') {
            if (!(/** @type {{checkOnly?: boolean}} */ (value ?? {})).checkOnly) { await this.sync.flush(); }
            return await this.sync.pending();
        }
        if (action === 'conversationUsage') { return this.journal.usage(value); }
        if (action === 'usageStats') {
            const response = await this.native({action: 'usageStats'}).promise;
            if (!response.ok) { throw new Error(response.error ?? '用量暂不可读'); }
            return response.usageStats;
        }
        if (action === 'cancel') {
            const scope = this.cancelScopes.get(this.cancelScopeKey(value));
            if (scope) { ++scope.generation; }
        }
        const requestEpoch = requestScope?.generation;
        if (action === 'journalPeek') { return await this.journal.get(value); }
        if (action === 'journalFeedback') { return await this.journal.feedback(value, /** @type {{feedback?: unknown}} */ (value ?? {}).feedback); }
        if (action === 'librarySave') {
            if (!value || typeof value !== 'object' || Object.keys(value).some((k) => !['entry', 'makeCard'].includes(k))) { throw new Error('学习保存参数无效。'); }
            const {entry, makeCard} = /** @type {{entry: import('study').LibraryEntry; makeCard: boolean}} */ (value);
            if (typeof makeCard !== 'boolean') { throw new Error('保存方式无效。'); }
            return await this.journal.save(entry, makeCard, void 0, await this.resolveSaveTarget(entry));
        }
        if (['librarySettingsGet', 'librarySettingsSave', 'librarySettingsCheck', 'librarySettingsPrepare', 'librarySettingsOpen'].includes(action)) {
            if (!value || typeof value !== 'object' || 'action' in value) { throw new Error('保存设置参数无效。'); }
            const response = await this.native({...value, action}).promise;
            if (!response.ok || !response.library) { throw new Error(response.error ?? '本机保存设置暂不可读。'); }
            const settings = /** @type {import('study').SaveTargetSettings} */ (response.library);
            const snapshot = {ankiEnabled: settings.ankiEnabled,
                targetId: settings.targetId,
                vault: settings.vault,
                directory: settings.directory,
                deck: settings.deck,
                model: settings.model,
                ...(settings.deckByKind ? {deckByKind: settings.deckByKind} : {})};
            if (JSON.stringify(await this.read(SAVE_TARGETS_KEY)) !== JSON.stringify(snapshot)) {
                await this.write(SAVE_TARGETS_KEY, () => snapshot);
            }
            return response.library;
        }
        if (action === 'practiceCheck' && !studyConfig(await this.read(SETTINGS_KEY)).practiceEnabled) {
            throw new Error('练习批改未开启；请先在 AI 设置中明确开启。');
        }
        if (['libraryPrepareJapanese', 'libraryMedia', 'libraryList', 'librarySync', 'libraryEnrich', 'libraryRead', 'libraryMemory', 'libraryCards', 'libraryDraftSave', 'libraryDraftDiscard', 'libraryDraftCommit', 'libraryReconcile', 'libraryRepair', 'libraryOrphan', 'libraryCardsAdd', 'libraryFavorite', 'libraryUpdate', 'libraryVideoWords', 'libraryVideoSummary', 'libraryWordSenses', 'libraryContextMiss', 'senseMatch', 'ankiToday', 'ankiOpen', 'bridgeHealth', 'practiceCheck'].includes(action)) {
            if (!value || typeof value !== 'object' || 'action' in value) { throw new Error('学习库参数无效。'); }
            if (action === 'libraryMemory') { void this.sync.flush(); }
            const response = await this.native({...value, action, ...(authority ? {cueAuthorization: {id: authority.id, source: authority.source}} : {})}).promise;
            if (!response.ok || !response.library) { throw new Error(response.error ?? '学习库未返回保存确认。'); }
            if (action === 'libraryList' || action === 'libraryMemory') {
                const items = /** @type {{items?: import('study').LibraryRecord[]}} */ (response.library).items;
                if (Array.isArray(items)) { await this.sync.favoritesFrom(items.filter((r) => r.entry && r.vaultSaved !== false)); }
            }
            if (['libraryFavorite', 'libraryReconcile', 'libraryRepair'].includes(action)) {
                const row = /** @type {import('study').LibraryRecord} */ (response.library);
                if (row.entry) {
                    await this.sync.favoritesFrom([row]);
                    if (['libraryReconcile', 'libraryRepair'].includes(action)) { await this.sync.bind(row.entry, row); }
                }
            }
            if (action === 'libraryRead') {
                const items = /** @type {{items?: import('study').LearningMaterial[]}} */ (response.library).items ?? [];
                for (const material of items) {
                    if (material.record?.entry) { await this.sync.bind(material.record.entry, material.record); }
                }
            }
            return response.library;
        }
        if (action === 'draftCards') {
            const {ids, language = 'en', automatic = false} = /** @type {{ids: string[], language?: string, automatic?: boolean}} */ (value ?? {});
            if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5 || new Set(ids).size !== ids.length || ids.some((id) => !/^[a-f0-9]{32}$/.test(id))) { throw new Error('每批生成 1–5 条记录的制卡草稿。'); }
            const read = await this.native({action: 'libraryRead', ids, language}).promise;
            if (!read.ok || !read.library) { throw new Error(read.error ?? '笔记读取未完成。'); }
            const {items: materials} = /** @type {{items: import('study').LearningMaterial[]}} */ (read.library);
            if (!Array.isArray(materials) || materials.length !== ids.length || materials.some((r, i) => r.id !== ids[i])) { throw new Error('笔记读取关联不一致。'); }
            if (materials.some((m) => !m.record || m.record.id !== m.id)) { throw new Error('本机桥尚未提供持久草稿，请更新后再操作。'); }
            if (materials.some((m) => m.record?.ankiEnabled === false)) { return {items: materials.map((m) => m.record)}; }
            const pending = materials.filter((m) => !m.record?.reviewDraft);
            if (pending.length === 0) { return {items: materials.map((m) => m.record)}; }
            const {model, effort} = studyConfig(await this.read(SETTINGS_KEY));
            const usageSource = automatic && pending.length === 1 ? pending[0].record?.entry : null;
            const attemptId = crypto.randomUUID();
            if (usageSource) { await this.journal.recordUsage(usageSource, attemptId, {status: 'running'}); }
            const response = await this.native({action: 'cards',
                language,
                items: pending.map(({id, word, text, confirmedCards, relatedMemory}) => ({id,
                    word,
                    text: `${automatic ? '本人点了记住它：只选择最值得复习的0或1张。优先记词和实际用法，原句作例句，不机械拆语法题；熟词新用法不可只因词拼写已有就跳过。\n' : ''}${text.length > 2800 ? `${text.slice(0, 600)}\n[较早正文省略，保留开头与近期内容]\n${text.slice(-2100)}` : text}\n${(confirmedCards ?? '本记录无已确认卡摘要。').slice(0, 900)}\n${(relatedMemory ?? 'Obsidian/Anki相关历史未核对，不代表未学过。').slice(0, 2400)}`})),
                config: {model, effort}}).promise.catch(async (error) => {
                if (usageSource) { await this.journal.recordUsage(usageSource, attemptId, {status: 'incomplete'}); }
                throw error;
            });
            if (usageSource) { await this.journal.recordUsage(usageSource, attemptId, response.usage ?? {status: 'unknown'}); }
            const result = /** @type {import('study').CardsResult | undefined} */ (response.result);
            if (!response.ok || !result || !Array.isArray(result.items) || result.items.length !== pending.length || result.items.some((r, i) => r.id !== pending[i].id || typeof r.reason !== 'string' || !Array.isArray(r.cards) || r.cards.length > 4 || r.cards.some((c) => typeof c.front !== 'string' || !c.front.trim() || c.front.length > 1000 || typeof c.back !== 'string' || !c.back.trim() || c.back.length > 2400))) { throw new Error(response.error ?? '制卡草稿遗漏或关联错误；没有保存和制卡。'); }
            // A model response is not a durable draft until the fixed-Vault write is acknowledged.
            await authority?.check?.();
            const saved = await this.native({action: 'libraryDraftSave', language, ...(authority ? {cueAuthorization: {id: authority.id, source: authority.source}} : {}), items: result.items.map((r, i) => ({id: r.id, version: pending[i].version, reason: r.reason, cards: (automatic ? r.cards.slice(0, 1) : r.cards).map((card) => ({...card, selected: true}))}))}).promise;
            if (!saved.ok || !saved.library) { throw new Error(saved.error ?? '草稿未能保存到 Obsidian；未送入 Anki。'); }
            const rows = /** @type {{items: import('study').LibraryRecord[]}} */ (saved.library).items;
            if (!Array.isArray(rows) || rows.length !== pending.length || rows.some((r, i) => r.id !== pending[i].id || !r.reviewDraft)) { throw new Error('草稿保存关联不一致，请重新读取笔记。'); }
            return {items: materials.map((m) => rows.find((r) => r.id === m.id) ?? m.record)};
        }
        if (action === 'organize') {
            const {records} = /** @type {{records: import('study').LibraryRecord[]}} */ (value ?? {});
            if (!Array.isArray(records) || records.length === 0 || records.length > 10) { throw new Error('请选择 1–10 条记录整理。'); }
            const language = records[0].entry.language ?? 'en';
            if (records.some((r) => (r.entry.language ?? 'en') !== language)) { throw new Error('不同语言请分别整理。'); }
            const read = await this.native({action: 'libraryRead', language, ids: records.map((r) => r.id)}).promise;
            if (!read.ok || !read.library) { throw new Error(read.error ?? '完整学习笔记读取失败。'); }
            const materials = /** @type {{items: import('study').LearningMaterial[]}} */ (read.library).items;
            if (materials.some((r, i) => r.id !== records[i]?.id || r.version !== records[i]?.version) || materials.length !== records.length) { throw new Error('笔记已更新，请重新展开记录后再整理。'); }
            const ids = new Set();
            const items = records.map(({id, entry}) => {
                if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || ids.has(id)) { throw new Error('记录编号无效或重复。'); }
                ids.add(id);
                const {word, sentence, context} = studyLookup(entry);
                const {meaning = '', translation = ''} = entry;
                const notes = materials.find((r) => r.id === id)?.text ?? '';
                return {id, word, sentence, context, meaning, translation, notes};
            });
            const {model, effort} = studyConfig(await this.read(SETTINGS_KEY));
            const config = {model, effort};
            const response = await this.native({action: 'organize', language, items, config}).promise;
            const result = /** @type {import('study').OrganizationResult | undefined} */ (response.result);
            if (!response.ok || !result || !Array.isArray(result.items) || result.items.length !== items.length || result.items.some((r, i) => r.id !== items[i].id || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 5000)) {
                throw new Error(response.error ?? 'AI 整理未能逐条对应；未保存。');
            }
            return result;
        }
        if (action === 'settings') {
            return studyConfig(await this.read(SETTINGS_KEY));
        }
        if (action === 'saveSettings') {
            const config = studyConfig(value);
            if (!config.cacheEnabled) {
                ++this.epoch;
                await this.write(CACHE_KEY, () => []);
                await this.write(DICTIONARY_CACHE_KEY, () => []);
            }
            await this.write(SETTINGS_KEY, () => config);
            return config;
        }
        if (action === 'models') {
            const response = await this.native({action: 'models'}).promise;
            if (!response.ok || !Array.isArray(response.models)) {
                throw new Error(response.error ?? '无法获取模型列表。');
            }
            return response.models;
        }
        if (action === 'clearCache') {
            ++this.epoch;
            await this.write(CACHE_KEY, () => []);
            await this.write(DICTIONARY_CACHE_KEY, () => []);
            return true;
        }
        if (action === 'storeDetail') {
            const row = {id: crypto.randomUUID(), source: detailSource(value), created: Date.now()};
            await this.write(DETAIL_KEY, (v) => [...(/** @type {import('study').DetailSnapshot[]} */ (Array.isArray(v) ? v : [])).filter((r) => r.created > Date.now() - TTL), row].slice(-20));
            return row;
        }
        if (action === 'detail') {
            const id = (/** @type {{id?: unknown}} */ (value ?? {})).id;
            if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) { throw new Error('详解编号无效。'); }
            const rows = await this.read(DETAIL_KEY);
            return (Array.isArray(rows) ? rows : []).find((r) => r.id === id && r.created > Date.now() - TTL) ?? null;
        }
        if (['dictionaryPeek', 'dictionaryGenerate', 'dictionaryCancel'].includes(action)) { return this.dictionary(action, value); }
        if (action === 'saved') {
            const rows = await this.read(SAVED_KEY);
            return Array.isArray(rows) ? rows : [];
        }
        if (action === 'clearSaved') {
            const rows = /** @type {import('study').SavedWord[]} */ (await this.read(SAVED_KEY) ?? []);
            for (const row of rows) { await this.sync.favorite(row, false); }
            await this.write(SAVED_KEY, () => []);
            return true;
        }
        if (action === 'removeWord') {
            const {id} = /** @type {{id: string}} */ (value);
            const rows = /** @type {import('study').SavedWord[]} */ (await this.read(SAVED_KEY) ?? []);
            const row = rows.find((r) => r.id === id);
            if (row) { await this.sync.favorite(row, false); }
            await this.write(SAVED_KEY, (v) => (Array.isArray(v) ? v : []).filter((r) => r.id !== id));
            return true;
        }
        const lookup = studyLookup(value);
        const config = studyConfig(await this.read(SETTINGS_KEY));
        const originSource = /** @type {Partial<import('study').LibraryEntry>} */ (value ?? {});
        const origin = JSON.stringify([originSource.url ?? '', originSource.url ? '' : originSource.title ?? '', originSource.videoTime ?? null]);
        const key = resultKey(lookup, config) + origin;
        /**
         * @param {string} mode
         * @returns {string}
         */
        const modeKey = (mode) => resultKey({...lookup, mode}, config) + origin;
        const skey = sentenceKey(lookup, config);
        if (action === 'saveWord') {
            const source = /** @type {{url?: string, title?: string, videoTime?: number}} */ (value);
            let url = '';
            try {
                const parsed = new URL(source.url ?? '');
                if (['https:', 'http:'].includes(parsed.protocol)) {
                    url = parsed.href.slice(0, 2000);
                }
            } catch { /* Local/plain source has no web URL. */ }
            const videoTime = typeof source.videoTime === 'number' && Number.isFinite(source.videoTime) && source.videoTime >= 0 ? Math.floor(source.videoTime) : void 0;
            const sourceUrl = url;
            if (videoTime !== void 0 && url) { url = timedUrl(url, videoTime).url; }
            /** @type {import('study').SavedWord} */
            let row = {id: crypto.randomUUID(), ...lookup, url, sourceUrl, title: String(source.title ?? '').slice(0, 300), videoTime, created: Date.now(), syncPending: true};
            const identity = sourceKey(row);
            await this.write(SAVED_KEY, (v) => {
                const current = /** @type {import('study').SavedWord[]} */ (Array.isArray(v) ? v : []);
                const previous = current.find((item) => sourceKey(item) === identity);
                const rows = current.filter((item) => sourceKey(item) !== identity);
                row = {...previous, ...row, id: previous?.id ?? row.id, created: previous?.created ?? row.created};
                if (rows.length >= 200) { throw new Error('本地收藏已满（200 条）；请先导出并手动清理，不会自动删除旧收藏。'); }
                return [...rows, row];
            });
            await this.sync.favorite(row, true);
            return (/** @type {import('study').SavedWord[]} */ (await this.read(SAVED_KEY) ?? [])).find((r) => r.id === row.id) ?? row;
        }
        const cache = config.cacheEnabled ? await this.cache() : [];
        let exact = [...cache].reverse().find((r) => r.key === key) ??
        (lookup.mode ? void 0 : [...cache].reverse().find((r) => r.key === modeKey('translate')));
        if (action === 'peek') {
            return {result: exact?.result ?? null,
                translation: [...cache].reverse().find((r) => r.sentenceKey === skey)?.result.translation ?? null,
                busy: this.pending.has(key) || this.pending.has(modeKey('translate')),
                localTurns: (await this.journal.get(value)).length};
        }
        if (action === 'cancel') {
            for (const mode of ['translate', 'explain']) {
                this.pending.get(modeKey(mode))?.cancel();
            }
            // Dictionary and sentence translation share one native lock.
            // Cancelling here releases that lock so the visible sentence action can run.
            for (const call of this.dictionaryPending.values()) {
                call.cancel();
            }
            return true;
        }
        if (action !== 'generate') {
            throw new Error('未知的学习操作。');
        }
        await this.journal.checkRoom();
        const translated = /** @type {{sentenceTranslation?: string}} */ (value).sentenceTranslation;
        if (lookup.mode === 'translate' && translated !== void 0) {
            const result = {translation: translated, meaning: '', notes: ''};
            if (!isStudyResult(result)) { throw new Error('这句没有翻译成功，请重试。'); }
            await this.journal.append(value, result, 'unconfirmed');
            return {result, cached: false};
        }
        let learningMemory = '';
        if (lookup.mode !== 'translate') {
            const response = await this.native({action: 'libraryMemory', word: lookup.word, language: lookup.language ?? 'en', ...(/** @type {import('study').LibraryEntry} */ (value).lemma ? {lemma: /** @type {import('study').LibraryEntry} */ (value).lemma} : {})}).promise;
            if (!response.ok || !response.library) { throw new Error(response.error ?? '历史学习记录暂不可读；未假装已读取。'); }
            const memory = /** @type {{items: import('study').LearningMaterial[]; total: number}} */ (response.library);
            const recent = await this.journal.get(value);
            learningMemory = JSON.stringify({saved: memory, recent: recent.slice(-6), earlierLocalTurnsNotIncluded: Math.max(0, recent.length - 6)});
            if (learningMemory.length > 50000) { throw new Error('相关学习过程过长，请先保存后继续；完整记录没有删除。'); }
            // Teaching must see changed notes/feedback, not return an old context-free cached explanation.
            exact = void 0;
        }
        if (requestScope && requestScope.generation !== requestEpoch) { throw new Error('已取消，未启动后续模型请求。'); }
        if (exact) {
            if (lookup.mode === 'translate') { exact = {...exact, result: {translation: exact.result.translation, meaning: '', notes: ''}}; }
            await this.journal.append(value, exact.result, 'unconfirmed', {status: 'cached', inputTokens: 0, outputTokens: 0, totalTokens: 0});
            return {result: exact.result, cached: true};
        }
        const sharedTranslation = [...cache].reverse().find((r) => r.sentenceKey === skey)?.result.translation;
        if (lookup.mode === 'translate' && sharedTranslation) {
            const result = {translation: sharedTranslation, meaning: '', notes: ''};
            await this.journal.append(value, result, 'unconfirmed', {status: 'cached', inputTokens: 0, outputTokens: 0, totalTokens: 0});
            return {result, cached: true};
        }
        if (!this.pending.has(key)) {
            const epoch = this.epoch;
            const {cacheEnabled} = config;
            // AI Native requests have a strict model/effort schema. UI-only
            // switches (including autoDictionaryTranslate) stay local.
            const nativeConfig = {model: config.model, effort: config.effort};
            const payload = {...(lookup.dictionaryNotes ? {dictionaryNotes: lookup.dictionaryNotes} : {}), language: lookup.language ?? 'en', action: lookup.mode ?? 'explain', sentence: lookup.sentence, word: lookup.word, context: lookup.context, question: lookup.question ?? '', config: nativeConfig, ...(learningMemory ? {learningMemory} : {})};
            const reuse = sharedTranslation && sharedTranslation.length <= 600 ? {cachedTranslation: sharedTranslation} : {};
            const attemptId = crypto.randomUUID();
            /** @type {ReturnType<import('study').NativeCall> | null} */
            let call = null;
            let reportedUsage = false;
            const promise = (async () => {
                await this.journal.recordUsage(value, attemptId, {status: 'running'});
                if (requestScope && requestScope.generation !== requestEpoch) {
                    await this.journal.recordUsage(value, attemptId, {status: 'cached', inputTokens: 0, outputTokens: 0, totalTokens: 0});
                    reportedUsage = true;
                    throw new Error('已取消，未启动模型请求。');
                }
                call = this.native({...payload, ...reuse});
                return await call.promise;
            })().then(async (response) => {
                await this.journal.recordUsage(value, attemptId, response.usage ?? {status: 'unknown'});
                reportedUsage = true;
                if (requestScope && requestScope.generation !== requestEpoch) { throw new Error('已取消，未保存返回结果。'); }
                if (response.ok !== true || !isStudyResult(response.result) || (lookup.mode !== 'translate' && !response.result.meaning.trim())) {
                    throw new Error(response.error ?? 'AI 返回了无效文本。');
                }
                if (lookup.mode === 'translate') { response.result = {translation: response.result.translation, meaning: '', notes: ''}; }
                if (cacheEnabled && epoch === this.epoch) {
                    const row = {key, sentenceKey: skey, created: Date.now(), result: response.result};
                    await this.write(CACHE_KEY, (v) => (epoch !== this.epoch ? v : [...this.rows(v).filter((r) => r.key !== key && r.created > Date.now() - TTL), row].slice(-CACHE_LIMIT)));
                }
                await this.journal.append(value, response.result, 'unconfirmed', response.usage);
                return response.result;
            }).catch(async (error) => {
                if (!reportedUsage) { await this.journal.recordUsage(value, attemptId, {status: 'incomplete'}); }
                throw error;
            })
                .finally(() => {
                    this.pending.delete(key);
                });
            this.pending.set(key, {promise, cancel: () => call?.cancel()});
        }
        return {result: await this.pending.get(key)?.promise, cached: false};
    }

    /**
     * @param {string} action
     * @param {unknown} value
     * @returns {Promise<unknown>}
     */
    async dictionary(action, value) {
        const lookup = dictionaryLookup(value);
        const config = studyConfig(await this.read(SETTINGS_KEY));
        const key = dictionaryKey(lookup, config);
        const stored = await this.read(DICTIONARY_CACHE_KEY);
        const rows = /** @type {import('study').DictionaryCacheEntry[]} */ (Array.isArray(stored) ? stored : []);
        const exact = config.cacheEnabled ? [...rows].reverse().find((r) => r.key === key && r.created > Date.now() - TTL && isDictionaryResult(r.result, lookup)) : void 0;
        if (action === 'dictionaryPeek') { return {result: exact?.result ?? null, busy: this.dictionaryPending.has(key)}; }
        if (action === 'dictionaryCancel') {
            for (const call of this.dictionaryPending.values()) {
                if (JSON.stringify(call.lookup) === JSON.stringify(lookup)) { call.cancel(); }
            }
            return true;
        }
        if (exact) { return {result: exact.result, cached: true}; }
        if (!this.dictionaryPending.has(key)) {
            const epoch = this.epoch;
            // Native Python accepts exactly {model, effort}; UI/cache toggles
            // stay in extension storage and must never enter the AI request.
            const {cacheEnabled} = config;
            const nativeConfig = {model: config.model, effort: config.effort};
            const call = this.native({action: 'dictionary', ...lookup, config: nativeConfig});
            const promise = call.promise.then(async (response) => {
                if (!response.ok || !isDictionaryResult(response.result, lookup)) { throw new Error(response.error ?? 'AI 词典翻译未能逐段对齐；原英文保留。'); }
                const result = response.result;
                if (cacheEnabled && epoch === this.epoch) {
                    await this.write(DICTIONARY_CACHE_KEY, (v) => (epoch !== this.epoch ? v : [...(/** @type {import('study').DictionaryCacheEntry[]} */ (Array.isArray(v) ? v : [])).filter((r) => r.key !== key && r.created > Date.now() - TTL), {key, lookup, created: Date.now(), result}].slice(-CACHE_LIMIT)));
                }
                return result;
            }).finally(() => { this.dictionaryPending.delete(key); });
            this.dictionaryPending.set(key, {promise, cancel: call.cancel, lookup});
        }
        return {result: await this.dictionaryPending.get(key)?.promise, cached: false};
    }
}

/**
 * Register independently of upstream APIs;
 * only our extension documents may call it.
 * @param {((text: string, optionsContext: import('settings').OptionsContext, sender: chrome.runtime.MessageSender) => Promise<unknown>) | null} [lookupDictionary]
 */
export function prepareStudyService(lookupDictionary = null) {
    if (preparedRuntimes.has(chrome.runtime)) { return; }
    preparedRuntimes.add(chrome.runtime);
    const service = new StudyService(chrome.storage.local);
    const companionOpen = prepareStudyCompanion(service, lookupDictionary);
    // Near-real-time Obsidian↔Anki sync while the browser runs; each pass only touches what changed.
    if (chrome.alarms?.create) {
        void chrome.alarms.create('study-auto-sync', {periodInMinutes: 0.5});
        chrome.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === 'study-auto-sync') { void service.autoSync(); }
            if (alarm.name === 'study-word-status') { void service.refreshWordStatus(); }
        });
        void chrome.alarms.create('study-word-status', {periodInMinutes: 5, delayInMinutes: 0.1});
    }
    /**
     * @param {unknown} message
     * @param {chrome.runtime.MessageSender} sender
     * @param {(response: unknown) => void} reply
     * @returns {boolean}
     */
    const receive = (message, sender, reply) => {
        const cueActionMessage = /** @type {{studyCueAction?: boolean, data?: unknown}} */ (message ?? {});
        if (cueActionMessage.studyCueAction === true) {
            void service.cueAction(chrome.runtime, sender, cueActionMessage.data).then((value) => reply({ok: true, value}), (error) => reply({ok: false, error: error instanceof Error ? error.message : '字幕操作失败。'}));
            return true;
        }
        const cueMessage = /** @type {{studyCueAttest?: boolean, data?: {queryId?: string, cue?: Record<string, unknown>}}} */ (message ?? {});
        if (cueMessage.studyCueAttest === true) {
            void service.attestCue(chrome.runtime, sender, cueMessage.data ?? {}).then(reply, () => reply({ok: false, writeAuthorized: false}));
            return true;
        }
        const {studyAction, data} = /** @type {{studyAction?: string, data?: unknown}} */ (/** @type {unknown} */ (message ?? {}));
        if (typeof studyAction !== 'string') {
            return false;
        }
        if (studyAction === 'openStudySettings' && sender.id === chrome.runtime.id &&
        (/^(?:https?|file):/.test(sender.url || '') || sender.url?.startsWith(chrome.runtime.getURL('')))) {
            const section = /** @type {{section?: string}} */ (data || {}).section === 'save' ? 'save' : 'ai';
            void chrome.tabs.create({url: chrome.runtime.getURL(`settings.html#${section}`)}).then(
                () => reply({ok: true, value: true}), () => reply({ok: false, error: '设置没有打开，请从扩展图标里打开设置。'}));
            return true;
        }
        // Content scripts get only the explicit reader's read/translate/cancel path. The one write is
        // the video study summary, built from the learner's own saved words for the sender's video.
        // Readers run inside their own web frame, or a top-level local file page.
        if (['subtitleSettings', 'subtitleTranslate', 'subtitleCancel', 'subtitleSegment', 'libraryVideoWords', 'libraryVideoSummary'].includes(studyAction) && sender.id === chrome.runtime.id &&
        (/^https?:\/\//.test(sender.url || '') || (sender.frameId === 0 && /^file:\/\//.test(sender.url || '')))) {
            const request = /** @type {{requestId?: string}} */ (data || {});
            const scoped = {...request, ...(request.requestId ? {requestId: `${sender.tab?.id}:${sender.documentId || ''}:${request.requestId}`} : {})};
            void (async () => {
                // A page may read back only the words saved from its own video.
                if (studyAction === 'libraryVideoWords') {
                    const asked = /** @type {{mediaKey?: unknown}} */ (data ?? {}).mediaKey;
                    const own = sender.url?.startsWith('file:') && typeof asked === 'string' && /^file:.+\|[0-9]+$/.test(asked) ? asked : mediaKeyOf(/** @type {string} */ (sender.url));
                    if (!own || asked !== own || Object.keys(/** @type {object} */ (data ?? {})).length !== 1) { throw new Error('只能读取当前视频的生词。'); }
                }
                // The summary's video URL comes from the sender, never from the page's message.
                /** @type {Record<string, unknown>} */
                let forwarded = scoped;
                if (studyAction === 'libraryVideoSummary') {
                    const local = sender.url?.startsWith('file:');
                    const localUrl = /** @type {{url?: string}} */ (data).url;
                    const url = local && typeof localUrl === 'string' && localUrl.startsWith('file:') ? localUrl : /** @type {string} */ (sender.url);
                    const own = mediaKeyOf(url);
                    const {mediaKey, title} = /** @type {{mediaKey?: unknown, title?: unknown}} */ (data ?? {});
                    if (!own || mediaKey !== own || typeof title !== 'string' || Object.keys(/** @type {object} */ (data ?? {})).length !== (local ? 3 : 2)) { throw new Error('只能为当前视频写小结。'); }
                    forwarded = {mediaKey: own, url: url.slice(0, 2000), title: title.slice(0, 300)};
                }
                // Only the model and Apple translation go through the local bridge.
                const {engine} = normalizeSubtitlePrefs({...await service.read(SUBTITLE_PREFS_KEY), ...await service.read(TRANSLATION_PREFS_KEY)});
                if (((studyAction === 'subtitleTranslate' && ['model', 'apple'].includes(engine)) || studyAction === 'subtitleSegment' || studyAction.startsWith('library')) && !await chrome.permissions.contains({permissions: ['nativeMessaging']})) {
                    throw new Error('请先在学习设置中授权本机翻译，再点翻译字幕。');
                }
                return await service.handle(studyAction, forwarded);
            })().then((value) => reply({ok: true, value}), (error) => reply({ok: false, error: error instanceof Error ? error.message : '字幕翻译未完成。'}));
            return true;
        }
        const prefix = chrome.runtime.getURL('');
        const pathname = sender.url?.slice(prefix.length).split(/[?#]/)[0];
        if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(prefix) || !['popup.html', 'search.html', 'study-settings.html', 'study-library.html', 'settings.html'].includes(pathname ?? '')) {
            reply({ok: false, error: '不允许此页面访问学习组件。'});
            return false;
        }
        if (['librarySettingsSave', 'librarySettingsCheck', 'librarySettingsPrepare', 'librarySettingsOpen', 'libraryPrepareJapanese', 'saveSettings', 'clearCache', 'clearSaved', 'models'].includes(studyAction) && !['study-settings.html', 'settings.html'].includes(pathname ?? '')) {
            reply({ok: false, error: '请在 AI 设置页管理本地数据。'});
            return false;
        }
        if (studyAction === 'openDetail') {
            reply({ok: false, error: '详解已留在当前查词卡，不再打开其他页面。'});
            return false;
        }
        if (studyAction === 'companionOpen') {
            void companionOpen(data, sender).then((/** @type {unknown} */ value) => reply({ok: true, value}), (/** @type {unknown} */ error) => reply({ok: false, error: error instanceof Error ? error.message : '打开未完成。'}));
            return true;
        }
        void service.handle(studyAction, data).then((result) => reply({ok: true, value: result}), (error) => reply({ok: false, error: error instanceof Error ? error.message : '学习操作失败。'}));
        return true;
    };
    chrome.runtime.onMessage.addListener(receive);
    // Startup is the only automatic R2 recovery entry; listeners remain available while I/O settles.
    void service.resumeCueSaves().catch((error) => { log.warn(error instanceof Error ? error : new Error('字幕保存启动恢复未完成；意图保留。')); });
}
