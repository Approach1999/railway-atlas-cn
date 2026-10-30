import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMapFont,MAP_FONT_URL} from './map-font.ts';
import {MAP_FONT_INTEGRITY} from './map-font-data.ts';
const flush=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
test('pinned font is registered only after successful body read and decoding',async()=>{
  const bytes=new ArrayBuffer(4),added=[];let decoded=false;
  const face={load:async()=>{decoded=true;return face;}};
  const result=await loadMapFont(new AbortController().signal,{
    fetcher:async(url,init)=>{assert.equal(url,MAP_FONT_URL);assert.equal(init.integrity,MAP_FONT_INTEGRITY);return {ok:true,arrayBuffer:async()=>bytes};},
    createFace:data=>{assert.equal(data,bytes);return face;},addFace:value=>{assert(decoded);added.push(value);},
  });assert.equal(result,face);assert.deepEqual(added,[face]);
});
test('HTTP error aborts unread body and never creates a font',async()=>{
  let requestSignal;
  await assert.rejects(loadMapFont(new AbortController().signal,{
    fetcher:async(_,init)=>{requestSignal=init.signal;return {ok:false,status:503,arrayBuffer:()=>assert.fail('must not consume HTTP error body')};},
    createFace:()=>assert.fail('must not decode error response'),addFace:()=>assert.fail('must not register error'),
  }),/503/);assert(requestSignal.aborted);
});
for(const phase of ['body','decode'])test('deadline covers '+phase+' and late work cannot register a font',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let release,requestSignal;const added=[];
  const held=new Promise(resolve=>release=resolve),face={load:()=>phase==='decode'?held:Promise.resolve(face)};
  const pending=loadMapFont(new AbortController().signal,{
    fetcher:async(_,init)=>{requestSignal=init.signal;return {ok:true,arrayBuffer:()=>phase==='body'?held:Promise.resolve(new ArrayBuffer(0))};},
    createFace:()=>face,addFace:f=>added.push(f),
  },1000);
  const rejected=assert.rejects(pending,/超时/);await flush();t.mock.timers.tick(1000);await rejected;assert(requestSignal.aborted);
  release(phase==='body'?new ArrayBuffer(0):face);await flush();assert.deepEqual(added,[]);
});
test('parent cancellation preserves reason before and during a request',async()=>{
  const parent=new AbortController(),reason=new Error('snapshot owner disposed');parent.abort(reason);let calls=0;
  await assert.rejects(loadMapFont(parent.signal,{fetcher:async()=>{calls++;}}),e=>e===reason);assert.equal(calls,0);
  const next=new AbortController();let requestSignal;
  const pending=loadMapFont(next.signal,{fetcher:async(_,init)=>{requestSignal=init.signal;return new Promise(()=>{});}});
  const rejected=assert.rejects(pending,e=>e===reason);next.abort(reason);await rejected;assert(requestSignal.aborted);
});
