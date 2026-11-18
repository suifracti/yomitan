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

import {escapeRegExp} from '../core/utilities.js';
import {CARD_CATALOG} from '../study/card-catalog.js';

export {MASTERY_LABELS, STAGE_LABELS} from '../study/card-catalog.js';

// Card types grouped by learning stage: ① recognise, ② understand in context, ③ use.
// Pure data and text templates; the card panel decides what is available and the
// learner still confirms every card before anything reaches Anki.

/** @typedef {keyof typeof import('../study/card-catalog.js').STAGE_LABELS} CardStage */
/** @typedef {keyof typeof import('../study/card-catalog.js').MASTERY_LABELS} Mastery */

/**
 * @typedef {object} CardFacts
 * @property {string} word
 * @property {string} sentence Empty when the lookup has no real sentence.
 * @property {string} translation Chinese translation of the sentence, if known.
 * @property {string} meaning Short Chinese dictionary sense.
 * @property {string} contextMeaning Meaning in this sentence, only when confirmed.
 * @property {boolean} audio Whether real audio is attached to the record.
 * @property {{label: string, form: string, kind: string}[]} forms Inflected forms with readable names.
 */

/** @typedef {typeof CARD_CATALOG[number]} CardKindInfo */

export const CARD_KINDS = CARD_CATALOG.filter(({kind}) => kind !== 'grammar');

/** @type {Record<Mastery, string[]>} */
const RECOMMENDED = {
    none: ['meaning', 'listen-meaning'],
    vague: ['meaning', 'context', 'listening'],
    known: ['produce', 'cloze'],
};

/**
 * @param {string} kind
 * @returns {CardKindInfo|undefined}
 */
export function cardKind(kind) {
    return CARD_CATALOG.find((item) => item.kind === kind);
}

/**
 * @param {CardKindInfo} info
 * @param {CardFacts} facts
 * @returns {string} Empty when the card can be made; otherwise why not.
 */
export function missingFor(info, facts) {
    if (info.needs === 'sentence' && !facts.sentence) { return '没有原句，请先补充原句。'; }
    if (info.kind === 'cloze' && blankStudyWord(facts).answers.length === 0) { return '这句里没找到这个词或它的词形。换一句再挖空。'; }
    if (info.needs === 'audio' && !facts.audio) { return '还没有真实原声；先在下方采集原声。'; }
    if (info.needs === 'forms' && facts.forms.length === 0) { return '这个词没有列出词形。'; }
    if (info.needs === 'translation' && !(facts.sentence && facts.translation)) { return '需要原句和译文；先翻译本句。'; }
    return '';
}

/**
 * The kinds to pre-select for a mastery level, limited to the ones the facts allow.
 * @param {Mastery} mastery
 * @param {CardFacts} facts
 * @returns {string[]}
 */
export function recommendedKinds(mastery, facts) {
    return RECOMMENDED[mastery].filter((kind) => {
        const info = cardKind(kind);
        return info !== void 0 && !missingFor(info, facts);
    });
}

/**
 * @param {Pick<CardFacts, 'sentence'|'word'|'forms'>} facts
 * @param {string} [source]
 * @returns {{text: string, answers: string[]}}
 */
export function blankStudyWord({sentence, word, forms}, source = sentence) {
    const alternatives = [word, ...forms.map(({form}) => form)]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|');
    /** @type {string[]} */
    const answers = [];
    const text = alternatives ?
source.replace(new RegExp(`(?<!\\w)(?:${alternatives})(?!\\w)`, 'gi'), (match) => {
    answers.push(match);
    return '[…]';
}) :
source;
    return {text, answers};
}

/**
 * Draft front/back texts for one kind. Forms produce one card per form.
 * Contextual answers are left empty when the context meaning is not confirmed.
 * @param {string} kind
 * @param {CardFacts} facts
 * @returns {{front: string, back: string}[]}
 */
export function cardDrafts(kind, facts) {
    const {word, sentence, translation, meaning, contextMeaning} = facts;
    switch (kind) {
        case 'meaning': return [{front: word, back: meaning}];
        case 'listen-meaning': return [{front: `听原声：这里的「${word}」是什么意思？`, back: [contextMeaning || meaning, sentence].filter(Boolean).join('\n')}];
        case 'form-recognize': return facts.forms.slice(0, 3).map(({form, kind: name}) => ({front: `${form} 是哪个词的什么形式？`, back: `${word} 的${name}`}));
        case 'context': return [{front: `“${word}”在这句话中是什么意思？\n${sentence}`, back: contextMeaning}];
        case 'sentence': return [{front: `翻译这句话：\n${sentence}`, back: translation}];
        case 'listening': {
            const masked = blankStudyWord(facts);
            const front = masked.answers.length > 0 ? `听原声，补全这句话：\n${masked.text}` : '听原声，写下你听到的内容。';
            return [{front, back: [sentence || word, translation].filter(Boolean).join('\n')}];
        }
        case 'produce': return [{front: `用英文说出这句话（提示：${word}）：\n${translation}`, back: sentence}];
        case 'cloze': {
            const masked = blankStudyWord(facts);
            if (masked.answers.length === 0) { return []; }
            const hint = blankStudyWord(facts, contextMeaning || meaning).text;
            return [{front: `填空${hint ? `（${hint}）` : ''}：\n${masked.text}`, back: `${masked.answers.join('、')}\n${sentence}`}];
        }
        case 'form-produce': return facts.forms.slice(0, 3).map(({form, kind: name}) => ({front: `${word} 的${name}是？`, back: form}));
        case 'make-sentence': return [{front: `用「${word}」（${contextMeaning || meaning}）造一个句子。`, back: sentence ? `参考：${sentence}` : ''}];
        case 'expression': return [{front: `“${word}”的常见搭配或表达？`, back: ''}];
        case 'spelling': return [{front: '听原声，拼写这个词。', back: word}];
        default: return [{front: word, back: ''}];
    }
}

/**
 * Deck-routing key: new kinds fall back to the subdeck of their stage.
 * @param {string} kind
 * @returns {string}
 */
export function deckKindFor(kind) {
    return cardKind(kind)?.deck ?? kind;
}
