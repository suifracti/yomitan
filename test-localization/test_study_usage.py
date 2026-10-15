import unittest,sys,pathlib,tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'local-bridge'))
class UsageTests(unittest.TestCase):
 def test_actual_usage_replaces_notifications_and_unknown_is_not_zero(self):
  from study_usage import Ledger,normalize_usage
  with tempfile.TemporaryDirectory() as d:
   l=Ledger(pathlib.Path(d)/'usage.sqlite3');ident=l.start('explain','test-model')
   a={'inputTokens':100,'outputTokens':30,'totalTokens':130,'cachedInputTokens':60,'reasoningOutputTokens':20}
   l.update(ident,normalize_usage(a),'running');l.update(ident,normalize_usage(a),'completed')
   l.start('subtitles','test-model')
   self.assertEqual(l.stats()['requests'],2);self.assertEqual(l.stats()['totalTokens'],130);self.assertEqual(l.stats()['unknown'],1)
   self.assertEqual(l.get(ident)['cachedInputTokens'],60)
   with self.assertRaises(ValueError):normalize_usage({**a,'totalTokens':True})
   with self.assertRaises(ValueError):normalize_usage({**a,'inputTokens':-1})
if __name__=='__main__':unittest.main()
