#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only Anki summaries scoped to the configured learning decks."""


def quoted_deck(name):
    return 'deck:"' + name.replace('\\', '\\\\').replace('"', '\\"').replace('*', '\\*') + '"'


def anki_today(library):
    settings = library.settings()
    if not settings.get('ankiEnabled', True):
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
        rows = {row.get('name'): row for row in stats.values() if isinstance(row, dict)}
        reviewed = library.anki('findCards', {'query': '(' + ' OR '.join(quoted_deck(d) for d in decks) + ') rated:1'})
        if not isinstance(reviewed, list) or any(type(c) is not int for c in reviewed):
            raise ValueError('Anki 今日已复习数量读取未完成。')
        return {'due': sum(rows.get(d, {}).get('learn_count', 0) + rows.get(d, {}).get('review_count', 0) for d in decks),
                'reviewed': len(set(reviewed)), 'newDue': sum(rows.get(d, {}).get('new_count', 0) for d in decks), 'decks': decks}
    except (OSError, TimeoutError):
        return {'paused': True}
