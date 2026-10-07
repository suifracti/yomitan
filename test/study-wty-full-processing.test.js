// Full data/schema/formatter processing with a counting sink: no user DB and no IndexedDB acceptance claim.
import {test,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {DictionaryImporter} from '../ext/js/dictionary/dictionary-importer.js';
import {DictionaryImporterMediaLoader} from './mocks/dictionary-importer-media-loader.js';
import {setupStubs} from './utilities/database.js';
setupStubs();
test('the entire bundled WTY validates and formats without missing resources',async()=>{
 const data=Buffer.concat(['part1','part2'].map(part=>readFileSync(new URL(`../ext/data/study/wty-en-en.${part}`,import.meta.url))));
 let written=0,descriptor;
 const sink={isPrepared:()=>true,dictionaryExists:async()=>false,addWithResult:async()=>{const request={result:1};setTimeout(()=>request.onsuccess?.(),0);return request;},bulkAdd:async(store,_entries,_offset,count)=>{if(store==='terms')written+=count;},bulkUpdate:async(_store,updates)=>{descriptor=updates[0].data;}};
 const importer=new DictionaryImporter(new DictionaryImporterMediaLoader());
 const result=await importer.importDictionary(sink,data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),{prefixWildcardsSupported:false,yomitanVersion:'26.10.8.1'});
 expect(result.errors).toEqual([]);expect(result.result.importSuccess).toBe(true);expect(written).toBe(1649109);expect(descriptor.importSuccess).toBe(true);
},300000);
