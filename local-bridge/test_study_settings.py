import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from study_library import RELATIVE
from study_settings import YomitanLibrary


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.vault = self.root / 'vault'
        self.vault.mkdir()
        self.config = self.root / 'bridge-config.json'
        self.config.write_text(json.dumps({'vault': str(self.vault), 'codex': '/fake/codex', 'other': 42}))
        self.calls = []
        self.decks = ['外语::英语语境']
        self.models = ['外语语境卡']
        self.fields = ['Word', 'Sentence', 'Definition', 'Source', 'URL', 'Audio', 'Image']
        self.library = YomitanLibrary(self.config, anki=self.anki)

    def tearDown(self):
        self.temp.cleanup()

    def anki(self, action, params):
        self.calls.append((action, params))
        if action == 'deckNames': return list(self.decks)
        if action == 'modelNames': return list(self.models)
        if action == 'modelFieldNames': return list(self.fields)
        if action == 'createDeck': self.decks.append(params['deck']); return 1
        if action == 'createModel': self.models.append(params['modelName']); return 1
        raise AssertionError('Unexpected Anki call: ' + action)

    def settings(self, **changes):
        return {**self.library.handle({'action': 'librarySettingsGet'}), **changes}

    def save_settings(self, **changes):
        return self.library.handle({'action': 'librarySettingsSave', 'settings': self.settings(**changes)})

    def entry(self, word='test'):
        return {'word': word, 'sentence': word + ' example.', 'meaning': 'meaning', 'url': 'https://example.com/a'}

    def save(self, word='test', **extra):
        return self.library.handle({'action': 'librarySave', 'entry': self.entry(word), 'makeCard': False, **extra})

    def test_defaults_and_edit_do_not_create_folders_or_change_root(self):
        old = self.settings()
        self.assertTrue(old['ankiEnabled'])
        self.assertEqual(old['directory'], str(RELATIVE))
        target = self.save_settings(directory='Custom/Learning', deck='My deck', model='My model')
        self.assertNotEqual(target['targetId'], old['targetId'])
        self.assertFalse((self.vault / 'Custom').exists())
        config = json.loads(self.config.read_text())
        self.assertEqual(config['vault'], str(self.vault))
        self.assertEqual(config['other'], 42)
        self.assertEqual(YomitanLibrary(self.config, anki=self.anki).handle({'action': 'librarySettingsGet'}), target)
        self.assertEqual(self.calls, [])

    def test_target_resolve_and_old_pending_never_redirect(self):
        old = self.save()
        new = self.save_settings(directory='Elsewhere', deck='Other', model='Other model')
        resolved = self.library.handle({'action': 'libraryTargetResolve', 'entry': self.entry()})
        self.assertEqual(resolved['targetId'], old['targetId'])
        retried = self.save(targetId=new['targetId'])
        self.assertEqual(retried['path'], old['path'])
        self.assertEqual(retried['target']['deck'], '外语::英语语境')
        legacy_pending = self.save('old pending')
        self.assertEqual(legacy_pending['targetId'], old['targetId'])
        fresh = self.save('fresh', targetId=new['targetId'])
        self.assertTrue(fresh['path'].startswith('Elsewhere/'))
        with patch('study_memory.memory', return_value={}), patch('study_memory.compact', return_value={}):
            rows = self.library.handle({'action': 'libraryRead', 'ids': [fresh['id'], old['id']]})['items']
        self.assertEqual([r['id'] for r in rows], [fresh['id'], old['id']])
        self.assertEqual(rows[1]['record']['targetId'], old['targetId'])
        self.assertEqual(len(list(self.vault.glob('**/*--' + old['id'] + '.md'))), 1)

    def test_disabled_preserves_pending_and_drafts_without_anki(self):
        row = self.save()
        lib = self.library.library_for(row['targetId'])
        record, body, version = lib.read(row['id'])
        record['ankiState'] = 'pending'
        lib.write(record, body, version)
        before = lib.path(row['id']).read_bytes()
        self.save_settings(ankiEnabled=False)
        self.calls.clear()
        for action in ['librarySync', 'libraryCards', 'libraryDraftCommit']:
            payload = {'action': action, 'ids': [row['id']]} if action == 'librarySync' else {'action': action, 'items': [{'id': row['id'], 'version': lib.result(row['id'])['version'], **({'cards': [{'front': 'Q', 'back': 'A'}]} if action == 'libraryCards' else {'draftId': 'a' * 32})}]}
            result = self.library.handle(payload)
            self.assertFalse(result['items'][0]['ankiEnabled'])
        self.assertEqual(lib.path(row['id']).read_bytes(), before)
        result = self.library.handle({'action': 'libraryRead', 'ids': [row['id']]})
        self.assertFalse(result['ankiEnabled'])
        self.assertEqual(self.calls, [])
        saved = self.library.handle({'action': 'librarySave', 'entry': self.entry('off save'), 'makeCard': True})
        self.assertFalse(saved['ankiEnabled'])
        self.assertEqual(saved['ankiState'], 'saved')
        self.assertEqual(self.calls, [])

    def test_check_is_read_only_and_prepare_only_selected_missing(self):
        self.save_settings(directory='New records', deck='New deck', model='New model')
        checked = self.library.handle({'action': 'librarySettingsCheck'})
        self.assertFalse(checked['status']['deckExists'])
        self.assertFalse(checked['status']['directoryExists'])
        self.assertFalse(any(action.startswith('create') for action, _ in self.calls))
        self.assertFalse((self.vault / 'New records').exists())
        result = self.library.handle({'action': 'librarySettingsPrepare', 'createDeck': True, 'createModel': False})
        self.assertTrue(result['status']['deckExists'])
        self.assertFalse(result['status']['modelExists'])
        result = self.library.handle({'action': 'librarySettingsPrepare', 'createDeck': False, 'createModel': True})
        self.assertTrue(result['prepared'])
        self.assertFalse((self.vault / 'New records').exists())
        self.fields = ['Not compatible']
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'librarySettingsPrepare', 'createDeck': True, 'createModel': True})

    def test_model_or_deck_edit_in_same_directory_keeps_original_target(self):
        first = self.save()
        new = self.save_settings(deck='New deck')
        second = self.save(targetId=new['targetId'])
        self.assertEqual(second['targetId'], first['targetId'])
        self.assertEqual(second['target']['deck'], first['target']['deck'])

    def test_open_missing_never_creates_directory(self):
        self.save_settings(directory='Not here')
        with patch('study_settings.subprocess.run') as run:
            with self.assertRaises(ValueError):
                self.library.handle({'action': 'librarySettingsOpen'})
            run.assert_not_called()
        self.assertFalse((self.vault / 'Not here').exists())

    def test_reinstall_preserves_namespace_and_unknown_config(self):
        from install_bridge import install
        home = self.root / 'home'
        codex = self.root / 'codex'
        codex.write_text('#!/bin/sh\n')
        codex.chmod(0o700)
        with patch('install_bridge.subprocess.run') as run:
            run.return_value.stdout = 'codex-cli 0.162.0'
            runtime, _ = install(home, codex, '/fake/python', self.vault)
            config = runtime / 'bridge-config.json'
            library = YomitanLibrary(config, anki=self.anki)
            settings = library.handle({'action': 'librarySettingsGet'})
            library.handle({'action': 'librarySettingsSave', 'settings': {**settings, 'directory': 'Kept', 'ankiEnabled': False}})
            contents = json.loads(config.read_text())
            contents['niratan'] = {'keep': 'yes'}
            config.write_text(json.dumps(contents))
            install(home, codex, '/fake/python')
        saved = json.loads(config.read_text())
        self.assertEqual(saved['yomitanStudy'], contents['yomitanStudy'])
        self.assertEqual(saved['niratan'], {'keep': 'yes'})
        self.assertTrue((runtime / 'study_settings.py').is_file())

    def test_custom_vault_and_japanese_remain_separate(self):
        second_vault = self.root / 'second vault'
        second_vault.mkdir()
        target = self.save_settings(vault=str(second_vault), directory='Notes', ankiEnabled=False)
        row = self.save('new english', targetId=target['targetId'])
        self.assertTrue((second_vault / row['path']).is_file())
        ja = self.library.handle({'action': 'librarySave', 'entry': {**self.entry('日本語'), 'language': 'ja'}, 'makeCard': False})
        self.assertEqual(ja['target']['deck'], '外语::日语语境')
        self.assertTrue((self.vault / ja['path']).is_file())
        self.assertNotIn('ankiEnabled', ja)

    def test_native_protocol_settings_and_disabled_save_without_model(self):
        import shutil
        import struct
        import subprocess
        import sys
        runtime = self.root / 'runtime'
        runtime.mkdir()
        for name in ('study_translator.py', 'study_settings.py', 'study_library.py', 'study_memory.py', 'study_video.py'):
            shutil.copyfile(pathlib.Path(__file__).parent / name, runtime / name)
        shutil.copyfile(self.config, runtime / 'bridge-config.json')
        def native(payload):
            raw = json.dumps(payload).encode()
            result = subprocess.run([sys.executable, str(runtime / 'study_translator.py'), 'chrome-extension://fdibnlkfllnojcmhcghkmdlceeegmhpf/'], input=struct.pack('=I', len(raw)) + raw, capture_output=True, timeout=5)
            answer = json.loads(result.stdout[4:])
            self.assertTrue(answer['ok'], answer)
            return answer['library']
        settings = native({'action': 'librarySettingsGet'})
        settings = native({'action': 'librarySettingsSave', 'settings': {**settings, 'ankiEnabled': False, 'directory': 'Native'}})
        row = native({'action': 'librarySave', 'entry': self.entry(), 'makeCard': True, 'targetId': settings['targetId']})
        self.assertFalse(row['ankiEnabled'])
        result = native({'action': 'libraryRead', 'ids': [row['id']]})
        self.assertFalse(result['ankiEnabled'])

    def test_check_reports_file_readonly_and_symlink_without_probe_write(self):
        self.save_settings(directory='Future/Notes')
        self.assertTrue(self.library.handle({'action': 'librarySettingsCheck'})['status']['saveAvailable'])
        with patch('study_settings.os.access', return_value=False):
            self.assertFalse(self.library.handle({'action': 'librarySettingsCheck'})['status']['saveAvailable'])
        (self.vault / 'Future').write_text('not a directory')
        status = self.library.handle({'action': 'librarySettingsCheck'})['status']
        self.assertFalse(status['saveAvailable'])
        self.assertTrue(status['saveMessage'])
        (self.vault / 'Future').unlink()
        (self.vault / 'Future').symlink_to(self.root, target_is_directory=True)
        self.assertFalse(self.library.handle({'action': 'librarySettingsCheck'})['status']['saveAvailable'])

    def test_unconfigured_bridge_can_choose_first_vault_without_reinstall(self):
        self.config.write_text(json.dumps({'codex': '/fake/codex'}))
        library = YomitanLibrary(self.config, anki=self.anki)
        settings = library.handle({'action': 'librarySettingsGet'})
        self.assertEqual(settings['vault'], '')
        self.assertFalse(library.handle({'action': 'librarySettingsCheck'})['status']['saveAvailable'])
        configured = library.handle({'action': 'librarySettingsSave', 'settings': {**settings, 'vault': str(self.vault), 'ankiEnabled': False}})
        row = library.handle({'action': 'librarySave', 'entry': self.entry(), 'makeCard': False, 'targetId': configured['targetId']})
        self.assertTrue(row['vaultSaved'])
        self.assertFalse(row['ankiEnabled'])

    def test_folder_detection_uses_local_vault_registry_and_keeps_config_unchanged(self):
        home = self.root / 'home'
        registry = home / 'Library/Application Support/obsidian/obsidian.json'
        registry.parent.mkdir(parents=True)
        other = self.root / 'Other Vault'
        other.mkdir()
        registry.write_text(json.dumps({'vaults': {'one': {'path': str(other)}, 'gone': {'path': str(self.root / 'gone')}}}))
        before = self.config.read_bytes()
        with patch('study_settings.pathlib.Path.home', return_value=home):
            result = self.library.handle({'action': 'librarySettingsDetect', 'kind': 'vault', 'vault': '', 'directory': ''})
        self.assertIn(str(other), [item['path'] for item in result['items']])
        self.assertIn(str(self.vault), [item['path'] for item in result['items']])
        (self.vault / 'Articles').mkdir()
        result = self.library.handle({'action': 'librarySettingsDetect', 'kind': 'directory', 'vault': str(self.vault), 'directory': ''})
        self.assertIn('Articles', [item['path'] for item in result['items']])
        wire = self.library.handle({'action': 'librarySettingsOpen', 'folderAction': 'detect', 'kind': 'directory', 'vault': str(self.vault), 'directory': ''})
        self.assertIn('Articles', [item['path'] for item in wire['items']])
        self.assertEqual(wire['targetId'], self.settings()['targetId'])
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(self.calls, [])

    def test_both_folder_pickers_only_return_drafts_and_reject_outside_vault(self):
        import subprocess
        chosen = self.vault / 'Study Folder'
        chosen.mkdir()
        before = self.config.read_bytes()
        request = {'action': 'librarySettingsPick', 'kind': 'directory', 'vault': str(self.vault), 'directory': ''}
        with patch('study_settings.subprocess.run', return_value=subprocess.CompletedProcess([], 0, str(chosen) + '/', '')) as run:
            result = self.library.handle(request)
            self.assertEqual(result['path'], 'Study Folder')
            self.assertEqual(run.call_args.args[0][0], '/usr/bin/osascript')
        with patch('study_settings.subprocess.run', return_value=subprocess.CompletedProcess([], 0, str(self.root), '')):
            with self.assertRaisesRegex(ValueError, 'Vault'):
                self.library.handle(request)
            result = self.library.handle({**request, 'kind': 'vault'})
            self.assertEqual(result['path'], str(self.root))
        with patch('study_settings.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', 'User canceled. (-128)')):
            self.assertTrue(self.library.handle(request)['cancelled'])
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(self.calls, [])


if __name__ == '__main__': unittest.main()
