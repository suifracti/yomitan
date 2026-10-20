// @vitest-environment jsdom
import {test, expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createSourceLine} from '../ext/js/pages/study-library.js';

test('library and new grouped contexts link their own video moment without rewriting the preceding context', () => {
    const {entry, body, firstUnchanged} = JSON.parse(execFileSync('python3', ['-B', '-c', `
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
`, `${import.meta.dirname}/../local-bridge`], {encoding: 'utf8'}));
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
