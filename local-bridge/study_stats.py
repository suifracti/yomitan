#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only Anki summaries scoped to the configured learning decks."""

from study_sync import sync_profile


def quoted_deck(name):
    return 'deck:"' + name.replace('\\', '\\\\').replace('"', '\\"').replace('*', '\\*') + '"'


def anki_today(library, expected_profile=None):
    settings = library.settings()
    if not settings.get('ankiEnabled', True):
        return {'paused': True}
    if expected_profile and sync_profile(library.anki, expected_profile)[1]:
        return {'paused': True}
    wanted = set(filter(None, [settings['deck'], *settings.get('deckByKind', {}).values()]))
    try:
        available = library.anki('deckNames', {})
        if not isinstance(available, list) or any(not isinstance(d, str) for d in available):
            raise ValueError('Anki 牌组列表读取未完成。')
        selected = sorted(wanted & set(available))
        decks = [d for d in selected if not any(d.startswith(parent + '::') for parent in selected if parent != d)]
        if not decks:
            return {'due': 0, 'reviewed': 0, 'newDue': 0, 'decks': []}
        stats = library.anki('getDeckStats', {'decks': decks})
        if not isinstance(stats, dict):
            raise ValueError('Anki 今日统计读取未完成。')
        # Anki returns only the requested deck IDs; a child's display name may omit its parent.
        rows = [row for row in stats.values() if isinstance(row, dict)]
        reviewed = library.anki('findCards', {'query': '(' + ' OR '.join(quoted_deck(d) for d in decks) + ') rated:1'})
        if not isinstance(reviewed, list) or any(type(c) is not int for c in reviewed):
            raise ValueError('Anki 今日已复习数量读取未完成。')
        return {'due': sum(row.get('learn_count', 0) + row.get('review_count', 0) for row in rows),
                'reviewed': len(set(reviewed)), 'newDue': sum(row.get('new_count', 0) for row in rows), 'decks': decks}
    except (OSError, TimeoutError):
        return {'paused': True}
