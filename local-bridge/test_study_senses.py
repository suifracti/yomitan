import json
import pathlib
import time
from unittest.mock import patch

from test_study_auto_sync import AutoSyncTests


class SenseTests(AutoSyncTests):
    def test_manual_known_is_word_wide_undoable_and_never_changes_anki(self):
        first = self.save_word('run', 'I run daily.')
        self.save_word('run', 'We run together.')
        self.save_word('improve', 'I improve daily.')
        path = self.library.locate(first['id']).path(first['id'], first['entry'])
        before = path.read_text()
        self.calls.clear()
        result = self.library.handle({'action': 'libraryMarkKnown', 'word': 'run', 'known': True})
        self.assertEqual(result['updated'], 1)
        state = self.library.handle({'action': 'libraryWordStatus'})['words']['run']
        self.assertEqual((state['s'], state['manualKnown']), ('known', True))
        self.save_word('run', 'They run every morning.')
        page = self.library.handle({'action': 'libraryList', 'scope': 'manual-known', 'url': '', 'title': ''})
        self.assertEqual(page['total'], 3)
        self.assertTrue(all(row['manualKnown'] for row in page['items']))
        self.assertIn('I run daily.', path.read_text())
        self.assertIn('We run together.', path.read_text())
        old_body = before.split('<!-- english-study-word-v1:')[1].split(' -->', 1)[1]
        self.assertTrue(path.read_text().split('<!-- english-study-word-v1:')[1].split(' -->', 1)[1].startswith(old_body))
        self.library.handle({'action': 'libraryMarkKnown', 'word': 'run', 'known': False})
        self.assertEqual(self.library.handle({'action': 'libraryWordStatus'})['words']['run']['s'], 'new')
        self.assertEqual(self.library.handle({'action': 'libraryList', 'scope': 'manual-known', 'url': '', 'title': ''})['total'], 0)
        self.assertEqual(self.calls, [])
        verb = self.save_word('saw', 'I saw it.', lemma='see', meaning='看见')
        noun = self.save_word('saw', 'This saw is sharp.', meaning='锯')
        self.assertEqual(verb['path'], noun['path'])
        self.library.handle({'action': 'libraryMarkKnown', 'word': 'see', 'known': True})
        words = self.library.word_status()['words']
        self.assertEqual((words['see']['s'], words['saw']['s']), ('known', 'new'))
        listed = self.library.handle({'action': 'libraryList', 'scope': 'manual-known', 'url': '', 'title': ''})
        self.assertEqual([row['id'] for row in listed['items']], [verb['id']])

    def test_known_and_ignored_words_live_outside_vault_and_undo_without_anki(self):
        self.calls.clear()
        result = self.library.handle({'action': 'libraryMarkKnown', 'word': 'architecture', 'known': True})
        self.assertEqual(result['updated'], 0)
        path = self.library.config_path.parent / 'known-words.json'
        self.assertEqual(json.loads(path.read_text()), {'known': ['architecture'], 'ignored': []})
        self.library.handle({'action': 'knownWords', 'ignored': {'add': ['Architecture', 'Brand']}})
        status = self.library.handle({'action': 'libraryWordStatus'})['words']
        self.assertEqual(status['architecture']['s'], 'ignored')
        self.library.handle({'action': 'knownWords', 'ignored': {'remove': ['architecture']}, 'known': {'add': ['architecture']}})
        self.assertEqual(self.library.handle({'action': 'libraryWordStatus'})['words']['architecture']['s'], 'known')
        self.library.handle({'action': 'libraryMarkKnown', 'word': 'architecture', 'known': False})
        self.assertNotIn('architecture', self.library.handle({'action': 'libraryWordStatus'})['words'])
        self.assertEqual(list(self.vault.rglob('*.md')), [])
        self.assertEqual(self.calls, [])

    def test_inflected_lookup_and_cross_form_undo_keep_both_senses(self):
        familiar_gloss = ('收取费用，向顾客索要这次商品或服务所需的款项' * 2)[:40]
        old = self.save_word('charge', 'Banks charge fees.', meaning='收费', sense={'key': 'new', 'gloss': familiar_gloss})
        self.library.handle({'action': 'libraryCardsAdd', 'id': old['id'],
                             'cards': [{'kind': 'meaning', 'front': 'charge', 'back': '收费'}]})
        self.save_word('Charges', 'Two charges were dropped.', lemma='charge', meaning='指控', sense={'key': 'new', 'gloss': '指控'})
        api = self.library.anki
        self.library.anki = lambda a, p: [{**c, 'interval': 33} for c in api(a, p)] if a == 'cardsInfo' else api(a, p)
        self.library.auto_sync()
        self.calls.clear()
        senses = self.library.handle({'action': 'libraryWordSenses', 'word': 'charges'})['senses']
        self.assertEqual({r['gloss']: r['s'] for r in senses}, {familiar_gloss: 'familiar', '指控': 'new'})
        before = self.library.word_status()['words']
        self.assertEqual(before['charge']['s'], 'partial')
        self.assertEqual(before['charges']['gloss'], ('指控；' + familiar_gloss)[:40])
        self.library.handle({'action': 'libraryMarkKnown', 'word': 'charges', 'known': True})
        marked = self.library.word_status()['words']
        self.assertEqual(marked['charge'], marked['charges'])
        self.assertEqual((marked['charges']['s'], marked['charges']['iv']), ('known', 33))
        # Older bridges could also leave the clicked spelling in the manual list.
        self.library.handle({'action': 'knownWords', 'known': {'add': ['charges']}})
        self.library.handle({'action': 'libraryMarkKnown', 'word': 'charge', 'known': False})
        self.assertEqual(self.library.word_status()['words'], before)
        self.library.handle({'action': 'knownWords', 'ignored': {'add': ['charges']}})
        ignored = self.library.word_status()['words']
        self.assertEqual((ignored['charge']['s'], ignored['charges']['s']), ('ignored', 'ignored'))
        self.assertEqual(self.calls, [])

    def test_selected_sentence_uses_existing_note_save_without_anki_or_word_marks(self):
        self.calls.clear()
        record = self.save_word(word='We learn from real sentences.', sentence='We learn from real sentences.',
                                translation='我们从真实的句子学习。', kind='sentence')
        self.assertEqual(record['entry']['kind'], 'sentence')
        self.assertEqual(record['entry']['translation'], '我们从真实的句子学习。')
        self.assertEqual(record.get('cards', []), [])
        self.assertNotIn(record['entry']['word'].lower(), self.library.handle({'action': 'libraryWordStatus'})['words'])
        self.assertEqual(self.calls, [])

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
        phrase = self.save_word(word='run into', sentence='I run into an old friend.', kind='expression', baseWord='run', lemma='run', meaning='偶遇')
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
        self.assertEqual(self.library.handle({'action': 'libraryWordSenses', 'word': 'run into'})['phrases'][0]['recordId'], phrase['id'])
        self.library.handle({'action': 'libraryMarkKnown', 'word': 'run', 'known': True})
        self.assertEqual(self.library.word_status()['phrases']['run into']['s'], 'new')

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
        self.assertEqual(result, {'s': 'familiar', 'manualKnown': False, 'iv': 30, 'lapses': 4, 'senses': 1, 'gloss': '砖'})
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

    def test_large_card_faces_do_not_hide_mastery_or_get_reread_on_quiet_passes(self):
        import io
        from study_library_core import anki_call
        from study_senses import refresh_metrics, status_for
        cards = range(1, 2001)
        records = {c: (None, None, {'noteId': 10000 + c}) for c in cards}
        reviewed, detail_ids = set(), []

        def respond(request, timeout):
            payload = json.loads(request.data)
            action, p = payload['action'], payload['params']
            if action == 'findCards':
                rows = list(cards) if p['query'].startswith('nid:') else list(reviewed)
            elif action == 'cardsModTime':
                rows = [{'cardId': c, 'mod': 1100 if c in reviewed else 800} for c in p['cards']]
            elif action == 'cardsInfo':
                detail_ids.extend(p['cards'])
                rows = [{'cardId': c, 'note': 10000 + c, 'mod': 1100 if c in reviewed else 800,
                         'interval': 2 if c in reviewed else 33, 'lapses': int(c in reviewed),
                         'answer': 'x' * (21000 if c <= 100 else 2300)} for c in p['cards']]
            else:
                raise AssertionError(action)
            return io.BytesIO(json.dumps({'result': rows, 'error': None}).encode())

        with patch('urllib.request.OpenerDirector.open', side_effect=respond):
            snapshot = refresh_metrics(anki_call, records, {}, 1000)
            self.assertEqual(status_for([records[17][2]], snapshot, 1000), ('familiar', {'iv': 33, 'lapses': 0}))
            self.assertEqual(set(detail_ids), set(cards))
            detail_ids.clear()
            quiet = refresh_metrics(anki_call, records, snapshot, 1030)
            self.assertEqual(quiet['notes'], snapshot['notes'])
            self.assertEqual(detail_ids, [])
            reviewed.add(17)
            changed = refresh_metrics(anki_call, records, quiet, 1101)
            self.assertEqual(detail_ids, [17])
            self.assertEqual(status_for([records[17][2]], changed, 1101), ('shaky', {'iv': 2, 'lapses': 1}))

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
        self.assertEqual(words['run'], {'s': 'new', 'manualKnown': False, 'senses': 1, 'gloss': '跑', 'lemma': 'run'})
        row = {'entry': {'word': 'run'}, 'cards': [{'id': 'use', 'kind': 'produce', 'noteId': 1, 'state': 'synced'}]}
        snapshot = {'notes': {'1': [{'id': 10, 'iv': 30, 'lapses': 0}]}, 'at': time.time(), 'again': []}
        self.assertEqual(status_for([row], snapshot, time.time())[0], 'known')
        snapshot['incomplete'] = ['1']
        self.assertEqual(status_for([row], snapshot, time.time()), ('learning', {}))
