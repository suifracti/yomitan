import copy
import unittest
import test_study_auto_sync as fixture


class RepairTests(unittest.TestCase):
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
        restored = h.library.handle({'action': 'libraryList', 'scope': 'all'})['items'][0]
        self.assertTrue(restored['vaultSaved'])
        self.assertEqual(restored['entry']['meaning'], '新的解释')
        self.assertFalse(any(a in h.calls for a in ('addNote', 'updateNoteFields', 'deleteNotes', 'setDueDate', 'changeDeck')))
