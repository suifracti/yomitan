import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch


class HealthTests(unittest.TestCase):
    def test_health_reports_actual_bytes_without_reading_notes(self):
        from study_health import health, record_error
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            vault = root / 'vault'
            vault.mkdir()
            (root / 'bridge-config.json').write_text(json.dumps({'vault': str(vault)}))
            (root / 'study_demo.py').write_bytes(b'code')
            cache = root / 'learning-cache'
            cache.mkdir()
            (cache / 'auto-sync-state.json').write_text(json.dumps({'at': 12, 'synced': 2, 'conflicts': 1}))
            for i in range(25):
                record_error(root, 'librarySave', ValueError('PRIVATE LEARNING SENTENCE'))
            with patch('pathlib.Path.rglob', side_effect=AssertionError('no vault traversal')):
                result = health(root, anki=lambda action, params: 6)
            self.assertEqual(result['files']['study_demo.py'], hashlib.sha256(b'code').hexdigest())
            self.assertEqual(result['anki'], {'ok': True, 'version': 6})
            self.assertEqual(result['vault'], {'ok': True})
            self.assertEqual(result['autoSync'], {'at': 12, 'synced': 2, 'conflicts': 1})
            self.assertEqual(len(result['errors']), 20)
            self.assertNotIn('PRIVATE', json.dumps(result))
            self.assertNotIn(str(vault), json.dumps(result))

    def test_health_is_available_without_codex_or_anki(self):
        from study_health import health
        from study_translator import normalize_request
        self.assertEqual(normalize_request({'action': 'bridgeHealth'}), {'action': 'bridgeHealth'})
        with self.assertRaises(ValueError):
            normalize_request({'action': 'bridgeHealth', 'path': '/private'})
        with tempfile.TemporaryDirectory() as temporary:
            def offline(action, params):
                raise OSError('offline')
            result = health(pathlib.Path(temporary), offline)
            self.assertFalse(result['anki']['ok'])
            self.assertFalse(result['vault']['ok'])

    def test_native_health_frame_routes_without_starting_codex(self):
        import struct
        import subprocess
        import sys
        import study_translator
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            source = pathlib.Path(study_translator.__file__)
            (root / source.name).write_bytes(source.read_bytes())
            (root / 'study_health.py').write_text("def health(root): return {'files': {'fixture.py': 'hash'}, 'python': 'fixture'}\n")
            payload = json.dumps({'action': 'bridgeHealth'}).encode()
            output = subprocess.run([sys.executable, str(root / source.name), study_translator.ORIGIN],
                                    input=struct.pack('=I', len(payload)) + payload, capture_output=True, check=True)
            response = json.loads(output.stdout[4:])
            self.assertTrue(response['ok'])
            self.assertEqual(response['library']['files'], {'fixture.py': 'hash'})

    def test_installer_records_every_module_and_compiled_helper(self):
        import os
        import sys
        import install_bridge
        from bridge_files import runtime_sources
        with tempfile.TemporaryDirectory() as temporary:
            home = pathlib.Path(temporary)
            codex = home / 'fixture-codex'
            codex.write_text('#!/bin/sh\necho "codex-cli 0.162.0-fixture"\n')
            codex.chmod(0o700)
            def compile_fixture(runtime):
                (runtime / 'apple-translate').write_bytes(b'fixture executable')
                return True
            with patch.dict(os.environ, {'CODEX_HOME': str(home / 'fixture-auth')}), patch.object(install_bridge, 'compile_apple_translate', compile_fixture):
                runtime, _ = install_bridge.install(home, codex, sys.executable)
                installed = json.loads((runtime / 'install-metadata.json').read_text())['files']
                for name in [*runtime_sources(pathlib.Path(install_bridge.__file__).parent), 'apple-translate']:
                    self.assertEqual(installed[str(runtime / name)], hashlib.sha256((runtime / name).read_bytes()).hexdigest())
                install_bridge.install(home, codex, sys.executable)
                (runtime / 'apple-translate').write_bytes(b'user modified helper')
                with self.assertRaises(ValueError):
                    install_bridge.install(home, codex, sys.executable)

class PingTests(unittest.TestCase):
    def test_ping_works_with_no_config_modules_or_providers(self):
        import struct
        import subprocess
        import sys
        import study_translator as native
        with tempfile.TemporaryDirectory() as temporary:
            script = pathlib.Path(temporary) / 'study_translator.py'
            script.write_bytes(pathlib.Path(native.__file__).read_bytes())
            payload = json.dumps({'action': 'bridgePing'}).encode()
            result = subprocess.run([sys.executable, str(script), native.ORIGIN], input=struct.pack('=I', len(payload)) + payload, capture_output=True, check=True)
            self.assertEqual(json.loads(result.stdout[4:]), {'ok': True, 'pong': True})
            self.assertEqual(list(script.parent.iterdir()), [script])
        with self.assertRaises(ValueError):
            native.normalize_request({'action': 'bridgePing', 'path': 'private'})


if __name__ == '__main__':
    unittest.main()
