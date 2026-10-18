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
        page = await browser.new_page(viewport={'width':400,'height':600})
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
        raw=raw.replace('</head>', ''.join('<link rel="stylesheet" href="/css/'+name+'">' for name in ['material.css','display.css','structured-content.css','study-card.css'])+'</head>')
        raw=raw.replace('prepareStudyFocus(window.display,{call:window.mockCall});', """
window.display.parentPopupId='test-root';
window.display.invokeParentFrame=async(action,data)=>{
 if(action==='popupFactoryGetFrameSize')return {width:innerWidth,height:innerHeight,valid:true};
 if(action==='popupFactorySetFrameSize')return await window.resizeStudyHost(data.width,data.height);
 throw Error(action);
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
        await page.locator('.study-followup').fill('Keep this unsent draft')
        await page.get_by_role('button',name='详细词典',exact=True).click()
        await page.wait_for_function('innerWidth>700')
        await check('two similar-size cards are visible side by side', '()=>{const m=document.querySelector(".sf-main-card").getBoundingClientRect(),d=document.querySelector(".sf-dictionary-card").getBoundingClientRect();return m.width>=300&&d.width>=300&&Math.abs(m.width-d.width)<30&&d.left>=m.right&&m.height>450&&d.height>450;}')
        await check('main remains on source and retains draft; dictionary uses its original controls', '()=>!document.querySelector(".sf-source-pane").hidden&&document.querySelector(".study-followup").value==="Keep this unsent draft"&&document.querySelector(".sf-dictionary-card [data-study-dictionary-next]")&&document.querySelectorAll(".study-original-dictionary").length===1')
        await page.screenshot(path=str(OUT/'two-cards.png'))
        await page.get_by_role('button',name='收起词典卡',exact=True).click()
        await check('collapsing dictionary keeps main and draft', '()=>document.querySelector(".sf-dictionary-card").classList.contains("sf-pane-collapsed")&&!document.querySelector(".sf-main-card").classList.contains("sf-pane-collapsed")&&document.querySelector(".study-followup").value==="Keep this unsent draft"')
        await page.get_by_role('button',name='展开词典卡',exact=True).click()
        await page.get_by_role('button',name='收起主卡',exact=True).click()
        await check('main can collapse independently', '()=>document.querySelector(".sf-main-card").classList.contains("sf-pane-collapsed")&&!document.querySelector(".sf-dictionary-card").classList.contains("sf-pane-collapsed")')
        await page.get_by_role('button',name='展开主卡',exact=True).click()
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
        await page.get_by_role('button',name='展开主卡',exact=True).click()
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
        await page.evaluate('window.fire("contentUpdateStart")')
        await check('cleanup restores DOM and removes workspace handlers', '()=>!document.querySelector(".sf-workspace")&&!document.documentElement.hasAttribute("data-study-workspace")&&document.querySelectorAll(".study-dictionary-details").length===1')
        await page.evaluate('window.display.query="improve";window.fire("contentUpdateComplete")')
        await page.get_by_role('button',name='详细词典',exact=True).click()
        await check('a new lookup recreates only one companion for its own word', '()=>document.querySelectorAll(".sf-workspace").length===1&&document.querySelector(".sf-pane-title").textContent==="improve · 详细词典"')
        await page.wait_for_timeout(150)
        await page.evaluate('window.fire("contentUpdateStart")')
        await page.wait_for_timeout(150)
        assert not errors,errors
        (OUT/'results.json').write_text(json.dumps({'checks':checks,'requests':requests,'errors':errors},ensure_ascii=False,indent=2))
        print(json.dumps({'passed':len(checks),'errors':errors}),flush=True)
        await page.unroute_all(behavior='ignoreErrors');await page.close();await browser.close()
with http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT/'ext'))) as server:
    threading.Thread(target=server.serve_forever,daemon=True).start()
    asyncio.run(main(server.server_port))
    server.shutdown()
