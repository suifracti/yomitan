import unittest

from study_translator import normalize_request


class SubtitleBatchRequest(unittest.TestCase):
    def test_accepts_a_public_subtitle_batch_with_default_language(self):
        request = {
            'action': 'subtitles',
            'items': [{'id': 'line_1', 'text': 'Hello there.'}],
        }

        self.assertEqual(normalize_request(request), {
            'action': 'subtitles',
            'items': [{'id': 'line_1', 'text': 'Hello there.'}],
            'language': 'en',
        })

    def test_keeps_optional_fields_and_normalizes_config(self):
        config = {'model': 'gpt-6.1-sol', 'effort': 'low'}
        request = {
            'action': 'subtitles',
            'items': [{'id': 'A-1', 'text': 'Bonjour.'}],
            'language': 'fr-FR',
            'context': 'The preceding line.',
            'title': 'A short scene',
            'config': config,
        }

        self.assertEqual(normalize_request(request), request)

    def test_accepts_eight_items_at_the_total_text_limit(self):
        request = {
            'action': 'subtitles',
            'items': [{'id': str(i), 'text': 'x' * 750} for i in range(8)],
        }

        self.assertEqual(normalize_request(request)['items'], request['items'])

    def test_rejects_fields_and_values_outside_the_subtitle_contract(self):
        valid = {'action': 'subtitles', 'items': [{'id': 'line-1', 'text': 'Hi.'}]}
        invalid = []
        invalid.append({**valid, 'url': 'https://example.com'})
        invalid.append({**valid, 'items': []})
        invalid.append({**valid, 'items': [{'id': str(i), 'text': 'x'} for i in range(9)]})
        invalid.append({**valid, 'items': [{'id': 'bad id', 'text': 'Hi.'}]})
        invalid.append({**valid, 'items': [{'id': 'line-1', 'text': 'Hi.'}, {'id': 'line-1', 'text': 'Again.'}]})
        invalid.append({**valid, 'items': [{'id': 'line-1', 'text': ''}]})
        invalid.append({**valid, 'items': [{'id': 'line-1', 'text': 'x' * 2401}]})
        invalid.append({**valid, 'items': [{'id': str(i), 'text': 'x' * 2001} for i in range(3)]})
        invalid.append({**valid, 'context': 'x' * 1201})
        invalid.append({**valid, 'title': 'x' * 301})
        invalid.append({**valid, 'language': 'x' * 33})
        invalid.append({**valid, 'config': {'model': '../model', 'effort': 'low'}})

        for request in invalid:
            with self.subTest(request=request):
                with self.assertRaises(ValueError):
                    normalize_request(request)


if __name__ == '__main__':
    unittest.main()
