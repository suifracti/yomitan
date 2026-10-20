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

import {sourceKey} from './study-journal.js';
import {SAVED_KEY} from './study-data.js';

const LINKS = 'studySyncLinksV1';
const OUTBOX = 'studySyncOutboxV1';

/** Existing browser storage holds delivery intents, never a second learning database. */
export class StudySync {
    /** @param {import('./study-service.js').StudyService} service */
    constructor(service) {
        /**
         *
         */
        this.service = service;
        /** @type {Promise<void>|null} */
        this.running = null;
        /** @type {number} */
        this.deliveryVersion = 0;
    }

    /** @returns {Promise<import('study').SyncTask[]>} */
    async pending() {
        const rows = await this.service.read(OUTBOX);
        return Array.isArray(rows) ? rows : [];
    }

    /**
     * Freeze the destination of an explicitly saved learning object.
     * @param {unknown} source
     * @param {import('study').LibraryRecord} row
     */
    async bind(source, row) {
        if (!/^[a-f0-9]{32}$/.test(row?.id) || row.learningState === 'favorite-only') { return; }
        const key = sourceKey(source);
        const language = row.entry?.language ?? /** @type {{language?: string}} */ (source).language ?? 'en';
        await this.service.write(LINKS, (value) => {
            const rows = /** @type {import('study').SyncLink[]} */ (Array.isArray(value) ? value : []);
            return [...rows.filter((r) => r.key !== key), {key, id: row.id, language, ...(row.targetId ? {targetId: row.targetId} : {})}];
        });
    }

    /**
     * @param {import('study').SyncTask} task
     * @param {string} [expectedRevision] Only replace the delivery snapshot that produced this receipt.
     * @returns {Promise<string|undefined>} The queued revision, if the expected version was still current.
     */
    async enqueue(task, expectedRevision) {
        /** @type {string|undefined} */
        let revision;
        await this.service.write(OUTBOX, async (value) => {
            const rows = /** @type {import('study').SyncTask[]} */ (Array.isArray(value) ? value : []);
            const previous = rows.find((r) => r.key === task.key);
            // A late receipt must not discard an answer queued while the bridge was busy.
            if (expectedRevision !== void 0 && previous?.revision !== expectedRevision) { return rows; }
            const old = task.action === 'libraryUpdate' && previous?.action === task.action ? previous : void 0;
            const turns = new Map([...(old?.turns ?? []), ...(task.turns ?? [])].map((t) => [t.id, t]));
            revision = crypto.randomUUID();
            const next = [...rows.filter((r) => r.key !== task.key), {...old,
                ...task,
                revision,
                ...(task.entry && task.action === 'libraryUpdate' ? {entry: {...old?.entry, ...task.entry}} : {}),
                ...(turns.size > 0 ? {turns: [...turns.values()]} : {})}];
            if (new TextEncoder().encode(JSON.stringify(next)).length > 2000000) { throw new Error('待同步内容较多，请先补齐；未删除旧记录。'); }
            if (task.action === 'libraryFavorite') {
                // Publish pending metadata before a worker can pick up this revision.
                const saved = (await this.service.storage.get(SAVED_KEY))[SAVED_KEY];
                await this.service.storage.set({[SAVED_KEY]: (/** @type {import('study').SavedWord[]} */ (Array.isArray(saved) ? saved : []))
                    .map((row) => (`favorite:${sourceKey(row)}` === task.key ? {...row, syncPending: true} : row))});
            }
            return next;
        });
        // Only actual incoming work wakes the worker, not its own deferred reconcile receipts.
        if (revision && expectedRevision === void 0) { ++this.deliveryVersion; }
        return revision;
    }

    /**
     * Generated content only supplements an already-saved object; it never selects cards.
     * @param {unknown} source
     * @param {import('study').Result} result
     */
    async learned(source, result) {
        const links = /** @type {import('study').SyncLink[]} */ (await this.service.read(LINKS) ?? []);
        const link = links.find((r) => r.key === sourceKey(source));
        if (!link) { return; }
        const entry = Object.fromEntries(Object.entries(result).filter(([k, v]) => ['translation', 'meaning', 'notes'].includes(k) && typeof v === 'string' && v.trim()));
        const turns = await this.service.journal.get(source);
        await this.enqueue({...link, key: `update:${link.language}:${link.id}`, action: 'libraryUpdate', entry, turns});
        void this.flush();
    }

    /**
     * Star/unstar is durable locally even while the Native bridge is unavailable.
     * @param {import('study').SavedWord} source
     * @param {boolean} favorite
     */
    async favorite(source, favorite) {
        const entry = {word: source.word,
            sentence: source.sentence,
            context: source.context ?? '',
            url: source.sourceUrl ?? source.url ?? '',
            title: source.title ?? '',
            meaning: '',
            translation: '',
            notes: '',
            language: source.language ?? 'en',
            ...(source.videoTime === void 0 ? {} : {videoTime: source.videoTime})};
        await this.enqueue({key: `favorite:${sourceKey(source)}`,
            action: 'libraryFavorite',
            language: entry.language,
            favorite,
            ...(source.libraryId ? {id: source.libraryId} : {entry})});
        // The star acknowledges local storage immediately; bridge delivery continues independently.
        void this.flush();
    }

    /**
     * Try queued writes without a model, creation of review cards, or deletion.
     * @returns {Promise<void>}
     */
    async flush() {
        if (this.running) { return this.running; }
        const attempted = new Set();
        const run = async () => {
            try {
                let version;
                do {
                    version = this.deliveryVersion;
                    await this.deliver(attempted);
                } while (version !== this.deliveryVersion);
            } finally { this.running = null; }
        };
        this.running = run();
        return this.running;
    }

    /**
     * @param {Set<string>} [attempted] Revisions already tried in this active flush, including deferred receipts.
     * @returns {Promise<void>}
     */
    async deliver(attempted = new Set()) {
        for (const task of await this.pending()) {
            const token = `${task.key}:${task.revision}`;
            if (attempted.has(token)) { continue; }
            const current = (await this.pending()).find((row) => row.key === task.key);
            if (!current || current.revision !== task.revision) { continue; }
            attempted.add(token);
            try {
                const {key, revision} = task;
                const payload = Object.fromEntries(Object.entries(task).filter(([name]) => !['key', 'revision', 'error'].includes(name)));
                let row;
                const turns = task.turns ?? [];
                for (let offset = 0; offset < Math.max(1, turns.length); offset += 4) {
                    const batch = turns.slice(offset, offset + 4);
                    const response = await this.service.native({...payload, ...(task.turns ? {turns: batch} : {})}).promise;
                    if (!response.ok || !response.library) { throw new Error(response.error ?? '等待本机同步确认。'); }
                    row = /** @type {import('study').LibraryRecord} */ (response.library);
                    if (task.action === 'libraryUpdate') { await this.service.journal.acknowledge(batch); }
                }
                if (row && task.action === 'libraryUpdate') {
                    const response = await this.service.native({action: 'libraryReconcile', id: task.id, language: task.language, ...(task.targetId ? {targetId: task.targetId} : {})}).promise;
                    if (!response.ok) { throw new Error(response.error ?? '笔记已补充，Anki 更新待同步。'); }
                    row = /** @type {import('study').LibraryRecord} */ (response.library ?? row);
                }
                if (task.action !== 'libraryFavorite' && row && (row.conflicts?.length || ['pending', 'missing', 'error', 'paused'].includes(row.syncState ?? ''))) {
                    const deferred = await this.enqueue({key,
                        action: 'libraryReconcile',
                        id: row.id,
                        language: task.language,
                        ...(task.targetId ? {targetId: task.targetId} : {}),
                        error: row.conflicts?.length ? '字段有冲突，请在我的记录或学习库选择保留哪一边。' : (row.error ?? '关联卡片待同步或已缺失，请在学习库查看。')}, revision);
                    if (deferred) { attempted.add(`${key}:${deferred}`); }
                    continue;
                }
                if (row && task.action === 'libraryFavorite') {
                    const libraryId = row.id;
                    await this.service.write(SAVED_KEY, async (value) => {
                        // Read directly inside the writer queue; service.read would wait on this write itself.
                        const outbox = (await this.service.storage.get(OUTBOX))[OUTBOX];
                        const latest = (/** @type {import('study').SyncTask[]} */ (Array.isArray(outbox) ? outbox : [])).find((item) => item.key === key);
                        return /** @type {import('study').SavedWord[]} */ (Array.isArray(value) ? value : [])
                            .map((item) => (`favorite:${sourceKey(item)}` === key ? {...item, libraryId, syncPending: latest?.revision !== revision} : item));
                    });
                }
                await this.service.write(OUTBOX, (value) => /** @type {import('study').SyncTask[]} */ (Array.isArray(value) ? value : []).filter((r) => r.key !== key || r.revision !== revision));
            } catch (error) {
                await this.service.write(OUTBOX, (value) => /** @type {import('study').SyncTask[]} */ (Array.isArray(value) ? value : []).map((r) => (r.key === task.key && r.revision === task.revision ? {...r, error: error instanceof Error ? error.message : '等待同步'} : r)));
            }
        }
    }

    /**
     * Mirror explicit star state from authoritative records; keep legacy local bookmarks.
     * @param {import('study').LibraryRecord[]} records
     */
    async favoritesFrom(records) {
        await this.service.write(SAVED_KEY, async (value) => {
            // Decide against the outbox current at this write, not a snapshot taken before it queued.
            const outbox = (await this.service.storage.get(OUTBOX))[OUTBOX];
            const pending = /** @type {import('study').SyncTask[]} */ (Array.isArray(outbox) ? outbox : []);
            let rows = /** @type {import('study').SavedWord[]} */ (Array.isArray(value) ? value : []);
            for (const record of records) {
                if (typeof record.favorite !== 'boolean' || !record.entry) { continue; }
                if (pending.some((p) => p.action === 'libraryFavorite' && (p.id === record.id || (p.entry && sourceKey(p.entry) === sourceKey(record.entry))))) { continue; }
                const old = rows.find((r) => r.libraryId === record.id || sourceKey(r) === sourceKey(record.entry));
                if (old?.syncPending) { continue; }
                rows = rows.filter((r) => r !== old);
                if (record.favorite) { rows.push({...record.entry, url: old?.url ?? record.entry.url, sourceUrl: record.entry.url, id: old?.id ?? crypto.randomUUID(), libraryId: record.id, created: old?.created ?? Date.now(), syncPending: false}); }
            }
            return rows;
        });
    }
}
