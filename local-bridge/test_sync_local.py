import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]


class LocalSyncTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('sync_local', ROOT / 'dev/sync-local.py')
        self.sync = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.sync)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = pathlib.Path(self.tmp.name)
        self.repo, self.ext, self.runtime = root / 'repo', root / 'extension', root / 'runtime'
        for path in (self.repo / 'ext/js/study', self.repo / 'local-bridge', self.ext / 'js/study', self.runtime):
            path.mkdir(parents=True)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.test')
        (self.repo / 'ext/code.js').write_bytes(b'old extension')
        (self.ext / 'code.js').write_bytes(b'old extension')
        (self.repo / 'ext/untouched.css').write_bytes(b'unchanged source')
        (self.ext / 'untouched.css').write_bytes(b'local UI change')
        (self.repo / 'local-bridge/study_demo.py').write_bytes(b'old bridge')
        (self.runtime / 'study_demo.py').write_bytes(b'old bridge')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')
        (self.repo / 'ext/code.js').write_bytes(b'new extension')
        (self.repo / 'local-bridge/study_demo.py').write_bytes(b'new bridge')
        self.sync.generate_manifest(self.repo)
        self.git('add', '.')
        self.git('commit', '-qm', 'update')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args])

    def run_sync(self, **options):
        with patch.object(self.sync, 'EXTENSION', self.ext), patch.object(self.sync, 'RUNTIME', self.runtime):
            return self.sync.sync(self.repo, **options)

    def test_sync_copies_exact_bytes_and_preserves_personal_config(self):
        config = self.runtime / 'bridge-config.json'
        config.write_bytes(b'private config untouched')
        self.run_sync()
        self.assertEqual((self.runtime / 'study_demo.py').read_bytes(), b'new bridge')
        self.assertEqual((self.ext / 'code.js').read_bytes(), b'new extension')
        self.assertEqual(config.read_bytes(), b'private config untouched')
        self.assertEqual((self.ext / 'untouched.css').read_bytes(), b'local UI change')
        metadata = json.loads((self.runtime / 'install-metadata.json').read_text())
        self.assertIn(str(self.runtime / 'study_demo.py'), metadata['files'])

    def test_modified_bridge_refuses_all_destination_writes(self):
        (self.runtime / 'study_demo.py').write_bytes(b'unknown edits')
        with self.assertRaisesRegex(ValueError, '上一个提交'):
            self.run_sync()
        self.assertEqual((self.ext / 'code.js').read_bytes(), b'old extension')

    def test_dry_run_changes_neither_destination(self):
        self.run_sync(dry_run=True)
        self.assertEqual((self.runtime / 'study_demo.py').read_bytes(), b'old bridge')
        self.assertEqual((self.ext / 'code.js').read_bytes(), b'old extension')

    def test_manifest_cannot_be_stale(self):
        (self.repo / 'local-bridge/study_demo.py').write_bytes(b'not in manifest')
        with self.assertRaisesRegex(ValueError, 'manifest'):
            self.run_sync()

    def test_frozen_target_is_rejected_before_any_write(self):
        with patch.object(self.sync, 'FROZEN', (self.ext,)):
            with self.assertRaisesRegex(ValueError, '发行包'):
                self.run_sync()
        self.assertEqual((self.runtime / 'study_demo.py').read_bytes(), b'old bridge')

    def test_changed_extension_file_is_not_overwritten(self):
        (self.ext / 'code.js').write_bytes(b'local code change')
        with self.assertRaisesRegex(ValueError, '日常扩展'):
            self.run_sync()
        self.assertEqual((self.runtime / 'study_demo.py').read_bytes(), b'old bridge')


if __name__ == '__main__':
    unittest.main()
