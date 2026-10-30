import test from 'node:test';
import assert from 'node:assert/strict';
import {listJson} from './list-request.ts';
const statusError=status=>Error('HTTP '+status);
const pending=signal=>new Promise((resolve,reject)=>{
  if(signal.aborted)reject(signal.reason);
  else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
});
test('list reads time out before headers and during an unfinished body',async()=>{
  for(const body of [false,true]){
    let observed;
    const fetcher=async(_url,{signal})=>{
      observed=signal;
      if(!body)return pending(signal);
      return {ok:true,json:()=>pending(signal)};
    };
    await assert.rejects(listJson('/index',new AbortController().signal,statusError,20,fetcher),/读取超时/);
    assert.equal(observed.aborted,true);
  }
});
test('closing a list cancels its request without converting cancellation to a timeout',async()=>{
  const parent=new AbortController();
  const promise=listJson('/index',parent.signal,statusError,100,async(_url,{signal})=>pending(signal));
  parent.abort();await assert.rejects(promise,{name:'AbortError'});
});
test('completed reads release timeout and preserve status errors and data',async()=>{
  let observed;
  assert.deepEqual(await listJson('/index',new AbortController().signal,statusError,20,async(_url,{signal})=>{observed=signal;return Response.json({records:[]});}),{records:[]});
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(observed.aborted,false);
  await assert.rejects(listJson('/index',new AbortController().signal,statusError,20,async()=>new Response('',{status:410})),/HTTP 410/);
});

test('HTTP rejection closes unread bodies and preserves the original status error',async()=>{
  let observed,bodyReads=0;
  const failure=Object.assign(Error('expired snapshot'),{status:410});
  await assert.rejects(listJson('/index',new AbortController().signal,()=>failure,1000,async(_url,{signal})=>{
    observed=signal;
    return {ok:false,status:410,json:()=>{bodyReads++;return pending(signal);}};
  }),error=>error===failure);
  assert.equal(bodyReads,0);assert.equal(observed.aborted,true);
});

test('JSON parse failure releases the request and keeps its original error',async()=>{
  let observed;const failure=new SyntaxError('invalid JSON');
  await assert.rejects(listJson('/index',new AbortController().signal,statusError,1000,async(_url,{signal})=>{
    observed=signal;return {ok:true,json:async()=>{throw failure;}};
  }),error=>error===failure);
  assert.equal(observed.aborted,true);
});
