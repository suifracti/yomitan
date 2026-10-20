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
        if action == 'cardsInfo': return [{'cardId': c, 'deckName': '外语', 'interval': 0} for c in params['cards']]
        if action == 'updateNoteFields':
            self.notes[params['note']['id']]['fields'].update(params['note']['fields'])
            return None
        if action in ('findCards',): return []
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

    def test_rejects_extra_fields(self):
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryAutoSync', 'all': True})


if __name__ == '__main__':
    unittest.main()
