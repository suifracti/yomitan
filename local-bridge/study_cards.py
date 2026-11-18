# SPDX-License-Identifier: GPL-3.0-or-later
"""Learning-card catalogue. The browser copy is prepared by dev/sync-local.py --manifest-only."""
import hashlib
from typing import NamedTuple, Optional

REVIEW_FIELDS = ['Word', 'Sentence', 'Definition', 'Source', 'URL', 'Audio', 'Image']


def read_review_view(anki, model):
    params = {'modelName': model}
    return {'templates': anki('modelTemplates', params), 'styling': anki('modelStyling', params)}


def review_view_state(view):
    """Compare only the named model's layouts and CSS, not a learner's cards."""
    from study_review_view import FRONT, BACK, CSS
    templates, styling = view['templates'], view['styling']
    if not isinstance(templates, dict) or not templates:
        return 'unknown'
    if len(templates) > 1:
        return 'multiple'
    sides = next(iter(templates.values()))
    if not isinstance(sides, dict) or not {'Front', 'Back'} <= sides.keys() or not isinstance(styling, dict) or 'css' not in styling:
        return 'unknown'
    if (sides['Front'], sides['Back']) != (FRONT, BACK):
        return 'different'
    return 'current' if styling['css'] == CSS else 'custom-style'


def card_key(record_id, front):
    return hashlib.sha256((record_id + '\n' + front.strip()).encode()).hexdigest()[:32]


def linked_note_ids(records):
    return {n for r in records for n in [r.get('noteId'), *(c.get('noteId') for c in r.get('cards', []))] if n}


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


def card_receipts(row):
    """Yield (confirmed Anki note ID or None if waiting, stage); skip broken links."""
    cards = row.get('cards', [])
    state = row.get('syncState')
    uncertain = state in ('missing', 'ambiguous')
    late = row.get('ankiState') == 'pending' or state == 'pending'
    linked = row.get('ankiState') in ('synced', 'linked')
    for c in cards:
        if uncertain and (not row.get('repairCardId') or c['id'] == row['repairCardId']):
            continue
        ident, receipt = c.get('noteId'), c.get('syncState') or c.get('state')
        if ident and (receipt == 'synced' or (not receipt and linked)):
            yield ident, CARD_STAGES.get(c.get('kind'), 0)
        elif receipt == 'pending' or (not ident and late):
            yield None, CARD_STAGES.get(c.get('kind'), 0)
    if not cards and row.get('noteId') and linked and not late and not uncertain:
        yield row['noteId'], 0


def card_progress(row):
    seen, waiting, stage = set(), 0, 0
    for ident, level in card_receipts(row):
        if ident is None:
            waiting += 1
        else:
            seen.add(ident)
            stage = max(stage, level)
    return {'confirmed': len(seen), 'waiting': waiting, 'stage': stage}


def with_card_progress(row):
    # A response field, never persisted in note metadata or the disposable index.
    return {**row, 'cardProgress': card_progress(row)}
