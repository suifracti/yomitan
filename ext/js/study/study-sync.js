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
        if (!/^[a-f0-9]{32}$/.test(row?.id) || row.learningState === 'favorite-only' || row.entry?.subtitleSource) { return; }
        const key = sourceKey(source);
        const language = row.entry?.language ?? /** @type {{language?: string}} */ (source).language ?? 'en';
        await this.service.write(LINKS, (value) => {
            const rows = /** @type {import('study').SyncLink[]} */ (Array.isArray(value) ? value : []);
            return [...rows.filter((r) => r.key !== key), {key, id: row.id, language, ...(row.targetId ? {targetId: row.targetId} : {})}];
        });
    }

    /** @param {import('study').SyncTask} task */
    async enqueue(task) {
        await this.service.write(OUTBOX, (value) => {
            const rows = /** @type {import('study').SyncTask[]} */ (Array.isArray(value) ? value : []);
            const previous = rows.find((r) => r.key === task.key);
            const old = task.action === 'libraryUpdate' && previous?.action === task.action ? previous : void 0;
            const turns = new Map([...(old?.turns ?? []), ...(task.turns ?? [])].map((t) => [t.id, t]));
            const next = [...rows.filter((r) => r.key !== task.key), {...old,
                ...task,
                revision: crypto.randomUUID(),
                ...(task.entry && task.action === 'libraryUpdate' ? {entry: {...old?.entry, ...task.entry}} : {}),
                ...(turns.size > 0 ? {turns: [...turns.values()]} : {})}];
            if (new TextEncoder().encode(JSON.stringify(next)).length > 2000000) { throw new Error('待同步内容较多，请先补齐；未删除旧记录。'); }
            return next;
        });
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
        this.running = this.deliver().finally(() => { this.running = null; });
        return this.running;
    }

    /** @returns {Promise<void>} */
    async deliver() {
        for (const task of await this.pending()) {
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
                    await this.enqueue({key,
                        action: 'libraryReconcile',
                        id: row.id,
                        language: task.language,
                        ...(task.targetId ? {targetId: task.targetId} : {}),
                        error: row.conflicts?.length ? '字段有冲突，请在我的记录或学习库选择保留哪一边。' : (row.error ?? '关联卡片待同步或已缺失，请在学习库查看。')});
                    continue;
                }
                if (row && task.action === 'libraryFavorite') {
                    const libraryId = row.id;
                    await this.service.write(SAVED_KEY, (value) => /** @type {import('study').SavedWord[]} */ (Array.isArray(value) ? value : []).map((r) => (`favorite:${sourceKey(r)}` === key ? {...r, libraryId, syncPending: false} : r)));
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
        const pending = await this.pending();
        await this.service.write(SAVED_KEY, (value) => {
            let rows = /** @type {import('study').SavedWord[]} */ (Array.isArray(value) ? value : []);
            for (const record of records) {
                if (typeof record.favorite !== 'boolean' || !record.entry || record.entry.subtitleSource) { continue; }
                if (pending.some((p) => p.action === 'libraryFavorite' && (p.id === record.id || (p.entry && sourceKey(p.entry) === sourceKey(record.entry))))) { continue; }
                const old = rows.find((r) => r.libraryId === record.id || sourceKey(r) === sourceKey(record.entry));
                rows = rows.filter((r) => r !== old);
                if (record.favorite) { rows.push({...record.entry, url: old?.url ?? record.entry.url, sourceUrl: record.entry.url, id: old?.id ?? crypto.randomUUID(), libraryId: record.id, created: old?.created ?? Date.now(), syncPending: false}); }
            }
            return rows;
        });
    }
}
