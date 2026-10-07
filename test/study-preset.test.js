import {test, expect, vi} from 'vitest';
import {OptionsUtil} from '../ext/js/data/options-util.js';
import {fetch, chrome} from './mocks/common.js';
vi.stubGlobal('fetch', fetch);
vi.stubGlobal('chrome', chrome);
test('study default passes upstream schema and maps all existing fields',async()=>{
    const util = new OptionsUtil();
    await util.prepare();
    const options = util.getDefault();
    util.validate(options);
    expect(options.profiles[0].options.general.language).toBe('en');
    expect(options.profiles[0].options.anki.cardFormats[0].model).toBe('外语语境卡');
    expect(Object.keys(options.profiles[0].options.anki.cardFormats[0].fields)).toEqual(['Word','Sentence','Definition','Source','URL','Audio','Image']);
    options.profiles[0].name='custom';
    options.profiles[0].options.anki.server='http://127.0.0.1:9999';
    const updated=await util.update(options);
    expect(updated.profiles[0].name).toBe('custom');
    expect(updated.profiles[0].options.anki.server).toBe('http://127.0.0.1:9999');
});
