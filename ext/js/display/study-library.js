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
 * @param {unknown} value
 * @returns {value is string}
 */
const validLibraryId = (value) => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

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
    const initialRecordId = getEntry()?.recordId;
    if (validLibraryId(initialRecordId)) { container.dataset.studyRecordId = initialRecordId; }
    const addCard = d.createElement('button');
    addCard.type = 'button';
    addCard.className = 'scan-disable study-card-add-toggle';
    addCard.dataset.studyAddCard = '';
    addCard.textContent = '手动添加卡片';
    addCard.hidden = true;
    const cardPanel = d.createElement('section');
    cardPanel.className = 'study-card-add';
    cardPanel.hidden = true;
    cardPanel.setAttribute('aria-label', '手动添加复习卡');
    const cardKinds = [
        ['meaning', '词义'],
        ['context', '语境'],
        ['expression', '表达'],
        ['grammar', '语法'],
        ['sentence', '句子'],
        ['listening', '听力'],
    ];
    const draftCards = d.createElement('div');
    draftCards.className = 'study-card-draft-list';
    const manualCards = d.createElement('div');
    manualCards.className = 'study-card-manual-list';
    /** @type {HTMLFieldSetElement[]} */
    const manualRows = [];
    /** @param {Partial<import('study').CardDraft> & {deck?: string}} card */
    const addManualRow = (card = {}) => {
        const row = d.createElement('fieldset');
        row.className = 'study-card-editor';
        const selectedLabel = d.createElement('label');
        selectedLabel.className = 'study-card-select-label';
        const selected = d.createElement('input');
        selected.type = 'checkbox';
        selected.checked = true;
        selected.dataset.studyCardSelect = '';
        selected.className = 'scan-disable';
        selectedLabel.append(selected, d.createTextNode('加入'));
        const kindLabel = d.createElement('label');
        kindLabel.textContent = '学习点';
        const kind = d.createElement('select');
        kind.className = 'scan-disable';
        kind.dataset.studyCardKind = '';
        for (const [key, label] of cardKinds) {
            const option = d.createElement('option');
            option.value = key;
            option.textContent = label;
            kind.append(option);
        }
        kind.value = card.kind ?? 'meaning';
        kindLabel.append(kind);
        const frontLabel = d.createElement('label'); frontLabel.textContent = '正面';
        const front = d.createElement('textarea');
        front.className = 'scan-disable';
        front.dataset.studyCardFront = '';
        front.rows = 2;
        front.maxLength = 1000;
        front.value = typeof card.front === 'string' ? card.front : '';
        const backLabel = d.createElement('label'); backLabel.textContent = '背面';
        const back = d.createElement('textarea');
        back.className = 'scan-disable';
        back.dataset.studyCardBack = '';
        back.rows = 2;
        back.maxLength = 2400;
        back.value = typeof card.back === 'string' ? card.back : '';
        const deckLabel = d.createElement('label'); deckLabel.textContent = '牌组（可留空）';
        const deck = d.createElement('input');
        deck.className = 'scan-disable';
        deck.dataset.studyCardDeck = '';
        deck.maxLength = 200;
        deck.value = typeof card.deck === 'string' ? card.deck : '';
        deckLabel.append(deck);
        const remove = d.createElement('button');
        remove.type = 'button';
        remove.className = 'scan-disable';
        remove.textContent = '移除';
        remove.addEventListener('click', () => {
            row.remove();
            updateSubmitState();
        });
        frontLabel.append(front);
        backLabel.append(back);
        row.append(selectedLabel, kindLabel, frontLabel, backLabel, deckLabel, remove);
        manualCards.append(row); manualRows.push(row);
        /** @param {HTMLTextAreaElement} field */
        const grow = (field) => {
            field.style.height = 'auto';
            field.style.height = `${field.scrollHeight}px`;
        };
        for (const field of [front, back]) {
            grow(field);
            field.addEventListener('input', () => { grow(field); });
        }
        row.addEventListener('input', updateSubmitState);
        row.addEventListener('change', updateSubmitState);
        updateSubmitState();
        front.focus();
    };
    const addRow = d.createElement('button');
    addRow.type = 'button';
    addRow.className = 'scan-disable';
    addRow.dataset.studyAddRow = '';
    addRow.textContent = '再加一张';
    addRow.addEventListener('click', () => addManualRow());
    const addStatus = d.createElement('p');
    addStatus.className = 'study-card-add-status';
    addStatus.setAttribute('role', 'status');
    const submitCards = d.createElement('button');
    submitCards.type = 'button';
    submitCards.className = 'scan-disable';
    submitCards.dataset.studyCardsSubmit = '';
    submitCards.textContent = '添加已选卡片';
    submitCards.disabled = true;
    cardPanel.append(draftCards, manualCards, addRow, submitCards, addStatus);
    /**
     *
     */
    /** @returns {void} */
    function updateSubmitState() {
        const draftsSelected = draftCards.querySelectorAll('input[data-study-review-card]:checked').length > 0;
        const manualSelected = manualRows.some((row) => row.isConnected && (/** @type {HTMLInputElement|null} */ (row.querySelector('input[data-study-card-select]')))?.checked);
        submitCards.disabled = !draftsSelected && !manualSelected;
    }
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
    /** @param {(import('study').CardDraft & {deck?: string})[]} cards */
    const renderDraftCards = (cards = []) => {
        draftCards.replaceChildren();
        const suggestions = Array.isArray(cards) ? cards : [];
        if (suggestions.length === 0) { return; }
        const heading = d.createElement('h4');
        heading.textContent = '已有复习建议 · 可逐张选择';
        draftCards.append(heading);
        for (const card of suggestions) {
            const row = d.createElement('label');
            row.className = 'study-card-draft';
            const select = d.createElement('input');
            select.type = 'checkbox';
            select.className = 'scan-disable';
            select.dataset.studyReviewCard = '';
            select.addEventListener('change', updateSubmitState);
            const kind = cardKinds.find(([key]) => key === card?.kind)?.[1] || '学习点';
            const description = d.createElement('span');
            description.textContent = `${kind} · ${typeof card?.front === 'string' ? card.front : ''} → ${typeof card?.back === 'string' ? card.back : ''}`;
            row.dataset.front = typeof card?.front === 'string' ? card.front : '';
            row.dataset.back = typeof card?.back === 'string' ? card.back : '';
            row.dataset.kind = cardKinds.some(([key]) => key === card?.kind) ? card.kind : 'meaning';
            if (typeof card?.deck === 'string' && card.deck) { row.dataset.deck = card.deck; }
            Object.assign(select.dataset, row.dataset);
            row.append(select, description); draftCards.append(row);
        }
    };
    /** @param {import('study').LibraryRecord} row */
    const showAnkiStatus = (row) => {
        currentSaved = row;
        if (validLibraryId(row?.id)) { container.dataset.studyRecordId = row.id; }
        addCard.hidden = !validLibraryId(row?.id) || row.ankiEnabled === false;
        renderDraftCards(row?.reviewDraft?.cards);
        ankiRow.hidden = false;
        const cards = row.cards ?? [];
        const synced = cards.filter((card) => (card.syncState ?? card.state) === 'synced');
        const pending = cards.filter((card) => (card.syncState ?? card.state) !== 'synced');
        retryCurrent.hidden = true;
        if (row.ankiEnabled === false) {
            ankiLabel.textContent = 'Anki · 已关闭，本次仅保存笔记';
        } else if (row.ankiState === 'pending') {
            ankiLabel.textContent = pending.length > 0 ?
                `Anki · ${pending.length} 张卡待核对／补交（笔记已保留）` :
                'Anki · 复习判断待完成（笔记已保留）';
            retryCurrent.hidden = false;
            retryCurrent.textContent = pending.length > 0 ? '重试这条记录的送卡' : '继续复习判断';
            retryCurrent.title = pending.length > 0 ?
                '只核对／补交已持久确认的卡；不重新生成卡片内容。' :
                '恢复未完成的复习判断，可能调用已配置的 AI。';
        } else if (synced.length > 0) {
            const linked = synced.every((card) => card.linkedExisting);
            ankiLabel.textContent = `Anki · ${linked ? '关联已有' : '已同步'} ${synced.length} 张卡${synced[0].noteId ? ` · #${synced[0].noteId}` : ''}`;
        } else if (row.reviewDraft?.cards?.length === 0) {
            ankiLabel.textContent = 'Anki · 本次无需新增复习卡';
        } else {
            ankiLabel.textContent = 'Anki · 记录已保存，制卡状态待核对';
        }
        ankiRow.title = row.error || pending[0]?.error || row.reviewDraft?.reason || '';
    };
    container.addEventListener('study-record-current', (event) => {
        if (!isCurrent()) { return; }
        const row = /** @type {CustomEvent<import('study').LibraryRecord>} */ (event).detail;
        if (row && validLibraryId(row.id)) { showAnkiStatus(row); }
    });
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
        submitCards.disabled = true;
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
                    updateSubmitState();
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
    addCard.addEventListener('click', () => {
        if (!currentSaved || !validLibraryId(currentSaved.id) || currentSaved.ankiEnabled === false) { return; }
        cardPanel.hidden = !cardPanel.hidden;
        container.closest('.study-focus-shell')?.classList.toggle('sf-card-editor-open', !cardPanel.hidden);
        addCard.textContent = cardPanel.hidden ? '再加一张卡' : '收起手动添加';
        if (!cardPanel.hidden && !draftCards.querySelector('[data-study-review-card]') && !manualRows.some((row) => row.isConnected)) { addManualRow(); }
        if (!cardPanel.hidden && typeof cardPanel.scrollIntoView === 'function') {
            d.defaultView?.requestAnimationFrame(() => {
                if (isCurrent()) { cardPanel.scrollIntoView({block: 'nearest'}); }
            });
        }
    });
    submitCards.addEventListener('click', () => {
        const saved = currentSaved;
        if (!saved || !validLibraryId(saved.id) || saved.ankiEnabled === false) { return; }
        /** @type {{front: string; back: string; kind: string; deck?: string}[]} */
        const cards = [];
        for (const row of /** @type {NodeListOf<HTMLInputElement>} */ (draftCards.querySelectorAll('input[data-study-review-card]:checked'))) {
            cards.push({front: row.dataset.front || '', back: row.dataset.back || '', kind: row.dataset.kind || 'meaning', ...(row.dataset.deck ? {deck: row.dataset.deck} : {})});
        }
        for (const row of manualRows.filter((item) => item.isConnected && (/** @type {HTMLInputElement|null} */ (item.querySelector('input[data-study-card-select]')))?.checked)) {
            const front = (/** @type {HTMLTextAreaElement|null} */ (row.querySelector('textarea[data-study-card-front]')))?.value.trim() ?? '';
            const back = (/** @type {HTMLTextAreaElement|null} */ (row.querySelector('textarea[data-study-card-back]')))?.value.trim() ?? '';
            const kind = (/** @type {HTMLSelectElement|null} */ (row.querySelector('select[data-study-card-kind]')))?.value || 'meaning';
            const deck = (/** @type {HTMLInputElement|null} */ (row.querySelector('input[data-study-card-deck]')))?.value.trim() ?? '';
            cards.push({front, back, kind, ...(deck ? {deck} : {})});
        }
        if (cards.length === 0 || cards.some((card) => !card.front || !card.back)) {
            addStatus.textContent = '请为每张已选卡片填写正面和背面。';
            return;
        }
        const seen = new Set();
        for (const card of cards) {
            const key = `${card.front.trim().toLocaleLowerCase()}\u0000${card.back.trim().toLocaleLowerCase()}`;
            if (seen.has(key)) {
                addStatus.textContent = '发现正反面相同的重复卡；请只保留一张或修改内容。';
                return;
            }
            seen.add(key);
        }
        const currentLanguage = saved.entry?.language ?? getEntry().language ?? 'en';
        run(async () => {
            addStatus.textContent = '正在添加手动复习卡…';
            const result = /** @type {import('study').LibraryRecord} */ (await studyCall('libraryCardsAdd', {
                id: saved.id,
                language: currentLanguage,
                cards,
            }));
            if (!isCurrent()) { return; }
            if (result) { showAnkiStatus(result); }
            addStatus.textContent = `${cards.length} 张手动卡已加入这条学习记录。`;
            cardPanel.hidden = true;
            container.closest('.study-focus-shell')?.classList.remove('sf-card-editor-open');
            addCard.textContent = '再加一张卡';
            manualRows.splice(0, manualRows.length);
            manualCards.replaceChildren();
            for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (draftCards.querySelectorAll('input[data-study-review-card]'))) { input.checked = false; }
            updateSubmitState();
            if (d.defaultView) { container.dispatchEvent(new d.defaultView.Event('study-saved')); }
        });
    });
    save.addEventListener('click', () => {
        const entry = getEntry();
        run(async () => {
            status.textContent = '正在保存本次学习…';
            // One background operation owns durable save intent; it outlives this document.
            const recordId = currentSaved?.id || container.dataset.studyRecordId || entry.recordId;
            const row = /** @type {import('study').LibraryRecord} */ (await studyCall('rememberEntry', {entry, ...(validLibraryId(recordId) ? {recordId} : {})}));
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
            if (row.syncState === 'conflict') {
                status.textContent = '笔记已保留 · 有同步冲突，请在我的记录中选择。';
            } else if (row.syncState === 'pending' || row.ankiState === 'pending') {
                status.textContent = '笔记已保存；Anki 更新待同步，可在学习库继续。';
            } else if (row.ankiState === 'synced') {
                status.textContent = `已记住 · Anki ${row.target?.deck ?? ''}`;
            } else {
                status.textContent = row.reviewDraft?.cards?.length === 0 ? '笔记已保存 · 本次无需新增复习卡' : '笔记已保存 · 复习结果尚未确认';
            }
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
        primary.after(destination, openNote, status, ankiRow, recovery, addCard, cardPanel);
    } else {
        container.append(actions, destination, openNote, status, ankiRow, recovery, addCard, cardPanel);
    }
    void refreshPending().catch(() => {});
}
