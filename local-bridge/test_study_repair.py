import base64
import copy
import re
import unittest
import test_study_auto_sync as fixture


class RepairTests(unittest.TestCase):
    def test_orphan_restores_to_its_folder_without_overwriting_a_later_edit_on_retry(self):
        h = fixture.AutoSyncTests(); h.setUp()
        self.addCleanup(h.tearDown)
        settings = h.library.settings()
        first = h.library.handle({'action': 'librarySettingsSave', 'settings': {**settings, 'directory': '课程 A'}})
        entry = {'word': 'brick', 'sentence': 'A brick wall.', 'meaning': '砖', 'url': 'https://example.com/a'}
        saved = h.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False, 'targetId': first['targetId']})
        h.library.handle({'action': 'libraryCardsAdd', 'id': saved['id'], 'cards': [{'kind': 'meaning', 'front': 'brick', 'back': '砖'}]})
        path = h.library.locate(saved['id']).path(saved['id'])
        path.unlink()
        h.library.handle({'action': 'librarySettingsSave', 'settings': {**settings, 'directory': '课程 B'}})
        # Existing cards only have the note link, not a saved target ID.
        fields = h.notes[1000]['fields']
        fields['Source'] = re.sub(r' data-study-target="[^"]*"', '', fields['Source'])
        h.library.handle({'action': 'libraryAutoSync'})
        restore = {'action': 'libraryOrphan', 'noteId': 1000, 'choice': 'restore'}
        h.library.handle(restore)
        self.assertTrue(path.is_file(), 'The note belongs in course A even though B is now selected.')
        self.assertEqual(h.library.locate(saved['id']).target_id, first['targetId'])
        h.library.handle({'action': 'librarySave', 'entry': {**entry, 'meaning': '我后来记的：一块砖'}, 'makeCard': False})
        edited = path.read_bytes()
        h.calls.clear()
        h.library.handle(restore)
        self.assertEqual(path.read_bytes(), edited)
        self.assertFalse((h.vault / '课程 B').exists())
        self.assertFalse(set(h.calls) & {'addNote', 'updateNoteFields', 'deleteNotes', 'changeDeck', 'setDueDate'})

    def test_restore_two_listening_cards_to_their_original_video_occurrences(self):
        h = fixture.AutoSyncTests(); h.setUp()
        self.addCleanup(h.tearDown)
        original = h.library.anki
        h.library.anki = lambda a, p: p['filename'] if a == 'storeMediaFile' else original(a, p)
        card = {'kind': 'spelling', 'front': '听原声，拼写这个词。', 'back': 'Just — 公正的'}
        originals = {}
        for sec in (12, 27):
            entry = {'word': 'Just', 'sentence': 'It is a just decision.', 'meaning': '公正的',
                     'url': 'https://example.com/lesson?t=83', 'title': 'Lesson', 'videoTime': sec}
            saved = h.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})
            h.library.handle({'action': 'libraryMedia', 'id': saved['id'], 'version': saved['version'],
                              'start': sec, 'end': sec + 1, 'origin': 'import', 'assets': [{
                                  'kind': 'audio', 'mime': 'audio/ogg', 'data': base64.b64encode(b'OggS' + bytes([sec]) * 8).decode()}]})
            result = h.library.handle({'action': 'libraryCardsAdd', 'id': saved['id'], 'cards': [card.copy()]})
            self.assertEqual(result['ankiState'], 'synced')
            originals[sec] = saved['id'], result['cards'][0]['id'], result['cards'][0]['noteId']
        # An older copy has only the original grouped note link and its recorded seconds.
        old = h.notes[originals[12][2]]['fields']
        old['Source'] = re.sub(r' data-study-word="[^"]*"', '', old['Source'])
        h.library.locate(saved['id']).path(saved['id']).unlink()
        h.library.handle({'action': 'libraryAutoSync'})
        rows = h.library.handle({'action': 'libraryList', 'scope': 'anki-only', 'url': '', 'title': ''})['items']
        self.assertCountEqual([(row['entry']['word'], row['entry'].get('videoTime')) for row in rows],
                              [('just', 12), ('Just', 27)])
        h.calls.clear()
        for _, _, note_id in originals.values():
            h.library.handle({'action': 'libraryOrphan', 'noteId': note_id, 'choice': 'restore'})
        for sec, (ident, card_id, note_id) in originals.items():
            record = h.library.locate(ident).read(ident)[0]
            self.assertEqual(record['entry']['videoTime'], sec)
            self.assertEqual([(c['id'], c['noteId']) for c in record['cards']], [(card_id, note_id)])
            again = h.library.handle({'action': 'libraryCardsAdd', 'id': ident, 'cards': [card.copy()]})
            self.assertEqual([c['noteId'] for c in again['cards']], [note_id])
        self.assertFalse(set(h.calls) & {'addNote', 'deleteNotes', 'updateNoteFields', 'changeDeck', 'setDueDate'})

    def test_repair_duplicate_then_deleted_card_and_recover_an_orphan_without_anki_writes(self):
        h = fixture.AutoSyncTests(); h.setUp()
        self.addCleanup(h.tearDown)
        ident = h.make_card()
        original = h.library.anki
        def anki(action, params):
            if action == 'findNotes' and params['query'] == '(tag:study_* OR tag:studycard_*)': return list(h.notes)
            if action == 'notesInfo': params = {'notes': [n for n in params['notes'] if n in h.notes]}
            return original(action, params)
        h.library.anki = anki
        h.notes[2000] = copy.deepcopy(h.notes[1000])
        result = h.library.handle({'action': 'libraryReconcile', 'id': ident})
        self.assertEqual(result['syncState'], 'ambiguous')
        self.assertEqual(len(result['candidates']), 2)
        h.calls.clear()
        h.library.handle({'action': 'libraryRepair', 'id': ident, 'choice': 'select', 'noteId': 1000})
        self.assertNotIn('updateNoteFields', h.calls)
        h.library.handle({'action': 'libraryCardsAdd', 'id': ident, 'cards': [{'front': 'A brick wall.', 'back': '砖墙', 'kind': 'context'}]})
        other = next(c['noteId'] for c in h.library.locate(ident).read(ident)[0]['cards'] if c['noteId'] != 1000)
        del h.notes[1000]
        self.assertEqual(h.library.handle({'action': 'libraryReconcile', 'id': ident})['syncState'], 'missing')
        video = h.library.handle({'action': 'libraryVideoWords', 'mediaKey': 'web:example.com/a'})
        self.assertEqual(video['items'][0]['cards'], 1)  # The missing card still has its old noteId.
        self.assertIn('已被删除', video['items'][0]['cardHint'])
        record = h.library.handle({'action': 'libraryRead', 'ids': [ident]})['items'][0]['record']
        self.assertEqual(record['cardProgress']['confirmed'], video['items'][0]['cards'])
        summary = h.library.handle({'action': 'libraryVideoSummary', 'mediaKey': 'web:example.com/a',
                                    'url': 'https://example.com/a', 'title': 'Lesson'})
        body = (h.vault / summary['path']).read_text()
        self.assertIn('已确认 1 张卡', body)
        self.assertIn(video['items'][0]['cardHint'], body)
        recreated = h.library.handle({'action': 'libraryRepair', 'id': ident, 'choice': 'recreate'})
        self.assertEqual([c['noteId'] for c in recreated['cards']], [other])
        cleared = h.library.handle({'action': 'libraryRepair', 'id': ident, 'choice': 'unlink'})
        self.assertFalse(cleared['cards'])
        lib = h.library.locate(ident)
        lib.path(ident).unlink()
        h.library.handle({'action': 'libraryAutoSync'})
        orphans = h.library.handle({'action': 'libraryList', 'scope': 'anki-only', 'url': '', 'title': ''})
        self.assertEqual([r['noteId'] for r in orphans['items']], [2000])
        h.calls.clear()
        h.notes[2000]['fields']['Definition'] = '新的解释'
        h.library.handle({'action': 'libraryOrphan', 'noteId': 2000, 'choice': 'restore'})
        # The first reply can be lost while the orphan list is still cached.
        h.library.handle({'action': 'libraryOrphan', 'noteId': 2000, 'choice': 'restore'})
        restored = h.library.handle({'action': 'libraryList', 'scope': 'all'})['items'][0]
        self.assertTrue(restored['vaultSaved'])
        self.assertEqual(restored['entry']['meaning'], '新的解释')
        self.assertEqual([c['noteId'] for c in restored['cards']], [2000])
        self.assertEqual(restored['cards'][0]['kind'], 'meaning')
        self.assertFalse(any(a in h.calls for a in ('addNote', 'updateNoteFields', 'deleteNotes', 'setDueDate', 'changeDeck')))
