import json
import pathlib
import time
from unittest.mock import patch

from test_study_auto_sync import AutoSyncTests


class SenseTests(AutoSyncTests):
    def save_word(self, word='run', sentence='I run daily.', **extra):
        return self.library.handle({'action': 'librarySave', 'makeCard': False,
            'entry': {'word': word, 'sentence': sentence, 'meaning': '跑', 'url': 'https://example.test/learn', **extra}})

    def test_new_senses_are_idempotent_and_old_notes_are_not_migrated(self):
        old = self.save_word()
        path = self.vault / old['path']
        before = path.read_bytes()
        senses = self.library.handle({'action': 'libraryWordSenses', 'word': 'run', 'language': 'en'})
        self.assertEqual(path.read_bytes(), before)
        first_key = senses['senses'][0]['key']
        new = self.save_word(sentence='I run a shop.', sense={'key': 'new', 'gloss': '经营'})
        again = self.save_word(sentence='I run a shop.', sense={'key': 'new', 'gloss': '经营'})
        self.assertEqual(new['id'], again['id'])
        self.assertEqual(new['entry']['sense'], again['entry']['sense'])
        self.assertNotEqual(first_key, new['entry']['sense']['key'])
        self.assertIn('义项', path.read_text())
        self.assertNotIn('sense', self.library.locate(old['id']).read(old['id'])[0]['entry'])
        listed = self.library.handle({'action': 'libraryWordSenses', 'word': 'run', 'language': 'en'})
        self.assertEqual(len(listed['senses']), 2)

    def test_phrase_and_context_misses_are_recorded_without_cards(self):
        word = self.save_word(sense={'key': 'new', 'gloss': '跑'})
        phrase = self.save_word(word='run into', sentence='I run into an old friend.', kind='expression', baseWord='run', meaning='偶遇')
        self.assertIn('关联原词：[run](obsidian://open?', (self.vault / phrase['path']).read_text())
        key = word['entry']['sense']['key']
        for kind in ['newSense', 'collocation', 'structure', 'recall']:
            result = self.library.handle({'action': 'libraryContextMiss', 'word': 'run', 'lemma': 'run', 'kind': kind,
                                         'senseKey': key, 'sentence': 'I run daily.', 'url': 'https://example.test/learn', 'videoTime': 12.5})
            self.assertEqual(result, {'ok': True})
        result = self.library.handle({'action': 'libraryWordSenses', 'word': 'run'})
        self.assertEqual(result['misses'], {'newSense': 1, 'collocation': 1, 'structure': 1, 'recall': 1})
        self.assertEqual(result['senses'][0]['s'], 'shaky')
        self.assertEqual(result['phrases'][0]['text'], 'run into')
        self.assertEqual(self.notes, {})
        status = self.library.handle({'action': 'libraryWordStatus'})
        self.assertEqual(status['version'], 2)
        self.assertIn('run into', status['phrases'])
        self.assertNotIn('run into', status['words'])
        self.assertEqual(self.library.locate(phrase['id']).result(phrase['id'])['entry']['baseWord'], 'run')

    def test_mastery_uses_actual_intervals_and_recent_again_not_just_card_stage(self):
        ident = self.make_card()
        note_id = next(iter(self.notes))
        original = self.library.anki
        interval = 30
        again = []
        def anki(action, params):
            if action == 'cardsInfo':
                return [{'cardId': c, 'note': note_id, 'interval': interval, 'lapses': 4, 'deckName': '外语'} for c in params['cards']]
            if action == 'findCards' and 'rated:30:1' in params.get('query', ''):
                return again
            return original(action, params)
        self.library.anki = anki
        self.library.auto_sync()
        result = self.library.handle({'action': 'libraryWordStatus'})['words']['brick']
        self.assertEqual(result, {'s': 'familiar', 'iv': 30, 'lapses': 4, 'senses': 1, 'gloss': '砖'})
        self.library.handle({'action': 'libraryContextMiss', 'word': 'brick', 'kind': 'structure'})
        self.assertEqual(self.library.word_status()['words']['brick']['s'], 'familiar')
        again.append(note_id * 10)
        self.library.auto_sync()
        self.assertEqual(self.library.word_status()['words']['brick']['s'], 'shaky')
        again.clear()
        interval = 2
        self.library.auto_sync()
        self.assertEqual(self.library.word_status()['words']['brick']['s'], 'learning')
        new = self.save_word(word='brick', sentence='A brick of cheese.', sense={'key': 'new', 'gloss': '砖状物'})
        interval = 40
        self.library.auto_sync()
        self.assertEqual(self.library.word_status()['words']['brick']['s'], 'partial')
        self.assertEqual(self.notes.keys(), {note_id})

    def test_optional_sense_match_uses_only_explicit_calls_and_cache(self):
        from study_senses import match_sense
        from study_translator import normalize_request, parse_answer, turn_params
        word = self.save_word(sense={'key': 'new', 'gloss': '跑'})
        request = normalize_request({'action': 'senseMatch', 'word': 'run', 'sentence': 'I run daily.',
                                     'contextMeaning': '跑', 'config': {'model': 'fixture', 'effort': 'low'}})
        calls = []
        key = word['entry']['sense']['key']
        def model(payload):
            calls.append(payload)
            self.assertEqual(turn_params('fixture', payload)['outputSchema']['required'], ['match', 'confidence'])
            return parse_answer(json.dumps({'match': key, 'confidence': .8}), payload)
        first = match_sense(self.library, request, model)
        self.assertEqual(first, {'match': key, 'confidence': .8})
        self.assertEqual(match_sense(self.library, request, model), first)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.notes, {})
        with self.assertRaises(ValueError):
            parse_answer(json.dumps({'match': 'wrong#99', 'confidence': .5}), calls[0])

    def test_new_sense_in_the_same_sentence_does_not_inherit_old_cards(self):
        ident = self.make_card()
        old = self.library.locate(ident).result(ident)
        entry = {**old['entry'], 'sense': {'key': 'new', 'gloss': '另一意思'}}
        new = self.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})
        again = self.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})
        self.assertNotEqual(new['id'], old['id'])
        self.assertEqual(again['id'], new['id'])
        self.assertEqual(new.get('cards', []), [])
        self.assertEqual(len(self.library.locate(ident).result(ident)['cards']), 1)

    def test_recall_event_expires_after_thirty_days(self):
        from study_senses import add_miss, senses, MONTH
        self.save_word(sense={'key': 'new', 'gloss': '跑'})
        now = time.time()
        add_miss(self.library, {'word': 'run', 'kind': 'recall'}, now=now - MONTH - 1)
        self.assertEqual(senses(self.library, 'run', now=now)['senses'][0]['s'], 'new')

    def test_aliases_share_v2_value_and_known_requires_a_mature_use_card(self):
        from study_senses import status_for
        self.save_word(word='Runs', sentence='She runs daily.', lemma='run', sense={'key': 'new', 'gloss': '跑'})
        words = self.library.word_status()['words']
        self.assertEqual(words['run'], words['runs'])
        self.assertEqual(set(words['run']), {'s', 'senses', 'gloss'})
        row = {'entry': {'word': 'run'}, 'cards': [{'id': 'use', 'kind': 'produce', 'noteId': 1, 'state': 'synced'}]}
        snapshot = {'notes': {'1': [{'id': 10, 'iv': 30, 'lapses': 0}]}, 'at': time.time(), 'again': []}
        self.assertEqual(status_for([row], snapshot, time.time())[0], 'known')
        snapshot['incomplete'] = ['1']
        self.assertEqual(status_for([row], snapshot, time.time()), ('learning', {}))
