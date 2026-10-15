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
/**
 * One explicit user action; all durable writes remain in the existing guarded protocol.
 * @param {import('./study-service.js').StudyService} service
 * @param {{id: string, language: string}} source
 * @param {((action: string, value: unknown) => Promise<unknown>) | null} [dispatch]
 * @returns {Promise<import('study').LibraryRecord>}
 */
export async function rememberSaved(service, source, dispatch = null) {
    const {id, language} = source;
    /**
     * @param {string} action
     * @param {Record<string, unknown>} data
     * @returns {Promise<{items: import('study').LibraryRecord[]}>}
     */
    const call = async (action, data) => /** @type {{items: import('study').LibraryRecord[]}} */ (await (dispatch ?? service.handle.bind(service))(action, {language, ...data}));
    const read = /** @type {{items: import('study').LearningMaterial[]}} */ (await (dispatch ?? service.handle.bind(service))('libraryRead', {language, ids: [id]}));
    let row = read.items[0]?.record;
    if (!row || row.id !== id) {
        throw new Error('已保存笔记暂不可读；没有送入 Anki。');
    }
    if (row.ankiState === 'pending' && (row.cards?.length || row.noteId || !row.reviewDraft)) {
        // Retrying already-authorized cards is not a new AI decision.
        return (await call('librarySync', {ids: [id]})).items[0];
    }
    if (row.reviewDraft && (row.draftStale || row.reviewDraft.cards.length > 1)) {
        await call('libraryDraftDiscard', {items: [{id, version: row.version}]});
        row = void 0;
    }
    if (!row?.reviewDraft) {
        row = (await call('draftCards', {ids: [id], automatic: true})).items[0];
    }
    if (!row?.reviewDraft) {
        throw new Error('笔记已保留，学习整理尚未完成；可重试。');
    }
    const candidate = row.reviewDraft.cards[0];
    if (!candidate) {
        return row;
    } // Zero cards is a valid learning decision.
    if (row.cards?.some((c) => c.front === candidate.front && c.back === candidate.back)) {
        return (await call('librarySync', {ids: [id]})).items[0];
    }
    if (row.reviewDraft.cards.filter((c) => c.selected).length !== 1 || !candidate.selected) {
        row = (await call('libraryDraftSave', {items: [{id,
            version: row.version,
            reason: row.reviewDraft.reason,
            cards: row.reviewDraft.cards.map((c, i) => ({...c, selected: i === 0}))}]})).items[0];
    }
    if (!row.reviewDraft) {
        throw new Error('复习建议保存未确认；没有送卡。');
    }
    return (await call('libraryDraftCommit', {items: [{id, version: row.version, draftId: row.reviewDraft.id}]})).items[0];
}
