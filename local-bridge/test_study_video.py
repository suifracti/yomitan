import unittest, tempfile, pathlib, json, datetime
from study_video import VideoLibrary, normalize_request

class VideoTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=pathlib.Path(self.tmp.name)
        (self.root/'.obsidian').mkdir()
        (self.root/'.obsidian/daily-notes.json').write_text(json.dumps({'folder':'04-日记','format':'YYYY/MM/YYYY-MM-DD'}))
        self.lib=VideoLibrary(self.root)
        self.p={'action':'videoSave','url':'https://www.youtube.com/watch?v=abc123&t=12','title':'测试视频','language':'en','track':'English','config':{'model':'gpt-6.1-sol','effort':'low'},'subtitles':[{'start':0,'end':1000,'text':'Hello'},{'start':1000,'end':2000,'text':'world.'}]}
    def tearDown(self):self.tmp.cleanup()
    def save(self):return self.lib.handle(normalize_request(self.p))
    def test_save_idempotent_and_complete(self):
        a=self.save();b=self.save(); self.assertEqual(a['id'],b['id']); self.assertIn('测试视频',a['path'])
        calls=[]
        def model(p):
            calls.append(p);return {'items':[{'id':x['id'],'translation':'译文'+x['text']} for x in p['items']]}
        c=self.lib.translate_next(a['id'],model);self.assertEqual(c['done'],2)
        self.lib.translate_next(a['id'],model);self.assertEqual(len(calls),1)
        self.assertIn('Hello',(self.root/c['path']).read_text())
    def test_version_and_language_identity(self):
        a=self.save();self.p['language']='ja';b=self.save();self.assertNotEqual(a['id'],b['id'])
        self.assertEqual(a['videoId'],b['videoId'])
        self.p['subtitles'][0]['text']='changed';self.assertNotEqual(b['id'],self.save()['id'])
    def test_failed_model_retains_original_and_rejects_missing(self):
        a=self.save()
        with self.assertRaises(ValueError):self.lib.translate_next(a['id'],lambda p:{'items':[]})
        self.assertEqual(self.lib.handle({'action':'videoRead','id':a['id']})['done'],0)
        self.assertIn('Hello',(self.root/a['path']).read_text())
    def test_user_body_preserved_and_events_dedup(self):
        a=self.save();p=self.root/a['path'];p.write_text(p.read_text()+'\n我的手写\n')
        self.lib.translate_next(a['id'],lambda p:{'items':[{'id':x['id'],'translation':'你好'} for x in p['items']]})
        self.assertIn('我的手写',p.read_text())
        event={'action':'videoEvent','id':a['id'],'eventId':'a'*32,'at':datetime.datetime.now().timestamp()*1000,'kind':'play','position':12}
        self.lib.handle(normalize_request(event));self.lib.handle(normalize_request(event))
        daily=list((self.root/'04-日记').rglob('*.md'));self.assertEqual(len(daily),1)
        self.assertEqual(daily[0].read_text().count('开始播放'),1)
        self.assertNotIn('看完',daily[0].read_text())
    def test_invalid_path_url_and_symlink(self):
        for url in ['file:///etc/passwd','https://user:pw@example.com']:
            self.p['url']=url
            with self.assertRaises(ValueError):normalize_request(self.p)
        with self.assertRaises(ValueError):normalize_request({'action':'videoRead','id':'../x'})
    def test_model_identity_and_url_normalization(self):
        a=self.save();self.p['url']='https://youtu.be/abc123';b=self.save();self.assertEqual(a['videoId'],b['videoId'])
        self.p['config']['model']='gpt-6-sol';self.assertNotEqual(a['id'],self.save()['id'])
    def test_events_keep_original_day(self):
        a=self.save();at=(datetime.datetime.now()-datetime.timedelta(days=1)).timestamp()*1000
        e={'action':'videoEvent','id':a['id'],'eventId':'b'*32,'at':at,'kind':'pause','position':40}
        self.lib.handle(normalize_request(e));day=datetime.datetime.fromtimestamp(at/1000).strftime('%Y-%m-%d')
        self.assertEqual(next((self.root/'04-日记').rglob('*.md')).stem,day)

if __name__=='__main__':unittest.main()

class VideoBoundaryTests(unittest.TestCase):
    setUp=VideoTests.setUp
    tearDown=VideoTests.tearDown
    save=VideoTests.save
    def test_native_entry_accepts_video_language_before_generic_language_strip(self):
        from study_translator import normalize_request as native
        self.assertEqual(native(self.p)['language'],'en')
        self.p['language']='ja';self.assertEqual(native(self.p)['language'],'ja')
    def test_pages_are_bounded_and_model_does_not_receive_paths(self):
        a=self.save()
        def model(p):
            self.assertEqual(set(p),{'action','language','items','context','title','config'})
            return {'items':[{'id':x['id'],'translation':'你好'} for x in p['items']]}
        c=self.lib.translate_next(a['id'],model)
        self.assertNotIn('translations',c)
        self.assertEqual(len(self.lib.handle({'action':'videoPage','id':a['id'],'offset':0})['translations']),2)
    def test_crash_and_request_budget_require_explicit_continue(self):
        a=self.save();r=self.lib.read(a['id']);r['inflight']=True;self.lib.persist(r)
        with self.assertRaises(ValueError):self.lib.translate_next(a['id'],lambda p:None)
        self.lib.handle({'action':'videoContinue','id':a['id']})
        r=self.lib.read(a['id']);r['requests']=60;self.lib.persist(r)
        with self.assertRaises(ValueError):self.lib.translate_next(a['id'],lambda p:None)
    def test_modified_generated_block_not_overwritten(self):
        a=self.save();p=self.root/a['path'];original=p.read_text().replace('study-video-generated:start','my-new-block');p.write_text(original)
        with self.assertRaises(ValueError):self.save()
        self.assertEqual(p.read_text(),original)
    def test_symlink_state_rejected(self):
        target=self.root/'elsewhere';target.mkdir();(self.root/'02-个人与生活').symlink_to(target)
        with self.assertRaises(ValueError):self.save()
    def test_loaded_multiple_tracks_only_one_daily_activity(self):
        a=self.save();now=datetime.datetime.now().timestamp()*1000
        for ident in ['a','b']:
            self.lib.handle({'action':'videoEvent','id':a['id'],'eventId':ident*32,'at':now,'kind':'loaded','position':0})
        self.assertEqual(next((self.root/'04-日记').rglob('*.md')).read_text().count('载入字幕'),1)
    def test_native_origin_is_strict_and_asb_cannot_access_anki(self):
        import shutil, subprocess,struct
        native=self.root/'host';native.mkdir()
        for name in ('study_video.py','study_translator.py','study_library.py'):
            shutil.copyfile(pathlib.Path(__file__).parent/name,native/name)
        (native/'bridge-config.json').write_text(json.dumps({'vault':str(self.root),'codex':'/does/not/exist'}))
        def run(origin,p):
            raw=json.dumps(p).encode();out=subprocess.run([__import__('sys').executable,str(native/'study_translator.py'),origin],input=struct.pack('=I',len(raw))+raw,capture_output=True)
            return json.loads(out.stdout[4:]) if out.stdout else out.returncode
        origin='chrome-extension://bnbpbghlnjpkcjbabdmjllpcfbibjbap/'
        self.assertTrue(run(origin,self.p)['ok'])
        self.assertFalse(run(origin,{'action':'status'})['ok'])
        self.assertEqual(run('chrome-extension://untrusted/',self.p),1)

class DiaryProgressTests(unittest.TestCase):
    setUp=VideoTests.setUp
    tearDown=VideoTests.tearDown
    save=VideoTests.save
    def test_checkpoints_compact_and_out_of_order_cannot_rewind(self):
        a=self.save();now=datetime.datetime.now().timestamp()*1000
        for i in [1,2,0]:
            self.lib.handle({'action':'videoEvent','id':a['id'],'eventId':str(i)*32,'at':now-3000+i*1000,'kind':'position','position':i*60})
        body=next((self.root/'04-日记').rglob('*.md')).read_text()
        self.assertEqual(body.count('播放位置'),1)
        self.assertIn('位置 120 秒',body)
