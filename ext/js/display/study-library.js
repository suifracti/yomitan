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

import {SAVE_TARGETS_KEY} from '../study/study-data.js';
import {studyCall} from '../study/study-client.js';

/**
 * One explicit save action; the background service and fixed native bridge own persistence and card selection.
 * @param {HTMLElement} container
 * @param {() => import('study').LibraryEntry} getEntry
 * @param {() => boolean} isCurrent
 */
export function mountStudyLibrary(container, getEntry, isCurrent) {
    const d = container.ownerDocument;
    const actions = d.createElement('div');
    actions.className = 'study-learning-actions study-save-actions';
    const save = d.createElement('button');
    save.type = 'button';
    save.className = 'scan-disable';
    save.dataset.studySave = 'note';
    save.textContent = '记住它';
    save.title = '保存本次完整学习到 Obsidian；是否安排 Anki 复习以“保存与复习”设置为准。';
    const destination = d.createElement('p');
    destination.className = 'study-save-destination';
    destination.textContent = `Obsidian · ${getEntry().language === 'ja' ? '日语 + Anki' : '英语 · 按保存与复习设置'}`;
    if (getEntry().language !== 'ja' && typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
        void chrome.storage.local.get(SAVE_TARGETS_KEY).then((value) => {
            const settings = /** @type {import('study').SaveTargetSettings | undefined} */ (value[SAVE_TARGETS_KEY]);
            if (isCurrent() && settings?.ankiEnabled === false) { destination.textContent = 'Obsidian · 英语 · Anki 未启用'; }
        });
    }
    const openNote = d.createElement('a');
    openNote.textContent = '查看学习记录 ↗';
    openNote.hidden = true;
    openNote.className = 'scan-disable';
    const status = d.createElement('p');
    status.className = 'study-library-status';
    status.setAttribute('role', 'status');
    // Show the verified Anki result separately from the durable Obsidian note.
    const ankiRow = d.createElement('div');
    ankiRow.className = 'study-anki-status';
    ankiRow.hidden = true;
    const ankiLabel = d.createElement('span');
    const retryCurrent = d.createElement('button');
    retryCurrent.type = 'button';
    retryCurrent.className = 'scan-disable';
    retryCurrent.textContent = '重试本条卡片';
    retryCurrent.hidden = true;
    ankiRow.append(ankiLabel, retryCurrent);
    /** @type {?import('study').LibraryRecord} */
    let currentSaved = null;
    /** @param {import('study').LibraryRecord} row */
    const showAnkiStatus = (row) => {
        currentSaved = row;
        ankiRow.hidden = false;
        const cards = row.cards ?? [];
        const synced = cards.filter((card) => card.state === 'synced');
        const pending = cards.filter((card) => card.state !== 'synced');
        retryCurrent.hidden = true;
        if (row.ankiEnabled === false) {
            ankiLabel.textContent = 'Anki · 已关闭，本次仅保存笔记';
        } else if (row.ankiState === 'pending') {
            ankiLabel.textContent = pending.length ?
                `Anki · ${pending.length} 张卡待核对／补交（笔记已保留）` :
                'Anki · 复习判断待完成（笔记已保留）';
            retryCurrent.hidden = false;
            retryCurrent.textContent = pending.length ? '重试这条记录的送卡' : '继续复习判断';
            retryCurrent.title = pending.length ?
                '只核对／补交已持久确认的卡；不重新生成卡片内容。' :
                '恢复未完成的复习判断，可能调用已配置的 AI。';
        } else if (synced.length) {
            const linked = synced.every((card) => card.linkedExisting);
            ankiLabel.textContent = `Anki · ${linked ? '关联已有' : '已同步'} ${synced.length} 张卡${synced[0].noteId ? ` · #${synced[0].noteId}` : ''}`;
        } else if (row.reviewDraft?.cards?.length === 0) {
            ankiLabel.textContent = 'Anki · 本次无需新增复习卡';
        } else {
            ankiLabel.textContent = 'Anki · 记录已保存，制卡状态待核对';
        }
        ankiRow.title = row.error || pending[0]?.error || row.reviewDraft?.reason || '';
    };
    const recovery = d.createElement('p');
    recovery.className = 'study-pending-recovery';
    recovery.hidden = true;
    const pendingLabel = d.createElement('span');
    const retry = d.createElement('button');
    retry.type = 'button';
    retry.className = 'scan-disable';
    retry.textContent = '继续补齐';
    recovery.append(pendingLabel, retry);
    const language = getEntry().language ?? 'en';
    const refreshPending = async () => {
        const pending = /** @type {{count?: number}} */ (await studyCall('pendingPeek', {language}));
        if (!isCurrent()) { return; }
        const count = typeof pending?.count === 'number' ? pending.count : 0;
        recovery.hidden = count === 0 || (count === 1 && currentSaved?.ankiState === 'pending');
        pendingLabel.textContent = `还有 ${count} 条待处理学习 · `;
    };
    let busy = false;
    /** @param {() => Promise<void>} operation */
    const run = (operation) => {
        if (busy) { return; }
        busy = true;
        save.disabled = true;
        retry.disabled = true;
        retryCurrent.disabled = true;
        void chrome.permissions.request({permissions: ['nativeMessaging']}).then(async (allowed) => {
            if (!allowed) { throw new Error('尚未允许本机保存；普通查词仍可用。'); }
            await operation();
        }).catch((error) => {
            if (isCurrent()) {
                status.textContent = `${error instanceof Error ? error.message : '暂未完成'}；点“记住它”可重试。`;
            }
        })
            .finally(() => {
                busy = false;
                if (isCurrent()) {
                    save.disabled = false;
                    retry.disabled = false;
                    retryCurrent.disabled = false;
                    void refreshPending().catch(() => {});
                }
            });
    };
    retry.addEventListener('click', () => run(async () => {
        pendingLabel.textContent = '正在继续上次未完成的学习…';
        const row = /** @type {?import('study').LibraryRecord} */ (await studyCall('retryPending', {language}));
        if (!row || !isCurrent()) { return; }
        showAnkiStatus(row);
        status.textContent = row.ankiEnabled === false ? '笔记已保存 · Anki 未启用；原待补齐内容已保留。' : `${row.entry.word} · ${row.ankiState === 'pending' ? '仍待补齐；记录已保留' : '已补齐'}${row.error ? `：${row.error}` : ''}`;
        if (row.openUrl?.startsWith('obsidian://open?')) {
            openNote.href = row.openUrl;
            openNote.textContent = `查看 ${row.entry.word} 的记录 ↗`;
            openNote.hidden = false;
        }
    }));
    retryCurrent.addEventListener('click', () => {
        if (!currentSaved || currentSaved.ankiState !== 'pending') { return; }
        const recordId = currentSaved.id;
        const currentLanguage = currentSaved.entry.language ?? language;
        run(async () => {
            status.textContent = '正在核对并继续本条学习的 Anki 复习…';
            // Reuses the existing guarded, idempotent save/Anki protocol.
            const row = /** @type {import('study').LibraryRecord} */ (await studyCall('remember', {id: recordId, language: currentLanguage}));
            if (!isCurrent()) { return; }
            showAnkiStatus(row);
            status.textContent = row.ankiState === 'pending' ?
                `本条卡片仍待补交：${row.cards?.find((card) => card.state !== 'synced')?.error || row.error || '可稍后再试'}` :
                '本条复习已确认；Obsidian 笔记未重复保存。';
        });
    });
    save.addEventListener('click', () => {
        const entry = getEntry();
        run(async () => {
            status.textContent = '正在保存本次学习…';
            // One background operation owns durable save intent; it outlives this document.
            const row = /** @type {import('study').LibraryRecord} */ (await studyCall('rememberEntry', {entry}));
            const saved = row;
            if (isCurrent()) {
                showAnkiStatus(row);
                destination.textContent = `已存：${saved.path}`;
                destination.title = saved.path;
                openNote.textContent = '查看学习记录 ↗';
                if (saved.openUrl?.startsWith('obsidian://open?')) {
                    openNote.href = saved.openUrl;
                    openNote.hidden = false;
                }
                if (d.defaultView) { container.dispatchEvent(new d.defaultView.Event('study-saved')); }
                status.textContent = '笔记已保存，正在安排复习；可以继续阅读。';
            }
            if (!isCurrent()) { return; }
            if (row.ankiEnabled === false) {
                status.textContent = '笔记已保存 · Anki 未启用';
                return;
            }
            status.textContent = row.ankiState === 'pending' ?
                '笔记已保存；Anki 卡片待核对／补交，请用下方按钮继续。' :
                (row.ankiState === 'synced' ? `已记住 · Anki ${row.target?.deck ?? ''}` : '已记下 · 本次不需要新增复习卡');
            const card = row.cards?.find((item) => item.state === 'synced');
            if (card) {
                status.textContent += ` · ${card.linkedExisting ? '关联已有卡' : '新卡'}：${card.front}`;
            } else if (row.ankiState !== 'pending' && row.reviewDraft?.reason) {
                status.textContent += ` · ${row.reviewDraft.reason}`;
            }
            status.title = row.error ?? row.reviewDraft?.reason ?? '';
            if (d.defaultView) { container.dispatchEvent(new d.defaultView.Event('study-saved')); }
        });
    });
    actions.append(save);
    const primary = container.querySelector('.study-translation-actions');
    if (primary) {
        primary.append(actions);
        primary.after(destination, openNote, status, ankiRow, recovery);
    } else {
        container.append(actions, destination, openNote, status, ankiRow, recovery);
    }
    void refreshPending().catch(() => {});
}
