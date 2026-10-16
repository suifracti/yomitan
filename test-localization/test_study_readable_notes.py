"""Real StudyLibrary I/O in temporary Vaults; external Anki/media are fakes."""
import copy, hashlib, importlib.util, json, pathlib, sys, tempfile, types, unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'local-bridge'))
from study_library import StudyLibrary, normalize_entry, entry_id

ENTRY={'word':'ability','sentence':'I want the ability to fall asleep.','meaning':'能力；才干','translation':'我希望能够入睡。','url':'','title':'Reading sample','lemma':'ability','reading':'ability'}

class FakeAnki:
    def __init__(self): self.notes={};self.offline=False;self.calls=[]
    def __call__(self,action,params):
        self.calls.append(action)
        if self.offline:raise ConnectionError('offline')
        if action=='findNotes':
            tag=params['query'].removeprefix('tag:')
            return [k for k,v in self.notes.items() if tag in v.get('tags',[])]
        if action=='addNote':
            ident=100+len(self.notes);self.notes[ident]=copy.deepcopy(params['note']);return ident
        if action=='notesInfo':return [{'noteId':i,'fields':{k:{'value':v} for k,v in self.notes[i]['fields'].items()}} for i in params['notes']]
        raise AssertionError(action)

# Stub only existing external services; the actual parser, guarded I/O, save,
# draft, material readback and sync methods run unchanged from the source.
mem=types.ModuleType('study_memory')
mem.duplicate=lambda *a:None;mem.duplicate_point=lambda *a:None
mem.exact_tag=lambda *a:'exact_test';mem.point_id=lambda *a:'point_test'
mem.norm=lambda x:' '.join(str(x).split()).casefold()
mem.invalidate_anki=lambda *a:None

media=types.ModuleType('study_media');media.anki_fields=lambda *a:{'Audio':'','Image':''}

class ReadableNotesTests(unittest.TestCase):
    def setUp(self):
        self.modules=patch.dict(sys.modules,{'study_memory':mem,'study_media':media});self.modules.start()
        self.tmp=tempfile.TemporaryDirectory();self.vault=pathlib.Path(self.tmp.name);self.api=FakeAnki()
        self.lib=StudyLibrary(self.vault,self.api,group_words=True)
    def tearDown(self):self.tmp.cleanup();self.modules.stop()
    def save(self,entry=None,turns=None):return self.lib.handle({'action':'librarySave','entry':entry or ENTRY,'makeCard':False,'turns':turns or []})
    def body(self,row):return (self.vault/row['path']).read_text()
    def draft(self,row,cards=None):return self.lib.handle({'action':'libraryDraftSave','items':[{'id':row['id'],'version':row['version'],'reason':'记住当前搭配。','cards':cards if cards is not None else [{'front':'ability to do 表示什么？','back':'做某事的能力。','selected':True}]}]})['items'][0]
    def commit(self,draft):return self.lib.handle({'action':'libraryDraftCommit','items':[{'id':draft['id'],'version':draft['version'],'draftId':draft['reviewDraft']['id']}]})['items'][0]
    def test_metadata_follows_human_content(self):
        row=self.save();text=self.body(row)
        self.assertLess(text.index('### 原句'),text.index('<!-- english-study-context-meta-v2:'))
        self.assertEqual(row['id'],entry_id(normalize_entry(ENTRY)))
        self.assertNotIn('词典读音',text)
        self.assertIn('未进行 AI 语境消歧',text)
    def test_human_edit_reads_back_without_rewrite(self):
        row=self.save();path=self.vault/row['path'];text=path.read_text().replace('### 来源','### 我的补充\n\n我自己编辑的解释。\n\n### 来源');path.write_text(text)
        result=self.lib.material(row['id']);self.assertIn('我自己编辑的解释',result['text']);self.assertEqual(path.read_text(),text)
    def test_same_word_contexts_share_file_keep_ids(self):
        a=self.save();b=self.save({**ENTRY,'sentence':'Her musical ability surprised us.'})
        self.assertEqual(a['path'],b['path']);self.assertNotEqual(a['id'],b['id']);self.assertEqual(len(self.lib.file_ids(self.vault/a['path'])),2)
    def test_duplicate_save_does_not_duplicate_context(self):
        a=self.save();before=self.body(a);b=self.save();self.assertEqual(a['id'],b['id']);self.assertEqual(self.body(b),before)
    def test_old_v1_record_is_read_only_until_explicit_save(self):
        row=self.save();r,body,_=self.lib.read(row['id']);path=self.vault/row['path']
        old=self.lib.word_header(r['entry'])+f'<!-- english-study-context-v1:{self.lib.metadata(r)} -->\n'+body+f'\n<!-- english-study-context-end:{r["id"]} -->\n'
        path.write_text(old);before=path.read_bytes();read=self.lib.read(row['id']);self.assertEqual(read[0]['id'],r['id']);self.assertEqual(path.read_bytes(),before)
        new=self.save({**ENTRY,'meaning':'我更新了这个语境的解释'});self.assertIn('context-meta-v2',self.body(new));self.assertIn('我更新了',self.body(new))
    def test_mixed_old_new_contexts(self):
        row=self.save();r,body,_=self.lib.read(row['id']);path=self.vault/row['path']
        path.write_text(self.lib.word_header(r['entry'])+f'<!-- english-study-context-v1:{self.lib.metadata(r)} -->\n'+body+f'\n<!-- english-study-context-end:{r["id"]} -->\n')
        other=self.save({**ENTRY,'sentence':'She has the ability.'});text=self.body(other)
        self.assertIn('context-v1:',text);self.assertIn('context-meta-v2:',text);self.assertEqual(len(self.lib.file_ids(path)),2)
    def test_stale_version_refuses_to_overwrite(self):
        row=self.save();r,body,version=self.lib.read(row['id']);path=self.vault/row['path'];path.write_text(path.read_text().replace('### 原句','### 原句\n\n个人补充'))
        with self.assertRaisesRegex(ValueError,'变化'):self.lib.write(r,body,version)
        self.assertIn('个人补充',path.read_text())
    def test_context_versions_remain_independent(self):
        a=self.save();ra,ba,va=self.lib.read(a['id']);b=self.save({**ENTRY,'sentence':'Different ability context.'})
        self.lib.write(ra,ba+'\n我的新理解。\n',va)
        self.assertIn('Different ability',self.lib.read(b['id'])[1])
    def test_malformed_footer_refused(self):
        row=self.save();path=self.vault/row['path'];path.write_text(path.read_text().replace('context-end:'+row['id'],'context-end:'+'0'*32))
        with self.assertRaises(ValueError):self.lib.word_contexts(path.read_text())
    def test_duplicate_context_refused(self):
        row=self.save();path=self.vault/row['path'];r,b,_=self.lib.read(row['id']);path.write_text(path.read_text()+self.lib.context_block(r,b))
        with self.assertRaises(ValueError):self.lib.word_contexts(path.read_text())
    def test_zero_card_is_explicit_and_compact(self):
        row=self.draft(self.save(),[]);text=self.body(row);self.assertIn('本次无需新增复习卡',text);self.assertIn('<details>',text);self.assertFalse(row['draftStale'])
    def test_pending_then_resend_same_id_no_duplicate(self):
        draft=self.draft(self.save());self.api.offline=True;pending=self.commit(draft)
        self.assertEqual(pending['ankiState'],'pending');ident=pending['cards'][0]['id'];text=self.body(pending)
        self.assertEqual(self.lib.read(pending['id'])[1].count('ability to do 表示什么？'),1) # confirmed Q/A is not repeated in draft view
        self.assertIn('等待 Anki 确认',text)
        self.api.offline=False;synced=self.lib.handle({'action':'librarySync','ids':[pending['id']]})['items'][0]
        self.assertEqual(synced['cards'][0]['id'],ident);self.assertEqual(synced['ankiState'],'synced');self.assertEqual(len(self.api.notes),1)
        self.lib.handle({'action':'librarySync','ids':[pending['id']]});self.assertEqual(len(self.api.notes),1)
    def test_user_edited_draft_is_not_silently_deleted(self):
        row=self.draft(self.save());path=self.vault/row['path'];path.write_text(path.read_text().replace('记住当前搭配。','我改了复习判断。'))
        with self.assertRaisesRegex(ValueError,'人工修改'):self.lib.result(row['id'])
        self.assertIn('我改了复习判断',path.read_text())
    def test_non_grouped_legacy_format_unchanged(self):
        lib=StudyLibrary(self.vault,self.api,group_words=False);row=lib.handle({'action':'librarySave','entry':ENTRY,'makeCard':False,'turns':[]})
        self.assertIn('english-study-v1:',(self.vault/row['path']).read_text());self.assertNotIn('context-meta-v2',(self.vault/row['path']).read_text())
    def test_no_external_calls_for_plain_save_or_read(self):
        row=self.save();self.lib.material(row['id']);self.lib.result(row['id']);self.assertEqual(self.api.calls,[])
    def test_marker_text_is_literal_not_executable(self):
        row=self.save({**ENTRY,'meaning':'<script>alert(1)</script> <!-- marker -->'});text=self.body(row)
        self.assertNotIn('<script>',text);self.assertEqual(len(self.lib.file_ids(self.vault/row['path'])),1)

    def test_explicit_formatter_preserves_all_content_and_ids(self):
        spec=importlib.util.spec_from_file_location('reformat',ROOT/'tools'/'reformat-study-note.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        row=self.save();record,body,_=self.lib.read(row['id']);path=self.vault/row['path']
        old=self.lib.word_header(record['entry'])+f'<!-- english-study-context-v1:{self.lib.metadata(record)} -->\n'+body+f'\n<!-- english-study-context-end:{record["id"]} -->\n'
        path.write_text(old);before=path.read_bytes();mod.inspect(self.vault,row['path']);self.assertEqual(before,path.read_bytes())
        answer=mod.apply(self.vault,row['path'],hashlib.sha256(before).hexdigest());self.assertTrue(answer['changed'])
        self.assertEqual(pathlib.Path(answer['backup']).read_bytes(),before);self.assertEqual(self.lib.read(row['id'])[:2],(record,body));self.assertEqual(self.api.calls,[])
    def test_formatter_refuses_stale_file(self):
        spec=importlib.util.spec_from_file_location('reformat',ROOT/'tools'/'reformat-study-note.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        row=self.save()
        with self.assertRaisesRegex(ValueError,'已修改'):mod.apply(self.vault,row['path'],'0'*64)
    def test_formatter_never_handles_arbitrary_note(self):
        spec=importlib.util.spec_from_file_location('reformat',ROOT/'tools'/'reformat-study-note.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        with self.assertRaisesRegex(ValueError,'单词文档'):mod.inspect(self.vault,'diary.md')

if __name__=='__main__':unittest.main(verbosity=2)
