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
  marks.openPageWords();document.querySelector('#study-page-words input').checked=true;
  const done=[...document.querySelectorAll('#study-page-words button')].find(n=>n.textContent==='完成');done.click();
  await vi.waitFor(()=>expect(calls.some(c=>c.studyAction==='knownWords'&&c.data.known?.add?.includes('sophisticated'))).toBe(true));
  expect(calls.some(c=>c.studyAction==='pageWordsSave')).toBe(false);
  [...document.querySelectorAll('[role=status] button')].find(b=>b.textContent==='撤销').click();
  await vi.waitFor(()=>expect(calls.some(c=>c.data.known?.remove?.includes('sophisticated'))).toBe(true));
  marks._words.sophisticated={s:'ignored'};marks._mark(document.querySelector('p').firstChild);expect(marks.pageWords().map(r=>r.word)).toEqual(['appreciate']);
 } finally{vi.unstubAllGlobals();await env.teardown(global);}
});
