import json
import pathlib
import tempfile
import unittest

from study_library import StudyLibrary
from study_memory import MemoryIndex
from study_settings import YomitanLibrary


class WordDocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.vault = pathlib.Path(self.temp.name)
        self.config = self.vault / 'bridge-config.json'
        self.config.write_text(json.dumps({'vault': str(self.vault)}))
        self.library = self.fresh()
        self.target = self.library.settings()['targetId']

    def no_anki(self, action, params):
        raise AssertionError('Unexpected external call: ' + action)

    def fresh(self):
        return YomitanLibrary(self.config, anki=self.no_anki)

    def entry(self, sentence='It is a just decision.', url='https://example.com/a', **extra):
        return {'word': 'just', 'sentence': sentence, 'url': url, 'meaning': 'fair', **extra}

    def turn(self, ident, answer):
        return {'id': ident, 'at': '2026-10-16T00:00:00+08:00', 'question': 'Why?',
                'translation': '', 'meaning': '', 'notes': answer, 'feedback': 'unconfirmed'}

    def save(self, entry=None, turns=None, target=None, library=None):
        return (library or self.library).handle({'action': 'librarySave', 'entry': entry or self.entry(),
            'makeCard': False, 'turns': turns or [], 'targetId': target or self.target})

    def test_same_word_different_contexts_share_one_file_but_keep_separate_answers(self):
        a = self.save(turns=[self.turn('turn-first', 'FIRST ANSWER')])
        other = self.entry('I have just arrived.', 'https://example.com/b', meaning='recently')
        b = self.save(other, [self.turn('turn-second', 'SECOND ANSWER')])
        self.assertNotEqual(a['id'], b['id'])
        self.assertEqual(a['path'], b['path'])
        self.assertEqual(len(list((self.vault / a['path']).parent.glob('*.md'))), 1)
        lib = self.fresh().library_for(self.target)
        self.assertIn('FIRST ANSWER', lib.read(a['id'])[1])
        self.assertNotIn('SECOND ANSWER', lib.read(a['id'])[1])
        self.assertIn('SECOND ANSWER', lib.read(b['id'])[1])
        self.assertEqual(lib.result(b['id'])['entry']['meaning'], 'recently')
        before = (self.vault / a['path']).read_bytes()
        self.save(other, [self.turn('turn-second', 'SECOND ANSWER')], library=self.fresh())
        self.assertEqual((self.vault / a['path']).read_bytes(), before)
        self.save(turns=[self.turn('turn-first', 'FIRST ANSWER'), self.turn('turn-third', 'THIRD ANSWER')])
        self.assertEqual(lib.read(a['id'])[1].count('FIRST ANSWER'), 1)
        self.assertIn('THIRD ANSWER', lib.read(a['id'])[1])
        self.assertNotIn('THIRD ANSWER', lib.read(b['id'])[1])

    def test_fresh_list_and_memory_include_new_second_context(self):
        a = self.save()
        lib = self.library.library_for(self.target)
        index = MemoryIndex(lib)
        self.addCleanup(index.close)
        self.assertEqual(index.refresh(budget=5)['status'], 'complete')
        b = self.save(self.entry('I just arrived.'))
        self.assertEqual(a['path'], b['path'])
        rows = self.fresh().handle({'action': 'libraryList', 'url': 'https://example.com/a', 'title': ''})
        self.assertEqual({r['id'] for r in rows['items']}, {a['id'], b['id']})
        self.assertEqual(index.refresh(budget=5)['status'], 'complete')
        ids, total = index.find('just')
        self.assertEqual(total, 2)
        self.assertEqual(set(ids), {a['id'], b['id']})
        # A new process must rebuild the same per-context associations.
        fresh_index = MemoryIndex(self.fresh().library_for(self.target))
        self.addCleanup(fresh_index.close)
        self.assertEqual(fresh_index.refresh(budget=5)['status'], 'complete')
        self.assertEqual(fresh_index.find('just')[1], 2)

    def test_sibling_update_does_not_stale_version_or_draft_and_preserves_manual_text(self):
        a = self.save()
        lib = self.library.library_for(self.target)
        draft = self.library.handle({'action': 'libraryDraftSave', 'items': [{'id': a['id'], 'version': a['version'],
            'reason': 'Explain', 'cards': [{'front': 'Question', 'back': 'Answer', 'selected': True}]}]})['items'][0]
        record, body, version = lib.read(a['id'])
        b = self.save(self.entry('I just arrived.'))
        self.assertEqual(a['path'], b['path'])
        self.assertEqual(lib.read(a['id']), (record, body, version))
        self.assertFalse(lib.result(a['id'])['draftStale'])
        path = self.vault / a['path']
        path.write_text(path.read_text() + '\nMy whole-word annotation.\n')
        self.save(self.entry('I just arrived.'), [self.turn('turn-manual', 'Other context')])
        self.assertIn('My whole-word annotation.', path.read_text())
        self.assertEqual(lib.read(a['id'])[2], version)
        updated = self.library.handle({'action': 'libraryDraftSave', 'items': [{'id': a['id'], 'version': draft['version'],
            'reason': 'Revised reason', 'cards': []}]})['items'][0]
        self.assertFalse(updated['draftStale'])

    def test_same_directory_new_deck_keeps_each_context_original_target(self):
        a = self.save()
        settings = self.library.settings()
        new = self.library.handle({'action': 'librarySettingsSave', 'settings': {**settings, 'deck': 'New deck'}})
        b = self.save(self.entry('I just arrived.'), target=new['targetId'])
        self.assertEqual(a['path'], b['path'])
        fresh = self.fresh()
        self.assertEqual(fresh.locate(a['id']).result(a['id'])['target']['deck'], '外语::英语语境')
        self.assertEqual(fresh.locate(b['id']).result(b['id'])['target']['deck'], 'New deck')
        retried = self.save(target=new['targetId'], library=fresh)
        self.assertEqual(retried['targetId'], a['targetId'])
        lib = fresh.locate(a['id'])
        r, body, version = lib.read(a['id'])
        r['ankiState'] = 'pending'
        lib.write(r, body, version)
        pending = fresh.handle({'action': 'libraryList', 'url': '', 'title': '', 'scope': 'pending'})
        self.assertEqual([r['id'] for r in pending['items']], [a['id']])

    def test_word_filename_collision_case_and_language_boundaries(self):
        a = self.save(self.entry(word='a/b'))
        b = self.save(self.entry(word='a:b'))
        self.assertNotEqual(a['path'], b['path'])
        c = self.save(self.entry(word='JUST'))
        d = self.save(self.entry('Another just sentence.', word='just'))
        self.assertEqual(c['path'], d['path'])
        ja = self.save(self.entry(word='just', language='ja'))
        self.assertNotEqual(ja['path'], d['path'])
        self.assertNotIn('--w', pathlib.Path(ja['path']).name)

    def test_legacy_note_updates_in_place_and_direct_iina_default_is_unchanged(self):
        legacy = StudyLibrary(self.vault, anki=self.no_anki)
        original = legacy.handle({'action': 'librarySave', 'entry': self.entry(), 'makeCard': False})
        path = self.vault / original['path']
        path.write_text(path.read_text() + '\nA manual legacy annotation.\n')
        result = self.save(turns=[self.turn('turn-legacy', 'LEGACY ANSWER')])
        self.assertEqual(result['path'], original['path'])
        self.assertIn('A manual legacy annotation.', path.read_text())
        self.assertIn('LEGACY ANSWER', path.read_text())
        another = legacy.handle({'action': 'librarySave', 'entry': self.entry('I just arrived.'), 'makeCard': False})
        self.assertNotEqual(another['path'], result['path'])
        self.assertNotIn('--w', path.name)

    def test_grouped_note_has_one_word_title_and_source_context_sections(self):
        a = self.save(self.entry(title='First source'))
        self.save(self.entry('I just arrived.', title='Second source'))
        content = (self.vault / a['path']).read_text()
        self.assertEqual(content.count('\n# just\n'), 1)
        self.assertIn('## 语境 · First source', content)
        self.assertIn('## 语境 · Second source', content)

    def test_manual_context_edits_stale_only_that_context_and_are_preserved(self):
        a = self.save(turns=[self.turn('turn-original', 'ORIGINAL ANSWER')])
        b = self.save(self.entry('I just arrived.'))
        lib = self.library.library_for(self.target)
        record, body, version = lib.read(a['id'])
        path = self.vault / a['path']
        path.write_text(path.read_text().replace('ORIGINAL ANSWER', 'MANUAL ANSWER'))
        self.assertNotEqual(lib.read(a['id'])[2], version)
        with self.assertRaises(ValueError):
            lib.write(record, body + '\nStale change', version)
        self.save(self.entry('I just arrived.'), [self.turn('turn-sibling', 'SIBLING')])
        self.assertIn('MANUAL ANSWER', lib.read(a['id'])[1])
        self.assertNotIn('MANUAL ANSWER', lib.read(b['id'])[1])

    def test_context_card_ids_pending_state_and_note_ids_survive_other_saves(self):
        a = self.save()
        lib = self.library.library_for(self.target)
        record, body, version = lib.read(a['id'])
        record.update({'ankiState': 'pending', 'noteId': 123, 'cards': [
            {'id': 'a' * 32, 'front': 'Q', 'back': 'A', 'state': 'pending', 'noteId': 456}]})
        lib.write(record, body, version)
        before = lib.read(a['id'])
        b = self.save(self.entry('I just arrived.'))
        self.assertEqual(a['path'], b['path'])
        self.assertEqual(lib.read(a['id']), before)
        index = MemoryIndex(lib)
        self.addCleanup(index.close)
        self.assertEqual(index.refresh(budget=5)['status'], 'complete')
        self.assertEqual(index.db.execute('SELECT record,note FROM points').fetchall(), [(a['id'], 456)])

    def test_unrelated_word_file_and_broken_markers_never_get_overwritten(self):
        a = self.save()
        path = self.vault / a['path']
        path.write_text('A manually-created note, not managed study data.')
        before = path.read_bytes()
        with self.assertRaises(ValueError):
            self.save()
        self.assertEqual(path.read_bytes(), before)

    def test_broken_other_word_does_not_block_healthy_grouped_or_legacy_records(self):
        broken = self.save()
        healthy = self.save(self.entry(word='fair'))
        legacy_lib = StudyLibrary(self.vault, self.no_anki)
        legacy = legacy_lib.handle({'action': 'librarySave', 'entry': self.entry(word='old'), 'makeCard': False})
        path = self.vault / broken['path']
        path.write_text('My manually edited word note with no metadata.')
        self.assertEqual(self.fresh().locate(healthy['id']).result(healthy['id'])['id'], healthy['id'])
        self.assertEqual(legacy_lib.read(legacy['id'])[0]['id'], legacy['id'])
        self.assertEqual(self.save(self.entry(word='fair'))['id'], healthy['id'])
        rows = self.fresh().handle({'action': 'libraryList', 'url': 'https://example.com/a', 'title': ''})
        self.assertEqual({row['id'] for row in rows['items']}, {healthy['id'], legacy['id']})
        with self.assertRaises(ValueError):
            self.save()
        self.assertEqual(path.read_text(), 'My manually edited word note with no metadata.')

    def test_memory_prunes_removed_context_without_losing_its_sibling(self):
        a = self.save()
        b = self.save(self.entry('I just arrived.'))
        self.assertEqual(a['path'], b['path'])
        lib = self.library.library_for(self.target)
        index = MemoryIndex(lib)
        self.addCleanup(index.close)
        self.assertEqual(index.refresh(budget=5)['status'], 'complete')
        path = self.vault / a['path']
        content = path.read_text()
        start, end = lib.word_contexts(content)[b['id']][3]
        path.write_text(content[:start] + content[end:])
        self.assertEqual(index.refresh(budget=5)['status'], 'complete')
        self.assertEqual(index.find('just'), ([a['id']], 1))

    def test_trusted_cues_group_but_private_authorization_stays_per_context(self):
        def cue_entry(sentence):
            entry = self.entry(sentence)
            start = sentence.index('just')
            entry['subtitleSource'] = {'version': 1, 'url': entry['url'], 'language': 'en', 'trackIndex': 0,
                'trackName': 'English', 'text': sentence, 'word': 'just', 'originalStartMs': 1000,
                'originalEndMs': 2000, 'subtitleOffsetMs': 0, 'selectionStart': start, 'selectionEnd': start + 4,
                'provenance': {'queryId': 'q-source', 'sourceRevision': 'revision', 'cueIndex': 0,
                               'tabId': 1, 'frameId': 0, 'documentId': 'doc'}}
            return entry
        ea, eb = cue_entry('It is just.'), cue_entry('I just arrived.')
        a, b = self.save(ea), self.save(eb)
        self.assertEqual(a['path'], b['path'])
        reconciled = self.library.handle({'action': 'libraryReconcile', 'id': a['id']})
        self.assertEqual(reconciled['syncState'], 'local-only')
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryDraftSave', 'items': [{'id': b['id'], 'version': b['version'],
                'reason': 'Cue', 'cards': []}], 'cueAuthorization': {'id': a['id'], 'source': ea['subtitleSource']}})
        result = self.library.handle({'action': 'libraryDraftSave', 'items': [{'id': b['id'], 'version': b['version'],
            'reason': 'Cue', 'cards': []}], 'cueAuthorization': {'id': b['id'], 'source': eb['subtitleSource']}})
        self.assertEqual(result['items'][0]['id'], b['id'])
        self.assertEqual(self.fresh().locate(a['id']).result(a['id'])['version'], a['version'])

    def test_native_subprocess_groups_two_contexts_with_anki_disabled(self):
        import shutil
        import struct
        import subprocess
        import sys
        runtime = self.vault / 'runtime'
        runtime.mkdir()
        from bridge_files import runtime_sources
        for name, data in runtime_sources(pathlib.Path(__file__).parent).items():
            (runtime / name).write_bytes(data)
        shutil.copyfile(self.config, runtime / 'bridge-config.json')
        def native(payload):
            raw = json.dumps(payload).encode()
            result = subprocess.run([sys.executable, str(runtime / 'study_translator.py'),
                'chrome-extension://fdibnlkfllnojcmhcghkmdlceeegmhpf/'],
                input=struct.pack('=I', len(raw)) + raw, capture_output=True, timeout=5)
            answer = json.loads(result.stdout[4:])
            self.assertTrue(answer['ok'], answer)
            return answer['library']
        settings = native({'action': 'librarySettingsGet'})
        settings = native({'action': 'librarySettingsSave', 'settings': {**settings, 'ankiEnabled': False}})
        rows = [native({'action': 'librarySave', 'entry': entry, 'makeCard': True, 'targetId': settings['targetId']})
                for entry in [self.entry(), self.entry('I just arrived.')]]
        self.assertEqual(rows[0]['path'], rows[1]['path'])
        result = native({'action': 'libraryRead', 'ids': [r['id'] for r in rows]})
        self.assertEqual({r['id'] for r in result['items']}, {r['id'] for r in rows})
        self.assertFalse(result['ankiEnabled'])


if __name__ == '__main__':
    unittest.main()
