import json,pathlib,struct,subprocess,sys,tempfile,unittest
class Shutdown(unittest.TestCase):
 def test_completed_response_exits_cleanly_while_chrome_stdin_is_open(self):
  bridge=pathlib.Path(__file__).resolve().parents[1]/'local-bridge'
  script="""import sys,os,pathlib,time
sys.path.insert(0,sys.argv[1]);import study_translator as t
from types import SimpleNamespace
t.configured_codex=lambda:'FAKE'
class Fake:
 def __init__(self,*args):self.process=SimpleNamespace(pid=2147483647)
 def translate(self,*args):time.sleep(.05);return {'translation':'test','meaning':'test','notes':''}
 def close(self):pass
 def usage(self):return {'status':'unknown'}
t.AppServer=Fake
sys.argv=['test',t.ORIGIN]
sys.exit(t.main())
"""
  with tempfile.TemporaryDirectory() as home:
   (pathlib.Path(home)/'Library/Application Support/EnglishStudyTranslator').mkdir(parents=True)
   import os
   p=subprocess.Popen([sys.executable,'-c',script,str(bridge)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'HOME':home})
   try:
    raw=json.dumps({'action':'explain','sentence':'It is just.','word':'just','context':'','question':'Meaning?'}).encode();p.stdin.write(struct.pack('=I',len(raw))+raw);p.stdin.flush()
    head=p.stdout.read(4);self.assertEqual(len(head),4,p.stderr.read().decode() if len(head)!=4 else '');n=struct.unpack('=I',head)[0];r=json.loads(p.stdout.read(n));self.assertTrue(r['ok'])
    self.assertEqual(p.wait(timeout=5),0,p.stderr.read().decode())
   finally:
    if p.poll() is None:p.kill();p.wait()
    p.stdin.close();p.stdout.close();p.stderr.close()
if __name__=='__main__':unittest.main()
