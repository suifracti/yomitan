/*
 * Copyright (C) 2023-2026  Yomitan Authors
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

// Generated from local-bridge/study_cards.py by dev/sync-local.py --manifest-only.
export const CARD_CATALOG = /** @type {const} */ ([
    {kind: 'meaning', label: '单词→中文义', stage: 1, needs: null, deck: 'meaning'},
    {kind: 'listen-meaning', label: '听原声→意思', stage: 1, needs: 'audio', deck: 'listening'},
    {kind: 'form-recognize', label: '词形识别', stage: 1, needs: 'forms', deck: 'meaning'},
    {kind: 'context', label: '原句中的意思', stage: 2, needs: 'sentence', deck: 'context'},
    {kind: 'sentence', label: '句子英→中', stage: 2, needs: 'sentence', deck: 'sentence'},
    {kind: 'listening', label: '视频声音字幕', stage: 2, needs: 'audio', deck: 'listening'},
    {kind: 'produce', label: '中→英（写原句）', stage: 3, needs: 'translation', deck: 'produce'},
    {kind: 'cloze', label: '挖空填词', stage: 3, needs: 'sentence', deck: 'produce'},
    {kind: 'form-produce', label: '词形变化', stage: 3, needs: 'forms', deck: 'produce'},
    {kind: 'make-sentence', label: '用词造句', stage: 3, needs: null, deck: 'produce'},
    {kind: 'expression', label: '搭配/表达', stage: 3, needs: null, deck: 'expression'},
    {kind: 'spelling', label: '听音拼写', stage: 3, needs: 'audio', deck: 'produce'},
    {kind: 'grammar', label: '语法', stage: 2, needs: null, deck: 'grammar'},
]);

export const STAGE_LABELS = /** @type {const} */ ({1: '① 认得', 2: '② 理解', 3: '③ 会用'});

export const MASTERY_LABELS = /** @type {const} */ ({none: '完全不会', vague: '有印象/模糊', known: '认识但不会用'});
