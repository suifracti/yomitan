import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {endianness} from 'node:os';
import {fileURLToPath} from 'node:url';
import {nativeStudyCall} from '../ext/js/study/study-client.js';
test('missing native binding gives actionable permission/reload guidance without dispatching a model',()=>{globalThis.chrome={runtime:{}};assert.throws(()=>nativeStudyCall({action:'models'}),/本机通信.*重新加载扩展/);});

test('returns the full saved-word list and every card context when one native message cannot fit', async (t) => {
    const bridge = fileURLToPath(new URL('../local-bridge/', import.meta.url));
    const previous = globalThis.chrome;
    t.after(() => { globalThis.chrome = previous; });
    let receive;
    let connected = true;
    const lengths = [];
    globalThis.chrome = {runtime: {connectNative: () => ({
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
library.video_words = lambda *args: [
    {'word': f'word{i}', 'sentence': ('原句 ' * 450) + str(i), 'cards': 1}
    for i in range(620)
]
with patch('study_settings.YomitanLibrary', return_value=library), patch('study_health.record_error'), \\
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
    })}};

    const reply = await nativeStudyCall({action: 'libraryVideoWords', mediaKey: 'youtube:XqS7kIWMIDE'}).promise;
    assert.equal(reply.ok, true, reply.error);
    assert.ok(lengths.length > 1 && lengths.every((length) => length <= 900_000));
    assert.deepEqual(reply.library.items.map((row) => row.word), Array.from({length: 300}, (_, i) => `word${i}`));
    assert.equal(reply.library.items[299].sentence, '原句 '.repeat(450) + '299');
    assert.deepEqual(reply.library.cardContexts.map((row) => row.word), Array.from({length: 620}, (_, i) => `word${i}`));
    assert.equal(reply.library.cardContexts[619].sentence, '原句 '.repeat(450) + '619');
});
