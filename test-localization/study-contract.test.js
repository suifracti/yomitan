// @vitest-environment jsdom
import {test, expect, vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mountStuckHint} from '../ext/js/display/study-stuck.js';
import {wordInfo, normalizeInfo} from '../ext/js/study/word-marks.js';
import {WORD_STATUS_KEY} from '../ext/js/study/study-data.js';
const bridge = fileURLToPath(new URL('../local-bridge', import.meta.url));
function backend(action, data = {}) {
    return JSON.parse(execFileSync('python3', ['-B', '-c', `
import json,sys
sys.path.insert(0,sys.argv[1])
from test_study_auto_sync import AutoSyncTests
h=AutoSyncTests();h.setUp()
try:
 h.make_card()
 original=h.library.anki
 h.library.anki=lambda a,p: [{'cardId':c,'deckName':'外语','interval':30,'lapses':0} for c in p['cards']] if a=='cardsInfo' else original(a,p)
 h.library.auto_sync()
 h.library.handle({'action':'librarySave','makeCard':False,'entry':{'word':'brick wall','kind':'expression','baseWord':'brick','sentence':'A brick wall.','meaning':'砖墙','url':'https://example.test'}})
 print(json.dumps(h.library.handle(json.loads(sys.argv[2])),ensure_ascii=False))
finally:h.tearDown()
`, bridge, JSON.stringify({action, ...data})], {encoding: 'utf8'}));
}
function mount(status, call) {
    globalThis.chrome = {storage: {local: {get: async () => ({[WORD_STATUS_KEY]: status})}}};
    const choice = vi.fn();
    const root = mountStuckHint({doc: document, getEntry: () => ({word: 'brick', sentence: 'A brick wall.', url: 'https://example.test'}), call, isCurrent: () => true, onChoice: choice});
    document.body.replaceChildren(root);
    return {root, choice};
}
test('real B2+B8 responses feed word/phrase info, senses and a context-miss click', async () => {
    const status = backend('libraryWordStatus');
    expect(status.version).toBe(2);
    expect(wordInfo('bricks', status.words).s).toBe('familiar');
    expect(normalizeInfo(status.phrases['brick wall']).s).toBe('new');
    const call = vi.fn(async (action, data) => backend(action, data));
    const {root} = mount(status, call);
    await vi.waitFor(() => expect(root.querySelector('.study-stuck-senses').textContent).toContain('砖'));
    root.querySelector('[data-stuck=recall]').click();
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('libraryContextMiss', expect.objectContaining({kind: 'recall', senseKey: 'brick#1'})));
    expect(await call.mock.results.at(-1).value).toEqual({ok: true});
});
test('old bridge still allows a local learning choice without writing a context miss', async () => {
    const call = vi.fn(async () => {throw new Error('unknown action');});
    const {root, choice} = mount({words: {brick: 'known'}}, call);
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    root.querySelector('[data-stuck=newSense]').click();
    expect(choice).toHaveBeenCalledWith('newSense', expect.objectContaining({supported: false}));
    expect(call).toHaveBeenCalledTimes(1);
});
