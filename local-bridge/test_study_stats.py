import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace


class TodayTests(unittest.TestCase):
    def test_today_counts_only_configured_decks_without_double_counting_children(self):
        from study_stats import anki_today
        calls = []
        settings = {'ankiEnabled': True, 'deck': '外语', 'deckByKind': {'meaning': '外语::单词', 'context': 'English "other"', 'unused': 'Missing'}}
        def anki(action, params):
            calls.append((action, params))
            if action == 'deckNames': return ['外语', '外语::单词', 'English "other"', 'Unrelated']
            if action == 'getDeckStats':
                self.assertEqual(params['decks'], ['English "other"', '外语'])
                return {1: {'name': '外语', 'new_count': 3, 'learn_count': 1, 'review_count': 9},
                        2: {'name': 'English "other"', 'new_count': 2, 'learn_count': 2, 'review_count': 11}}
            if action == 'findCards':
                self.assertIn('rated:1', params['query'])
                self.assertNotIn('Unrelated', params['query'])
                self.assertIn('deck:"English \\"other\\""', params['query'])
                return [10, 11, 11]
            raise AssertionError(action)
        result = anki_today(SimpleNamespace(settings=lambda: settings, anki=anki))
        self.assertEqual(result, {'due': 23, 'reviewed': 2, 'newDue': 5, 'decks': ['English "other"', '外语']})
        self.assertEqual([c[0] for c in calls], ['deckNames', 'getDeckStats', 'findCards'])

    def test_real_deck_id_stats_allow_an_unreadable_deck(self):
        from study_stats import anki_today
        def anki(action, params):
            if action == 'deckNames': return ['外语::单词', '外语::语境']
            if action == 'getDeckStats':
                return {'1723456789000': {'name': '外语::单词', 'new_count': 2, 'learn_count': 1, 'review_count': 4}}
            if action == 'findCards': return [123]
            self.fail(action)
        library = SimpleNamespace(settings=lambda: {'deck': '外语::单词', 'deckByKind': {'context': '外语::语境'}}, anki=anki)
        self.assertEqual(anki_today(library), {'due': 5, 'reviewed': 1, 'newDue': 2, 'decks': ['外语::单词', '外语::语境']})

    def test_closed_or_disabled_anki_reports_paused(self):
        from study_stats import anki_today
        def offline(action, params):
            raise OSError('offline')
        lib = SimpleNamespace(settings=lambda: {'ankiEnabled': True, 'deck': '外语'}, anki=offline)
        self.assertEqual(anki_today(lib), {'paused': True})
        lib.settings = lambda: {'ankiEnabled': False}
        lib.anki = lambda *_args: self.fail('disabled feature must not contact Anki')
        self.assertEqual(anki_today(lib), {'paused': True})

    def test_missing_deck_is_not_created_and_extra_request_fields_are_refused(self):
        from study_stats import anki_today
        from study_translator import normalize_request
        self.assertEqual(normalize_request({'action': 'ankiToday'}), {'action': 'ankiToday'})
        with self.assertRaises(ValueError): normalize_request({'action': 'ankiToday', 'deck': 'All'})
        calls = []
        lib = SimpleNamespace(settings=lambda: {'ankiEnabled': True, 'deck': 'Missing'},
                              anki=lambda action, params: (calls.append(action) or []))
        self.assertEqual(anki_today(lib), {'due': 0, 'reviewed': 0, 'newDue': 0, 'decks': []})
        self.assertEqual(calls, ['deckNames'])

    def test_native_action_round_trips_the_documented_shape_without_model_or_notes(self):
        import io
        import struct
        from unittest.mock import patch
        import study_translator as native
        calls = []
        def anki(action, params):
            calls.append(action)
            if action == 'deckNames': return ['外语']
            if action == 'getDeckStats': return {'1': {'name': '外语', 'new_count': 2, 'learn_count': 1, 'review_count': 4}}
            if action == 'findCards': return [123]
            self.fail(action)
        library = SimpleNamespace(settings=lambda: {'ankiEnabled': True, 'deck': '外语'}, anki=anki)
        payload = json.dumps({'action': 'ankiToday'}).encode()
        source = SimpleNamespace(buffer=io.BytesIO(struct.pack('=I', len(payload)) + payload))
        sink = SimpleNamespace(buffer=io.BytesIO())
        with patch.object(native.sys, 'argv', ['fixture', native.ORIGIN]), patch.object(native.sys, 'stdin', source), patch.object(native.sys, 'stdout', sink), patch('study_settings.YomitanLibrary', return_value=library), patch.object(native, 'configured_codex', side_effect=AssertionError('no model')):
            self.assertEqual(native.main(), 0)
        result = json.loads(sink.buffer.getvalue()[4:])
        self.assertTrue(result['ok'])
        self.assertEqual(result['library'], {'due': 5, 'reviewed': 1, 'newDue': 2, 'decks': ['外语']})
