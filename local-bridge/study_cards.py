# SPDX-License-Identifier: GPL-3.0-or-later
"""Learning-card catalogue. The browser copy is prepared by dev/sync-local.py --manifest-only."""
from typing import NamedTuple, Optional


class Card(NamedTuple):
    label: str
    stage: int
    needs: Optional[str]
    deck: str  # settings key, not a name in the user's Anki collection


CARDS = {
    'meaning': Card('单词→中文义', 1, None, 'meaning'),
    'listen-meaning': Card('听原声→意思', 1, 'audio', 'listening'),
    'form-recognize': Card('词形识别', 1, 'forms', 'meaning'),
    'context': Card('原句中的意思', 2, 'sentence', 'context'),
    'sentence': Card('句子英→中', 2, 'sentence', 'sentence'),
    'listening': Card('视频声音字幕', 2, 'audio', 'listening'),
    'produce': Card('中→英（写原句）', 3, 'translation', 'produce'),
    'cloze': Card('挖空填词', 3, 'sentence', 'produce'),
    'form-produce': Card('词形变化', 3, 'forms', 'produce'),
    'make-sentence': Card('用词造句', 3, None, 'produce'),
    'expression': Card('搭配/表达', 3, None, 'expression'),
    'spelling': Card('听音拼写', 3, 'audio', 'produce'),
    'grammar': Card('语法', 2, None, 'grammar'),  # manual editor, not a suggested template
}
STAGE_NAMES = {1: '① 认得', 2: '② 理解', 3: '③ 会用'}
MASTERY_LABELS = {'none': '完全不会', 'vague': '有印象/模糊', 'known': '认识但不会用'}
AI_KINDS = ('meaning', 'context', 'expression', 'grammar', 'sentence', 'listening')
CARD_STAGES = {kind: c.stage for kind, c in CARDS.items()}
KIND_LABELS = {kind: c.label for kind, c in CARDS.items()}
AUDIO_KINDS = frozenset(kind for kind, c in CARDS.items() if c.needs == 'audio')


def card_progress(row):
    """Count last acknowledged cards, not drafts or an ID whose link just failed."""
    cards = row.get('cards', [])
    state = row.get('syncState')
    uncertain = state in ('missing', 'ambiguous')
    late = row.get('ankiState') == 'pending' or state == 'pending'
    linked = row.get('ankiState') in ('synced', 'linked')
    seen, waiting, stage = set(), 0, 0
    for c in cards:
        if uncertain and (not row.get('repairCardId') or c['id'] == row['repairCardId']):
            continue
        ident, receipt = c.get('noteId'), c.get('syncState') or c.get('state')
        if ident and (receipt == 'synced' or (not receipt and linked)):
            seen.add(ident)
            stage = max(stage, CARD_STAGES.get(c.get('kind'), 0))
        elif receipt == 'pending' or (not ident and late):
            waiting += 1
    if not cards and row.get('noteId') and linked and not late and not uncertain:
        seen.add(row['noteId'])
    return {'confirmed': len(seen), 'waiting': waiting, 'stage': stage}


def with_card_progress(row):
    # A response field, never persisted in note metadata or the disposable index.
    return {**row, 'cardProgress': card_progress(row)}
