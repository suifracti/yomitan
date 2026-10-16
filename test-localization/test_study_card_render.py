import json,pathlib,re,os,tempfile
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1];assets=ROOT/'assets/study-review'
OUTPUT=pathlib.Path(os.environ.get('STUDY_UI_OUTPUT',tempfile.mkdtemp(prefix='study-card-view-test-')))
(OUTPUT/'previews').mkdir(parents=True,exist_ok=True)
CSS=(assets/'card.css').read_text()
fields={'Word':'ability to do something 是什么意思？句中 ability to fall asleep 指什么？','Sentence':"I don't know if people can relate to this, but once I start doing something purposefully, I end up losing ability to fall asleep.",'Definition':'表示「做某事的能力」；ability to fall asleep 指「入睡的能力」。常见完整表达是 the ability to fall asleep。','Source':'学习材料示例 · <a href="obsidian://open?vault=demo&file=ability">我的学习笔记</a>','URL':'https://example.org/reading','Audio':'发音示例','Image':'画面示例'}
def render(name,data):
 text=(assets/(name+'.html')).read_text()
 text=re.sub(r'{{#(\w+)}}(.*?){{/\1}}',lambda m:m[2] if data.get(m[1]) else '',text,flags=re.S)
 return re.sub(r'{{(\w+)}}',lambda m:data.get(m[1],''),text)
checks=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
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
 assert not errors
 (OUTPUT/'anki-render-results.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'scope':'Chromium rendering of real template files with fixture fields; not the Anki app'},ensure_ascii=False,indent=2))
 print(json.dumps({'passed':len(checks),'errors':errors}));browser.close()
