import {readFileSync} from 'node:fs';
import Ajv from 'ajv';
import JSZip from 'jszip';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {test, expect, vi} from 'vitest';
import {DictionaryDatabase} from '../ext/js/dictionary/dictionary-database.js';
import {DictionaryImporter} from '../ext/js/dictionary/dictionary-importer.js';
import {DictionaryImporterMediaLoader} from './mocks/dictionary-importer-media-loader.js';
import {fetch, chrome} from './mocks/common.js';
import {setupStubs} from './utilities/database.js';

setupStubs();
vi.stubGlobal('fetch', fetch);
vi.stubGlobal('chrome', chrome);
vi.stubGlobal('IDBKeyRange', IDBKeyRange);

const archivePath = new URL('../ext/data/study/ecdict.zip', import.meta.url);
const readSchema = (name) => JSON.parse(readFileSync(new URL(`../ext/data/schemas/${name}`, import.meta.url), 'utf8'));

test('the actual bundled archive and every term bank pass official schemas', async () => {
    const zip = await JSZip.loadAsync(readFileSync(archivePath));
    const ajv = new Ajv({strict: false});
    const validateIndex = ajv.compile(readSchema('dictionary-index-schema.json'));
    const index = JSON.parse(await zip.file('index.json').async('string'));
    expect(validateIndex(index), JSON.stringify(validateIndex.errors)).toBe(true);
    const validateTerms = ajv.compile(readSchema('dictionary-term-bank-v3-schema.json'));
    let count = 0;
    for (const name of Object.keys(zip.files).filter((n) => /^term_bank_\d+\.json$/.test(n))) {
        const bank = JSON.parse(await zip.file(name).async('string'));
        expect(validateTerms(bank), `${name}: ${JSON.stringify(validateTerms.errors)}`).toBe(true);
        count += bank.length;
    }
    expect(count).toBe(768739);
}, 60000);

test('official importer accepts bundled metadata and English definitions can be queried', async () => {
    const archive = await JSZip.loadAsync(readFileSync(archivePath));
    const entries = JSON.parse(await archive.file('term_bank_1.json').async('string')).slice(0, 8);
    const sample = new JSZip();
    sample.file('index.json', await archive.file('index.json').async('string'));
    sample.file('term_bank_1.json', JSON.stringify(entries));
    vi.stubGlobal('indexedDB', new IDBFactory());
    const database = new DictionaryDatabase();
    await database.prepare();
    try {
        const importer = new DictionaryImporter(new DictionaryImporterMediaLoader());
        const {result, errors} = await importer.importDictionary(database, await sample.generateAsync({type: 'arraybuffer'}), {prefixWildcardsSupported: false, yomitanVersion: '26.10.7.1'});
        expect(errors).toEqual([]);
        expect(result.importSuccess).toBe(true);
        const terms = await database.findTermsBulk([entries[0][0]], new Set([result.title]), 'exact');
        expect(terms.length).toBeGreaterThan(0);
        expect(terms[0].definitions).toEqual(entries[0][5]);
    } finally {
        database.close();
    }
}, 60000);
