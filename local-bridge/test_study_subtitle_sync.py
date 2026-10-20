import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'test-localization'))
import test_study_library as fixture
ENTRY = fixture.ENTRY


def cue_entry():
    entry = dict(ENTRY)
    sentence = entry['sentence']
    start = sentence.index(entry['word'])
    entry['subtitleSource'] = {'version': 1, 'url': entry['url'], 'language': 'en', 'trackIndex': 0,
        'trackName': 'English', 'text': sentence, 'word': entry['word'], 'originalStartMs': 1000,
        'originalEndMs': 2000, 'subtitleOffsetMs': 0, 'selectionStart': start, 'selectionEnd': start + len(entry['word']),
        'provenance': {'queryId': 'q-source', 'sourceRevision': 'revision', 'cueIndex': 0,
                       'tabId': 1, 'frameId': 0, 'documentId': 'doc'}}
    return entry


class SubtitleSyncTests(unittest.TestCase):
    setUp = fixture.LibraryTests.setUp

    def test_subtitle_cards_update_reconcile_and_favorite_share_the_normal_path(self):
        entry = cue_entry()
        saved = self.lib.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})
        ident = saved['id']
        self.assertEqual(self.cards, {})
        cards = [{'front': 'What does just mean here?', 'back': '公正的', 'kind': 'context'},
                 {'front': 'just → 中文', 'back': '公正的', 'kind': 'meaning'}]
        result = self.lib.handle({'action': 'libraryCardsAdd', 'id': ident, 'cards': cards})
        self.assertEqual(len(result['cards']), 2)
        self.assertEqual(len(self.cards), 2)
        nid = result['cards'][0]['noteId']
        old = self.cards[nid]['fields']['Definition']
        self.cards[nid]['fields']['Definition'] = old.replace('公正的', '公正、公平的')
        updated = self.lib.handle({'action': 'libraryReconcile', 'id': ident})
        self.assertFalse(updated.get('conflicts'))
        self.assertIn('公平', updated['cards'][0]['back'])
        self.lib.handle({'action': 'libraryUpdate', 'id': ident, 'entry': {'translation': '这是公平的决定。'}})
        after = self.lib.handle({'action': 'libraryReconcile', 'id': ident})
        self.assertEqual(after['entry']['translation'], '这是公平的决定。')
        self.assertEqual(after['entry']['subtitleSource'], entry['subtitleSource'])
        self.assertTrue(self.lib.handle({'action': 'libraryFavorite', 'id': ident, 'favorite': True})['favorite'])
        self.assertFalse(self.lib.handle({'action': 'libraryFavorite', 'id': ident, 'favorite': False})['favorite'])
        self.assertEqual(len(self.cards), 2)

    def test_supplied_authorization_must_still_match_the_record(self):
        saved = self.lib.handle({'action': 'librarySave', 'entry': cue_entry(), 'makeCard': False})
        with self.assertRaises(ValueError):
            self.lib.handle({'action': 'librarySync', 'ids': [saved['id']],
                             'cueAuthorization': {'id': 'f' * 32, 'source': cue_entry()['subtitleSource']}})


if __name__ == '__main__':
    unittest.main()


class SubtitleAutoSyncTests(unittest.TestCase):
    from test_study_auto_sync import AutoSyncTests as _Fixture
    setUp = _Fixture.setUp
    tearDown = _Fixture.tearDown
    anki = _Fixture.anki

    def test_automatic_sync_does_not_skip_saved_subtitle_cards(self):
        saved = self.library.handle({'action': 'librarySave', 'entry': cue_entry(), 'makeCard': False})
        made = self.library.handle({'action': 'libraryCardsAdd', 'id': saved['id'],
            'cards': [{'front': 'just → 中文', 'back': '公正的', 'kind': 'context'}]})
        self.library.auto_sync()
        nid = made['cards'][0]['noteId']
        self.notes[nid]['fields']['Definition'] = self.notes[nid]['fields']['Definition'].replace('公正的', '公平的')
        self.notes[nid]['mod'] = 2
        self.edited = [nid]
        result = self.library.auto_sync()
        self.assertEqual(result['synced'], 1)
        self.assertIn('公平', self.library.locate(saved['id']).result(saved['id'])['cards'][0]['back'])
