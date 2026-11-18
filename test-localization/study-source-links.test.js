// @vitest-environment jsdom
import {test, expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {parseJson} from '../dev/json.js';
import {createSourceLine} from '../ext/js/pages/study-library.js';

test('library and new grouped contexts link their own video moment without rewriting the preceding context', () => {
    const {entry, body, firstUnchanged} = /** @type {{entry: {title: string, url: string, videoTime: number}, body: string, firstUnchanged: boolean}} */ (parseJson(execFileSync('python3', ['-B', '-c', `
import sys,json
sys.path.insert(0,sys.argv[1])
from test_study_word_documents import WordDocumentTests
h=WordDocumentTests();h.setUp()
try:
 first=h.save(h.entry(title='First clip',url='https://youtu.be/abcdefghijk',videoTime=120))
 lib=h.library.library_for(h.target)
 before=lib.read(first['id'])[1]
 path=h.vault / first['path']
 path.write_text(path.read_text().replace('type: english-study-word', 'source: existing-source\\ntype: english-study-word'))
 entry=h.entry('I have just arrived.',url='https://youtu.be/abcdefghijk',title='Second clip',videoTime=739)
 second=h.save(entry)
 print(json.dumps({'entry':entry,'body':lib.read(second['id'])[1],'firstUnchanged':lib.read(first['id'])[1]==before}))
finally:h.doCleanups()
`, `${import.meta.dirname}/../local-bridge`], {encoding: 'utf8'})));
    const line = createSourceLine(entry, entry.title);
    expect(line.textContent).toBe('来源：YouTube · Second clip · 12:19 ↗');
    expect(line.querySelector('a').href).toBe('https://youtu.be/abcdefghijk?t=739s');
    expect(body.split('来源：[Second clip](https://youtu.be/abcdefghijk?t=739s)')).toHaveLength(3);
    expect(firstUnchanged).toBe(true);
    const local = createSourceLine({url: 'file:///tmp/My%20clip.mp4'}, 'Video');
    expect(local.textContent).toBe('来源：My clip.mp4');
    expect(local.querySelector('a')).toBeNull();
    expect(createSourceLine({}, 'Article').textContent).toBe('来源：Article');
});

test('a related-source link opens the saved video part, not just notes for its jump URL', () => {
    const url = 'https://www.bilibili.com/video/BV1example?p=2&t=12';
    const line = createSourceLine({url, videoTime: 82}, 'Example lesson', '', 'chrome-extension://test/study-library.html');
    const links = /** @type {NodeListOf<HTMLAnchorElement>} */ (line?.querySelectorAll('a'));
    expect(links).toHaveLength(2);
    expect(links[0].href).toBe('https://www.bilibili.com/video/BV1example?p=2&t=82');
    const related = new URL(links[1].href);
    expect(related.pathname).toBe('/study-library.html');
    expect(links[1].textContent).toContain('同来源原句');
    const source = related.searchParams.get('source') ?? '';
    expect(source).toBe(url);
    const result = /** @type {{sentences: string[], firstPart: boolean, youtube: boolean, article: boolean}} */ (parseJson(execFileSync('python3', ['-B', '-c', `
import sys,json
sys.path.insert(0,sys.argv[1])
from test_study_word_documents import WordDocumentTests
from study_sources import page_source_key
h=WordDocumentTests();h.setUp()
base='https://www.bilibili.com/video/BV1example'
try:
 for sentence, suffix, seconds in [('Just one thing.', '?p=2&t=12', 12),
                                   ('I have just arrived.', '?p=2&t=82#t=82', 82),
                                   ('That is just the first part.', '', 18)]:
  h.save(h.entry(sentence, url=base+suffix, videoTime=seconds))
 rows=h.fresh().handle({'action':'libraryList','scope':'source','url':sys.argv[2],'title':''})['items']
 key=page_source_key
 first=key(base)==key(base+'?p=1&t=18')!=key(base+'?p=2')
 yt=key('https://youtu.be/abcdefghijk?t=12')==key('https://www.youtube.com/watch?v=abcdefghijk&t=82s')!=key('https://www.youtube.com/watch?v=987654321ab')
 article=key('https://example.com/a?q=1#section')==key('https://example.com/a?q=1#:~:text=text')!=key('https://example.com/a?q=2') and key('https://example.com/a#/chapter')!=key('https://example.com/a#/other')
 print(json.dumps({'sentences':sorted(row['entry']['sentence'] for row in rows),'firstPart':first,'youtube':yt,'article':article}))
finally:h.doCleanups()
`, `${import.meta.dirname}/../local-bridge`, source], {encoding: 'utf8'})));
    expect(result).toEqual({sentences: ['I have just arrived.', 'Just one thing.'], firstPart: true, youtube: true, article: true});
});
