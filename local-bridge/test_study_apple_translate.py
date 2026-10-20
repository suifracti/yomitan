import json
import pathlib
import stat
import tempfile
import unittest

from study_apple_translate import translate
from study_translator import normalize_request


def fake_helper(directory, output, status=0):
    path = pathlib.Path(directory) / 'apple-translate'
    path.write_text('#!/bin/sh\ncat > /dev/null\nprintf %s ' + json.dumps(json.dumps(output)) + '\nexit ' + str(status) + '\n')
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


class AppleTranslateRequest(unittest.TestCase):
    def test_normalizes_a_batch_through_the_bridge_entry(self):
        request = {'action': 'appleTranslate', 'items': [{'id': 'a', 'text': ' Keep going. '}]}
        self.assertEqual(normalize_request(request), {'action': 'appleTranslate', 'items': [{'id': 'a', 'text': 'Keep going.'}], 'language': 'en'})

    def test_rejects_extra_fields_duplicates_and_oversized_batches(self):
        with self.assertRaises(ValueError):
            normalize_request({'action': 'appleTranslate', 'items': [{'id': 'a', 'text': 'x'}], 'config': {}})
        with self.assertRaises(ValueError):
            normalize_request({'action': 'appleTranslate', 'items': [{'id': 'a', 'text': 'x'}, {'id': 'a', 'text': 'y'}]})
        with self.assertRaises(ValueError):
            normalize_request({'action': 'appleTranslate', 'items': [{'id': str(i), 'text': 'x'} for i in range(9)]})

    def test_maps_translations_back_to_row_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            helper = fake_helper(directory, {'translations': ['继续前进。', '大脑可以改变。']})
            payload = normalize_request({'action': 'appleTranslate', 'items': [{'id': 'a', 'text': 'Keep going.'}, {'id': 'b', 'text': 'The brain can change.'}]})
            self.assertEqual(translate(payload, helper), {'items': [{'id': 'a', 'translation': '继续前进。'}, {'id': 'b', 'translation': '大脑可以改变。'}]})

    def test_explains_a_missing_language_pack(self):
        with tempfile.TemporaryDirectory() as directory:
            helper = fake_helper(directory, {'error': 'x', 'code': 'download'}, 3)
            payload = normalize_request({'action': 'appleTranslate', 'items': [{'id': 'a', 'text': 'Keep going.'}]})
            with self.assertRaisesRegex(ValueError, '语言包'):
                translate(payload, helper)

    def test_missing_helper_asks_to_reinstall(self):
        payload = normalize_request({'action': 'appleTranslate', 'items': [{'id': 'a', 'text': 'Keep going.'}]})
        with self.assertRaisesRegex(ValueError, '安装本机翻译桥'):
            translate(payload, '/nonexistent/apple-translate')


if __name__ == '__main__':
    unittest.main()
