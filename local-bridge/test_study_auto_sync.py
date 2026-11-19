import json
import pathlib
import tempfile
import unittest

from study_settings import YomitanLibrary


class AutoSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name).resolve()
        self.vault = root / 'vault'
        self.vault.mkdir()
        config = root / 'bridge-config.json'
        config.write_text(json.dumps({'vault': str(self.vault), 'codex': '/fake/codex'}))
        self.notes = {}
        self.calls = []
        self.edited = []
        (root / 'cache').mkdir(mode=0o700)
        self.library = YomitanLibrary(config, anki=self.anki, cache_dir=root / 'cache')
        settings = self.library.handle({'action': 'librarySettingsGet'})
        self.library.handle({'action': 'librarySettingsSave', 'settings': {**settings, 'deck': '外语', 'model': '外语语境卡'}})

    def tearDown(self):
        self.temp.cleanup()

    def anki(self, action, params):
        self.calls.append(action)
        if action == 'deckNames': return ['外语']
        if action == 'modelNames': return ['外语语境卡']
        if action == 'modelFieldNames': return ['Word', 'Sentence', 'Definition', 'Source', 'URL', 'Audio', 'Image']
        if action == 'findNotes':
            query = params['query']
            if 'edited:1' in query: return list(self.edited)
            if query == '(tag:study_* OR tag:studycard_*)': return list(self.notes)
            if not query.startswith('tag:') or ' ' in query: return []
            tag = query[4:]
            return [n for n, note in self.notes.items() if tag in note['tags']]
        if action == 'addNote':
            note_id = 1000 + len(self.notes)
            self.notes[note_id] = {**params['note'], 'mod': 1}
            return note_id
        if action == 'notesInfo':
            return [{'noteId': n, 'tags': self.notes[n]['tags'], 'mod': self.notes[n]['mod'], 'cards': [n * 10],
                     'fields': {k: {'value': v} for k, v in self.notes[n]['fields'].items()}} for n in params['notes']]
        if action == 'cardsInfo': return [{'cardId': c, 'note': c // 10, 'deckName': '外语', 'interval': 0, 'lapses': 0} for c in params['cards']]
        if action == 'updateNoteFields':
            self.notes[params['note']['id']]['fields'].update(params['note']['fields'])
            return None
        if action == 'findCards':
            query = params['query']
            return [int(n) * 10 for n in query[4:].split(',') if int(n) in self.notes] if query.startswith('nid:') else []
        return []

    def make_card(self):
        entry = {'word': 'brick', 'sentence': 'A brick wall.', 'meaning': '砖', 'url': 'https://example.com/a'}
        saved = self.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})
        record = saved['items'][0] if 'items' in saved else saved
        self.library.handle({'action': 'libraryCardsAdd', 'id': record['id'], 'cards': [{'front': 'brick', 'back': '砖', 'kind': 'meaning'}]})
        return record['id']

    def test_first_pass_is_a_baseline_and_later_anki_edits_flow_back(self):
        self.make_card()
        first = self.library.handle({'action': 'libraryAutoSync'})
        self.assertTrue(first['first'])
        self.assertEqual(first['synced'], 0)
        quiet = self.library.handle({'action': 'libraryAutoSync'})
        self.assertEqual(quiet['synced'], 0)
        note_id = next(iter(self.notes))
        definition = self.notes[note_id]['fields']['Definition'].replace('砖', '砖块（Anki 里改的）')
        self.notes[note_id]['fields']['Definition'] = definition
        self.notes[note_id]['mod'] = 2
        self.edited = [note_id]
        result = self.library.handle({'action': 'libraryAutoSync'})
        self.assertEqual(result['synced'], 1)
        body = next(self.vault.rglob('*brick*.md')).read_text()
        self.assertIn('砖块（Anki 里改的）', body)
        settle = self.library.handle({'action': 'libraryAutoSync'})
        self.assertEqual(settle['synced'], 0)
        # notesInfo can keep the same second, or omit mod entirely.
        api = self.library.anki
        missing_mod = False
        def notes_info(action, params):
            result = api(action, params)
            if missing_mod and action == 'notesInfo':
                for row in result: row.pop('mod', None)
            return result
        self.library.anki = notes_info
        for missing_mod, label in ((False, '同一秒再改'), (True, '没有修改时间')):
            note = self.notes[note_id]['fields']
            note['Definition'] = note['Definition'].replace('砖块', label + '砖块')
            result = self.library.handle({'action': 'libraryAutoSync'})
            self.assertEqual(result['synced'], 1)
            self.assertIn(label + '砖块', next(self.vault.rglob('*brick*.md')).read_text())
            self.assertEqual(self.library.handle({'action': 'libraryAutoSync'})['synced'], 0)

    def test_an_obsidian_edit_reaches_anki_on_the_next_pass(self):
        self.make_card()
        self.library.handle({'action': 'libraryAutoSync'})
        path = next(self.vault.rglob('*brick*.md'))
        text = path.read_text()
        start = text.index('##### 答案')
        edited = text[:start] + text[start:].replace('> 砖', '> 砖头（Obsidian 里改的）', 1)
        self.assertNotEqual(edited, text)
        path.write_text(edited)
        result = self.library.handle({'action': 'libraryAutoSync'})
        self.assertEqual(result['synced'], 1)
        self.assertIn('updateNoteFields', self.calls)
        self.assertIn('砖头（Obsidian 里改的）', next(iter(self.notes.values()))['fields']['Definition'])

    def test_note_edited_while_reading_anki_is_retried_without_sending_the_old_answer(self):
        ident = self.make_card()
        note_id = next(iter(self.notes))
        self.library.auto_sync()
        path = next(self.vault.rglob('*brick*.md'))
        original = path.read_text()
        start = original.index('##### 答案')
        first_edit = original[:start] + original[start:].replace('> 砖', '> 临时的答案', 1)
        path.write_text(first_edit)
        changed = False

        def edit_during_anki_read(action, params):
            nonlocal changed
            result = self.anki(action, params)
            if action == 'notesInfo' and not changed:
                changed = True
                path.write_text(first_edit.replace('> 临时的答案', '> 真正要保存的答案', 1))
            return result

        self.library.anki = edit_during_anki_read
        self.calls.clear()
        attempt = self.library.auto_sync()
        self.assertTrue(changed)
        self.assertNotIn('updateNoteFields', self.calls)
        self.assertEqual(attempt['synced'], 0)
        self.assertIn(ident, self.library.sync_state()['retryRecords'])
        self.assertIn('真正要保存的答案', path.read_text())
        self.assertNotIn('临时的答案', self.notes[note_id]['fields']['Definition'])
        self.library.anki = self.anki

        retry = self.library.auto_sync()
        self.assertEqual((retry['synced'], retry['conflicts']), (1, 0))
        self.assertIn('真正要保存的答案', self.notes[note_id]['fields']['Definition'])
        self.assertNotIn(ident, self.library.sync_state()['retryRecords'])

    def test_switching_profiles_during_anki_read_does_not_write_to_the_other_copy(self):
        import copy
        ident = self.make_card()
        note_id = next(iter(self.notes))
        study_notes = self.notes
        accounts = {'Study': study_notes, 'Other': copy.deepcopy(study_notes)}
        active = 'Study'
        switch_on_read = False

        def anki(action, params):
            nonlocal active, switch_on_read
            if action == 'getActiveProfile': return active
            if action == 'notesInfo' and switch_on_read:
                active = 'Other'
                switch_on_read = False
            self.notes = accounts[active]
            return self.anki(action, params)

        self.library.anki = anki
        self.library.auto_sync()
        self.assertEqual(self.library.sync_state()['ankiProfile'], 'Study')
        path = next(self.vault.rglob('*brick*.md'))
        text = path.read_text()
        start = text.index('##### 答案')
        edited = text[:start] + text[start:].replace('> 砖', '> 改好的答案', 1)
        path.write_text(edited)
        original_answer = accounts['Other'][note_id]['fields']['Definition']
        self.calls.clear()
        switch_on_read = True
        attempt = self.library.auto_sync()
        self.assertEqual(active, 'Other')
        self.assertNotIn('updateNoteFields', self.calls)
        self.assertIn('另一个账户', attempt['paused'])
        self.assertIn(ident, self.library.sync_state()['retryRecords'])
        self.assertEqual(path.read_text(), edited)
        self.assertEqual(accounts['Other'][note_id]['fields']['Definition'], original_answer)

        active = 'Study'
        self.assertEqual(self.library.auto_sync()['synced'], 1)
        self.assertIn('改好的答案', study_notes[note_id]['fields']['Definition'])
        self.assertEqual(accounts['Other'][note_id]['fields']['Definition'], original_answer)

    def test_offline_edit_retries_until_the_original_card_is_updated(self):
        from unittest.mock import patch
        ident = self.make_card()
        note_id = next(iter(self.notes))
        self.library.auto_sync()
        path = next(self.vault.rglob('*brick*.md'))
        original = path.read_text()
        start = original.index('##### 答案')
        path.write_text(original[:start] + original[start:].replace('> 砖', '> 离线改好的答案', 1))
        def disconnected(action, params): raise ConnectionError('offline')
        self.library.anki = disconnected
        self.assertTrue(self.library.auto_sync()['paused'])
        self.library.anki = self.anki
        with patch('study_sync.reconcile', side_effect=ValueError('请稍后再试')) as retry:
            self.assertEqual(self.library.auto_sync()['errors'], ['请稍后再试'])
            self.assertEqual(retry.call_args.args[1]['id'], ident)
        self.calls.clear()
        self.assertEqual(self.library.auto_sync()['synced'], 1)
        self.assertIn('离线改好的答案', self.notes[note_id]['fields']['Definition'])
        self.assertEqual(self.library.auto_sync()['synced'], 0)
        self.assertEqual(set(self.notes), {note_id})
        self.assertNotIn('addNote', self.calls)

    def test_word_status_marks_words_with_use_cards_as_known(self):
        self.make_card()
        entry = {'word': 'Mortar', 'sentence': 'Brick and mortar.', 'meaning': '灰浆', 'url': 'https://example.com/b'}
        saved = self.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})
        record = saved['items'][0] if 'items' in saved else saved
        self.library.handle({'action': 'libraryCardsAdd', 'id': record['id'], 'cards': [{'front': '用英文说', 'back': 'mortar', 'kind': 'produce'}]})
        words = self.library.handle({'action': 'libraryWordStatus'})['words']
        self.assertEqual({k: v['s'] for k, v in words.items()}, {'brick': 'learning', 'mortar': 'learning'})

    def test_2000_cards_read_content_only_for_edited_and_unlinked_candidates(self):
        from unittest.mock import patch
        now = 1000
        linked = set(range(1000, 3000))
        deleted, candidate = 2999, 9000
        live = (linked - {deleted}) | {candidate}
        edited = {1000, 1001, candidate}
        lib = self.library.library_for(self.library.active_id)
        records = {f'{n:032x}': (lib, self.vault / f'{n}.md',
                   {'id': f'{n:032x}', 'noteId': n, 'entry': {'word': f'word{n}'}}) for n in linked}
        files = {str(path): 1 for _, path, _ in records.values()}
        self.library.indexed = lambda: (files, records)
        state_path = pathlib.Path(self.library.cache_dir) / 'auto-sync-state.json'
        state_path.write_text(json.dumps({'files': files, 'notes': {str(n): 1 for n in linked}, 'upgradeAt': now}))
        calls = []
        def anki(action, params):
            calls.append((action, params))
            if action == 'findNotes': return sorted(edited if 'edited:1' in params['query'] else live)
            if action == 'notesInfo':
                return [{'noteId': n, 'mod': 2, 'cards': [n * 10],
                         'tags': ['study_' + f'{n:032x}'],
                         'fields': {'Word': {'value': f'word{n}'}, 'Sentence': {'value': f'A word{n}.'}}} for n in params['notes']]
            if action == 'findCards':
                query = params['query']
                return [int(n) * 10 for n in query[4:].split(',') if int(n) in live] if query.startswith('nid:') else []
            if action == 'cardsInfo': return [{'cardId': c, 'note': c // 10, 'interval': 30, 'lapses': 0} for c in params['cards']]
            self.fail(action)
        self.library.anki = anki
        with patch('study_sync.reconcile', return_value={'conflicts': []}) as reconcile:
            result = self.library.auto_sync(now)
        self.assertFalse(result['paused'])
        self.assertEqual([p['query'] for a, p in calls if a == 'findNotes'].count('(tag:study_* OR tag:studycard_*)'), 1)
        self.assertTrue(any(a == 'findNotes' and 'edited:1' in p['query'] for a, p in calls))
        self.assertEqual([p['notes'] for a, p in calls if a == 'notesInfo'], [sorted(edited)])
        self.assertEqual({int(c.args[1]['id'], 16) for c in reconcile.call_args_list}, {1000, 1001, deleted})
        state = json.loads(state_path.read_text())
        self.assertEqual([r['noteId'] for r in state['orphans']], [candidate])
        self.assertEqual(state['mastery']['notes']['1000'][0]['iv'], 30)

    def test_upgrade_uses_the_linked_card_interval_not_another_notes_copied_tag(self):
        lib = self.library.library_for(self.library.active_id)
        records = {}
        for n, word in enumerate(('brick', 'mortar', 'wall', 'gate'), 1):
            ident = f'{n:032x}'
            row = {'entry': {'word': word}, 'ankiState': 'synced', 'noteId': n}
            if n < 3:
                row['cards'] = [{'id': ident, 'noteId': n, 'kind': 'meaning', 'state': 'synced'}]
            records[ident] = (lib, self.vault / f'{word}.md', row)
        self.library.indexed = lambda: ({str(p): 1 for _, p, _ in records.values()}, records)
        bodies = []
        def anki(action, p):
            if action == 'findNotes':
                if 'edited:1' in p['query']: return []
                if p['query'].startswith('nid:'): return [3]  # Only wall's legacy note has a stage tag.
                return [1, 2, 3, 4]
            if action == 'findCards':
                if 'rated:' in p['query']: return []
                if 'prop:ivl' in p['query']: return [12, 13]
                return [11, 12, 13, 14]
            if action == 'cardsToNotes': return [cid - 10 for cid in p['cards']]
            if action == 'cardsInfo':
                return [{'cardId': c, 'note': c - 10, 'interval': 2 if c == 11 else 21, 'lapses': 0} for c in p['cards']]
            if action == 'notesInfo':
                bodies.extend(p['notes'])
                return [{'noteId': n, 'tags': ['studycard_' + f'{i:032x}' for i in (1, 2)] if n == 2 else ['study_stage::2']}
                        for n in p['notes']]
            self.fail(action)
        self.library.anki = anki
        self.assertEqual(self.library.auto_sync(1000)['upgrade'], [
            {'id': f'{2:032x}', 'word': 'mortar'}, {'id': f'{3:032x}', 'word': 'wall'}])
        self.assertEqual(bodies, [])

    def test_personal_link_without_study_tags_stays_quiet_and_keeps_its_html(self):
        import copy
        import re
        ident = self.make_card()
        self.notes[2000] = copy.deepcopy(self.notes[1000])
        self.library.handle({'action': 'libraryReconcile', 'id': ident})
        self.library.handle({'action': 'libraryRepair', 'id': ident, 'choice': 'select', 'noteId': 1000})
        self.notes[1000]['tags'] = ['personal']
        fields = self.notes[1000]['fields']
        fields.update(Word='<b>brick</b>', Definition='<i>砖</i>', Sentence='My example.')
        reads = []
        def lookup(action, p):
            if action == 'findNotes':
                q = p['query']
                nid = re.search(r'nid:([\d,]+)', q)
                chosen = {int(n) for n in nid[1].split(',')} if nid else set()
                if 'edited:1' in q:
                    return [n for n in self.edited if n in chosen or 'english_study' in self.notes[n]['tags']]
                if nid: return list(chosen & self.notes.keys())
                if q == '(tag:study_* OR tag:studycard_*)': return [2000]
            if action == 'notesInfo':
                reads.extend(p['notes'])
                p = {'notes': [n for n in p['notes'] if n in self.notes]}
            return self.anki(action, p)
        self.library.anki = lookup
        self.library.auto_sync()
        self.calls.clear()
        reads.clear()
        self.assertEqual(self.library.auto_sync()['synced'], 0)
        self.assertNotIn(1000, reads)  # The other tagged copy is still an unlinked candidate.
        self.assertEqual(fields['Definition'], '<i>砖</i>')
        self.edited = [1000]
        fields['Definition'] = '<i>砖块</i>'
        self.assertEqual(self.library.auto_sync()['synced'], 1)
        self.assertEqual(self.library.locate(ident).result(ident)['cards'][0]['back'], '砖块')
        self.assertEqual((fields['Word'], fields['Definition'], fields['Sentence']), ('<b>brick</b>', '<i>砖块</i>', 'My example.'))
        self.assertNotIn('updateNoteFields', self.calls)
        self.edited = []
        del self.notes[1000]
        self.library.auto_sync()
        self.assertEqual(self.library.locate(ident).result(ident)['syncState'], 'missing')

    def test_restored_card_clears_missing_without_an_edit_timestamp_change(self):
        import copy
        ident = self.make_card()
        note_id = next(iter(self.notes))
        saved_note = copy.deepcopy(self.notes[note_id])
        anki = self.library.anki
        def readable_notes(action, params):
            if action == 'notesInfo':
                params = {'notes': [n for n in params['notes'] if n in self.notes]}
            return anki(action, params)
        self.library.anki = readable_notes
        self.library.handle({'action': 'libraryAutoSync'})
        del self.notes[note_id]
        self.library.handle({'action': 'libraryAutoSync'})
        self.assertEqual(self.library.handle({'action': 'libraryRead', 'ids': [ident]})['items'][0]['record']['syncState'], 'missing')

        self.notes[note_id] = saved_note  # Same ID and mod, absent from edited:1.
        self.calls.clear()
        restored = self.library.handle({'action': 'libraryAutoSync'})
        self.assertEqual(restored['synced'], 1)
        record = self.library.handle({'action': 'libraryRead', 'ids': [ident]})['items'][0]['record']
        self.assertEqual(record['syncState'], 'synced')
        self.assertEqual([c['noteId'] for c in record['cards']], [note_id])
        self.assertEqual(self.library.handle({'action': 'libraryAutoSync'})['synced'], 0)
        self.assertFalse(any(a in self.calls for a in ('addNote', 'updateNoteFields', 'deleteNotes', 'setDueDate', 'changeDeck')))

    def test_rejects_extra_fields(self):
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryAutoSync', 'all': True})


if __name__ == '__main__':
    unittest.main()
