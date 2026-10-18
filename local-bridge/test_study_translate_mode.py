import json
import unittest
from study_translator import parse_answer

class TranslationMode(unittest.TestCase):
    def test_translation_does_not_invent_a_contextual_explanation(self):
        value = parse_answer(json.dumps({'translation':'我们改善生活。','meaning':'','notes':''}), {'action':'translate'})
        self.assertEqual(value, {'translation':'我们改善生活。','meaning':'','notes':''})
    def test_old_translation_responses_do_not_become_answers(self):
        value = parse_answer(json.dumps({'translation':'译文','meaning':'旧说明','notes':'旧解释'}), {'action':'translate'})
        self.assertEqual(value['meaning'], '')
        self.assertEqual(value['notes'], '')
    def test_explanation_still_needs_a_meaning(self):
        with self.assertRaises(ValueError):
            parse_answer(json.dumps({'translation':'译文','meaning':'','notes':''}), {'action':'explain'})

if __name__ == '__main__': unittest.main()
