"""Template application tests with fake AnkiConnect, not a real collection."""
import copy, importlib.util, json, pathlib, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('view',ROOT/'tools'/'apply-study-card-view.py');view=importlib.util.module_from_spec(spec);spec.loader.exec_module(view)
class ViewTests(unittest.TestCase):
 def setUp(self):
  self.templates={'语境回忆':{'Front':'OLD FRONT','Back':'OLD BACK'}};self.css={'css':'old'};self.calls=[];self.fields=list(view.FIELDS)
 def api(self,action,params):
  self.calls.append(action)
  if action=='modelFieldNames':return self.fields.copy()
  if action=='modelTemplates':return copy.deepcopy(self.templates)
  if action=='modelStyling':return self.css.copy()
  if action=='updateModelTemplates':self.templates.update(copy.deepcopy(params['model']['templates']));return None
  if action=='updateModelStyling':self.css={'css':params['model']['css']};return None
  raise AssertionError('Unexpected operation: '+action)
 def test_check_is_read_only(self):
  view.inspect('外语语境卡',self.api);self.assertEqual(set(self.calls),{'modelFieldNames','modelTemplates','modelStyling'})
 def test_apply_updates_view_only_and_backs_up(self):
  old=view.inspect('外语语境卡',self.api);token=view.fingerprint(old)
  with tempfile.TemporaryDirectory() as temp:
   result=view.apply_view('外语语境卡',None,token,temp,self.api)
   self.assertEqual(json.loads(pathlib.Path(result['backup']).read_text()),old)
   self.assertEqual(self.fields,view.FIELDS)
   self.assertNotIn('addNote',self.calls);self.assertNotIn('answerCards',self.calls)
   self.assertIn('sr-question',self.templates['语境回忆']['Front'])
 def test_changed_templates_not_overwritten(self):
  old=view.inspect('外语语境卡',self.api);token=view.fingerprint(old);self.templates['语境回忆']['Front']='MY EDIT'
  with tempfile.TemporaryDirectory() as temp:
   with self.assertRaisesRegex(ValueError,'已变化'):view.apply_view('外语语境卡',None,token,temp,self.api)
  self.assertEqual(self.templates['语境回忆']['Front'],'MY EDIT')
 def test_wrong_schema_refused(self):
  self.fields+=['Extra']
  with self.assertRaisesRegex(ValueError,'七字段'):view.inspect('外语语境卡',self.api)
 def test_multiple_templates_are_not_restyled(self):
  self.templates['其他卡型']={'Front':'OTHER','Back':'OTHER'};token=view.fingerprint(view.inspect('外语语境卡',self.api))
  with tempfile.TemporaryDirectory() as temp:
   with self.assertRaisesRegex(ValueError,'多个'):view.apply_view('外语语境卡',None,token,temp,self.api)
   with self.assertRaisesRegex(ValueError,'多个'):view.apply_view('外语语境卡','语境回忆',token,temp,self.api)
  self.assertNotIn('updateModelStyling',self.calls)
 def test_front_never_contains_definition_or_media(self):
  front=(view.ASSETS/'front.html').read_text();self.assertNotIn('{{Definition}}',front);self.assertNotIn('{{Image}}',front);self.assertNotIn('{{Audio}}',front)
if __name__=='__main__':unittest.main(verbosity=2)
