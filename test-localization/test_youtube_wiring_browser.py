"""Real browser audio + existing reader/word-card components. Generated fixture, no model/user data."""
import base64, json, os, pathlib, subprocess, sys
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path(os.environ.get('YOUTUBE_UI_OUTPUT', '/tmp/youtube-wiring-browser'))
OUT.mkdir(parents=True, exist_ok=True)
media = OUT/'sample.webm'
if not media.exists():
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=160x90:r=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','7','-c:v','libvpx','-b:v','40k','-c:a','libopus','-y',str(media)],check=True)
HTML = '''<html><head><meta charset="utf-8"><title>Local subtitle wiring fixture</title></head><body style="margin:12px;font:14px Arial;display:grid;grid-template-columns:560px 420px;gap:12px"><main><div id="movie_player"><video controls src="/sample.webm" style="width:540px"></video></div><div id="secondary-inner"></div></main><iframe id="card" src="/card.html" style="width:400px;height:550px;border:0"></iframe></body></html>'''
CARD = '''<html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/study-focus.css"></head><body><div class="content-body-inner"><div class="study-entry"><div class="entry-header"></div><div class="study-reading-anchor"><div class="study-source"><span class="study-source-label">当前原句</span><p>We <mark>improve</mark> daily.</p></div><div class="study-reading-ai-context"><div class="study-reading-ai-text"></div><details class="study-reading-ai-more"><summary>更多</summary><div class="study-reading-ai-full"></div></details></div><div class="study-reading-meaning"><div class="study-reading-sense">vt. 改善；vi. 变得更好</div></div></div><section id="study-context"></section></div></div></body></html>'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),headless=True,args=['--autoplay-policy=no-user-gesture-required'])
    page=browser.new_page(viewport={'width':1040,'height':760})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def serve(route):
        path=route.request.url.split('youtube.com/',1)[-1].split('?',1)[0]
        file=ROOT/'ext'/path
        if path=='sample.webm':
            body=media.read_bytes();size=len(body)
            span=route.request.headers.get('range','')
            if span.startswith('bytes='):
                a,b=span[6:].split('-',1);start=int(a or 0);end=min(int(b) if b else size-1,size-1)
                route.fulfill(status=206,body=body[start:end+1],content_type='video/webm',headers={'Accept-Ranges':'bytes','Content-Range':f'bytes {start}-{end}/{size}'})
            else:route.fulfill(body=body,content_type='video/webm',headers={'Accept-Ranges':'bytes'})
        elif path=='card.html':route.fulfill(body=CARD,content_type='text/html')
        elif file.is_file():route.fulfill(path=str(file))
        else:route.fulfill(body=HTML,content_type='text/html')
    page.route('https://www.youtube.com/**',serve)
    print('fixture open',flush=True)
    page.goto('https://www.youtube.com/watch?v=abcdefghijk')
    page.wait_for_function('document.querySelector("video").readyState>=2')
    print('video ready',flush=True)
    page.evaluate('''async()=>{
        const {YoutubeReader}=await import('/js/study/youtube-reader.js');
        window.calls=[];window.assets=null;
        window.reader=new YoutubeReader({prefs:{engine:'model'},call:async(action,data)=>{
            window.calls.push(action);
            if(action==='subtitleSettings')return {model:'fixture',effort:'low',cacheEnabled:true};
            if(action==='subtitleTranslate')return {items:data.items.map(r=>({id:r.id,translation:'我们每天进步。'}))};
            return true;
        }});
        window.reader.start();
        window.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({events:[{tStartMs:1000,dDurationMs:1500,segs:[{utf8:'We improve daily.'}]}]})});
        window.reader.rememberRequest('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en');
    }''')
    print('reader ready',flush=True)
    page.get_by_role('button',name='载入字幕',exact=True).click()
    page.get_by_role('button',name='翻译接下来8句').click()
    page.wait_for_function('document.querySelector(".r-translation").textContent==="我们每天进步。"')
    print('translated',flush=True)
    page.evaluate('''async()=>{
        const {Frontend}=await import('/js/app/frontend.js');
        const {TextSourceRange}=await import('/js/dom/text-source-range.js');
        const {youtubeStudyContext}=await import('/js/study/youtube-study-context.js');
        window.mediaContext=youtubeStudyContext;
        const text=document.querySelector('.r-text').firstChild,range=document.createRange();range.setStart(text,3);range.setEnd(text,10);
        const frontend={_pageType:'web',_application:{tabId:1,frameId:0},_textScanner:{},_showPopupContent:(_source,_options,details)=>{window.cardState=details.state;}};
        Frontend.prototype._showContent.call(frontend,TextSourceRange.create(range),false,[],'terms',{text:'scanner fallback',offset:0},document.title,{url:location.href},'light');
        const video=document.querySelector('video');video.pause();video.currentTime=5;video.playbackRate=1.25;
    }''')
    page.wait_for_function('!document.querySelector("video").seeking && Math.abs(document.querySelector("video").currentTime-5)<0.1')
    print('frontend source ready',flush=True)
    frame=page.frame(url='https://www.youtube.com/card.html')
    frame.evaluate('''async()=>{
        const source=parent.cardState;
        window.row=null;
        window.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async({studyAction,data})=>{
            parent.calls.push(studyAction);let value=[];
            if(studyAction==='pendingPeek')value={count:0};
            if(studyAction==='peek')value={result:null,busy:false};
            if(studyAction==='rememberEntry')value=window.row={id:'a'.repeat(32),entry:data.entry,version:'b'.repeat(64),cards:[],ankiState:'saved',ankiEnabled:true};
            if(studyAction==='libraryRead')value={items:[{record:window.row}]};
            if(studyAction==='libraryMedia'){parent.assets=data.assets;value=window.row={...window.row,media:{audio:{name:'fixture.webm'}}};}
            if(studyAction==='libraryCardsAdd'){parent.cardRequest=data;value={...window.row,cards:data.cards.map(c=>({...c,noteId:1,state:'synced'}))};}
            return {ok:true,value};
        }}};
        const {prepareStudyTranslation}=await import('/js/display/study-translation.js');
        const {prepareStudyFocus}=await import('/js/display/study-focus.js');
        const callbacks={};const display={on:(e,fn)=>callbacks[e]=fn,query:'improve',history:{state:source},getOptions:()=>({general:{language:'en'}})};
        prepareStudyTranslation().render(document.querySelector('#study-context'),source.sentence.text,'improve',{
            translation:source.studySentenceTranslation,url:source.url,title:'Generated local fixture',videoTime:source.videoTime,context:source.sentence.adjacent,
            mediaRange:source.studyMediaRange,capture:async(start,duration)=>{try{return await parent.mediaContext.capture(source.studyMediaToken,start,duration);}catch(e){parent.captureError={message:e.message,stack:e.stack};throw new Error(e.message);}},cancelCapture:async()=>parent.mediaContext.cancel(source.studyMediaToken),meaning:'词典简释（未按当前句消歧）：改善'});
        prepareStudyFocus(display,{call:async()=>({items:[],total:0,anki:{status:'complete',items:[]}})});callbacks.contentUpdateComplete();
    }''')
    print('word card ready',flush=True)
    assert frame.locator('.study-source-translation').inner_text()=='我们每天进步。'
    frame.locator('[data-study-add-card]').click()
    frame.locator('[data-study-capture]').click()
    print('capture clicked',flush=True)
    try:
        frame.wait_for_function('document.querySelector(".study-card-add-status").textContent.includes("真实原声已保存")',timeout=12000)
    except Exception:
        print(frame.evaluate('document.body.innerText'),flush=True)
        print(page.evaluate('({calls,captureError:window.captureError,duration:document.querySelector("video").duration,seekable:Array.from({length:document.querySelector("video").seekable.length},(_,i)=>[document.querySelector("video").seekable.start(i),document.querySelector("video").seekable.end(i)]),time:document.querySelector("video").currentTime,paused:document.querySelector("video").paused,rate:document.querySelector("video").playbackRate})'),errors,flush=True)
        raise
    assert page.evaluate('calls.filter(x=>x==="libraryCardsAdd").length')==0
    state=page.evaluate('({time:document.querySelector("video").currentTime,rate:document.querySelector("video").playbackRate,paused:document.querySelector("video").paused,assets})')
    assert abs(state['time']-5)<0.1 and state['rate']==1.25 and state['paused'],state
    print('captured/restored',flush=True)
    captured=OUT/'captured.webm';captured.write_bytes(base64.b64decode(state['assets'][0]['data']))
    probe=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_type','-of','json',str(captured)],capture_output=True,text=True,check=True)
    assert json.loads(probe.stdout)['streams']==[{'codec_type':'audio'}]
    frame.locator('[data-study-card-choice=listening]').click()
    frame.locator('[data-study-cards-submit]').click()
    page.wait_for_function('window.cardRequest?.cards[0]?.kind==="listening"')
    page.screenshot(path=str(OUT/'reader-and-card.png'))
    assert not errors,errors
    (OUT/'capture.json').write_text(json.dumps({'assets':state['assets'],'start':1,'end':2.5}))
    browser.close()
# Reuse the existing temporary-library harness; no real Vault or Anki connection.
sys.path.insert(0,str(ROOT/'test-localization'))
from test_study_library import LibraryTests, ENTRY
h=LibraryTests();h.setUp()
try:
    payload=json.loads((OUT/'capture.json').read_text())
    row=h.save({**ENTRY,'word':'improve','sentence':'We improve daily.','videoTime':1,'url':'https://www.youtube.com/watch?v=abcdefghijk&t=1s'})
    row=h.lib.handle({'action':'libraryMedia','id':row['id'],'version':row['version'],'origin':'capture',**payload})
    name=row['media']['audio']['name']
    assert (h.vault/name).read_bytes()==base64.b64decode(payload['assets'][0]['data'])
    h.lib.handle({'action':'libraryCardsAdd','id':row['id'],'language':'en','cards':[{'kind':'listening','front':'听本句中的 improve','back':'We improve daily. / 我们每天进步。'}]})
    assert len(h.cards)==1 and name in next(iter(h.cards.values()))['fields']['Audio']
finally:h.doCleanups()
print(json.dumps({'browser' :'Chrome real MediaRecorder','temporaryLibraryAudioMatch':True,'audioBytes':captured.stat().st_size,'playbackRestored':True,'explicitListeningCard':True,'output':str(OUT)}))
