import json
import pathlib
import tempfile
import unittest

from study_settings import YomitanLibrary


class MasteryCardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        self.vault = root / 'vault'
        self.vault.mkdir()
        self.config = root / 'bridge-config.json'
        self.config.write_text(json.dumps({'vault': str(self.vault), 'codex': '/fake/codex'}))
        self.notes = {}
        self.calls = []
        self.library = YomitanLibrary(self.config, anki=self.anki)
        settings = self.library.handle({'action': 'librarySettingsGet'})
        self.library.handle({'action': 'librarySettingsSave', 'settings': {**settings, 'deck': '外语', 'model': '外语语境卡'}})

    def tearDown(self):
        self.temp.cleanup()

    def anki(self, action, params):
        self.calls.append((action, params))
        if action == 'deckNames': return ['外语']
        if action == 'modelNames': return ['外语语境卡']
        if action == 'modelFieldNames': return ['Word', 'Sentence', 'Definition', 'Source', 'URL', 'Audio', 'Image']
        if action == 'findNotes': return []
        if action == 'addNote':
            note_id = 1000 + len(self.notes)
            self.notes[note_id] = params['note']
            return note_id
        if action == 'notesInfo':
            return [{'noteId': n, 'fields': {k: {'value': v} for k, v in self.notes[n]['fields'].items()}, 'cards': [n * 10]} for n in params['notes']]
        if action == 'cardsInfo':
            return [{'cardId': c, 'deckName': '外语'} for c in params['cards']]
        if action == 'setDueDate': return [True]
        return []

    def save(self):
        entry = {'word': 'brick', 'sentence': 'I opened a brick and mortar shop.', 'meaning': '砖', 'url': 'https://example.com/a'}
        return self.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})

    def test_known_mastery_tags_cards_and_delays_only_recognition_cards(self):
        saved = self.save()
        record = saved['items'][0] if 'items' in saved else saved
        self.library.handle({'action': 'libraryCardsAdd', 'id': record['id'], 'mastery': 'known', 'cards': [
            {'front': 'brick', 'back': '砖', 'kind': 'meaning'},
            {'front': '用英文说出这句话：我开了一家实体店。', 'back': 'I opened a brick and mortar shop.', 'kind': 'produce'},
        ]})
        tags = [note['tags'] for note in self.notes.values()]
        self.assertTrue(all('study_mastery::known' in t for t in tags))
        self.assertIn('study_stage::1', tags[0])
        self.assertIn('study_stage::3', tags[1])
        due = [params for action, params in self.calls if action == 'setDueDate']
        self.assertEqual(due, [{'cards': [10000], 'days': '3-7'}])
        body = next(self.vault.rglob('*.md')).read_text()
        self.assertIn('认识但不会用', body)

    def test_unknown_mastery_is_rejected_and_none_keeps_schedule(self):
        saved = self.save()
        record = saved['items'][0] if 'items' in saved else saved
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryCardsAdd', 'id': record['id'], 'mastery': 'expert', 'cards': [{'front': 'brick', 'back': '砖'}]})
        self.library.handle({'action': 'libraryCardsAdd', 'id': record['id'], 'mastery': 'none', 'cards': [{'front': 'brick', 'back': '砖', 'kind': 'meaning'}]})
        self.assertFalse(any(action == 'setDueDate' for action, _ in self.calls))


if __name__ == '__main__':
    unittest.main()
