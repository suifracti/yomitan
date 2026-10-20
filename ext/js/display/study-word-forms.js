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

/**
 * @typedef {object} WordFormSense
 * @property {string} pos Part-of-speech label as shown in the card, e.g. "n. 名词".
 * @property {string} text Chinese meaning for that part of speech.
 */

/**
 * @typedef {object} WordFormExplanation
 * @property {string} kind Readable name of the form, e.g. "复数".
 * @property {string[]} usage One line per grammatical role this form plays.
 * @property {?WordFormSense} sense The dictionary sense this form belongs to, when the card lists one.
 * @property {string} missing Shown instead of a sense when the card has no matching part of speech.
 */

/** @type {[RegExp, string, RegExp, string][]} */
const FORM_RULES = [
    [/复数|\bpl\./i, '复数', /^n\b|名词/i, '名词复数：表示两个或更多。'],
    [/过去式|过去(?!分词)|\bpast\b/i, '过去式', /^v[ti]?\b|动词/i, '过去式：表示过去发生的动作或状态。'],
    [/过去分词|\bp\.\s*p\./i, '过去分词', /^v[ti]?\b|动词/i, '过去分词：用于完成时（have / has + 这个词）和被动语态（be + 这个词），也可当形容词用。'],
    [/现在分词|进行|\bV-ing\b/i, '现在分词', /^v[ti]?\b|动词/i, '现在分词：用于进行时（be + 这个词），也可当动名词（像名词一样用）或形容词。'],
    [/第三人称|三单|\b3sg\./i, '第三人称单数', /^v[ti]?\b|动词/i, '第三人称单数现在时：主语是 he / she / it 或单数名词时用。'],
    [/比较级|\bcomp\./i, '比较级', /^(a|adj|adv)\b|形容词|副词/i, '比较级：比较两者，意思是「更……」。'],
    [/最高级|\bsuperl\./i, '最高级', /^(a|adj|adv)\b|形容词|副词/i, '最高级：在三者或更多之中「最……」。'],
];

/**
 * Explains one inflected form from the card's own data; nothing is generated or fetched.
 * A combined label such as "过去式 / 过去分词" yields one usage line per role.
 * @param {string} label Form label from the dictionary, e.g. "复数" or "过去式 / 过去分词".
 * @param {string} word The looked-up headword.
 * @param {WordFormSense[]} senses Chinese senses currently shown on the card.
 * @returns {WordFormExplanation}
 */
export function explainWordForm(label, word, senses) {
    const matches = FORM_RULES.filter(([pattern]) => pattern.test(label));
    if (matches.length === 0) {
        return {kind: label.trim() || '词形', usage: [`${word} 的一种词形。`], sense: null, missing: ''};
    }
    const posPattern = matches[0][2];
    const sense = senses.find((item) => posPattern.test(item.pos.trim())) ?? null;
    const partName = posPattern.source.includes('名词') ? '名词' : (posPattern.source.includes('动词') ? '动词' : '形容词或副词');
    return {
        kind: matches.map(([, kind]) => kind).join(' / '),
        usage: matches.map((rule) => rule[3]),
        sense,
        missing: sense ? '' : `词卡里没有列出 ${word} 的${partName}义，可在完整词典里确认。`,
    };
}

/**
 * Finds a short dictionary example that uses the exact form, if the dictionary has one.
 * @param {Iterable<string>} texts Candidate texts, in reading order.
 * @param {string} form The inflected form, e.g. "bricks".
 * @returns {string}
 */
export function findFormExample(texts, form) {
    const escaped = form.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'iu');
    for (const raw of texts) {
        const text = raw.replaceAll(/\s+/g, ' ').trim();
        if (text.length < 8 || text.length > 220) { continue; }
        // Grammar lines list the forms themselves; they are not usage examples.
        if (/plural|participle|third-person|comparative|superlative|simple past|过去式|复数|分词/i.test(text)) { continue; }
        if (pattern.test(text)) { return text; }
    }
    return '';
}
