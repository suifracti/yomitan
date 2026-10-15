import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeStudyCall} from '../ext/js/study/study-client.js';
test('missing native binding gives actionable permission/reload guidance without dispatching a model',()=>{globalThis.chrome={runtime:{}};assert.throws(()=>nativeStudyCall({action:'models'}),/本机通信.*重新加载扩展/);});
