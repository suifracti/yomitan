"""One local-file Chrome check, generated media/subtitles only."""
import json, pathlib, subprocess, tempfile
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='study-f5-') as temporary:
    root = pathlib.Path(temporary)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=640x360:r=5','-t','2','-c:v','libvpx','-y',str(root/'sample.webm')],check=True)
    (root/'index.html').write_text('<video src="sample.webm" controls style="width:640px;height:360px"></video>')
    (root/'fixture.srt').write_text('1\n00:00:00,000 --> 00:00:02,000\nWe learn from a local video.\n')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--allow-file-access-from-files'])
        page = browser.new_page(viewport={'width':1000,'height':700})
        page.goto((root/'index.html').as_uri())
        page.wait_for_function('document.querySelector("video").readyState >= 1')
        page.evaluate('''async (url) => {
            const {YoutubeReader} = await import(url);
            const {WebVideoSite} = await import(new URL('./web-video-site.js', url));
            const {YoutubeOverlay} = await import(new URL('./youtube-overlay.js', url));
            const site = new WebVideoSite();
            window.reader = new YoutubeReader({site,prefs:{merge:false},call:async()=>({items:[]})});
            new YoutubeOverlay(reader, site).start(); reader.start();
        }''', (ROOT/'ext/js/study/youtube-reader.js').as_uri())
        button = page.get_by_role('button',name='导入字幕',exact=True)
        button.wait_for(state='visible')
        with page.expect_file_chooser() as chooser: button.click()
        chooser.value.set_files(str(root/'fixture.srt'))
        page.wait_for_function('window.reader.session?.cues.length === 1')
        state = page.evaluate('({key:reader.session.source.mediaKey,url:reader.session.source.url})')
        assert state['key'] == 'file:sample.webm|2', state
        import sys
        sys.path.insert(0,str(ROOT/'local-bridge'))
        from study_library_core import media_key_of, normalize_request
        assert media_key_of(state['url']) == state['key']
        normalize_request({'action':'libraryVideoWords','mediaKey':state['key']})
        page.screenshot(path='/tmp/yomitan-f5-local.png')
        browser.close()
print('F5: real Chrome file video, visible import hint and imported captions; matching Python identity')
