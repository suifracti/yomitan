import base64, io, json, math, os, pathlib, re, struct, tempfile, wave
from playwright.sync_api import sync_playwright
import test_study_library as library_fixture
import test_study_settings as settings_fixture
ROOT=pathlib.Path(__file__).resolve().parents[1];assets=ROOT/'assets/study-review'
OUTPUT=pathlib.Path(os.environ.get('STUDY_UI_OUTPUT') or tempfile.mkdtemp(prefix='study-card-view-test-'))
(OUTPUT/'previews').mkdir(parents=True,exist_ok=True)
CSS=(assets/'card.css').read_text()
fields={'Word':'ability to do something 是什么意思？句中 ability to fall asleep 指什么？','Sentence':"I don't know if people can relate to this, but once I start doing something purposefully, I end up losing ability to fall asleep.",'Definition':'表示「做某事的能力」；ability to fall asleep 指「入睡的能力」。常见完整表达是 the ability to fall asleep。','Source':'学习材料示例 · <a href="obsidian://open?vault=demo&file=ability">我的学习笔记</a>','URL':'https://example.org/reading','Audio':'发音示例','Image':'画面示例'}
def render_text(text,data):
 text=re.sub(r'{{#(\w+)}}(.*?){{/\1}}',lambda m:m[2] if data.get(m[1]) else '',text,flags=re.S)
 return re.sub(r'{{(\w+)}}',lambda m:data.get(m[1],''),text)
def render(name,data):
 return render_text((assets/(name+'.html')).read_text(),data)

def check_listening(page):
 """One temporary recording, a spelling card and a normal card made from the same note."""
 study=library_fixture.LibraryTests();study.setUp()
 settings=settings_fixture.SettingsTests();settings.setUp()
 try:
  settings.models.clear()
  settings.library.handle({'action':'librarySettingsPrepare','createDeck':False,'createModel':True})
  model=next(params for action,params in settings.calls if action=='createModel')
  template=model['cardTemplates'][0]
  saved=study.save();wav=io.BytesIO()
  with wave.open(wav,'wb') as tone:
   tone.setparams((1,2,8000,0,'NONE','not compressed'))
   tone.writeframes(b''.join(struct.pack('<h',int(4000*math.sin(i*2*math.pi*440/8000))) for i in range(2000)))
  attached=study.lib.handle({'action':'libraryMedia','id':saved['id'],'version':saved['version'],'start':1,'end':1.25,'origin':'import',
                             'assets':[{'kind':'audio','mime':'audio/wav','data':base64.b64encode(wav.getvalue()).decode()}]})
  cards=[{'kind':'spelling','front':'听原声，拼写这个词。','back':'just'},{'kind':'meaning','front':'just','back':'公正的'}]
  study.lib.handle({'action':'libraryCardsAdd','id':saved['id'],'cards':cards})
  assert study.lib.handle({'action':'libraryReconcile','id':saved['id']})['syncState']=='synced'
  listening,text_card=(n['fields'] for n in study.cards.values())
  def show(side,values):
   file=study.vault/'review.html'
   file.write_text('<meta charset="utf-8"><style>'+model['css']+'</style>'+render_text(template[side],values))
   page.goto(file.as_uri())
  show('Front',listening)
  assert listening['Sentence'] not in page.locator('body').inner_text(), 'unflipped listening card gives away the subtitle'
  player=page.locator('audio[controls]')
  assert player.is_visible() and player.get_attribute('src')==attached['media']['audio']['name'], 'the selected recording is not on the question side'
  player.evaluate('(a) => a.play()')
  page.wait_for_function("document.querySelector('audio').ended")
  assert player.evaluate('(a) => a.duration')==0.25
  show('Back',listening)
  assert listening['Sentence'] in page.locator('body').inner_text() and '公正的' in page.locator('#answer').inner_text()
  show('Front',text_card)
  assert text_card['Audio']==listening['Audio'] and page.locator('audio').count()==0 and '[sound:' not in page.locator('body').inner_text()
  assert template['Front']==(assets/'front.html').read_text() and template['Back']==(assets/'back.html').read_text() and model['css']==CSS
  (study.vault/'edited clip.wav').write_bytes(wav.getvalue())
  listening['Audio']='[sound:edited clip.wav]'
  assert study.lib.handle({'action':'libraryReconcile','id':saved['id']})['syncState']=='synced'
  show('Front',listening)
  assert page.locator('audio').get_attribute('src')=='edited%20clip.wav'
 finally:
  settings.tearDown();study.doCleanups()
checks=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--mute-audio'])
 page=browser.new_page(viewport={'width':640,'height':560});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 for side in ('front','back'):
  page.set_content('<body class="card">'+render(side,fields)+'</body>');page.add_style_tag(content=CSS)
  assert page.locator('.sr-question').text_content()==fields['Word']
  assert page.locator('.sr-sentence').text_content()==fields['Sentence']
  if side=='front':assert page.locator('.sr-definition').count()==0
  else:
   assert page.locator('.sr-definition').text_content()==fields['Definition']
   assert not page.locator('.sr-dictionary').is_visible()
   assert page.locator('.sr-media[open]').count()==0
  checks.append(side+' renders existing seven fields with no answer/media on front')
  page.screenshot(path=str(OUTPUT/'previews'/('anki-'+side+'.png')))
 dictionary={**fields,'Word':'ability','Definition':'<ol><li><div data-sc-study-role="meaning">n. 能力，才干</div><details><summary>英文解释</summary>A full long dictionary</details></li></ol>'}
 page.set_content('<body class="card">'+render('back',dictionary)+'</body>');page.add_style_tag(content=CSS)
 assert page.locator('.sr-dictionary').is_visible();assert page.locator('.sr-dictionary[open]').count()==0
 assert '能力，才干' in page.locator('.sr-definition').text_content()
 assert page.locator('.sr-reference ol').count()==1
 checks.append('quick dictionary card retains full data in a collapsed reference')
 page.screenshot(path=str(OUTPUT/'previews'/'anki-quick-back.png'))
 check_listening(page)
 checks.append('new model: selected WAV finishes before reveal, transcript on back, no playback on a text card')
 assert not errors
 (OUTPUT/'anki-render-results.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'scope':'Chromium rendering of real template files with fixture fields; not the Anki app'},ensure_ascii=False,indent=2))
 print(json.dumps({'passed':len(checks),'errors':errors}));browser.close()
