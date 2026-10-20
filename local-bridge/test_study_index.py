import json
import pathlib
import time
import unittest
from unittest.mock import patch

from study_library import StudyLibrary, normalize_entry, entry_id
from study_settings import YomitanLibrary
from test_study_auto_sync import AutoSyncTests


class RecordIndexTests(AutoSyncTests):
    def test_queries_reuse_index_across_native_processes(self):
        self.make_card()
        self.library.handle({'action': 'libraryAutoSync'})
        cache = pathlib.Path(self.library.cache_dir) / '.study-index.json'
        self.assertTrue(cache.is_file())
        self.assertFalse(list(self.vault.rglob('.study-index.json')))
        fresh = YomitanLibrary(self.library.config_path, self.anki, self.library.cache_dir)
        with patch.object(StudyLibrary, 'file_content', side_effect=AssertionError('unchanged note reread')):
            self.assertEqual(fresh.word_status(), {'brick': 'learning'})
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
        self.assertEqual(self.library.word_status(), {})

    def test_quiet_auto_sync_with_2000_records(self):
        lib = self.library.library_for(self.library.active_id)
        lib.records.mkdir(parents=True, exist_ok=True)
        for i in range(2000):
            entry = normalize_entry({'word': f'word{i}', 'sentence': f'A word{i} here.', 'meaning': '义'})
            record = {'id': entry_id(entry), 'entry': entry, 'created': str(i), 'ankiState': 'saved', 'noteId': None,
                      'targetId': lib.target_id, 'savedTarget': lib.target_details()}
            path = lib.records / (f'word{i}--w' + lib.word_id(entry) + '.md')
            path.write_text(lib.word_header(entry) + lib.context_block(record, '\n## 学习\n\n文本\n'))
        self.library.auto_sync()
        fresh = YomitanLibrary(self.library.config_path, self.anki, self.library.cache_dir)
        start = time.perf_counter()
        with patch.object(StudyLibrary, 'file_content', side_effect=AssertionError('quiet pass read notes')):
            result = fresh.auto_sync()
        elapsed = time.perf_counter() - start
        print(f'2000 records quiet auto_sync: {elapsed * 1000:.1f} ms')
        self.assertEqual(result['checked'], 2000)
        self.assertLess(elapsed, .3)


if __name__ == '__main__':
    unittest.main()
