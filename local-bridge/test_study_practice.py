import json
from unittest.mock import patch
from test_study_auto_sync import AutoSyncTests


class PracticeTests(AutoSyncTests):
    def request(self):
        from study_translator import normalize_request
        self.ident = self.make_card()
        return normalize_request({'action': 'practiceCheck', 'id': self.ident, 'kind': 'make-sentence',
            'prompt': '用 brick 造句', 'answer': 'A brick are red.', 'config': {'model': 'fixture', 'effort': 'low'}})

    def test_check_appends_once_and_leaves_cards_and_other_contexts_unchanged(self):
        from study_practice import check_practice
        from study_translator import turn_params, parse_answer
        request = self.request()
        other = self.library.handle({'action': 'librarySave', 'makeCard': False,
            'entry': {'word': 'brick', 'sentence': 'I bought a brick.', 'url': 'https://example.test'}})
        lib = self.library.locate(self.ident)
        before = lib.read(self.ident)[0]
        other_before = lib.read(other['id'])
        notes = json.loads(json.dumps(self.notes))
        calls = []
        def model(payload):
            calls.append(payload)
            self.assertNotIn('id', payload)
            self.assertEqual(set(payload['material']), {'word', 'sentence', 'meaning', 'translation', 'language'})
            self.assertNotIn(str(self.vault), json.dumps(payload))
            self.assertEqual(turn_params('fixture', payload)['outputSchema']['required'], ['verdict', 'corrected', 'reason'])
            # A note can change while the model works; append to its fresh version.
            record, body, version = lib.read(self.ident)
            lib.write(record, body + '\n本人新笔记。\n', version)
            return parse_answer(json.dumps({'verdict': 'almost', 'corrected': 'A brick is red.', 'reason': '单数主语用 is。'}), payload)
        result = check_practice(self.library, request, model)
        self.assertEqual(result, {'verdict': 'almost', 'corrected': 'A brick is red.', 'reason': '单数主语用 is。'})
        self.assertEqual(check_practice(self.library, request, model), result)
        self.assertEqual(len(calls), 1)
        record, body, _ = lib.read(self.ident)
        self.assertIn('### 练习', body)
        self.assertIn('本人新笔记。', body)
        self.assertEqual(len(record['practice']), 1)
        self.assertEqual(record['cards'], before['cards'])
        self.assertEqual(lib.read(other['id']), other_before)
        self.assertEqual(json.loads(json.dumps(self.notes)), notes)

    def test_finished_result_survives_write_failure_and_retry_does_not_regenerate(self):
        from study_practice import check_practice
        request = self.request()
        model_calls = []
        result = {'verdict': 'wrong', 'corrected': 'A brick is red.', 'reason': '注意主谓一致。'}
        def model(_payload):
            model_calls.append(True)
            return result
        with patch('study_library.StudyLibrary.write', side_effect=OSError('fixture write failure')):
            failed = check_practice(self.library, request, model)
        self.assertFalse(failed['saved'])
        self.assertEqual(failed['corrected'], result['corrected'])
        self.assertEqual(check_practice(self.library, request, model), result)
        self.assertEqual(len(model_calls), 1)
        self.assertEqual(len(self.library.locate(self.ident).read(self.ident)[0]['practice']), 1)

    def test_validation_and_missing_record_fail_before_model(self):
        from study_translator import normalize_request, parse_answer
        from study_practice import check_practice
        request = self.request()
        for changes in ({'kind': 'cards'}, {'answer': ''}, {'prompt': 'a' * 2401}, {'config': {'model': 'fixture'}}, {'extra': 'no'}):
            with self.assertRaises(ValueError): normalize_request({**request, **changes})
        with self.assertRaises(ValueError): parse_answer(json.dumps({'verdict': 'known', 'corrected': '', 'reason': 'bad'}), request)
        with self.assertRaises(ValueError):
            check_practice(self.library, {**request, 'id': 'f' * 32}, lambda *_: self.fail('missing record must not call model'))

    def test_native_dispatch_uses_selected_record_and_optional_model_only(self):
        import io
        import struct
        from types import SimpleNamespace
        import study_translator as native
        request = self.request()
        payload = json.dumps(request).encode()
        source = SimpleNamespace(buffer=io.BytesIO(struct.pack('=I', len(payload)) + payload))
        sink = SimpleNamespace(buffer=io.BytesIO())
        result = {'verdict': 'good', 'corrected': '', 'reason': '表达正确。'}
        with patch.object(native.sys, 'argv', ['fixture', native.ORIGIN]), patch.object(native.sys, 'stdin', source), patch.object(native.sys, 'stdout', sink), patch('study_settings.YomitanLibrary', return_value=self.library), patch.object(native, 'run_optional_model', return_value=result) as model:
            native.main()
        self.assertEqual(json.loads(sink.buffer.getvalue()[4:]), {'ok': True, 'library': result})
        self.assertEqual(model.call_count, 1)

    def test_model_uses_current_note_fields_not_stale_metadata(self):
        from study_practice import check_practice
        from study_sync import local_fields, with_local_fields
        request = self.request()
        lib = self.library.locate(self.ident)
        record, body, version = lib.read(self.ident)
        fields = {**local_fields(record, body), 'sentence': 'Fresh brick context.', 'meaning': '本人修改后的意思'}
        lib.write(record, with_local_fields(body, fields), version)
        def model(payload):
            self.assertEqual(payload['material']['sentence'], 'Fresh brick context.')
            self.assertEqual(payload['material']['meaning'], '本人修改后的意思')
            return {'verdict': 'good', 'corrected': '', 'reason': '表达正确。'}
        check_practice(self.library, request, model)
