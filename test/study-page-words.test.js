/*
 * Copyright (C) 2023-2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {expect,test,vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';

test('level candidates exclude saved and function words, and page selection writes only unchecked words as known',async()=>{
 const env=await builtinEnvironments.jsdom.setup(global,{jsdom:{html:'<p>We appreciate sophisticated architecture every day.</p>',url:'https://example.test/article'}});
 const calls=[]; vi.stubGlobal('chrome',{runtime:{sendMessage:async message=>{calls.push(message);return {ok:true,value:message.studyAction==='knownWords'?{known:[],ignored:[]}:true};}}});
 const {WordMarks}=await import('../ext/js/study/word-marks.js'); const marks=new WordMarks();marks._encounters=false;
 marks._levels={we:[1,1],appreciate:[3,2000],sophisticated:[6,9000],architecture:[3,4000]};marks._glosses={appreciate:'欣赏',sophisticated:'复杂的',architecture:'建筑'};
 marks._words={architecture:{s:'learning'}};marks._highlights={possible:new Set(),learning:new Set()};
 try{
  marks._mark(document.querySelector('p').firstChild);expect(marks.pageWords().map(r=>r.word)).toEqual(['appreciate','sophisticated']);
  await marks.openPageWords();document.querySelector('#study-page-words input').checked=true;
  const done=[...document.querySelectorAll('#study-page-words button')].find(n=>n.textContent==='完成');done.click();
  await vi.waitFor(()=>expect(calls.some(c=>c.studyAction==='knownWords'&&c.data.known?.add?.includes('sophisticated'))).toBe(true));
  expect(calls.some(c=>c.studyAction==='pageWordsSave')).toBe(false);
  [...document.querySelectorAll('[role=status] button')].find(b=>b.textContent==='撤销').click();
  await vi.waitFor(()=>expect(calls.some(c=>c.data.known?.remove?.includes('sophisticated'))).toBe(true));
  marks._words.sophisticated={s:'ignored'};marks._mark(document.querySelector('p').firstChild);expect(marks.pageWords().map(r=>r.word)).toEqual(['appreciate']);
 } finally{vi.unstubAllGlobals();await env.teardown(global);}
});

test('page words follow live occurrences and do not submit a stale panel', async () => {
    const env = await builtinEnvironments.jsdom.setup(global, {jsdom: {
        html: '<p>I appreciate the quiet.</p><p>We appreciate the effort.</p><p>The architecture is unique.</p>',
        url: 'https://example.test/article',
    }});
    const sendMessage = vi.fn();
    vi.stubGlobal('CSS', {highlights: new Map()});
    vi.stubGlobal('Highlight', Set);
    vi.stubGlobal('chrome', {
        runtime: {sendMessage, getURL: (path) => path},
        storage: {local: {get: async () => ({studyWordMarks: {encounters: false}})}, onChanged: {addListener() {}}},
    });
    const levels = {appreciate: [3, 2000], architecture: [3, 4000], facade: [6, 9000]};
    vi.stubGlobal('fetch', async (url) => new Response(JSON.stringify(url.endsWith('word-levels.json') ? levels : {})));
    try {
        const {WordMarks} = await import('../ext/js/study/word-marks.js');
        const marks = new WordMarks();
        await marks.start();
        const [first, second, last] = document.querySelectorAll('p');
        const listedSentence = () => marks.pageWords().find(({word}) => word === 'appreciate')?.sentence;
        await vi.waitFor(() => expect(listedSentence()).toBe('We appreciate the effort.'));
        second.remove();
        expect(listedSentence()).toBe('I appreciate the quiet.');

        const updated = last.firstChild;
        updated.data = 'The facade is unique.';
        expect(marks.pageWords().map(({word}) => word)).toEqual(['appreciate']);
        await vi.waitFor(() => expect(marks.pageWords().some(({word}) => word === 'facade')).toBe(true));
        await marks.openPageWords();
        first.firstChild.data = 'Nothing to save here.';
        document.querySelector('#study-page-words input').checked = true;
        const button = [...document.querySelectorAll('#study-page-words button')].find((node) => node.textContent === '完成');
        button.click();
        expect(sendMessage).not.toHaveBeenCalled();
        expect(button.textContent).toBe('重新读取本页');
        button.click();
        await vi.waitFor(() => expect(document.querySelector('#study-page-words h3')?.textContent).toBe('本页生词（1）'));
        expect(document.querySelector('#study-page-words section')?.textContent).toContain('The facade is unique.');
    } finally {
        vi.unstubAllGlobals();
        await env.teardown(global);
    }
});
