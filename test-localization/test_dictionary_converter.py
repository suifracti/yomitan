import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
class ConverterTest(unittest.TestCase):
 def test_rich_fields_remain_real_and_optional(self):
  import build_study_dictionary as b
  row=dict(word='bank',phonetic='bæŋk',translation=r'n. 银行\nn. 河岸',definition=r'n. sloping land\nn. a supply held in reserve',exchange='s:banks/p:banked',tag='zk gk',bnc='406',frq='663')
  term=b.convert(row,1)
  self.assertEqual(term[0],'bank');self.assertIn('bæŋk',str(term[5]))
  text=str(term[5]);self.assertIn('sloping land',text);self.assertIn('banks',text);self.assertIn('高考',text)
  self.assertNotIn('例句',text);self.assertNotIn('CEFR',text)
  self.assertNotIn('词形',str(b.convert(dict(word='x',translation='某词'),2)))
 def test_empty_rows_skipped_and_controls_removed(self):
  import build_study_dictionary as b
  self.assertIsNone(b.convert(dict(word=''),0))
  self.assertNotIn('\x00',str(b.convert(dict(word='foo',translation='bar\x00'),1)))
if __name__=='__main__':unittest.main()
