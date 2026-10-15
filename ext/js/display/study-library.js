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
    save.title = '保存本次学习到 Obsidian，并由 AI 选择最多一张新卡加入 Anki；已有精确相同内容则关联';
    const destination = d.createElement('p');
    destination.className = 'study-save-destination';
    destination.textContent = `Obsidian + Anki · ${getEntry().language === 'ja' ? '日语' : '英语'}`;
    const openNote = d.createElement('a');
    openNote.textContent = '查看学习记录 ↗';
    openNote.hidden = true;
    openNote.className = 'scan-disable';
    const status = d.createElement('p');
    status.className = 'study-library-status';
    status.setAttribute('role', 'status');
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
        recovery.hidden = count === 0;
        pendingLabel.textContent = `还有 ${count} 条学习未完成 · `;
    };
    let busy = false;
    /** @param {() => Promise<void>} operation */
    const run = (operation) => {
        if (busy) { return; }
        busy = true;
        save.disabled = true;
        retry.disabled = true;
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
                    void refreshPending().catch(() => {});
                }
            });
    };
    retry.addEventListener('click', () => run(async () => {
        pendingLabel.textContent = '正在继续上次未完成的学习…';
        const row = /** @type {?import('study').LibraryRecord} */ (await studyCall('retryPending', {language}));
        if (!row || !isCurrent()) { return; }
        status.textContent = `${row.entry.word} · ${row.ankiState === 'pending' ? '仍待补齐；记录已保留' : '已补齐'}${row.error ? `：${row.error}` : ''}`;
        if (row.openUrl?.startsWith('obsidian://open?')) {
            openNote.href = row.openUrl;
            openNote.textContent = `查看 ${row.entry.word} 的记录 ↗`;
            openNote.hidden = false;
        }
    }));
    save.addEventListener('click', () => {
        const entry = getEntry();
        run(async () => {
            status.textContent = '正在保存本次学习…';
            // One background operation owns durable save intent; it outlives this document.
            const row = /** @type {import('study').LibraryRecord} */ (await studyCall('rememberEntry', {entry}));
            const saved = row;
            if (isCurrent()) {
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
            status.textContent = row.ankiState === 'pending' ?
                '笔记已保存；稍后点“继续补齐”，不用重找原网页。' :
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
        primary.after(destination, openNote, status, recovery);
    } else {
        container.append(actions, destination, openNote, status, recovery);
    }
    void refreshPending().catch(() => {});
}
