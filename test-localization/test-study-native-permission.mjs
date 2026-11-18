import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {endianness} from 'node:os';
import {fileURLToPath} from 'node:url';
import {nativeStudyCall} from '../ext/js/study/study-client.js';
import {StudyService} from '../ext/js/study/study-service.js';
import {WORD_STATUS_KEY} from '../ext/js/study/study-data.js';
test('missing native binding gives actionable permission/reload guidance without dispatching a model',()=>{globalThis.chrome={runtime:{}};assert.throws(()=>nativeStudyCall({action:'models'}),/本机通信.*重新加载扩展/);});

function mountNativeBridge(t, fixture) {
    const bridge = fileURLToPath(new URL('../local-bridge/', import.meta.url));
    const previous = globalThis.chrome;
    t.after(() => { globalThis.chrome = previous; });
    const lengths = [];
    function connectNative() {
        let receive;
        let connected = true;
        return {
            onMessage: {addListener: (fn) => { receive = fn; }},
            onDisconnect: {addListener: () => {}},
            disconnect: () => { connected = false; },
            postMessage: (payload) => {
                const wire = execFileSync('python3', ['-B', '-c', `
import io, json, sys
from types import SimpleNamespace
from unittest.mock import patch
from study_settings import YomitanLibrary
from study_translator import ORIGIN, main, write_frame

request, response = io.BytesIO(), io.BytesIO()
write_frame(request, json.load(sys.stdin))
request.seek(0)
library = object.__new__(YomitanLibrary)
library.reload = lambda: None
${fixture}
with patch('study_settings.YomitanLibrary', return_value=library), patch('study_health.record_error'), \\
     patch('study_senses.metrics', return_value={}), \\
     patch('study_senses.known_words', return_value={'known': [], 'ignored': ['alreadyknown']}), \\
     patch.object(sys, 'argv', ['bridge', ORIGIN]), \\
     patch.object(sys, 'stdin', SimpleNamespace(buffer=request)), \\
     patch.object(sys, 'stdout', SimpleNamespace(buffer=response)):
    main()
sys.stdout.buffer.write(response.getvalue())
    `], {cwd: bridge, input: JSON.stringify(payload), maxBuffer: 4_000_000});
                queueMicrotask(() => {
                    for (let offset = 0; offset < wire.length && connected;) {
                        const length = endianness() === 'LE' ? wire.readUInt32LE(offset) : wire.readUInt32BE(offset);
                        const start = offset + 4;
                        offset = start + length;
                        lengths.push(length);
                        receive(JSON.parse(wire.toString('utf8', start, offset)));
                    }
                });
            },
        };
    }
    globalThis.chrome = {permissions: {contains: async () => true}, runtime: {connectNative}};
    return lengths;
}

test('returns the full saved-word list and every card context when one native message cannot fit', async (t) => {
    const lengths = mountNativeBridge(t, `
library.video_words = lambda *args: [
    {'word': f'word{i}', 'sentence': ('原句 ' * 450) + str(i), 'cards': 1}
    for i in range(620)
]
`);
    const reply = await nativeStudyCall({action: 'libraryVideoWords', mediaKey: 'youtube:XqS7kIWMIDE'}).promise;
    assert.equal(reply.ok, true, reply.error);
    assert.ok(lengths.length > 1 && lengths.every((length) => length <= 900_000));
    assert.deepEqual(reply.library.items.map((row) => row.word), Array.from({length: 300}, (_, i) => `word${i}`));
    assert.equal(reply.library.items[299].sentence, '原句 '.repeat(450) + '299');
    assert.deepEqual(reply.library.cardContexts.map((row) => row.word), Array.from({length: 620}, (_, i) => `word${i}`));
    assert.equal(reply.library.cardContexts[619].sentence, '原句 '.repeat(450) + '619');
});

test('publishes every word and phrase from a large snapshot, without republishing unchanged colours', async (t) => {
    const lengths = mountNativeBridge(t, `
rows = {}
for i in range(6000):
    word = f'lexeme{i:05}'
    rows[word] = (None, None, {'entry': {'word': word, 'meaning': '按照诗句描述的方式表达；词典中另外一种较长解释'}})
    if i % 4 == 0:
        rows[word+'s'] = (None, None, {'entry': {'word': word+'s', 'lemma': word, 'meaning': '按照诗句描述的方式表达'}})
    if i % 10 == 0:
        rows[word+' out'] = (None, None, {'entry': {'word': word+' out', 'kind': 'expression', 'meaning': '实际执行并将过程解释清楚'}})
library.indexed = lambda: (None, rows)
`);
    const data = {};
    let publications = 0;
    const service = new StudyService({
        get: async (key) => ({[key]: structuredClone(data[key])}),
        set: async (values) => { Object.assign(data, structuredClone(values)); ++publications; },
    });
    await service.refreshWordStatus();
    const snapshot = data[WORD_STATUS_KEY];
    assert.ok(snapshot, 'no word status was published');
    assert.ok(lengths.length > 1 && lengths.every((length) => length <= 900_000));
    assert.equal(snapshot.version, 2);
    assert.equal(Object.keys(snapshot.words).length, 7501);
    assert.deepEqual(snapshot.words.lexeme05996s, snapshot.words.lexeme05996);
    assert.equal(snapshot.words.lexeme05999.gloss, '按照诗句描述的方式表达；词典中另外一种较长解释');
    assert.equal(snapshot.words.alreadyknown.s, 'ignored');
    assert.equal(Object.keys(snapshot.phrases).length, 600);
    assert.equal(snapshot.phrases['lexeme05990 out'].gloss, '实际执行并将过程解释清楚');
    await service.refreshWordStatus();
    assert.equal(publications, 1);
});
