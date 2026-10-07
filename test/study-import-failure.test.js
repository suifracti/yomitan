import {test, expect, vi} from 'vitest';
import JSZip from 'jszip';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {DictionaryDatabase} from '../ext/js/dictionary/dictionary-database.js';
import {DictionaryImporter} from '../ext/js/dictionary/dictionary-importer.js';
import {DictionaryImporterMediaLoader} from './mocks/dictionary-importer-media-loader.js';
import {setupStubs} from './utilities/database.js';
setupStubs();vi.stubGlobal('IDBKeyRange',IDBKeyRange);
test('a failed term transaction never leaves an importSuccess=true descriptor',async()=>{
 vi.stubGlobal('indexedDB',new IDBFactory());const db=new DictionaryDatabase();await db.prepare();
 const zip=new JSZip();zip.file('index.json',JSON.stringify({title:'Test failed write',revision:'1',format:3}));zip.file('term_bank_1.json',JSON.stringify([['demo','','','',0,['example'],1,'']]));
 const original=db.bulkAdd.bind(db);db.bulkAdd=async(...args)=>{if(args[0]==='terms')throw new Error('QuotaExceededError: test fixture');return original(...args);};
 try{
  const imported=await new DictionaryImporter(new DictionaryImporterMediaLoader()).importDictionary(db,await zip.generateAsync({type:'arraybuffer'}),{prefixWildcardsSupported:false,yomitanVersion:'26.10.8.1'});
  expect(imported.errors[0].message).toContain('QuotaExceededError');expect(imported.result.importSuccess).toBe(false);expect((await db.getDictionaryInfo())[0].importSuccess).toBe(false);
 }finally{db.close();}
});
