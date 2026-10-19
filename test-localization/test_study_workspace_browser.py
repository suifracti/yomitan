"""Real workspace modules + local DOM/services; no profile, model or learning writes."""
import asyncio, functools, http.server, json, os, pathlib, threading
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path(os.environ.get('WORKSPACE_UI_OUTPUT', '/tmp/yomitan-sidecar'))
OUT.mkdir(parents=True, exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass
async def main(port):
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'), headless=True)
        page = await browser.new_page(viewport={'width':400,'height':250})
        errors=[]; page.on('pageerror', lambda error: errors.append(str(error)))
        limits={'width':1200,'height':900}
        requests=[]
        async def resize_host(width,height):
            requests.append({'width':width,'height':height})
            await page.set_viewport_size({'width':min(round(width),limits['width']),'height':min(round(height),limits['height'])})
            return True
        await page.expose_function('resizeStudyHost', resize_host)
        raw=(ROOT/'test-localization/fixtures/study-focus.html').read_text()
        raw=raw.replace("import {prepareStudyFocus} from '/source/ext/js/display/study-focus.js';", "import {prepareStudyFocus} from '/js/display/study-focus.js';import {prepareStudyDictionary} from '/js/display/study-dictionary.js';")
        raw=raw.replace('</head>', '<link rel="stylesheet" href="/js/study/study-tokens.css">'+''.join('<link rel="stylesheet" href="/css/'+name+'">' for name in ['material.css','display.css','structured-content.css','study-card.css'])+'</head>')
        raw=raw.replace('prepareStudyFocus(window.display,{call:window.mockCall});', """
window.display.parentPopupId='test-root';
window.display.invokeParentFrame=async(action,data)=>{
 if(action==='popupFactoryGetFrameSize')return {width:innerWidth,height:innerHeight,valid:true};
 if(action==='popupFactorySetFrameSize')return await window.resizeStudyHost(data.width,data.height);
 throw Error(action);
};
window.testOriginalInner=document.querySelector('.content-body-inner').innerHTML;
window.display.setContent=(details)=>{
 window.fire('contentWillChange');window.fire('contentUpdateStart');
 document.querySelector('.content-body-inner').innerHTML=window.testOriginalInner;
 window.display.query=details.params.query;window.display.history={state:details.state,content:details.content};
 document.querySelector('.study-reading-word').textContent=details.params.query;
 document.querySelector('.study-source p').textContent=details.state.sentence.text;
 window.fire('contentUpdateComplete');
};
prepareStudyFocus(window.display,{call:window.mockCall});""")
        async def route_fixture(route): await route.fulfill(content_type='text/html',body=raw)
        await page.route('**/fixture.html',route_fixture)
        await page.route('**/js/study/study-client.js',lambda route:route.fulfill(content_type='text/javascript',body='export const studyCall=(a,d)=>window.dictionaryCall(a,d);'))
        await page.goto(f'http://127.0.0.1:{port}/fixture.html')
        await page.wait_for_function('window.ready===true')
        checks=[]
        async def check(name, expression):
            result=await page.evaluate(expression)
            assert result, (name,result)
            checks.append(name)
        await check('companion is a layout-only wrapper over the original card', '()=>!!document.querySelector(".sf-workspace .sf-main-card .study-focus-shell")')
        await page.wait_for_timeout(100)
        await check('default 250px popup can grow to its content before manual resizing', '()=>innerHeight>300')
        await check('short first page adapts height rather than keeping an empty bottom region', '()=>{const m=document.querySelector(".sf-main-card");return m.getBoundingClientRect().height<=600&&m.getBoundingClientRect().height>240;}')
        await page.evaluate('window.oldSentence=document.querySelector(".sf-source-pane p").textContent;document.querySelector(".sf-source-pane p").textContent="A short source.";document.querySelector(".sf-answer").hidden=true')
        await page.wait_for_timeout(150)
        await check('short content shrinks the main surface automatically', '()=>document.querySelector(".sf-main-card").getBoundingClientRect().height<550')
        await page.screenshot(path=str(OUT/'compact-main.png'))
        await page.evaluate('document.querySelector(".sf-source-pane p").textContent=window.oldSentence;document.querySelector(".sf-answer").hidden=false')
        await page.locator('.study-followup').fill('Keep this unsent draft')
        await page.get_by_role('button',name='详细词典',exact=True).click()
        await page.wait_for_function('innerWidth>700')
        await check('two similar-size cards are visible side by side', '()=>{const m=document.querySelector(".sf-main-card").getBoundingClientRect(),d=document.querySelector(".sf-dictionary-card").getBoundingClientRect();return m.width>=300&&d.width>=300&&Math.abs(m.width-d.width)<30&&d.left>=m.right&&m.height>450&&d.height>450;}')
        await check('main remains on source and retains draft; dictionary uses its original controls', '()=>!document.querySelector(".sf-source-pane").hidden&&document.querySelector(".study-followup").value==="Keep this unsent draft"&&document.querySelector(".sf-dictionary-card [data-study-dictionary-next]")&&document.querySelectorAll(".study-original-dictionary").length===1')
        await check('sentence actions remain small bordered buttons in the sentence heading', '()=>[...document.querySelectorAll(".sf-source-tools button")].every(b=>b.getBoundingClientRect().height<=23&&parseFloat(getComputedStyle(b).borderTopWidth)>0&&!!b.closest(".study-source-heading"))')
        await check('both cards share text and surface colors', '()=>{const m=getComputedStyle(document.querySelector(".sf-main-card")),d=getComputedStyle(document.querySelector(".sf-dictionary-card"));return m.color===d.color&&m.backgroundColor===d.backgroundColor;}')
        await page.screenshot(path=str(OUT/'two-cards.png'))
        await page.evaluate('document.documentElement.dataset.theme="dark"')
        await page.wait_for_timeout(300)
        await check('dark mode uses the same palette for both cards and dictionary examples', '()=>{const m=getComputedStyle(document.querySelector(".sf-main-card")),d=getComputedStyle(document.querySelector(".sf-dictionary-card")),e=getComputedStyle(document.querySelector("[data-sc-content=extra-info]"));return m.color===d.color&&m.backgroundColor===d.backgroundColor&&e.backgroundColor!=="rgb(241, 247, 245)"&&m.backgroundColor!=="rgb(255, 255, 255)";}')
        await page.screenshot(path=str(OUT/'two-cards-dark.png'))
        await page.evaluate('delete document.documentElement.dataset.theme')
        await page.wait_for_timeout(300)
        await page.get_by_role('tab',name='我的记录',exact=False).click()
        await page.wait_for_timeout(100)
        await check('records contain only Obsidian and Anki presence destinations and shrink to content', '()=>{const m=document.querySelector(".sf-main-card"),r=document.querySelector(".sf-records");return m.getBoundingClientRect().height<500&&r.querySelectorAll(".sf-record-destination").length===2&&!r.querySelector(".sf-note-prose");}')
        await page.screenshot(path=str(OUT/'records-compact.png'))
        await page.get_by_role('tab',name='词义与原句',exact=True).click()
        await page.get_by_role('button',name='收起词典卡',exact=True).click()
        await check('collapsing dictionary keeps main and draft', '()=>document.querySelector(".sf-dictionary-card").classList.contains("sf-pane-collapsed")&&!document.querySelector(".sf-main-card").classList.contains("sf-pane-collapsed")&&document.querySelector(".study-followup").value==="Keep this unsent draft"')
        await page.get_by_role('button',name='展开词典卡',exact=True).click()
        await page.get_by_role('button',name='收起主卡',exact=True).click()
        await check('main can collapse independently', '()=>document.querySelector(".sf-main-card").classList.contains("sf-pane-collapsed")&&!document.querySelector(".sf-dictionary-card").classList.contains("sf-pane-collapsed")')
        await page.get_by_role('button',name='切回单词 ability',exact=True).click()
        await page.locator('[data-study-dictionary-next]').click()
        await check('original dictionary pager still works', '()=>document.querySelector(".study-sense-count").textContent.includes("2/2")')
        await page.locator('.sf-dictionary-card').click()
        await page.keyboard.press('Escape')
        await check('Escape collapses only companion, not main learning object', '()=>document.querySelector(".sf-dictionary-card").classList.contains("sf-pane-collapsed")&&document.querySelector(".study-focus-shell").isConnected&&document.querySelector(".study-followup").value==="Keep this unsent draft"')
        await page.get_by_role('button',name='展开词典卡',exact=True).click()
        handle=page.get_by_role('button',name='调整词典卡大小',exact=True)
        box=await handle.bounding_box(); await page.mouse.move(box['x']+5,box['y']+5); await page.mouse.down(); await page.mouse.move(box['x']+75,box['y']+35,steps=5); await page.mouse.up()
        await page.wait_for_timeout(100)
        await check('dictionary resize does not change main preferred width', '()=>{const m=document.querySelector(".sf-main-card").getBoundingClientRect(),d=document.querySelector(".sf-dictionary-card").getBoundingClientRect();return d.width>m.width+30;}')
        main_handle=page.get_by_role('button',name='调整主卡大小',exact=True)
        box=await main_handle.bounding_box(); await page.mouse.move(box['x']+5,box['y']+5); await page.mouse.down(); await page.mouse.move(box['x']+50,box['y']+25,steps=5); await page.mouse.up()
        await page.wait_for_timeout(100)
        await check('main resize is independently retained', '()=>document.querySelector(".sf-main-card").getBoundingClientRect().width>425&&document.querySelector(".sf-dictionary-card").getBoundingClientRect().width>450')
        await check('layout operations never generate AI or save learning', '()=>window.models===0&&window.saveClicks===0&&window.dictionaryCalls.every(([a])=>a==="dictionaryPeek")')
        await page.get_by_role('button',name='收起词典卡',exact=True).click()
        await page.get_by_role('button',name='收起主卡',exact=True).click()
        await page.screenshot(path=str(OUT/'both-collapsed.png'))
        await page.get_by_role('button',name='切回单词 ability',exact=True).click()
        await page.get_by_role('button',name='展开词典卡',exact=True).click()
        await page.wait_for_timeout(100)
        await check('expansion restores individual dimensions and draft', '()=>document.querySelector(".sf-main-card").getBoundingClientRect().width>425&&document.querySelector(".sf-dictionary-card").getBoundingClientRect().width>450&&document.querySelector(".study-followup").value==="Keep this unsent draft"')
        await page.get_by_role('button',name='关闭词典卡',exact=True).click()
        await page.wait_for_function('innerWidth<700')
        limits['width']=420
        await page.set_viewport_size({'width':420,'height':600})
        await page.get_by_role('button',name='详细词典',exact=True).click()
        await page.wait_for_timeout(100)
        await check('host clipping falls back to a full-width reader, not tiny columns', '()=>document.querySelector(".sf-workspace").dataset.layout==="overlay"&&document.querySelector(".sf-dictionary-card").getBoundingClientRect().width>=400&&document.documentElement.scrollWidth<=innerWidth+1')
        await page.get_by_role('button',name='切回单词 ability',exact=True).click()
        await check('narrow reader can switch back through a visible card tab', '()=>!document.querySelector(".sf-main-card").hidden&&document.querySelector(".sf-dictionary-card").hidden&&document.querySelector(".study-followup").value==="Keep this unsent draft"')
        await page.get_by_role('button',name='收起主卡',exact=True).click()
        await check('collapsed main stays reachable while dictionary is in front', '()=>!document.querySelector(".sf-dictionary-card").hidden&&document.querySelector(".sf-workspace-tabs [data-study-word-tab]").getBoundingClientRect().height>0')
        await page.screenshot(path=str(OUT/'collapsed-main-tab.png'))
        await page.get_by_role('button',name='切回单词 ability',exact=True).click()
        await check('restoring the tab brings back its original draft', '()=>!document.querySelector(".sf-main-card").hidden&&document.querySelector(".study-followup").value==="Keep this unsent draft"')
        await page.get_by_role('button',name='展开词典卡',exact=True).click()
        await check('tab strip remains available while reading dictionary', '()=>!document.querySelector(".sf-workspace-tabs").hidden&&document.querySelector(".sf-workspace-tabs").getBoundingClientRect().bottom<innerHeight')
        await page.screenshot(path=str(OUT/'narrow-reader.png'))
        limits['width']=320
        await page.set_viewport_size({'width':320,'height':550})
        await page.wait_for_function('document.querySelector(".sf-workspace").getBoundingClientRect().bottom<=innerHeight+1')
        await check('320px reader keeps pager and translation inside the viewport', '()=>["[data-study-dictionary-next]","[data-study-dictionary-translate]"].every(s=>{const r=document.querySelector(s).getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})')
        limits['width']=400
        await page.set_viewport_size({'width':400,'height':250})
        await page.wait_for_function('document.querySelector(".sf-workspace").getBoundingClientRect().bottom<=innerHeight+1')
        await check('small 400x250 window gives the companion a readable content area', '()=>document.querySelector(".sf-dictionary-card .sf-dictionary-scroll").clientHeight>100&&document.querySelector("[data-study-dictionary-next]").getBoundingClientRect().bottom<=innerHeight+1')
        await page.screenshot(path=str(OUT/'small-reader.png'))
        await page.get_by_role('button',name='关闭词典卡',exact=True).click()
        await check('return restores same source and input', '()=>document.querySelector(".study-followup").value==="Keep this unsent draft"&&!document.querySelector(".sf-source-pane").hidden')
        await page.evaluate('window.fire("contentWillChange");window.fire("contentUpdateStart")')
        await check('cleanup restores DOM and removes workspace handlers', '()=>!document.querySelector(".sf-workspace")&&!document.documentElement.hasAttribute("data-study-workspace")&&document.querySelectorAll(".study-dictionary-details").length===1')
        await page.evaluate('window.display.setContent({params:{type:"terms",query:"improve"},state:{sentence:{text:"Another real sentence to improve."},url:"https://source/two"},content:{dictionaryEntries:[]}})')
        await page.get_by_role('button',name='详细词典',exact=True).click()
        await check('parked word survives next query in the word-only top strip', '()=>{const t=[...document.querySelectorAll("[data-study-word-tab]")].map(b=>b.textContent);return t.includes("ability")&&t.includes("improve")&&!document.querySelector(".sf-workspace-tabs").textContent.includes("详细词典");}')
        await check('a new lookup recreates only one companion for its own word', '()=>document.querySelectorAll(".sf-workspace").length===1&&document.querySelector(".sf-pane-title").textContent==="improve · 详细词典"')
        await page.get_by_role('button',name='切回单词 ability',exact=True).click()
        await check('switching to parked word rebuilds the old source and unsent draft without changing new word', '()=>window.display.query==="ability"&&document.querySelector(".study-followup").value==="Keep this unsent draft"&&!document.querySelector(".sf-main-card").hidden')
        await check('word tab labels are readable next to their close controls', '()=>[...document.querySelectorAll("[data-study-word-tab]")].every(b=>b.getBoundingClientRect().width>65)')
        await page.screenshot(path=str(OUT/'restored-word-tabs.png'))
        await page.get_by_role('button',name='切回单词 improve',exact=True).click()
        await check('second word remains a separate reachable tab', '()=>window.display.query==="improve"&&document.querySelectorAll("[data-study-word-tab]").length===2')
        await page.get_by_role('button',name='关闭单词 ability',exact=True).click()
        await check('tab X closes only its own word without generating or saving', '()=>document.querySelectorAll("[data-study-word-tab]").length===1&&window.display.query==="improve"&&window.models===0&&window.saveClicks===0')
        await page.wait_for_timeout(150)
        await page.evaluate('window.fire("contentWillChange");window.fire("contentUpdateStart")')
        await page.wait_for_timeout(150)
        assert not errors,errors
        (OUT/'results.json').write_text(json.dumps({'checks':checks,'requests':requests,'errors':errors},ensure_ascii=False,indent=2))
        print(json.dumps({'passed':len(checks),'errors':errors}),flush=True)
        await page.unroute_all(behavior='ignoreErrors');await page.close();await browser.close()
with http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT/'ext'))) as server:
    threading.Thread(target=server.serve_forever,daemon=True).start()
    asyncio.run(main(server.server_port))
    server.shutdown()
