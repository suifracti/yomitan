import json
import pathlib
import time
import unittest
from unittest.mock import patch

from study_library import StudyLibrary, normalize_entry, entry_id
from study_settings import YomitanLibrary
from test_study_auto_sync import AutoSyncTests
from test_study_media_video import WEBM, asset


class RecordIndexTests(AutoSyncTests):
    def test_source_shelf_groups_saved_contexts_and_search_keeps_whole_group_counts(self):
        yt = 'https://www.youtube.com/watch?v=abcdefghijk&t=4s'
        local = 'file:///examples/a/Lesson.mp4#study-duration=18'
        for word, url in [('beacon', yt), ('harbor', 'https://youtu.be/abcdefghijk?t=13s'),
                          ('change', local), ('bridge', local.replace('/a/', '/b/'))]:
            row = self.library.handle({'action': 'librarySave', 'makeCard': False,
                                        'entry': {'word': word, 'sentence': f'We saw a {word}.', 'url': url, 'videoTime': 4}})
            if word in ('beacon', 'change'):
                self.library.handle({'action': 'libraryMedia', 'id': row['id'], 'version': row['version'],
                                     'start': 4, 'end': 6, 'origin': 'capture', 'assets': [asset('audio', 'audio/webm', WEBM)]})
        request = {'action': 'libraryList', 'scope': 'sources', 'url': '', 'title': ''}
        all_sources = self.library.handle(request)
        self.assertEqual(all_sources['total'], 3)
        self.assertEqual({row['url'] for row in all_sources['sources'] if row['url'].startswith('file:')},
                         {local, local.replace('/a/', '/b/')})
        self.calls.clear()
        with patch.object(StudyLibrary, 'file_content', side_effect=AssertionError('source shelf reopened a note')), \
                patch('study_media.attachment', side_effect=AssertionError('source shelf opened audio')):
            found = self.library.handle({**request, 'query': 'harbor'})
            self.assertEqual(found['total'], 1)
            self.assertEqual([(s['records'], s['audio']) for s in found['sources']], [(2, 1)])
            self.assertEqual(self.library.handle({**request, 'offset': 1})['sources'], all_sources['sources'][1:])
        self.assertEqual(self.calls, [])

    def test_dictation_finds_original_recordings_before_list_paging(self):
        root = 'file:///examples/folder-a/lesson%20one.mp4#study-duration=120'
        def save(word, sentence, url=root, audio=False):
            row = self.library.handle({'action': 'librarySave', 'makeCard': False,
                                        'entry': {'word': word, 'sentence': sentence, 'url': url, 'videoTime': 12}})
            if audio:
                self.library.handle({'action': 'libraryMedia', 'id': row['id'], 'version': row['version'],
                                     'start': 12, 'end': 15, 'origin': 'capture', 'assets': [asset('audio', 'audio/webm', WEBM)]})
            return row
        sentence = 'We finally reached the harbor.'
        save('finally', sentence, audio=True)
        old = save('harbor', sentence, audio=True)
        stale = save('shore', 'We reached the shore.', audio=True)
        self.library.handle({'action': 'libraryUpdate', 'id': stale['id'], 'entry': {'sentence': 'We see the harbor.'}})
        save('boats', 'Boats were waiting at the harbor.', url=root.replace('folder-a', 'folder-b'), audio=True)
        for i in range(11):
            save(f'word{i}', f'A new example for word{i}.')
        request = {'action': 'libraryList', 'scope': 'all', 'url': '', 'title': ''}
        normal = self.library.handle(request)
        self.assertNotIn(old['id'], {row['id'] for row in normal['items']})
        self.calls.clear()
        with patch.object(StudyLibrary, 'file_content', side_effect=AssertionError('dictation reopened a note')), \
                patch('study_media.attachment', side_effect=AssertionError('dictation opened audio before playback')):
            scoped = {**request, 'scope': 'source', 'url': root}
            self.assertEqual(self.library.handle(scoped)['total'], 14)
            result = self.library.handle({**scoped, 'query': 'harbor', 'practice': 'dictation'})
            self.assertEqual(result['total'], 1)
            self.assertEqual([r['id'] for r in result['items']], [old['id']])
        self.assertEqual(self.calls, [])
        self.assertEqual(self.library.handle(request)['total'], normal['total'])

    def test_find_an_older_sentence_by_meaning_or_word_before_paging(self):
        def save(word, sentence, meaning):
            return self.library.handle({'action': 'librarySave', 'makeCard': False,
                                        'entry': {'word': word, 'sentence': sentence, 'meaning': meaning,
                                                  'url': 'https://example.test/film', 'title': 'Coastal journeys'}})
        old = save('harbor', 'We finally reached the harbor.', '避风港')
        for i in range(12):
            save(f'beacon{i}', f'Another harbor light number {i}.', '灯塔')
        def lookup(**params):
            return self.library.handle({'action': 'libraryList', 'scope': 'all', 'url': '', 'title': '', **params})
        self.assertNotIn(old['id'], {row['id'] for row in lookup()['items']})
        self.calls.clear()
        with patch.object(StudyLibrary, 'file_content', side_effect=AssertionError('search reopened a note')):
            found = lookup(query='避风港')
            self.assertEqual([(r['id'], r['searchHit']['text']) for r in found['items']], [(old['id'], '避风港')])
            page = lookup(query='HARBOR')
            self.assertEqual((page['total'], len(page['items']), page['items'][0]['id']), (13, 10, old['id']))
            self.assertEqual(page['items'][1]['searchHit']['label'], '原句')
            self.assertEqual(len(lookup(query='harbor', offset=10)['items']), 3)
            self.assertEqual([r['id'] for r in lookup(query='HARBOR 避风港')['items']], [old['id']])
            self.assertEqual(lookup(query='beacon1 避风港')['items'], [])
            self.assertEqual(lookup(query='vaultSaved')['total'], 0)
        self.assertEqual(self.calls, [])

    def test_queries_reuse_index_across_native_processes(self):
        self.make_card()
        self.library.handle({'action': 'libraryAutoSync'})
        cache = pathlib.Path(self.library.cache_dir) / '.study-index.json'
        self.assertTrue(cache.is_file())
        self.assertFalse(list(self.vault.rglob('.study-index.json')))
        fresh = YomitanLibrary(self.library.config_path, self.anki, self.library.cache_dir)
        with patch.object(StudyLibrary, 'file_content', side_effect=AssertionError('unchanged note reread')):
            self.assertEqual(fresh.word_status()['words']['brick']['s'], 'learning')
            self.assertEqual(fresh.video_words('youtube:abcdefghijk'), [])
            result = fresh.handle({'action': 'libraryList', 'scope': 'all', 'url': '', 'title': ''})
            self.assertEqual(result['total'], 1)
            self.assertEqual(fresh.auto_sync()['synced'], 0)

    def test_only_changed_files_are_read_and_deletion_is_removed(self):
        self.make_card()
        self.library.word_status()
        path = next(self.vault.rglob('*brick*.md'))
        text = path.read_text()
        path.write_text(text.replace('> 砖', '> 砖块'))
        reads = []
        read = StudyLibrary.file_content
        def tracked(lib, file):
            reads.append(file)
            return read(lib, file)
        with patch.object(StudyLibrary, 'file_content', tracked):
            result = self.library.handle({'action': 'libraryList', 'scope': 'all', 'url': '', 'title': ''})
        self.assertEqual(reads, [path])
        self.assertEqual(result['total'], 1)
        path.unlink()
        self.assertEqual(self.library.word_status()['words'], {})

    def test_quiet_auto_sync_with_2000_records(self):
        lib = self.library.library_for(self.library.active_id)
        lib.records.mkdir(parents=True, exist_ok=True)
        for i in range(2000):
            entry = normalize_entry({'word': f'word{i}', 'sentence': f'A word{i} here.', 'meaning': '义'})
            record = {'id': entry_id(entry), 'entry': entry, 'created': str(i), 'ankiState': 'synced', 'noteId': 1000 + i,
                      'targetId': lib.target_id, 'savedTarget': lib.target_details()}
            path = lib.records / (f'word{i}--w' + lib.word_id(entry) + '.md')
            path.write_text(lib.word_header(entry) + lib.context_block(record, '\n## 学习\n\n文本\n'))
        profile = '学习'
        def fast_anki(action, params):
            if action == 'getActiveProfile': return profile
            if action == 'findNotes' and params['query'] == '(tag:study_* OR tag:studycard_*)':
                return list(range(1000, 3000)) if profile == '学习' else []
            if action == 'findCards' and params['query'].startswith('nid:'):
                return [int(n) * 10 for n in params['query'][4:].split(',')] if profile == '学习' else []
            if action == 'notesInfo':
                return [{'noteId': n, 'cards': [n * 10]} for n in params['notes']]
            if action == 'cardsInfo':
                return [{'cardId': c, 'note': c // 10, 'mod': 1, 'interval': 30, 'lapses': 0} for c in params['cards']]
            if action == 'cardsModTime':
                return [{'cardId': c, 'mod': 1} for c in params['cards']]
            return []
        self.library.anki = fast_anki
        self.library.auto_sync()
        fresh = YomitanLibrary(self.library.config_path, fast_anki, self.library.cache_dir)
        start = time.perf_counter()
        with patch.object(StudyLibrary, 'file_content', side_effect=AssertionError('quiet pass read notes')):
            result = fresh.auto_sync()
        elapsed = time.perf_counter() - start
        print(f'2000 records quiet auto_sync: {elapsed * 1000:.1f} ms')
        self.assertEqual(result['checked'], 2000)
        self.assertLess(elapsed, .3)
        profile = '另一个账户'
        with patch('study_sync.reconcile', return_value={}) as reconcile:
            switched = fresh.auto_sync()
            self.assertIn('账户', switched['paused'])
            reconcile.assert_not_called()


if __name__ == '__main__':
    unittest.main()
