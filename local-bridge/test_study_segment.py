import json
import unittest

from study_translator import normalize_request, parse_answer, segment_groups_valid


def request(n=3):
    return normalize_request({'action': 'segment', 'items': [{'id': f'c{i}', 'text': f'part {i}'} for i in range(n)], 'config': {'model': 'gpt-6.1-sol', 'effort': 'low'}})


class SegmentRequest(unittest.TestCase):
    def test_normalizes_and_keeps_config(self):
        payload = request()
        self.assertEqual(payload['action'], 'segment')
        self.assertEqual([row['id'] for row in payload['items']], ['c0', 'c1', 'c2'])
        self.assertEqual(payload['language'], 'en')

    def test_rejects_single_rows_and_unknown_fields(self):
        with self.assertRaises(ValueError):
            request(1)
        with self.assertRaises(ValueError):
            normalize_request({'action': 'segment', 'items': [{'id': 'a', 'text': 'x'}, {'id': 'b', 'text': 'y'}], 'title': 'x'})

    def test_groups_must_cover_every_row_in_order(self):
        ids = ['c0', 'c1', 'c2']
        self.assertTrue(segment_groups_valid(ids, [['c0', 'c1'], ['c2']]))
        self.assertFalse(segment_groups_valid(ids, [['c0'], ['c2', 'c1']]))
        self.assertFalse(segment_groups_valid(ids, [['c0', 'c1']]))
        self.assertFalse(segment_groups_valid(ids, [['c0'], [], ['c1', 'c2']]))

    def test_parse_answer_rejects_reordered_groups(self):
        payload = request()
        self.assertEqual(parse_answer(json.dumps({'groups': [['c0'], ['c1', 'c2']]}), payload), {'groups': [['c0'], ['c1', 'c2']]})
        with self.assertRaises(ValueError):
            parse_answer(json.dumps({'groups': [['c1'], ['c0', 'c2']]}), payload)


if __name__ == '__main__':
    unittest.main()
