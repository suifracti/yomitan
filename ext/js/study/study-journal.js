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

import {studyLookup} from './study-data.js';

const KEY = 'studyLearningJournalV1';

/**
 * @param {import('study').JournalRow[]} rows
 * @returns {import('study').JournalRow[]}
 */
function bounded(rows) {
    // Only acknowledged copies are evicted; the durable full history remains in Obsidian.
    const keep = new Set(rows.filter((r) => r.saved && r.turn.kind !== 'feedback').slice(-100).map((r) => r.turn.id));
    for (const row of rows) {
        if (!row.saved && row.turn.relatedTurnId) {
            keep.add(row.turn.relatedTurnId);
        }
    }
    let next = rows.filter((r) => !r.saved || keep.has(r.turn.id) || (r.turn.relatedTurnId && keep.has(r.turn.relatedTurnId)));
    const pinned = new Set(rows.filter((r) => !r.saved && r.turn.relatedTurnId).map((r) => r.turn.relatedTurnId));
    const encoder = new TextEncoder();
    for (const candidate of next.filter((r) => r.saved && r.turn.kind !== 'feedback')) {
        if (encoder.encode(JSON.stringify(next.filter((r) => r.saved))).length <= 500000) { break; }
        if (!pinned.has(candidate.turn.id)) {
            next = next.filter((r) => !r.saved || (r.turn.id !== candidate.turn.id && r.turn.relatedTurnId !== candidate.turn.id));
        }
    }
    return next;
}


/**
 * @param {unknown} value
 * @returns {string}
 */
export function sourceKey(value) {
    const source = /**
                    * @type {Partial<import('study').LibraryEntry>}
                    */ (value ?? {});
    if (source.subtitleSource) {
        const s = source.subtitleSource;
        return 'r2:' + JSON.stringify([s.version,
            s.url,
            s.language,
            s.trackIndex,
            s.trackName,
            s.text,
            s.originalStartMs,
            s.originalEndMs,
            s.selectionStart,
            s.selectionEnd,
            s.word]);
    }
    const {word, sentence, language} = studyLookup(value);
    return (language === 'ja' ? 'ja:' : '') + JSON.stringify([word.toLowerCase(), sentence, source.url ?? '', source.url ? '' : source.title ?? '', source.videoTime ?? null]);
}

/**
 * Durable local outbox. Only explicit Save transfers this history to Obsidian.
 */
export class StudyJournal {
    /**
     * @param {import('./study-service.js').StudyService} service
     */
    constructor(service) {
        /**
         * @type {import('./study-service.js').StudyService}
         */
        this.service = service;
    }

    /**
     * @returns {Promise<import('study').JournalRow[]>}
     */
    async rows() {
        const rows = await this.service.read(KEY);
        return Array.isArray(rows) ? rows : [];
    }

    /**
     * @param {unknown} source
     * @returns {Promise<import('study').LearningTurn[]>}
     */
    async get(source) {
        const key = sourceKey(source);
        return (await this.rows()).filter((r) => r.key === key && !r.saved).map((r) => r.turn);
    }

    /**
     * @param {unknown} source
     * @returns {Promise<import('study').LearningTurn[]>}
     */
    async conversation(source) {
        const rows = (await this.rows()).filter((r) => r.key === sourceKey(source));
        return rows.filter((r) => r.turn.kind !== 'feedback').map((r) => {
            const events = rows.filter((e) => e.turn.kind === 'feedback' && e.turn.relatedTurnId === r.turn.id);
            const last = events.at(-1);
            return {...r.turn, feedback: last?.turn.feedback ?? r.turn.feedback, saved: r.saved === true && (!last || last.saved === true)};
        });
    }

    /**
     * @param {unknown} source
     * @param {string} id
     * @param {import('study').Usage} usage
     * @returns {Promise<void>}
     */
    async recordUsage(source, id, usage) {
        await this.service.write('studyConversationUsageV1', (value) => {
            const rows = /** @type {{key: string, id: string, usage: import('study').Usage}[]} */ (Array.isArray(value) ? value : []);
            return [...rows.filter((r) => r.id !== id), {key: sourceKey(source), id, usage}];
        });
    }

    /**
     * @param {unknown} source
     * @returns {Promise<import('study').Usage[]>}
     */
    async usage(source) {
        const value = await this.service.read('studyConversationUsageV1');
        const rows = /** @type {{key: string, usage: import('study').Usage}[]} */ (Array.isArray(value) ? value : []);
        return rows.filter((r) => r.key === sourceKey(source) && r.usage.status !== 'cached').map((r) => r.usage);
    }

    /**
     * @returns {Promise<void>}
     */
    async checkRoom() {
        if (new TextEncoder().encode(JSON.stringify(bounded(await this.rows()))).length > 1500000) {
            throw new Error('未保存学习过程较多，请先保存到 Obsidian；不会自动删除旧问答。');
        }
    }

    /**
     * @param {unknown} source
     * @param {import('study').Result} result
     * @param {import('study').LearningTurn['feedback']} [feedback]
     * @param {import('study').Usage} [usage]
     * @returns {Promise<void>}
     */
    async append(source, result, feedback = 'unconfirmed', usage) {
        const lookup = studyLookup(source);
        const turn = {id: crypto.randomUUID(), at: new Date().toISOString(), question: lookup.question ?? '', ...result, feedback, ...(usage ? {usage} : {})};
        const row = {key: sourceKey(source), turn};
        await this.service.write(KEY, (value) => {
            const rows = /**
                          * @type {import('study').JournalRow[]}
                          */ (Array.isArray(value) ? value : []);
            const next = bounded([...rows, row]);
            if (new TextEncoder().encode(JSON.stringify(next)).length > 2000000) {
                throw new Error('本地学习过程已满，请先保存；不会自动清理。');
            }
            return next;
        });
    }

    /**
     * @param {unknown} source
     * @param {unknown} feedback
     * @returns {Promise<boolean>}
     */
    async feedback(source, feedback) {
        if (feedback !== 'understood' && feedback !== 'unclear') {
            throw new Error('请选择本人这次是否理解。');
        }
        const key = sourceKey(source);
        const question = studyLookup(source).question ?? '';
        const turnId = /** @type {{turnId?: string}} */ (source ?? {}).turnId;
        await this.service.write(KEY, (value) => {
            const rows = /** @type {import('study').JournalRow[]} */ (Array.isArray(value) ? value : []);
            const row = [...rows].reverse().find((r) => r.key === key && r.turn.kind !== 'feedback' && (turnId ? r.turn.id === turnId : r.turn.question === question));
            if (!row) {
                throw new Error('请先读取这轮回答，再反馈；不会猜测关联。');
            }
            const last = [...rows].reverse().find((r) => r.key === key && r.turn.kind === 'feedback' && r.turn.relatedTurnId === row.turn.id);
            if ((last?.turn.feedback ?? row.turn.feedback) === feedback) {
                return rows;
            }
            if (!row.saved) {
                return rows.map((r) => (r === row ? {...r, turn: {...r.turn, feedback}} : r));
            }
            if (last && !last.saved) {
                return rows.map((r) => (r === last ? {...r, turn: {...r.turn, at: new Date().toISOString(), feedback}} : r));
            }
            return [...rows, {key, turn: {id: crypto.randomUUID(), at: new Date().toISOString(), kind: 'feedback', relatedTurnId: row.turn.id, question: row.turn.question, translation: '', meaning: '', notes: '', feedback}}];
        });
        return true;
    }

    /**
     * @param {import('study').LibraryEntry} entry
     * @param {boolean} makeCard
     * @param {import('study').LearningTurn[]} [frozenTurns]
     * @param {string} [targetId]
     * @returns {Promise<unknown>}
     */
    async save(entry, makeCard, frozenTurns, targetId) {
        const turns = frozenTurns ?? await this.get(entry);
        /**
         * @type {unknown}
         */
        let saved;
        // Small frames also keep long answers below the native-message byte budget.
        for (let i = 0; i < Math.max(1, turns.length); i += 4) {
            const batch = turns.slice(i, i + 4);
            const response = await this.service.native({action: 'librarySave', entry, makeCard: makeCard && i + 4 >= turns.length, turns: batch, ...(targetId ? {targetId} : {})}).promise;
            if (!response.ok || !response.library) {
                throw new Error(response.error ?? '保存未确认，问答仍在本地待保存。');
            }
            saved = response.library;
            const snapshots = new Map(batch.map((t) => [t.id, t]));
            await this.service.write(KEY, (value) => {
                const rows = /** @type {import('study').JournalRow[]} */ (Array.isArray(value) ? value : []);
                /** @type {import('study').JournalRow[]} */
                const repairs = [];
                const next = rows.map((r) => {
                    const snapshot = snapshots.get(r.turn.id);
                    if (!snapshot) {
                        return r;
                    }
                    if (r.turn.feedback !== snapshot.feedback) {
                        repairs.push({key: r.key, turn: {id: crypto.randomUUID(), at: new Date().toISOString(), kind: 'feedback', relatedTurnId: r.turn.relatedTurnId ?? r.turn.id, question: r.turn.question, translation: '', meaning: '', notes: '', feedback: r.turn.feedback}});
                    }
                    return {...r, turn: snapshot, saved: true};
                });
                return bounded([...next, ...repairs]);
            });
        }
        return saved;
    }
}
