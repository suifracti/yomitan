#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Readable grouped notes; legacy identities and guarded writes are unchanged.

New saves put machine metadata AFTER each context, not before the learning text.
Old v1 contexts are read in place. There is no background migration or new database.
"""
import copy
import hashlib
import json
import re


def context_block(self, record, body):
    ident = record['id']
    if not re.fullmatch(r'[a-f0-9]{32}', ident):
        raise ValueError('学习记录编号无效。')
    # Data is still lossless and lives with the note. This is not encryption.
    # Source mode can still show the footer; reading mode hides HTML comments.
    return (f'<!-- english-study-context-start:{ident} -->\n' + body +
            '\n<!-- english-study-context-meta-v2:' + self.metadata(record) +
            f' -->\n<!-- english-study-context-end:{ident} -->\n')

def word_contexts(self, content):
    document = re.search(r'^<!-- english-study-word-v1:(.+) -->$', content, re.M)
    if not document:
        raise ValueError('已有同名文件不是单词文档，不会覆盖。')
    metadata = json.loads(document[1])
    if metadata.get('language') != self.language or not isinstance(metadata.get('word'), str):
        raise ValueError('单词文档的语言或词面无效。')
    old_pattern = r'^<!-- english-study-context-v1:([^\n]+) -->\n(.*?)\n<!-- english-study-context-end:([a-f0-9]{32}) -->\n'
    new_pattern = r'^<!-- english-study-context-start:([a-f0-9]{32}) -->\n(.*?)\n<!-- english-study-context-meta-v2:([^\n]+) -->\n<!-- english-study-context-end:([a-f0-9]{32}) -->\n'
    matches = []
    for match in re.finditer(old_pattern, content, re.M | re.S):
        matches.append((match.start(), match.end(), match[1], match[2], match[3], match[3], match[0]))
    for match in re.finditer(new_pattern, content, re.M | re.S):
        matches.append((match.start(), match.end(), match[3], match[2], match[1], match[4], match[0]))
    contexts = {}
    previous_end = -1
    for start, end, raw, body, opening, closing, block in sorted(matches):
        try:
            record = json.loads(raw)
            ident = record['id']
            if (start < previous_end or not re.fullmatch(r'[a-f0-9]{32}', ident) or
                    ident != opening or ident != closing or ident in contexts or
                    record['entry']['word'].casefold() != metadata['word'].casefold() or
                    record['entry'].get('language', 'en') != self.language or
                    raw != self.metadata(record)):
                raise ValueError('语境元数据不一致，停止自动覆盖。')
        except (KeyError, TypeError, json.JSONDecodeError) as error:
            raise ValueError('语境元数据不完整，原文件未改动。') from error
        contexts[ident] = (record, body, hashlib.sha256(block.encode()).hexdigest(), (start, end))
        previous_end = end
    expected = content.count('<!-- english-study-context-v1:') + content.count('<!-- english-study-context-start:')
    if (not contexts or len(contexts) != expected or
            content.count('<!-- english-study-context-end:') != len(contexts) or
            content.count('<!-- english-study-context-meta-v2:') != content.count('<!-- english-study-context-start:')):
        raise ValueError('单词文档语境分节不完整，停止自动覆盖。')
    return contexts

def draft_block(self, draft, record=None):
    # Only grouped English notes use the compact view. IINA/Japanese/legacy
    # callers keep their contract. Exact legacy rendering remains available.
    if not self.group_words or not record:
        return self._legacy_draft_block(draft, record)
    from study_library import paragraph
    confirmed = record.get('cards', [])
    rows = []
    unconfirmed = []
    for item in draft['cards']:
        card = next((card for card in confirmed if card['front'].strip() == item['front'].strip()
                     and card['back'].strip() == item['back'].strip()), None)
        if card:
            synced = card.get('state') == 'synced' and type(card.get('noteId')) is int
            rows.append('已关联 Anki' if synced and card.get('linkedExisting') else 'Anki 已同步' if synced else '卡片内容已确定 · 等待 Anki 确认')
        else:
            unconfirmed.append(item)
    if not draft['cards']:
        status = '本次无需新增复习卡（正常零卡）'
    elif rows and not unconfirmed:
        status = '；'.join(dict.fromkeys(rows))
    else:
        status = '复习建议待确认'
    block = ('\n<!-- study-review-draft:start -->\n<details>\n<summary>复习判断 · ' + status +
             '</summary>\n\n' + paragraph(draft['reason']) + '\n')
    # Confirmed Q/A already exists in the reading body; do not print it again.
    for item in unconfirmed:
        block += '\n' + ('已选择的建议' if item['selected'] else '未选择的建议') + '\n\n'
        block += paragraph(item['front']) + '\n\n' + paragraph(item['back']) + '\n'
    return block + '\n</details>\n<!-- study-review-draft:end -->\n'

def without_draft(self, record, body):
    draft = record.get('reviewDraft')
    if not draft:
        if '<!-- study-review-draft:' in body:
            raise ValueError('草稿区域与元数据不一致，停止覆盖。')
        return body
    # Accept only renderings made by a known version, including the adjacent
    # pending/synced transition. NEVER discard arbitrary edited auto-blocks.
    variants = [self.draft_block(draft, record), self._legacy_draft_block(draft, record), self._legacy_draft_block(draft)]
    uncommitted = copy.deepcopy(record)
    uncommitted['cards'] = [card for card in uncommitted.get('cards', []) if not any(card['front'].strip() == item['front'].strip() and card['back'].strip() == item['back'].strip() for item in draft['cards'])]
    variants.extend([self.draft_block(draft, uncommitted), self._legacy_draft_block(draft, uncommitted)])
    for state in ('pending', 'synced'):
        previous = copy.deepcopy(record)
        for card in previous.get('cards', []):
            card['state'] = state
        variants.extend([self.draft_block(draft, previous), self._legacy_draft_block(draft, previous)])
    for candidate in dict.fromkeys(variants):
        if body.count(candidate) == 1 and body.count('<!-- study-review-draft:start -->') == 1:
            return body.replace(candidate, '', 1)
    raise ValueError('复习自动区有人工修改或未知版本；请核对，未覆盖正文。')
