import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudyService} from '../ext/js/study/study-service.js';
import {StudySync} from '../ext/js/study/study-sync.js';
const entry = {word:'improve', sentence:'We improve our lives.', context:'', url:'https://example.test/a', title:'A', meaning:'改善', translation:'', notes:'', language:'en'};
function setup() {
    const data={}, calls=[]; let offline=false;
    const storage={get:async k=>({[k]:data[k]}),set:async v=>Object.assign(data,v)};
    const row={id:'a'.repeat(32),entry,learningState:'saved',targetId:'b'.repeat(32),ankiEnabled:true};
    const native=p=>({cancel(){},promise:Promise.resolve().then(()=>{
        calls.push(p); if(offline)throw new Error('offline');
        return {ok:true,library:structuredClone(row)};
    })});
    const service=new StudyService(storage,native);
    return {service,data,calls,row,storage,native,setOffline:v=>offline=v};
}
test('unsaved translations remain local, saved additions keep original target and never select cards',async()=>{
    const h=setup(), sync=new StudySync(h.service);
    await sync.learned(entry,{translation:'我们改善生活。',meaning:'',notes:''});
    assert.equal(h.calls.length,0);
    await sync.bind(entry,h.row);
    await sync.learned(entry,{translation:'我们改善生活。',meaning:'',notes:''});
    await sync.flush();
    const updates=h.calls.filter(p=>p.action==='libraryUpdate');
    assert.equal(updates.length,1);assert.equal(updates[0].id,h.row.id);
    assert.equal(updates[0].targetId,h.row.targetId);
    assert.deepEqual(updates[0].entry,{translation:'我们改善生活。'});
    assert.equal(h.calls.some(p=>['cards','librarySave'].includes(p.action)),false);
});
test('offline supplementation survives restart without losing turns or replaying model calls',async()=>{
    const h=setup(), sync=new StudySync(h.service);
    await sync.bind(entry,h.row); h.setOffline(true);
    await h.service.journal.append(entry,{translation:'译文',meaning:'',notes:''});
    await sync.learned(entry,{translation:'译文',meaning:'',notes:''});
    assert.equal((await sync.pending()).length,1);
    const restarted=new StudyService(h.storage,h.native), next=new StudySync(restarted);
    h.setOffline(false);await next.flush();
    assert.equal((await next.pending()).length,0);
    const sent=h.calls.filter(p=>p.action==='libraryUpdate').at(-1);
    assert.equal(sent.turns.length,1);assert.equal(sent.turns[0].translation,'译文');
});
test('favorite sync preserves a local favorite on failure and cancellation never deletes notes',async()=>{
    const h=setup(), sync=new StudySync(h.service);h.setOffline(true);
    const favorite={...entry,id:'local-id',created:1};
    await sync.favorite(favorite,true);
    assert.equal((await sync.pending()).length,1);
    h.setOffline(false);await sync.flush();
    await sync.favorite(favorite,false);await sync.flush();
    assert.equal(h.calls.filter(p=>p.action==='libraryFavorite').at(-1).favorite,false);
    assert.equal(h.calls.some(p=>/delete/i.test(p.action)),false);
});

test('video bookmark navigation time does not change the saved source identity',async()=>{
    const h=setup(), sync=new StudySync(h.service);
    await sync.favorite({...entry,id:'video-local',created:1,url:'https://www.youtube.com/watch?v=x&t=42s',sourceUrl:'https://www.youtube.com/watch?v=x',videoTime:42},true);
    await sync.flush();
    assert.equal(h.calls.find(p=>p.action==='libraryFavorite').entry.url,'https://www.youtube.com/watch?v=x');
});

for (const state of ['pending', 'conflict', 'synced']) {
    test(`an older ${state} receipt preserves a newer answer and its original target`, async () => {
        const h = setup(), sync = h.service.sync;
        let release, started;
        const updating = new Promise((resolve) => { started = resolve; });
        let held = false, replyState = state;
        const reply = () => ({ok: true, library: {...h.row, syncState: replyState,
            conflicts: replyState === 'conflict' ? [{field: 'meaning'}] : []}});
        h.service.native = (payload) => {
            h.calls.push(payload);
            if (payload.action === 'libraryUpdate' && !held) {
                held = true;
                return {cancel() {}, promise: new Promise((resolve) => {
                    release = () => resolve(reply());
                    started();
                })};
            }
            return {cancel() {}, promise: Promise.resolve(reply())};
        };
        await sync.bind(entry, h.row);
        await h.service.journal.append(entry, {translation: '第一版译文', meaning: '', notes: ''});
        await updating;
        await h.service.journal.append({...entry, question: '这里为什么这样用？'},
            {translation: '更新后的译文', meaning: '新补充的本句含义', notes: '新的回答'});
        const newest = (await sync.pending())[0];
        release();
        await sync.flush();
        const pending = await sync.pending();
        assert.equal(pending.length, 1);
        assert.equal(pending[0].action, 'libraryUpdate');
        assert.equal(pending[0].revision, newest.revision);
        assert.equal(pending[0].entry.meaning, '新补充的本句含义');
        assert.ok(pending[0].turns.some((turn) => turn.question === '这里为什么这样用？'));
        assert.equal(pending[0].targetId, h.row.targetId);
        replyState = 'synced';
        await sync.flush();
        assert.equal((await sync.pending()).length, 0);
        assert.equal(h.calls.filter((p) => p.action === 'libraryUpdate').at(-1).entry.meaning, '新补充的本句含义');
        assert.equal(h.calls.some((p) => ['cards', 'libraryCardsAdd', 'librarySave'].includes(p.action)), false);
    });
}

test('an unchanged failed delivery still becomes a reconcile task, not a fresh save or card', async () => {
    const h = setup(), sync = h.service.sync;
    h.row.syncState = 'pending';
    await sync.bind(entry, h.row);
    await h.service.journal.append(entry, {translation: '译文', meaning: '', notes: ''});
    await sync.flush();
    const pending = await sync.pending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].action, 'libraryReconcile');
    assert.equal(pending[0].id, h.row.id);
    assert.equal(pending[0].targetId, h.row.targetId);
});
