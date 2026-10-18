import importlib.util
import pathlib
import tempfile
import unittest
import sys
import base64

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'local-bridge'))
ROOT = pathlib.Path(__file__).resolve().parents[1]
ENTRY = {'word': 'just', 'sentence': 'It is a just decision.', 'context': '',
         'meaning': '公正的', 'translation': '这是一个公正的决定。', 'notes': '',
         'url': 'https://example.com/article', 'title': 'Article'}


class LibraryTests(unittest.TestCase):
    def setUp(self):
        path = ROOT / 'local-bridge/study_library.py'
        self.assertTrue(path.exists(), 'Obsidian library not implemented')
        spec = importlib.util.spec_from_file_location('study_library', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = pathlib.Path(self.tmp.name)
        self.cards = {}
        self.offline = False
        self.ambiguous = False

        def anki(action, params):
            if self.offline:
                raise OSError('offline')
            if action == 'deckNames':
                return ['外语::英语语境', '外语::日语语境', 'Cloze Deck', 'Default Deck']
            if action == 'storeMediaFile':
                return params['filename']
            if action == 'findNotes':
                return [i for i, n in self.cards.items() if params['query'][4:] in n['tags']]
            if action == 'addNote':
                note = params['note']
                if not note.get('options', {}).get('allowDuplicate') and any(n['fields']['Word'] == note['fields']['Word'] for n in self.cards.values()):
                    raise ValueError('first field duplicate')
                ident = 123 + len(self.cards)
                self.cards[ident] = note
                if self.ambiguous:
                    self.ambiguous = False
                    raise TimeoutError('written but response lost')
                return ident
            if action == 'notesInfo':
                return [{'noteId': i, 'cards': [i], 'modelName': self.cards[i].get('modelName'), 'fields': {k: {'value': v} for k, v in self.cards[i]['fields'].items()}}
                        for i in params['notes']]
            if action == 'cardsInfo':
                return [{'cardId': i, 'deckName': self.cards[i].get('deckName', '外语::英语语境')} for i in params['cards']]
            if action in ('updateNote', 'updateNoteFields'):
                note = params['note']
                self.cards[note['id']]['fields'].update(note['fields'])
                return None
            raise AssertionError(action)

        self.lib = self.module.StudyLibrary(self.vault, anki=anki)

    def test_short_dictionary_translation_saved_with_source_and_not_mislabeled_as_raw_dictionary(self):
        excerpt='词典英文：To become something different.\nAI 辅助中文：变得不同；发生变化。'
        saved=self.save({**ENTRY,'dictionaryTranslation':excerpt})
        body=(self.vault/saved['path']).read_text()
        self.assertIn('> 词典英文：To become something different.',body)
        self.assertIn('> AI 辅助中文：变得不同；发生变化。',body)
        self.assertIn('词典原文与 AI 辅助中文（非语境解释）',body)
        self.assertEqual(saved['entry']['dictionaryTranslation'],excerpt)
        again=self.save({**ENTRY,'dictionaryTranslation':excerpt})
        self.assertEqual((self.vault/again['path']).read_text().count('> AI 辅助中文：变得不同；发生变化。'),1)

    def test_feedback_event_and_real_usage_save_without_duplicate_answer(self):
        t={'id':'turn-abcdef','at':'2026-10-09T17:00:00+08:00','question':'Why?', 'translation':'中文','meaning':'含义','notes':'UNIQUEANSWER','feedback':'unconfirmed',
           'usage':{'requestId':'a'*32,'status':'completed','inputTokens':100,'outputTokens':30,'totalTokens':130}}
        saved=self.lib.handle({'action':'librarySave','entry':ENTRY,'makeCard':False,'turns':[t]})
        feedback={**t,'id':'feedback-abcdef','kind':'feedback','relatedTurnId':t['id'],'translation':'','meaning':'','notes':'','feedback':'understood'}
        feedback.pop('usage')
        request={'action':'librarySave','entry':ENTRY,'makeCard':False,'turns':[feedback]}
        self.lib.handle(request);self.lib.handle(request)
        body=(self.vault/saved['path']).read_text()
        self.assertEqual(body.count('UNIQUEANSWER'),1)
        self.assertEqual(body.count('## 理解反馈'),1)
        self.assertIn('输入 100 / 输出 30',body)
        self.assertIn('轮次 ID：turn-abcdef',body)
        self.assertEqual(self.cards,{})
        with self.assertRaises(ValueError):self.lib.handle({**request,'turns':[{**feedback,'notes':'repeated answer'}]})

    def save(self, entry=ENTRY, make_card=False):
        return self.lib.handle({'action': 'librarySave', 'entry': entry, 'makeCard': make_card})

    def test_first_note_write_failure_never_publishes_partial_file_and_can_retry(self):
        import os
        from unittest.mock import patch

        real_fdopen = os.fdopen

        class PartialWriteFailure:
            def __init__(self, stream):
                self.stream = stream

            def __enter__(self):
                self.stream.__enter__()
                return self

            def __exit__(self, *args):
                return self.stream.__exit__(*args)

            def __getattr__(self, name):
                return getattr(self.stream, name)

            def write(self, value):
                self.stream.write(value[:max(1, len(value) // 2)])
                raise OSError('injected partial first-write failure')

        with patch.object(os, 'fdopen', side_effect=lambda fd, *args, **kwargs: PartialWriteFailure(real_fdopen(fd, *args, **kwargs))):
            with self.assertRaisesRegex(OSError, 'partial first-write failure'):
                self.save()

        records = self.vault / self.lib.relative / '记录'
        self.assertEqual(list(records.glob('*--*.md')), [])
        self.assertEqual(list(records.glob('.study-*')), [])
        saved = self.save()
        body = (self.vault / saved['path']).read_text()
        self.assertIn('It is a just decision.', body)
        self.assertEqual(len(list(records.glob('*--*.md'))), 1)

        record = {'id': 'a' * 32, 'entry': ENTRY, 'ankiState': 'saved', 'noteId': None, 'created': saved['created']}
        target = self.lib.path(record['id'], record['entry'])
        real_link = os.link

        def create_conflict(source, destination):
            pathlib.Path(destination).write_text('user-owned file')
            return real_link(source, destination)

        with patch.object(os, 'link', side_effect=create_conflict):
            with self.assertRaises(FileExistsError):
                self.lib.write(record, 'replacement')
        self.assertEqual(target.read_text(), 'user-owned file')
        self.assertEqual(list(records.glob('.study-*')), [])

    def test_persistent_review_draft_is_notes_first_survives_reopen_and_commits_only_selection(self):
        saved = self.save()
        draft = self.lib.handle({'action':'libraryDraftSave','items':[{'id':saved['id'],'version':saved['version'],
            'reason':'针对本人困惑', 'cards':[{'front':'just在原句是什么意思？','back':'公正的','selected':True},
                {'front':'这句搭配是什么？','back':'a just decision','selected':False}]}]})['items'][0]
        self.assertEqual(self.cards, {})
        self.assertEqual(draft['target']['deck'], '外语::英语语境')
        self.assertIn('复习草稿', (self.vault/draft['path']).read_text())
        reopened = self.module.StudyLibrary(self.vault, anki=self.lib.anki).result(saved['id'])
        self.assertEqual(reopened['reviewDraft'], draft['reviewDraft'])
        p={'action':'libraryDraftCommit','items':[{'id':draft['id'],'version':draft['version'],'draftId':draft['reviewDraft']['id']}]}
        self.offline=True
        pending=self.lib.handle(p)['items'][0]
        self.assertEqual(pending['ankiState'],'pending');self.assertEqual(self.cards,{})
        self.assertEqual(len(pending['cards']),1)
        self.assertEqual(len(pending['reviewDraft']['cards']),2,'unselected suggestions retained')
        with self.assertRaises(ValueError): self.lib.handle(p)
        self.offline=False;self.lib.handle({'action':'librarySync','ids':[draft['id']]})
        self.lib.handle({'action':'librarySync','ids':[draft['id']]})
        self.assertEqual(len(self.cards),1)
        self.assertEqual(next(iter(self.cards.values()))['deckName'],'外语::英语语境')
        self.assertIn('已确认复习卡',self.lib.material(saved['id'])['confirmedCards'])

    def test_review_draft_rejects_stale_human_edits_and_bad_requests(self):
        saved=self.save()
        payload={'action':'libraryDraftSave','items':[{'id':saved['id'],'version':saved['version'],'reason':'reason',
            'cards':[{'front':'q','back':'a','selected':True}]}]}
        draft=self.lib.handle(payload)['items'][0]
        path=self.vault/draft['path'];path.write_text(path.read_text()+'\n本人新的理解，不得覆盖\n')
        current=self.lib.result(saved['id']);self.assertTrue(current['draftStale'])
        with self.assertRaises(ValueError):self.lib.handle(payload)
        with self.assertRaises(ValueError):self.lib.handle({'action':'libraryDraftCommit','items':[{'id':current['id'],'version':current['version'],'draftId':current['reviewDraft']['id']}]})
        cleared=self.lib.handle({'action':'libraryDraftDiscard','items':[{'id':current['id'],'version':current['version']}]})['items'][0]
        self.assertNotIn('reviewDraft',cleared);self.assertIn('本人新的理解',path.read_text());self.assertEqual(self.cards,{})
        with self.assertRaises(ValueError):self.lib.handle({'action':'libraryDraftSave','items':[{'id':cleared['id'],'version':cleared['version'],'reason':'r','cards':[{'front':'q','back':'a','selected':True}],'deck':'evil'}]})

    def test_saved_video_learning_note_links_to_existing_material_only(self):
        from study_video import VideoLibrary
        video=VideoLibrary(self.vault)
        p={'action':'videoSave','url':'https://www.youtube.com/watch?v=abc','title':'Video','language':'en','track':'English','config':{'model':'gpt-6.1-sol','effort':'low'},'subtitles':[{'start':0,'end':1000,'text':'It is a just decision.'}]}
        material=video.handle(p)
        record=self.save({**ENTRY,'url':p['url'],'videoTime':0})
        body=(self.vault/record['path']).read_text()
        self.assertIn(material['videoId']+'|视频材料与完整字幕',body)
        again=self.save({**ENTRY,'url':p['url'],'videoTime':0})
        self.assertEqual((self.vault/again['path']).read_text().count('|视频材料与完整字幕'),1)

    def test_japanese_setup_is_explicit_idempotent_and_preserves_existing_models(self):
        models = {}; decks = []; writes = []
        def api(action, params):
            if action == 'modelNames': return list(models)
            if action == 'modelFieldNames': return models[params['modelName']]
            if action == 'deckNames': return decks[:]
            if action == 'createModel':
                models[params['modelName']] = params['inOrderFields']; writes.append(action); return {}
            if action == 'createDeck':
                decks.append(params['deck']); writes.append(action); return 123
            raise AssertionError(action)
        lib = self.module.StudyLibrary(self.vault, anki=api)
        p = {'action': 'libraryPrepareJapanese', 'language': 'ja'}
        lib.handle(p); lib.handle(p)
        self.assertEqual(writes, ['createModel', 'createDeck'])
        self.assertIn('Expression', models['日语语境卡'])
        self.assertFalse(list(self.vault.rglob('*.md')))
        models['日语语境卡'] = ['My Own Field']
        with self.assertRaises(ValueError): lib.handle(p)
        self.assertEqual(models['日语语境卡'], ['My Own Field'])

    def test_japanese_card_uses_separate_question_and_expression(self):
        saved = self.save({**ENTRY, 'language': 'ja', 'word': '食べた', 'lemma': '食べる', 'reading': 'たべる',
                           'sentence': '朝ご飯を食べた。', 'meaning': '吃过了', 'dictionaryNotes': 'た形 → 食べる'})
        result = self.lib.handle({'action': 'libraryCards', 'language': 'ja', 'items': [
            {'id': saved['id'], 'version': saved['version'], 'cards': [{'front': '食べた 的原形是什么？', 'back': '食べる。'}]}]})
        self.assertEqual(result['items'][0]['ankiState'], 'synced')
        note = next(iter(self.cards.values()))
        self.assertEqual(note['deckName'], '外语::日语语境')
        self.assertEqual(note['fields']['Question'], '食べた 的原形是什么？')
        self.assertEqual(note['fields']['Expression'], '食べる')
        self.assertEqual(note['fields']['Reading'], 'たべる')
        memory = self.lib.handle({'action': 'libraryMemory', 'language': 'ja', 'word': '食べます', 'lemma': '食べる'})
        self.assertEqual([x['id'] for x in memory['items']], [saved['id']])

    def test_media_binds_to_saved_record_not_last_card_and_rejects_bad_data(self):
        a = self.save({**ENTRY, 'videoTime': 12})
        b = self.save({**ENTRY, 'sentence': 'I just arrived.'})
        media = {'action': 'libraryMedia', 'id': a['id'], 'version': a['version'],
                 'start': 11, 'end': 15, 'origin': 'import',
                 'assets': [{'kind': 'image', 'mime': 'image/png',
                             'data': base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'fixture').decode()}]}
        a = self.lib.handle(media)
        self.assertIn('![[', (self.vault / a['path']).read_text())
        self.assertEqual(self.lib.handle(media)['version'], a['version'], 'retry after lost reply must be idempotent')
        filename = a['media']['image']['name']
        self.assertTrue((self.vault / filename).is_file())
        media['version'] = a['version']
        self.lib.handle(media)
        self.assertEqual(len(list(self.vault.glob('study-media-*'))), 1)
        self.lib.handle({'action': 'librarySync', 'ids': [b['id'], a['id']]})
        self.assertEqual(self.cards[123]['fields']['Image'], '')
        self.assertIn(filename, self.cards[124]['fields']['Image'])
        media['assets'][0]['data'] = base64.b64encode(b'<script>bad</script>').decode()
        with self.assertRaises(ValueError):
            self.lib.handle(media)
        self.assertEqual((self.vault / filename).read_bytes(), b'\x89PNG\r\n\x1a\nfixture')

    def test_languages_are_isolated_and_english_identity_is_stable(self):
        en = self.save()
        self.assertEqual(en['id'], self.save({**ENTRY, 'language': 'en'})['id'])
        ja = self.save({**ENTRY, 'language': 'ja', 'lemma': '食べる', 'reading': 'たべる',
                        'dictionaryNotes': '原形：食べる；読み：たべる；音調未收录'})
        self.assertNotEqual(en['id'], ja['id'])
        self.assertNotIn('05-英语', ja['path'])
        self.assertIn('たべる', (self.vault / ja['path']).read_text())
        for lang, ident in [('en', en['id']), ('ja', ja['id'])]:
            rows = self.lib.handle({'action': 'libraryMemory', 'word': ENTRY['word'], 'language': lang})
            self.assertEqual([r['id'] for r in rows['items']], [ident])
        with self.assertRaises(ValueError):
            self.save({**ENTRY, 'language': 'auto'})
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.lib.handle({'action': 'libraryRead', 'ids': [ja['id']]})

    def test_save_is_readable_idempotent_and_preserves_user_notes(self):
        a = self.save()
        p = self.vault / a['path']
        self.assertIn('It is a just decision.', p.read_text())
        self.assertIn('公正的', p.read_text())
        p.write_text(p.read_text() + '\n我自己的理解，不要覆盖。\n')
        b = self.save()
        self.assertEqual(a['id'], b['id'])
        self.assertIn('我自己的理解', p.read_text())
        self.assertEqual(self.cards, {})
        self.save({**ENTRY, 'notes': '公正的，与副词刚刚区分。'})
        self.assertIn('公正的，与副词刚刚区分。', p.read_text())
        self.assertIn('我自己的理解', p.read_text())
        c = self.save({**ENTRY, 'sentence': 'I just arrived.'})
        self.assertNotEqual(a['id'], c['id'])

    def test_offline_then_ambiguous_write_retry_creates_only_one_card(self):
        self.offline = True
        a = self.save(make_card=True)
        self.assertEqual(a['ankiState'], 'pending')
        self.assertTrue((self.vault / a['path']).is_file())
        self.offline = False
        self.ambiguous = True
        b = self.lib.handle({'action': 'librarySync', 'ids': [a['id']]})['items'][0]
        self.assertEqual(b['ankiState'], 'pending')
        c = self.lib.handle({'action': 'librarySync', 'ids': [a['id']]})['items'][0]
        self.assertEqual(c['ankiState'], 'synced')
        self.assertEqual(c['noteId'], 123)
        self.assertEqual(len(self.cards), 1)
        self.assertIn('obsidian://open?', self.cards[123]['fields']['Source'])
        self.assertEqual(self.cards[123]['fields']['Audio'], '')

    def test_source_list_and_ai_append_require_matching_version(self):
        a = self.save()
        self.save({**ENTRY, 'url': 'https://example.com/other'})
        rows = self.lib.handle({'action': 'libraryList', 'url': ENTRY['url'], 'title': ENTRY['title']})['items']
        self.assertEqual(len(rows), 1)
        patch = {'id': a['id'], 'version': rows[0]['version'], 'text': '形容词 just 表示公正。'}
        p = self.vault / a['path']
        original = p.read_text()
        p.write_text(original + '\n我的新增备注\n')
        with self.assertRaises(ValueError):
            self.lib.handle({'action': 'libraryEnrich', 'items': [patch]})
        self.assertIn('我的新增备注', p.read_text())
        patch['version'] = self.lib.handle({'action': 'libraryList', 'url': ENTRY['url'], 'title': ENTRY['title']})['items'][0]['version']
        self.lib.handle({'action': 'libraryEnrich', 'items': [patch]})
        self.assertIn('我的新增备注', p.read_text())
        self.assertIn('形容词 just 表示公正', p.read_text())

    def test_same_word_in_two_contexts_is_not_rejected_as_a_duplicate(self):
        a = self.save({**ENTRY, 'notes': '深入解释：' + '详细辨析。' * 100}, make_card=True)
        b = self.save({**ENTRY, 'sentence': 'I just arrived.', 'meaning': '刚刚'}, make_card=True)
        self.assertEqual(a['ankiState'], 'synced')
        self.assertEqual(b['ankiState'], 'synced')
        self.assertNotEqual(a['noteId'], b['noteId'])
        self.assertEqual(len(self.cards), 2)
        self.assertNotIn('深入解释', self.cards[a['noteId']]['fields']['Definition'])
        self.assertIn('深入解释', (self.vault / a['path']).read_text())

    def test_path_injection_symlink_and_unknown_files_fail_without_overwrite(self):
        with self.assertRaises(ValueError):
            self.lib.handle({'action': 'librarySync', 'ids': ['../../Secrets']})
        with self.assertRaises(ValueError):
            self.save({**ENTRY, 'path': '/tmp/evil'})
        with self.assertRaises(ValueError):
            self.save({**ENTRY, 'url': 'file:///etc/passwd'})
        a = self.save()
        p = self.vault / a['path']
        p.write_text('用户自己建的文件，不是程序记录')
        with self.assertRaises(ValueError):
            self.save()
        self.assertEqual(p.read_text(), '用户自己建的文件，不是程序记录')
        p.unlink()
        secret = self.vault / 'private.txt'
        secret.write_text('private')
        p.symlink_to(secret)
        with self.assertRaises(ValueError):
            self.save()
        self.assertEqual(secret.read_text(), 'private')

    def test_learning_turns_are_durable_idempotent_and_retrievable_with_user_notes(self):
        turn = {'id': 'turn-000001', 'at': '2026-10-09T05:00:00Z', 'question': '为什么不是刚刚？',
                'translation': '这是公正的决定。', 'meaning': '公正的', 'notes': '这里修饰名词 decision。', 'feedback': 'unconfirmed'}
        request = {'action': 'librarySave', 'entry': ENTRY, 'makeCard': False, 'turns': [turn]}
        a = self.lib.handle(request)
        self.lib.handle(request)
        p = self.vault / a['path']
        self.assertEqual(p.read_text().count('为什么不是刚刚？'), 1)
        p.write_text(p.read_text() + '\n我现在懂了：先判断词性。\n')
        self.save({**ENTRY, 'word': 'unrelated', 'notes': 'DO_NOT_READ_ME'})
        memory = self.lib.handle({'action': 'libraryMemory', 'word': 'JUST'})
        self.assertEqual(memory['total'], 1)
        self.assertIn('为什么不是刚刚？', memory['items'][0]['text'])
        self.assertIn('我现在懂了', memory['items'][0]['text'])
        self.assertNotIn('DO_NOT_READ_ME', str(memory))
        self.assertNotIn('https://', memory['items'][0]['text'])
        selected = self.lib.handle({'action': 'libraryRead', 'ids': [a['id']]})
        self.assertIn('先判断词性', selected['items'][0]['text'])
        self.assertEqual(self.cards, {})
        invalid = {**turn, 'id': 'turn-000002', 'feedback': 'model-says-mastered'}
        with self.assertRaises(ValueError):
            self.lib.handle({**request, 'turns': [invalid]})

    def test_confirmed_card_drafts_persist_before_anki_and_retry_without_duplicates(self):
        a = self.save()
        item = {'id': a['id'], 'version': a['version'], 'cards': [
            {'front': 'just 在 It is a just decision 中是什么词性？', 'back': '形容词，修饰 decision，表示公正的。'},
            {'front': 'I just arrived 中 just 表示什么？', 'back': '刚刚；这里是副词。'}]}
        self.offline = True
        r = self.lib.handle({'action': 'libraryCards', 'items': [item]})['items'][0]
        self.assertEqual(r['ankiState'], 'pending')
        self.assertEqual(len(r['cards']), 2)
        self.assertIn('是什么词性', (self.vault / a['path']).read_text())
        self.offline = False
        self.ambiguous = True
        r = self.lib.handle({'action': 'librarySync', 'ids': [a['id']]})['items'][0]
        self.assertEqual(r['ankiState'], 'pending')
        r = self.lib.handle({'action': 'librarySync', 'ids': [a['id']]})['items'][0]
        self.assertEqual(r['ankiState'], 'synced')
        self.assertEqual(len(self.cards), 2)
        self.assertTrue(all(c['noteId'] for c in r['cards']))
        self.assertIn('obsidian://open?', self.cards[123]['fields']['Source'])
        with self.assertRaises(ValueError):
            self.lib.handle({'action': 'libraryCards', 'items': [item]})  # stale preview
        item['version'] = r['version']
        self.lib.handle({'action': 'libraryCards', 'items': [item]})
        self.assertEqual(len(self.cards), 2)

    def test_native_protocol_saves_without_starting_codex(self):
        import json, shutil, struct, subprocess, sys
        runtime = self.vault / 'runtime'
        runtime.mkdir()
        for name in ['study_translator.py', 'study_library.py', 'study_library_core.py', 'study_sync.py', 'study_note_view.py', 'study_settings.py', 'study_video.py', 'study_memory.py', 'study_media.py', 'study_japanese.py']:
            shutil.copyfile(ROOT / 'local-bridge' / name, runtime / name)
        (runtime / 'bridge-config.json').write_text(json.dumps({'vault': str(self.vault), 'codex': '/nonexistent/do-not-start'}))
        request = json.dumps({'action': 'librarySave', 'entry': ENTRY, 'makeCard': False}).encode()
        result = subprocess.run([sys.executable, str(runtime / 'study_translator.py'), 'chrome-extension://fdibnlkfllnojcmhcghkmdlceeegmhpf/'],
                                input=struct.pack('=I', len(request)) + request, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        length = struct.unpack('=I', result.stdout[:4])[0]
        answer = json.loads(result.stdout[4:4 + length])
        self.assertTrue(answer['ok'])
        self.assertTrue((self.vault / answer['library']['path']).is_file())


    def test_reading_field_omitted_when_same_as_word_and_included_when_phonetic(self):
        saved_plain = self.save({**ENTRY, 'word': 'improve', 'reading': 'improve', 'lemma': 'improve'})
        body_plain = (self.vault / saved_plain['path']).read_text()
        self.assertNotIn('词典读音', body_plain, 'English reading matching headword must not be labeled as pronunciation')
        self.assertEqual(saved_plain['entry']['reading'], 'improve', 'Raw metadata field remains preserved')

        saved_ipa = self.save({**ENTRY, 'word': 'improve', 'reading': '/ɪmˈpruːv/', 'lemma': 'improve', 'url': 'https://example.com/ipa'})
        body_ipa = (self.vault / saved_ipa['path']).read_text()
        self.assertIn('词典读音', body_ipa)
        self.assertIn('/ɪmˈpruːv/', body_ipa)

    def test_review_draft_distinguishes_confirmed_pending_and_zero_card(self):
        saved = self.save()
        payload = {'action': 'libraryDraftSave', 'items': [{
            'id': saved['id'], 'version': saved['version'], 'reason': '语境明确，选一张核心句型卡',
            'cards': [
                {'front': 'Q1: front', 'back': 'A1: back', 'selected': True},
                {'front': 'Q2: unselected', 'back': 'A2: unselected', 'selected': False}
            ]
        }]}
        draft = self.lib.handle(payload)['items'][0]
        commit_payload = {'action': 'libraryDraftCommit', 'items': [{
            'id': draft['id'], 'version': draft['version'], 'draftId': draft['reviewDraft']['id']
        }]}
        self.offline = True
        pending = self.lib.handle(commit_payload)['items'][0]
        body_pending = (self.vault / pending['path']).read_text()
        self.assertIn('候选已确认（等待送入 Anki）', body_pending)
        self.assertIn('候选未勾选', body_pending)
        self.assertNotIn('候选未勾选\n\n> Q1: front', body_pending)

        self.offline = False
        synced = self.lib.handle({'action': 'librarySync', 'ids': [pending['id']]})['items'][0]
        body_synced = (self.vault / synced['path']).read_text()
        self.assertIn('候选已确认（Anki 已同步）', body_synced)

        zero_saved = self.save({**ENTRY, 'url': 'https://example.com/zero'})
        zero_payload = {'action': 'libraryDraftSave', 'items': [{
            'id': zero_saved['id'], 'version': zero_saved['version'], 'reason': '用户已完全掌握，无需新卡',
            'cards': []
        }]}
        zero_draft = self.lib.handle(zero_payload)['items'][0]
        body_zero = (self.vault / zero_draft['path']).read_text()
        self.assertIn('本次无需新增复习卡（正常零卡）。', body_zero)

    def test_direct_save_without_ai_turns_writes_explicit_notice_and_no_blank_section(self):
        saved = self.lib.handle({'action': 'librarySave', 'entry': ENTRY, 'makeCard': False, 'turns': []})
        body = (self.vault / saved['path']).read_text()
        self.assertIn('本次未进行 AI 语境消歧（直接以词典泛义保存）。', body)
        self.assertNotIn('## 我的理解与问题\n\n##', body)
        self.assertNotIn('### 我的理解与问题\n\n###', body)
        self.assertIn('含义（保存时的解释）', body)
        self.assertIn(ENTRY['meaning'], body)

    def test_note_only_then_qa_then_card_then_more_qa_preserves_point(self):
        saved = self.lib.handle({'action':'librarySave','entry':ENTRY,'makeCard':False,'turns':[]})
        self.assertEqual(len(self.cards), 0)
        first = {'id':'late-qa-1','at':'2026-10-18T12:00:00Z','question':'第一次追问',
                 'translation':'第一版译文','meaning':'第一版语境含义','notes':'第一轮说明','feedback':'unconfirmed'}
        updated = self.lib.handle({'action':'libraryUpdate','id':saved['id'],'language':'en',
                                  'entry':{'translation':first['translation'],'meaning':first['meaning']},'turns':[first]})
        self.assertEqual(updated['id'], saved['id'])
        self.assertEqual(len(self.cards), 0)
        made = self.lib.handle({'action':'libraryCardsAdd','id':saved['id'],'language':'en',
                               'cards':[{'front':'What does just mean here?','back':'独立确认的复习答案','kind':'context'}]})
        note_id = made['cards'][0]['noteId']
        second = {**first,'id':'late-qa-2','question':'第二次追问','translation':'第二版译文','meaning':'第二版语境含义'}
        self.lib.handle({'action':'libraryUpdate','id':saved['id'],'language':'en',
                         'entry':{'translation':second['translation'],'meaning':second['meaning']},'turns':[second]})
        reconciled = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en'})
        self.assertEqual(reconciled['syncState'], 'synced')
        self.assertEqual(len(self.cards), 1)
        self.assertEqual(reconciled['cards'][0]['noteId'], note_id)
        fields = self.cards[note_id]['fields']
        self.assertIn('第二版译文', fields['Definition'])
        self.assertIn('第二版语境含义', fields['Definition'])
        self.assertIn('独立确认的复习答案', fields['Definition'])
        self.assertIn('What does just mean here?', fields['Word'])
        body = (self.vault / reconciled['path']).read_text()
        self.assertIn('第一次追问', body)
        self.assertIn('第二次追问', body)

    def test_pending_card_resubmission_uses_original_ids_and_no_duplicates(self):
        saved = self.save()
        item = {'id': saved['id'], 'version': saved['version'], 'cards': [
            {'front': 'Q: front', 'back': 'A: back'}
        ]}
        self.offline = True
        pending = self.lib.handle({'action': 'libraryCards', 'items': [item]})['items'][0]
        card_id = pending['cards'][0]['id']
        self.assertEqual(pending['ankiState'], 'pending')
        self.assertEqual(pending['cards'][0]['state'], 'pending')
        self.assertIsNone(pending['cards'][0]['noteId'])

        self.offline = False
        synced = self.lib.handle({'action': 'librarySync', 'ids': [saved['id']]})['items'][0]
        self.assertEqual(synced['id'], saved['id'])
        self.assertEqual(synced['cards'][0]['id'], card_id)
        self.assertEqual(synced['cards'][0]['state'], 'synced')
        self.assertIsNotNone(synced['cards'][0]['noteId'])
        self.assertEqual(len(self.cards), 1)

        # Resync again must be completely idempotent, no duplicate cards created
        resync = self.lib.handle({'action': 'librarySync', 'ids': [saved['id']]})['items'][0]
        self.assertEqual(len(self.cards), 1)
        self.assertEqual(resync['cards'][0]['noteId'], synced['cards'][0]['noteId'])


    def test_favorite_only_is_idempotent_and_explicit_save_reuses_same_context(self):
        entry = {**ENTRY, 'word': 'focus', 'sentence': 'Focus on the task.'}
        favorite = self.lib.handle({'action':'libraryFavorite','entry':entry,'favorite':True,'language':'en'})
        self.assertTrue(favorite['favorite'])
        self.assertEqual(favorite['learningState'], 'favorite-only')
        again = self.lib.handle({'action':'libraryFavorite','entry':entry,'favorite':True,'language':'en'})
        self.assertEqual(favorite['id'], again['id'])
        saved = self.lib.handle({'action':'librarySave','entry':entry,'makeCard':False,'turns':[]})
        self.assertEqual(favorite['id'], saved['id'])
        self.assertEqual(len(list(self.lib.records.glob('*.md'))), 1)
        self.assertEqual(saved['learningState'], 'saved')
        bookmark_entry = {**ENTRY, 'word':'bookmark', 'sentence':'Bookmark this context.'}
        bookmark = self.lib.handle({'action':'libraryFavorite','entry':bookmark_entry,'favorite':True,'language':'en'})
        appended = self.lib.handle({'action':'libraryUpdate','id':bookmark['id'],'language':'en','entry':{'translation':'整理后的译文'}})
        self.assertEqual(appended['learningState'], 'favorite-only')
        remembered = self.lib.handle({'action':'libraryUpdate','id':bookmark['id'],'language':'en','entry':{},'remember':True})
        self.assertEqual(remembered['learningState'], 'saved')
        self.assertTrue(remembered['favorite'])
        unstarred = self.lib.handle({'action':'libraryFavorite','id':saved['id'],'favorite':False,'language':'en'})
        self.assertFalse(unstarred['favorite'])
        self.assertEqual(unstarred['learningState'], 'saved')
        self.assertTrue((self.vault / saved['path']).is_file())

    def test_partial_update_keeps_unspecified_fields_and_distinguishes_translate_turn(self):
        saved = self.save()
        update = self.lib.handle({'action':'libraryUpdate','id':saved['id'],'language':'en',
            'entry':{'translation':'更新后的译文'},
            'turns':[{'id':'translate-1','at':'2026-10-18T12:00:00+08:00','question':'','translation':'新译文','meaning':'','notes':'','feedback':'unconfirmed','mode':'translate'}]})
        self.assertEqual(update['entry']['translation'], '更新后的译文')
        self.assertEqual(update['entry']['meaning'], ENTRY['meaning'])
        body = (self.vault / update['path']).read_text()
        self.assertIn('翻译过程', body)
        self.assertEqual(body.count('## 翻译过程'), 1)
        self.assertEqual(self.cards, {})

    def test_deck_by_kind_is_preserved_in_target_and_card_target_uses_actual_anki_deck(self):
        from study_settings import target_fields
        target = target_fields({'vault':str(self.vault),'directory':'custom-study','deck':'Default Deck',
                               'model':'外语语境卡','deckByKind':{'cloze':'Cloze Deck'}})
        self.assertEqual(target['deckByKind']['cloze'], 'Cloze Deck')
        lib = self.module.StudyLibrary(self.vault, anki=self.lib.anki,
             target={**target, 'ankiEnabled':True})
        saved = lib.handle({'action':'librarySave','entry':{**ENTRY,'url':'https://example.com/deck'},'makeCard':False,'turns':[]})
        result = lib.handle({'action':'libraryCardsAdd','id':saved['id'],'language':'en','cards':[
            {'front':'just','back':'公正的','kind':'cloze'}]})
        self.assertEqual(result['cards'][0]['target']['deck'], 'Cloze Deck')
        self.assertEqual(result['cards'][0]['target']['targetId'], target['targetId'])


    def test_draft_kind_survives_commit_and_routes_to_configured_deck(self):
        from study_settings import target_fields
        target = target_fields({'vault':str(self.vault),'directory':'kind-study','deck':'Default Deck',
                               'model':'外语语境卡','deckByKind':{'cloze':'Cloze Deck'}})
        lib = self.module.StudyLibrary(self.vault, anki=self.lib.anki,
             target={**target, 'ankiEnabled':True}, group_words=True)
        saved = lib.handle({'action':'librarySave','entry':{**ENTRY,'url':'https://example.com/kind'},'makeCard':False,'turns':[]})
        draft = lib.handle({'action':'libraryDraftSave','items':[{'id':saved['id'],'version':saved['version'],'reason':'需要复习','cards':[
            {'front':'Complete this phrase','back':'a just decision','kind':'cloze','selected':True}]}]})['items'][0]
        committed = lib.handle({'action':'libraryDraftCommit','items':[{'id':saved['id'],'version':draft['version'],'draftId':draft['reviewDraft']['id']}]})['items'][0]
        self.assertEqual(committed['cards'][0]['kind'],'cloze')
        self.assertEqual(committed['cards'][0]['target']['deck'],'Cloze Deck')
        import study_sync
        self.assertEqual(study_sync.default_card_kind({'sentence':'a real sentence'}),'context')
        self.assertEqual(study_sync.default_card_kind({'sentence':''}),'meaning')

    def test_manual_cards_are_persisted_independently_and_reconciled_from_anki(self):
        saved = self.save()
        result = self.lib.handle({'action':'libraryCardsAdd','id':saved['id'],'language':'en','cards':[
            {'front':'What does just mean here?','back':'公正的','kind':'meaning'},
            {'front':'Complete: a just decision','back':'a just decision','kind':'cloze'}]})
        self.assertEqual(len(result['cards']), 2)
        self.assertEqual(len(self.cards), 2)
        self.assertEqual(len({c['id'] for c in result['cards']}), 2)
        self.assertTrue(all(c.get('target',{}).get('deck') == '外语::英语语境' for c in result['cards']))
        card = result['cards'][0]
        self.cards[card['noteId']]['fields']['Word'] = 'What does just mean in this sentence?'
        reconciled = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en'})
        self.assertEqual(reconciled['syncState'], 'synced')
        self.assertEqual(reconciled['cards'][0]['front'], 'What does just mean in this sentence?')
        self.assertEqual(reconciled.get('conflicts'), [])
        path = self.vault / reconciled['path']
        body = path.read_text().replace('##### 问题\n\n> What does just mean in this sentence?', '##### 问题\n\n> What does just mean now?')
        path.write_text(body)
        edited = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en'})
        self.assertEqual(edited['cards'][0]['front'], 'What does just mean now?')
        self.assertEqual(self.cards[card['noteId']]['fields']['Word'], 'What does just mean now?')


    def test_legacy_card_front_edit_keeps_record_identity(self):
        saved = self.save(make_card=True)
        path = self.vault / saved['path']
        body = path.read_text()
        body = body.replace('##### 问题\n\n> just', '##### 问题\n\n> JUST')
        path.write_text(body)
        updated = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en'})
        self.assertEqual(updated['id'], saved['id'])
        self.assertEqual(updated['legacyCard']['front'], 'JUST')
        self.assertEqual(self.cards[saved['noteId']]['fields']['Word'], 'JUST')
        with self.assertRaises(ValueError):
            self.lib.handle({'action':'libraryUpdate','id':saved['id'],'entry':{'word':'another'}})
        self.assertEqual(self.lib.result(saved['id'])['entry']['word'], 'just')

    def test_reconcile_conflict_waits_for_explicit_resolution(self):
        saved = self.save()
        result = self.lib.handle({'action':'libraryCardsAdd','id':saved['id'],'language':'en','cards':[
            {'front':'What does just mean here?','back':'公正的','kind':'meaning'}]})
        path = self.vault / result['path']
        body = path.read_text().replace('#### 本句含义\n\n> 公正的', '#### 本句含义\n\n> 本地含义')
        path.write_text(body)
        note_id = result['cards'][0]['noteId']
        self.cards[note_id]['fields']['Definition'] = self.cards[note_id]['fields']['Definition'].replace('本句含义<br>公正的', '本句含义<br>远程含义')
        conflict = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en'})
        self.assertEqual(conflict['syncState'], 'conflict')
        self.assertTrue(any(x['key'] == 'meaning' for x in conflict['conflicts']))
        resolved = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en','resolutions':{'meaning':'local'}})
        self.assertEqual(resolved['syncState'], 'synced')
        self.assertIn('本句含义<br>本地含义', self.cards[note_id]['fields']['Definition'])

    def test_different_shared_anki_values_report_each_card_id_and_can_choose_local(self):
        saved = self.save()
        result = self.lib.handle({'action':'libraryCardsAdd','id':saved['id'],'language':'en','cards':[
            {'front':'What does just mean here?','back':'公正的','kind':'meaning'},
            {'front':'Complete: a just decision','back':'a just decision','kind':'cloze'}]})
        for i, card in enumerate(result['cards']):
            self.cards[card['noteId']]['fields']['Sentence'] = f'Remote variant {i}'
        conflict = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en'})
        sentence_conflicts = [x for x in conflict['conflicts'] if x['key'].startswith('sentence:')]
        self.assertEqual({x['key'].split(':',1)[1] for x in sentence_conflicts}, {c['id'] for c in result['cards']})
        resolutions = {x['key']:'local' for x in sentence_conflicts}
        resolved = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en','resolutions':resolutions})
        self.assertEqual(resolved['syncState'], 'synced')
        self.assertTrue(all(self.cards[c['noteId']]['fields']['Sentence'] == ENTRY['sentence'] for c in result['cards']))

    def test_sync_fields_are_visible_and_editable_in_both_apps(self):
        saved = self.save()
        result = self.lib.handle({'action':'libraryCardsAdd','id':saved['id'],'language':'en','cards':[
            {'front':'What does just mean here?','back':'公正的','kind':'meaning'}]})
        path = self.vault / result['path']
        text = path.read_text()
        self.assertIn('#### 原句译文', text)
        self.assertNotIn('```study-sync-json', text)
        self.assertIn('data-study-sync="translation"', self.cards[result['cards'][0]['noteId']]['fields']['Definition'])
        text = text.replace('#### 原句译文\n\n> 这是一个公正的决定。', '#### 原句译文\n\n> 这是公允的决定。')
        path.write_text(text)
        updated = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en'})
        self.assertEqual(updated['entry']['translation'], '这是公允的决定。')
        note = self.cards[updated['cards'][0]['noteId']]
        self.assertIn('这是公允的决定。', note['fields']['Definition'])
        note['fields']['Definition'] = note['fields']['Definition'].replace('这是公允的决定。', '远端更新的译文')
        updated = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en'})
        self.assertEqual(updated['entry']['translation'], '远端更新的译文')
        self.assertIn('> 远端更新的译文', path.read_text())

    def test_blank_optional_routes_keep_legacy_target_identity(self):
        from study_settings import target_fields
        original = {'vault':str(self.vault),'directory':'study','deck':'Default','model':'Study'}
        base = target_fields(original)
        routed = target_fields({**original,'deckByKind':{kind:'' for kind in ('meaning','context','expression','grammar','sentence','listening')}})
        self.assertEqual(base, routed)

    def test_reconcile_missing_anki_is_pending_not_success(self):
        saved = self.save(make_card=True)
        self.offline = True
        updated = self.lib.handle({'action':'libraryReconcile','id':saved['id'],'language':'en'})
        self.assertEqual(updated['syncState'], 'pending')
        self.assertIn('Anki', updated['error'])


    def test_one_shared_edit_updates_other_cards_and_partial_retry_has_no_false_conflict(self):
        saved = self.save()
        row = self.lib.handle({'action':'libraryCardsAdd','id':saved['id'],'cards':[
            {'front':'Point A','back':'Answer A','kind':'context'}, {'front':'Point B','back':'Answer B','kind':'sentence'}]})
        self.cards[row['cards'][0]['noteId']]['fields']['Sentence'] = 'An edited real sentence.'
        row = self.lib.handle({'action':'libraryReconcile','id':row['id']})
        self.assertEqual(row['syncState'],'synced')
        self.assertTrue(all(self.cards[c['noteId']]['fields']['Sentence'] == 'An edited real sentence.' for c in row['cards']))
        self.lib.handle({'action':'libraryUpdate','id':row['id'],'entry':{'translation':'新的共享译文'}})
        original = self.lib.anki
        fail = [True]
        second = row['cards'][1]['noteId']
        def uncertain(action, params):
            if action == 'updateNoteFields' and params['note']['id'] == second and fail[0]:
                fail[0] = False
                raise OSError('temporary offline')
            return original(action, params)
        self.lib.anki = uncertain
        pending = self.lib.handle({'action':'libraryReconcile','id':row['id']})
        self.assertEqual(pending['syncState'],'pending')
        retried = self.lib.handle({'action':'libraryReconcile','id':row['id']})
        self.assertEqual(retried['syncState'],'synced')
        self.assertEqual(retried['conflicts'],[])
        self.assertTrue(all('新的共享译文' in self.cards[c['noteId']]['fields']['Definition'] for c in retried['cards']))
        self.assertEqual(len(self.cards),2)

    def test_associated_card_does_not_replace_another_context_source(self):
        first = self.save()
        owner = self.lib.handle({'action':'libraryCardsAdd','id':first['id'],'cards':[{'front':'Meaning?','back':'公正的','kind':'meaning'}]})
        second = self.save({**ENTRY,'sentence':'A different context for just.','url':'https://example.com/second'})
        record, body, version = self.lib.read(second['id'])
        record['cards'] = [{**owner['cards'][0], 'linkedExisting':True, 'linkedByPoint':True}]
        self.lib.write(record,body,version)
        result = self.lib.handle({'action':'libraryReconcile','id':second['id']})
        self.assertEqual(result['entry']['sentence'],'A different context for just.')
        self.assertEqual(self.cards[owner['cards'][0]['noteId']]['fields']['Sentence'],ENTRY['sentence'])
        self.assertTrue(result['cards'][0]['reviewOnly'])

    def test_missing_deck_preserves_manual_card_without_auto_creation(self):
        saved = self.save()
        row = self.lib.handle({'action':'libraryCardsAdd','id':saved['id'],'cards':[{'front':'Question?','back':'Answer','kind':'meaning','deck':'Missing Deck'}]})
        self.assertEqual(row['ankiState'],'pending')
        self.assertEqual(len(row['cards']),1)
        self.assertEqual(self.cards,{})
        self.assertIn('牌组不存在',row['cards'][0]['error'])

    def test_obisidian_star_edit_is_readable_even_with_anki_disabled(self):
        row = self.lib.handle({'action':'libraryFavorite','entry':ENTRY,'favorite':True})
        path = self.vault / row['path']
        path.write_text(path.read_text().replace('#### 收藏\n\n> 是','#### 收藏\n\n> 否'))
        self.lib.anki_enabled = False
        result = self.lib.result(row['id'])
        self.assertFalse(result['favorite'])
        self.assertEqual(result['learningState'],'favorite-only')


if __name__ == '__main__':
    unittest.main()

