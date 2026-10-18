"""Isolated contracts: no real provider, Vault, or Anki collection."""
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'local-bridge'))
from study_library import StudyLibrary

ENTRY = dict(word='went', lemma='go', sentence='We went home.', meaning='回去了', url='https://example.org/a', title='A')

class MemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name).resolve(); self.vault = self.root / 'vault'; self.vault.mkdir()
        self.calls = []; self.notes = {}; self.offline = False
        def api(action, params):
            self.calls.append((action, params))
            if self.offline: raise OSError('offline')
            if action == 'deckNames': return ['外语::英语语境']
            if action == 'updateNoteFields':
                self.notes[params['note']['id']]['fields'].update(params['note']['fields']); return None
            if action == 'findNotes':
                query = params['query']
                if query.startswith('tag:'): return [n for n,r in self.notes.items() if query[4:] in r['tags']]
                if ' tag:studypoint_' in query: return [n for n,r in self.notes.items() if query.rsplit(' tag:',1)[1] in r['tags']]
                return list(self.notes)
            if action == 'notesInfo':
                return [{'noteId': i, 'modelName': '外语语境卡', 'tags': self.notes[i]['tags'], 'cards': [i+1000], 'fields': {k:{'value':v} for k,v in self.notes[i]['fields'].items()}} for i in params['notes']]
            if action == 'cardsInfo': return [{'cardId': i, 'deckName': self.notes[i-1000].get('deckName','外语::英语语境'), 'note': i-1000, 'reps': 3, 'lapses': 1, 'interval': 2, 'queue': 2} for i in params['cards']]
            if action == 'addNote':
                i = max([99, *self.notes]) + 1; self.notes[i] = params['note']; return i
            raise AssertionError(action)
        self.lib = StudyLibrary(self.vault, anki=api, cache_dir=self.root / 'cache')
    def save(self, entry=ENTRY): return self.lib.handle({'action':'librarySave','entry':entry,'makeCard':False})
    def memory(self, **kw): return self.lib.handle({'action':'libraryMemory','word':'go',**kw})
    def commit(self, row, front='What does went mean here?', back='went 是 go 的过去式，表示去了。'):
        return self.lib.handle({'action':'libraryCards','items':[{'id':row['id'],'version':row['version'],'cards':[{'front':front,'back':back}]}]})['items'][0]
    def test_incremental_index_lemma_and_edit_delete(self):
        first = self.save(); self.save({**ENTRY, 'word':'go', 'sentence':'Go home.', 'url':'https://example.org/b'})
        result = self.memory(); self.assertEqual(result['total'],2); self.assertEqual(result['coverage']['status'],'complete')
        with patch.object(self.lib, 'read_file', wraps=self.lib.read_file) as read:
            self.memory()
            self.assertLessEqual(read.call_count,3,'hot index must not reread all unmodified notes')
        p = self.vault / first['path']; p.write_text(p.read_text()+'\n手写：新的困惑。\n')
        self.assertIn('新的困惑',str(self.memory()))
        p.unlink(); self.assertEqual(self.memory()['total'],1)
    def test_short_anki_cache_but_fresh_bypasses_and_failure_unknown(self):
        self.save(); a=self.memory(); self.assertEqual(a['anki']['status'],'complete')
        before=len(self.calls); self.memory(); self.assertEqual(len(self.calls),before)
        self.memory(fresh=True); self.assertGreater(len(self.calls),before)
        self.offline=True
        result=self.memory(fresh=True); self.assertEqual(result['anki']['status'],'unavailable')
        self.assertNotEqual(result['anki'].get('total'),0)
    def test_live_review_evidence_and_bounded_partial(self):
        self.notes[101]={'fields':{'Word':'go','Sentence':'We went home.','Definition':'去'},'tags':[]}
        result=self.memory(); self.assertEqual(result['anki']['items'][0]['reviews'][0]['reps'],3)
        for i in range(102,125): self.notes[i]=self.notes[101]
        result=self.memory(fresh=True); self.assertEqual(result['anki']['status'],'partial'); self.assertLessEqual(len(result['anki']['items']),6)
    def test_other_language_not_in_index(self):
        self.save(); result=self.lib.handle({'action':'libraryMemory','language':'ja','word':'go'})
        self.assertEqual(result['items'],[])
    def test_cross_source_exact_card_reuses_note_but_never_overwrites(self):
        first=self.commit(self.save()); self.assertEqual(first['ankiState'],'synced')
        second=self.commit(self.save({**ENTRY,'url':'https://example.org/another','title':'Other'}))
        self.assertEqual(len(self.notes),1)
        self.assertEqual(first['cards'][0]['noteId'],second['cards'][0]['noteId'])
        self.assertTrue(second['cards'][0]['linkedExisting'])
        retry=self.lib.handle({'action':'librarySync','ids':[second['id']]})['items'][0]
        self.assertEqual(retry['ankiState'],'synced'); self.assertEqual(len(self.notes),1)
        self.offline=True
        third=self.commit(self.save({**ENTRY,'url':'https://example.org/third'}))
        self.assertEqual(third['ankiState'],'pending'); self.assertEqual(len(self.notes),1)
    def test_same_point_new_example_links_legacy_card_without_rewriting_it(self):
        first=self.commit(self.save())
        note_id=first['cards'][0]['noteId']; before=dict(self.notes[note_id]['fields'])
        self.notes[note_id]['tags']=[t for t in self.notes[note_id]['tags'] if not t.startswith('studypoint_')]
        second=self.commit(self.save({**ENTRY,'sentence':'Yesterday they went to school.','url':'https://example.org/new'}))
        self.assertEqual(second['ankiState'],'synced'); self.assertEqual(len(self.notes),1)
        self.assertEqual(second['cards'][0]['noteId'],note_id)
        self.assertTrue(second['cards'][0]['linkedByPoint'])
        self.assertEqual(self.notes[note_id]['fields'],before)
        self.assertIn('Yesterday they went to school.',(self.vault/second['path']).read_text())
        self.assertEqual(self.lib.handle({'action':'librarySync','ids':[second['id']]})['items'][0]['ankiState'],'synced')

    def test_different_subject_same_generic_question_does_not_merge(self):
        self.commit(self.save(),front='What does this mean?',back='可以表示离开。')
        other=self.commit(self.save({**ENTRY,'word':'leave','lemma':'leave','sentence':ENTRY['sentence'],'url':'https://example.org/leave'}),front='What does this mean?',back='可以表示离开。')
        self.assertEqual(other['ankiState'],'synced'); self.assertEqual(len(self.notes),2)

    def test_associated_point_edited_or_deleted_is_pending_not_recreated(self):
        first=self.commit(self.save()); ident=first['cards'][0]['noteId']
        self.notes[ident]['fields']['Definition']='手工编辑的不同答案'
        other=self.commit(self.save({**ENTRY,'sentence':'She went away.','url':'https://example.org/new'}))
        self.assertEqual(other['ankiState'],'pending'); self.assertEqual(len(self.notes),1)
        del self.notes[ident]
        retry=self.lib.handle({'action':'librarySync','ids':[other['id']]})['items'][0]
        self.assertEqual(retry['ankiState'],'pending'); self.assertEqual(len(self.notes),0)

    def test_commit_ignores_cached_absence_and_preserves_different_answer(self):
        self.memory()  # A previous successful empty search must not authorize a write.
        fields={'Word':'What does went mean here?', 'Sentence':ENTRY['sentence'], 'Definition':'went 是 go 的过去式，表示去了。'}
        self.notes[101]={'fields':fields.copy(),'tags':[]}
        linked=self.commit(self.save())
        self.assertEqual(linked['cards'][0]['noteId'],101); self.assertEqual(len(self.notes),1)
        other=self.commit(self.save({**ENTRY,'url':'https://example.org/other-sense'}),back='不同的答案，需要独立核对。')
        self.assertEqual(other['ankiState'],'synced'); self.assertEqual(len(self.notes),2)
        self.assertEqual(self.notes[101]['fields'],fields)

    def test_read_budget_is_shared_across_anki_calls(self):
        from study_memory import bounded_api
        from study_library import anki_call
        lib=StudyLibrary(self.vault, anki=anki_call)
        received=[]
        with patch('study_memory.time.monotonic',side_effect=[10,10.1,10.9,11.3]):
            api=bounded_api(lib,budget=1.2)
            with patch('study_library.urllib.request.build_opener') as opener:
                opener.return_value.open.side_effect=TimeoutError('simulated local socket deadline')
                with self.assertRaises(TimeoutError): api('findNotes',{'query':'x'})
                received.append(opener.return_value.open.call_args.kwargs['timeout'])
                with self.assertRaises(TimeoutError): api('notesInfo',{'notes':[1]})
                received.append(opener.return_value.open.call_args.kwargs['timeout'])
                count=opener.return_value.open.call_count
                with self.assertRaises(TimeoutError): api('cardsInfo',{'cards':[1]})
                self.assertEqual(opener.return_value.open.call_count,count)
        self.assertAlmostEqual(received[0],1.1); self.assertAlmostEqual(received[1],0.3)

    def test_hot_index_parses_zero_unchanged_files_and_does_not_send_unrelated_notes(self):
        from study_memory import MemoryIndex
        for i in range(60): self.save({**ENTRY,'word':'word'+str(i),'lemma':'lemma'+str(i),'sentence':'Other text','url':'https://example.org/'+str(i)})
        self.save()
        index=MemoryIndex(self.lib)
        while index.refresh(budget=1)['status']!='complete': pass
        with patch.object(self.lib,'read_file',wraps=self.lib.read_file) as read:
            status=index.refresh(budget=1)
            self.assertEqual(status['changedFiles'],0); self.assertEqual(read.call_count,0)
        ids,total=index.find('went','go'); self.assertEqual(len(ids),1); self.assertEqual(total,1)
        index.close()

    def test_small_budget_rebuild_resumes_instead_of_rescanning_prefix_forever(self):
        from study_memory import MemoryIndex
        for i in range(15): self.save({**ENTRY,'word':'term'+str(i),'url':'https://example.org/'+str(i)})
        index=MemoryIndex(self.lib); ticks=[0]
        def clock(): ticks[0]+=0.01; return ticks[0]
        with patch('study_memory.time.monotonic',side_effect=clock):
            for _ in range(30):
                status=index.refresh(budget=0.06)
                if status['status']=='complete': break
        self.assertEqual(status['status'],'complete')
        self.assertEqual(index.db.execute('select count(*) from records').fetchone()[0],15)
        index.close()

    def test_discard_archives_previous_draft_without_losing_learning_or_managed_markers(self):
        row=self.save()
        row=self.lib.handle({'action':'libraryDraftSave','items':[{'id':row['id'],'version':row['version'],'reason':'previous focus','cards':[{'front':'old question','back':'old answer','selected':True}]}]})['items'][0]
        row=self.save({**ENTRY,'notes':'A new question.'})
        self.assertTrue(row['draftStale'])
        result=self.lib.handle({'action':'libraryDraftDiscard','items':[{'id':row['id'],'version':row['version']}]})['items'][0]
        self.assertNotIn('reviewDraft',result)
        body=(self.vault/result['path']).read_text()
        self.assertIn('old question',body); self.assertIn('old answer',body); self.assertIn('A new question.',body)
        self.assertNotIn('<!-- study-review-draft:',body)

    def test_legacy_sync_also_has_no_duplicate_bypass(self):
        one=self.lib.handle({'action':'librarySave','entry':ENTRY,'makeCard':True})
        two=self.lib.handle({'action':'librarySave','entry':{**ENTRY,'url':'https://example.org/legacy'},'makeCard':True})
        self.assertEqual(one['ankiState'],'synced'); self.assertEqual(two['ankiState'],'synced')
        self.assertEqual(len(self.notes),1)
        self.assertEqual(one['noteId'],two['noteId'])

    def test_index_budget_partial_not_false_absence(self):
        from study_memory import MemoryIndex
        self.save()
        index=MemoryIndex(self.lib)
        result=index.refresh(budget=0)
        self.assertEqual(result['status'],'partial')
        index.close()

if __name__=='__main__': unittest.main()
