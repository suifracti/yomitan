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

import {expect, test} from 'vitest';
import {cardDrafts, cardKind, deckKindFor, missingFor, recommendedKinds} from '../ext/js/display/study-card-kinds.js';

/** @type {import('../ext/js/display/study-card-kinds.js').CardFacts} */
const facts = {
    word: 'brick',
    sentence: 'I opened a brick and mortar shop.',
    translation: '我开了一家实体店。',
    meaning: 'n. 砖块',
    contextMeaning: '实体的（brick and mortar）',
    audio: false,
    forms: [{label: '复数', form: 'bricks', kind: '复数'}],
};

test('mastery recommends stage cards that the facts allow', () => {
    expect(recommendedKinds('none', facts)).toEqual(['meaning']);
    expect(recommendedKinds('none', {...facts, audio: true})).toEqual(['meaning', 'listen-meaning']);
    expect(recommendedKinds('vague', facts)).toEqual(['meaning', 'context']);
    expect(recommendedKinds('known', facts)).toEqual(['produce', 'cloze']);
    expect(recommendedKinds('known', {...facts, translation: ''})).toEqual(['cloze']);
});

test('drafts use the card facts and never borrow a general sense for the context answer', () => {
    expect(cardDrafts('cloze', facts)).toEqual([{front: '填空（实体的（brick and mortar））：\nI opened a […] and mortar shop.', back: 'brick\nI opened a brick and mortar shop.'}]);
    expect(cardDrafts('produce', facts)[0]).toEqual({front: '用英文说出这句话（提示：brick）：\n我开了一家实体店。', back: 'I opened a brick and mortar shop.'});
    expect(cardDrafts('form-recognize', facts)).toEqual([{front: 'bricks 是哪个词的什么形式？', back: 'brick 的复数'}]);
    expect(cardDrafts('context', {...facts, contextMeaning: ''})[0].back).toBe('');
});

test('missing prerequisites explain themselves', () => {
    const listening = /** @type {import('../ext/js/display/study-card-kinds.js').CardKindInfo} */ (cardKind('listening'));
    expect(missingFor(listening, facts)).toContain('原声');
    expect(missingFor(listening, {...facts, audio: true})).toBe('');
    const forms = /** @type {import('../ext/js/display/study-card-kinds.js').CardKindInfo} */ (cardKind('form-produce'));
    expect(missingFor(forms, {...facts, forms: []})).toContain('词形');
});

test('new kinds route to the subdeck of their stage', () => {
    expect(deckKindFor('meaning')).toBe('meaning');
    expect(deckKindFor('form-recognize')).toBe('meaning');
    expect(deckKindFor('listen-meaning')).toBe('listening');
    expect(deckKindFor('cloze')).toBe('produce');
    expect(deckKindFor('sentence')).toBe('sentence');
});
