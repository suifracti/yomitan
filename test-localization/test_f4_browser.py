"""One F4 Chrome check: a saved learning word produces a visible line-end star."""
import pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    def serve(route):
        path = route.request.url.split('youtube.com/', 1)[-1].split('?', 1)[0]
        file = ROOT / 'ext' / path
        if file.is_file(): route.fulfill(path=str(file))
        else: route.fulfill(body='<div id="secondary-inner"></div>', content_type='text/html')
    page.route('https://www.youtube.com/**', serve)
    page.goto('https://www.youtube.com/watch?v=abcdefghijk')
    page.evaluate('''async () => {
        const {YoutubeReader} = await import('/js/study/youtube-reader.js');
        window.reader = new YoutubeReader({prefs:{merge:false}, call:async()=>({items:[]})});
        reader._mediaKey='youtube:abcdefghijk';
        reader._learningWords={brick:{s:'learning'}};
        await reader._mount(0);
        reader.importText('1\\n00:00:00,000 --> 00:00:10,000\\nWe build a brick wall today.', 'fixture.srt');
    }''')
    assert page.locator('.r-star').inner_text() == '★'
    assert page.locator('.r-star').is_visible()
    page.screenshot(path='/tmp/yomitan-f4-star.png')
    browser.close()
print('F4: visible star in real Chrome; temporary captions, no user data')
