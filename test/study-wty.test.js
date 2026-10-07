// Validate and import a bounded sample from the exact supplied dictionary, not invented examples.
import {test, vi} from 'vitest';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {DictionaryDatabase} from '../ext/js/dictionary/dictionary-database.js';
import {DictionaryImporter} from '../ext/js/dictionary/dictionary-importer.js';
import {DictionaryImporterMediaLoader} from './mocks/dictionary-importer-media-loader.js';
import {setupStubs} from './utilities/database.js';
import {getSchemas, validateDictionary} from '../dev/dictionary-validate.js';
setupStubs();vi.stubGlobal('IDBKeyRange',IDBKeyRange);
test('bundled WTY original digest, source examples and official importer remain valid',async({expect})=>{
 const source=fileURLToPath(new URL('../ext/data/study/',import.meta.url));
 const sample=JSON.parse(execFileSync('python3',['-c',`import zipfile,json,pathlib,io,hashlib
p=pathlib.Path(${JSON.stringify(source)})
b=(p/'wty-en-en.part1').read_bytes()+(p/'wty-en-en.part2').read_bytes()
assert hashlib.sha256(b).hexdigest()=='bcccdce0047917db42c55e8221eff22c1477794cbcd571ddc49551cf26254fbf'
terms=[];wanted={'tired','repeatedly','ourselves','bank'}
with zipfile.ZipFile(io.BytesIO(b)) as z:
 for n in z.namelist():
  if n.startswith('term_bank'):
   for t in json.loads(z.read(n)):
    if t[0] in wanted:terms.append(t)
 result={'index':json.loads(z.read('index.json')),'terms':terms,'tags':sum([json.loads(z.read(n)) for n in z.namelist() if n.startswith('tag_bank')],[]),'styles':z.read('styles.css').decode()}
print(json.dumps(result))`],{encoding:'utf8',maxBuffer:5_000_000}));
 expect(sample.terms.some(t=>t[0]==='tired'&&JSON.stringify(t[5]).includes("I'm "))).toBe(true);
 const zip=new JSZip();zip.file('index.json',JSON.stringify(sample.index));zip.file('term_bank_1.json',JSON.stringify(sample.terms));zip.file('tag_bank_1.json',JSON.stringify(sample.tags));zip.file('styles.css',sample.styles);
 const archive=await zip.generateAsync({type:'arraybuffer'});await validateDictionary(null,archive,getSchemas());
 const db=new DictionaryDatabase();vi.stubGlobal('indexedDB',new IDBFactory());await db.prepare();
 try{
  const imported=await new DictionaryImporter(new DictionaryImporterMediaLoader(),()=>{}).importDictionary(db,archive,{prefixWildcardsSupported:false,yomitanVersion:'26.10.8.0'});
  expect(imported.errors).toEqual([]);expect(imported.result.title).toBe('wty-en-en');
  const words=await db.findTermsBulk(['tired','repeatedly'],new Set(['wty-en-en']),'exact');expect(words.length).toBeGreaterThan(1);
 }finally{await db.close();}
},60000);
