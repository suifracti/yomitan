import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudyService} from '../ext/js/study/study-service.js';

const source = {word: 'just', sentence: 'It is a just decision.', context: '', url: 'https://example.com/a', title: 'A'};
const result = {meaning: '公正的', translation: '这是公正的决定。', notes: '这里修饰名词 decision。'};
/**
 * Creates an in-memory service and native bridge for the journal tests.
 * @returns {object}
 */
function setup() {
    const data = {},
        calls = [];
    const storage = {get: async (k) => ({[k]: data[k]}), set: async (o) => Object.assign(data, o)};
    const native = (p) => ({cancel() {},
        promise: Promise.resolve().then(() => {
            if (p.action === 'libraryTargetResolve') { return {ok: true, library: {targetId: 'd'.repeat(32)}}; }
            calls.push(p);
            if (p.action === 'libraryMemory') { return {ok: true, library: {items: [{id: 'a'.repeat(32), text: '我以前把 just 都当成刚刚。', version: 'b'.repeat(64), word: 'just', truncated: false}], total: 1}}; }
            if (p.action === 'librarySave') { return {ok: true, library: {id: 'a'.repeat(32), vaultSaved: true}}; }
            return {ok: true, result};
        })});
    return {service: new StudyService(storage, native), storage, native, calls};
}
test('learning journal survives service restart, feeds follow-up and transfers all turns only on save', async () => {
    const {service, storage, native, calls} = setup();
    await service.handle('generate', {...source, mode: 'explain', question: '这里为什么不是刚刚？'});
    const restarted = new StudyService(storage, native);
    await restarted.handle('generate', {...source, mode: 'explain', question: '那怎么判断词性？'});
    const sent = calls.filter((x) => x.action === 'explain');
    assert.match(sent[0].learningMemory, /以前把 just/);
    assert.match(sent[1].learningMemory, /这里为什么不是刚刚/);
    assert.equal(calls.filter((x) => x.action === 'librarySave').length, 0);
    await restarted.handle('journalFeedback', {...source, question: '那怎么判断词性？', feedback: 'understood'});
    const other = await restarted.handle('journalPeek', {...source, url: 'https://example.com/b'});
    assert.equal(other.length, 0);
    await restarted.handle('librarySave', {entry: {...source, ...result}, makeCard: false});
    const saved = calls.filter((x) => x.action === 'librarySave');
    assert.equal(saved.flatMap((x) => x.turns ?? []).length, 2);
    assert.equal(saved[0].turns[0].feedback, 'unconfirmed');
    assert.equal(saved[0].turns.at(-1).feedback, 'understood');
    assert.equal((await restarted.handle('journalPeek', source)).length, 0);
    await restarted.handle('journalFeedback', {...source, question: '那怎么判断词性？', feedback: 'unclear', answer: result});
    assert.equal((await restarted.handle('journalPeek', source))[0].feedback, 'unclear');
});

test('card suggestions are saved to Obsidian before return, include confirmed history and reopen without model calls', async () => {
    const data = {},
        sent = []; let record = {id: 'a'.repeat(32), version: 'b'.repeat(64), entry: {word: 'just'}, target: {deck: '外语::英语语境', model: '外语语境卡'}};
    const service = new StudyService({get: async (k) => ({[k]: data[k]}), set: async (x) => Object.assign(data, x)}, (p) => ({cancel() {},
        promise: Promise.resolve().then(() => {
            sent.push(p);
            if (p.action === 'libraryRead') { return {ok: true, library: {items: [{id: record.id, version: record.version, word: 'just', text: '我手写补充：为什么修饰名词？', confirmedCards: '已确认卡：副词义已经做过', record}]}}; }
            if (p.action === 'cards') { return {ok: true, result: {items: [{id: record.id, cards: [{front: 'just修饰名词时？', back: '公正的'}], reason: '针对本人困惑'}]}}; }
            if (p.action === 'libraryDraftSave') {
                assert.equal('reviewDraft' in record, false);
                record = {...record, version: 'c'.repeat(64), reviewDraft: {id: 'd'.repeat(32), reason: p.items[0].reason, cards: p.items[0].cards}};
                return {ok: true, library: {items: [record]}};
            }
            throw new Error(p.action);
        })}));
    const value = await service.handle('draftCards', {ids: [record.id]});
    assert.equal(value.items[0].version, 'c'.repeat(64)); assert.ok(value.items[0].reviewDraft);
    const text = sent.find((p) => p.action === 'cards').items[0].text;
    assert.match(text, /我手写补充/);
    assert.match(text, /副词义已经做过/);
    await service.handle('draftCards', {ids: [record.id]});
    assert.equal(sent.filter((p) => p.action === 'cards').length, 1, 'durable draft resumes, no regeneration');
    assert.equal(sent.some((p) => p.action === 'libraryCards' || p.action === 'libraryDraftCommit'), false);
});

test('cancel during history retrieval never starts a model request', async () => {
    let release; const calls = [];
    const service = new StudyService({get: async () => ({}), set: async () => {}}, (p) => {
        calls.push(p.action);
        return {cancel() {}, promise: new Promise((r) => { release = r; })};
    });
    const pending = service.handle('generate', {...source, mode: 'explain'});
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await service.handle('cancel', source);
    release({ok: true, library: {items: [], total: 0}});
    await assert.rejects(pending, /取消/);
    assert.deepEqual(calls, ['libraryMemory']);
});

test('Japanese and English same-surface learning history and caches stay isolated', async () => {
    const {studyLookup, sentenceKey, DEFAULTS} = await import('../ext/js/study/study-data.js');
    const en = studyLookup({word: 'test', sentence: 'test sentence', language: 'en'});
    const ja = studyLookup({word: 'test', sentence: 'test sentence', language: 'ja'});
    assert.equal(ja.language, 'ja');
    assert.notEqual(sentenceKey(en, DEFAULTS), sentenceKey(ja, DEFAULTS));
    assert.throws(() => studyLookup({...ja, language: 'auto'}));
    const {service, calls} = setup();
    await service.handle('generate', {...source, language: 'ja', mode: 'explain', question: '日语问题'});
    assert.equal((await service.handle('journalPeek', {...source, language: 'en'})).length, 0);
    assert.equal((await service.handle('journalPeek', {...source, language: 'ja'})).length, 1);
    assert.equal(calls.find((p) => p.action === 'libraryMemory').language, 'ja');
    assert.equal(calls.find((p) => p.action === 'explain').language, 'ja');
});

test('one Save transfers every completed turn of this context in batches, not the neighbouring context', async () => {
    const {service, calls} = setup();
    for (let i = 0; i < 11; i++) { await service.journal.append({...source, question: `问题${i}`}, result); }
    await service.journal.append({...source, url: 'https://example.com/other', question: '另一个来源'}, result);
    await service.handle('librarySave', {entry: {...source, ...result, explanationSource: 'ai'}, makeCard: false});
    const batches = calls.filter((p) => p.action === 'librarySave');
    assert.deepEqual(batches.map((p) => p.turns.length), [4, 4, 3]);
    assert.equal(new Set(batches.flatMap((p) => p.turns.map((t) => t.id))).size, 11);
    assert.equal(batches.every((p) => p.makeCard === false), true);
    assert.equal((await service.handle('journalPeek', source)).length, 0);
    assert.equal((await service.handle('journalPeek', {...source, url: 'https://example.com/other'})).length, 1);
});


test('failed draft persistence never reports a durable draft or starts Anki', async () => {
    const id = 'a'.repeat(32),
        version = 'b'.repeat(64),
        calls = [];
    const service = new StudyService({get: async () => ({}), set: async () => {}}, (p) => ({cancel() {},
        promise: Promise.resolve().then(() => {
            calls.push(p.action);
            if (p.action === 'libraryRead') { return {ok: true, library: {items: [{id, version, word: 'just', text: '正文'.repeat(3000), confirmedCards: '旧卡'.repeat(1200), record: {id, version}}]}}; }
            if (p.action === 'cards') {
                assert.ok(p.items[0].text.length <= 6500);
                assert.match(p.items[0].text, /省略/);
                return {ok: true, result: {items: [{id, reason: '建议', cards: [{front: '问题', back: '答案'}]}]}};
            }
            if (p.action === 'libraryDraftSave') { return {ok: false, error: '笔记已变化'}; }
            throw new Error('unexpected ' + p.action);
        })}));
    await assert.rejects(service.handle('draftCards', {ids: [id]}), /笔记已变化/);
    assert.deepEqual(calls, ['libraryRead', 'cards', 'libraryDraftSave']);
});

test('feedback binds to one turn, repeats do not duplicate answers, saved conversation survives', async () => {
    const {service, calls} = setup(); await service.journal.append({...source, question: 'Q'}, result);
    const id = (await service.handle('journalPeek', source))[0].id;
    for (let i = 0; i < 3; i++) { await service.handle('journalFeedback', {...source, turnId: id, question: 'Q', feedback: 'understood'}); }
    assert.equal((await service.handle('journalPeek', source)).length, 1);
    await service.handle('librarySave', {entry: {...source, ...result}, makeCard: false});
    const history = await service.handle('journalConversation', source);
    assert.equal(history.length, 1);
    assert.equal(history[0].saved, true);
    await service.handle('journalFeedback', {...source, turnId: id, question: 'Q', feedback: 'unclear'});
    await service.handle('journalFeedback', {...source, turnId: id, question: 'Q', feedback: 'unclear'});
    const pending = await service.handle('journalPeek', source);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, 'feedback');
    assert.equal(pending[0].meaning, '');
    assert.equal((await service.handle('journalConversation', source))[0].feedback, 'unclear');
    assert.equal(calls.filter((c) => c.action === 'librarySave').length, 1);
});

test('feedback changed during save ack remains pending without copying the answer', async () => {
    const {service} = setup(); await service.journal.append({...source, question: 'race'}, result);
    const turn = (await service.handle('journalPeek', source))[0]; let done;
    service.native = (p) => ({cancel() {}, promise: p.action === 'libraryTargetResolve' ? Promise.resolve({ok: true, library: {targetId: 'd'.repeat(32)}}) : new Promise((r) => { done = r; })});
    const save = service.handle('librarySave', {entry: {...source, ...result}, makeCard: false});
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await service.handle('journalFeedback', {...source, turnId: turn.id, feedback: 'understood'});
    done({ok: true, library: {id: 'a'.repeat(32)}}); await save;
    const pending = await service.handle('journalPeek', source);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].relatedTurnId, turn.id);
    assert.equal(pending[0].meaning, '');
    assert.equal((await service.handle('journalConversation', source))[0].feedback, 'understood');
});

test('acknowledged local copies are bounded without blocking new questions or discarding pending feedback', async () => {
    const {service, storage} = setup();
    const key = 'studyLearningJournalV1';
    await service.journal.append(source, result);
    const seed = (await storage.get(key))[key][0];
    const rows = Array.from({length: 90}, (_, i) => ({...seed, saved: true, turn: {...seed.turn, id: `turn-${i}`, notes: '中'.repeat(5000)}}));
    await storage.set({[key]: rows});
    await service.journal.checkRoom(); await service.journal.append({...source, question: 'new'}, result);
    const stored = (await storage.get(key))[key]; assert.ok(stored.length < 90);
    assert.equal(stored.at(-1).turn.question, 'new');
    assert.equal('saved' in stored.at(-1), false);
});

test('ordinary peek has zero library/Anki calls; English lemma and bounded evidence reach explicit AI work', async () => {
    const {service, calls} = setup();
    await service.handle('peek', source);
    assert.equal(calls.some((p) => p.action === 'libraryMemory'), false);
    await service.handle('generate', {...source, lemma: 'go', mode: 'explain'});
    assert.equal(calls.find((p) => p.action === 'libraryMemory').lemma, 'go');
    const id = 'a'.repeat(32),
        version = 'b'.repeat(64),
        sent = [];
    service.native = (p) => ({cancel() {},
        promise: Promise.resolve().then(() => {
            sent.push(p);
            if (p.action === 'libraryRead') { return {ok: true, library: {items: [{id, version, word: 'went', text: '正文'.repeat(3000), confirmedCards: '旧卡'.repeat(1200), relatedMemory: 'Anki：noteId=101，复习3次，不代表掌握', record: {id, version}}]}}; }
            if (p.action === 'cards') { return {ok: true, result: {items: [{id, reason: '已有卡不重复', cards: []}]}}; }
            if (p.action === 'libraryDraftSave') { return {ok: true, library: {items: [{id, version, reviewDraft: {id, reason: '已有卡不重复', cards: []}}]}}; }
            throw new Error(p.action);
        })});
    await service.handle('draftCards', {ids: [id]});
    const payload = sent.find((p) => p.action === 'cards').items[0].text;
    assert.match(payload, /noteId=101/); assert.ok(payload.length <= 6500);
    assert.equal(sent.some((p) => p.action === 'libraryDraftCommit'), false);
});
