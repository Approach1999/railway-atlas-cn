import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogStore,initialCatalogState} from './catalog-store.ts';
import {JsonReadTimeoutError} from './json-request.ts';

const directory={schema_version:1,regions:[{id:'shenyang',name:'沈阳试验区',current_snapshot:'shenyang-now',
  default_view:{longitude:123.42,latitude:41.8,zoom:10.5},snapshots:[{id:'shenyang-now',object_list:true}]},
  {id:'dalian',name:'大连试验区',current_snapshot:'dalian-now',default_view:{longitude:121.575,latitude:39.105,zoom:10.5},
   snapshots:[{id:'dalian-now',object_list:true}]}]};
const respond=value=>async()=>Response.json(value);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const pending=signal=>new Promise((_resolve,reject)=>{
  if(signal.aborted)reject(signal.reason);
  else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
});

test('the directory is read once for concurrent callers and reaches ready with parsed regions',async()=>{
  let calls=0;const store=createCatalogStore(async()=>{calls++;return Response.json(directory);});
  const observed=[],unsubscribe=store.subscribe(()=>observed.push(store.getSnapshot().status));
  assert.equal(store.getSnapshot().status,'loading');
  const [first,second]=await Promise.all([store.load(),store.load()]);
  assert.equal(calls,1);assert.equal(first,second);assert.equal(store.getSnapshot().status,'ready');
  assert.deepEqual(store.getSnapshot().catalog.regions.map(region=>region.id),['shenyang','dalian']);
  // The initial state is already "loading", so that first status is not announced again.
  assert.equal(store.getSnapshot().message,'');assert.deepEqual(observed,['ready']);
  unsubscribe();store.dispose();
});

test('a failed directory reports itself and recovers on retry',async()=>{
  let broken=true;const store=createCatalogStore(async()=>broken?new Response('',{status:503}):Response.json(directory));
  await assert.rejects(store.load());assert.equal(store.getSnapshot().status,'error');
  assert.equal(store.getSnapshot().message,'数据目录暂时无法读取或格式无效');assert.equal(store.getSnapshot().catalog,null);
  broken=false;await store.load();assert.equal(store.getSnapshot().status,'ready');assert.equal(store.getSnapshot().catalog.regions.length,2);
  const invalid=createCatalogStore(async()=>Response.json({schema_version:1,regions:[]}));
  await assert.rejects(invalid.load());assert.equal(invalid.getSnapshot().message,'数据目录暂时无法读取或格式无效');
  invalid.dispose();store.dispose();
});

test('a stalled directory ends in the timeout message instead of loading forever',async()=>{
  const store=createCatalogStore((_url,{signal})=>pending(signal),20);
  await assert.rejects(store.load(),error=>error instanceof JsonReadTimeoutError);
  assert.equal(store.getSnapshot().message,'数据目录读取超时，请检查网络后重试。');store.dispose();
});

test('disposal aborts the request, ignores a transport that answers anyway, and refuses further loads',async()=>{
  const answer=[];let signal;
  // This transport ignores its abort signal, like a connection that completes regardless.
  const stubborn=(_url,options)=>{
    signal=options.signal;
    return new Promise(resolve=>{
      answer.push(()=>resolve(Response.json(directory)));
    });
  };
  const store=createCatalogStore(stubborn);
  const request=store.load();const before=store.getSnapshot();
  store.dispose();assert.equal(signal.aborted,true);
  answer[0]();await assert.rejects(request,{name:'AbortError'});await tick();
  assert.equal(store.getSnapshot(),before);assert.equal(before.status,'loading');
  await assert.rejects(store.load(),{name:'AbortError'});
});

test('a retry keeps the already loaded directory visible while it reloads, whether it recovers or fails',async()=>{
  let failing=false;let answer=null;
  const transport=async()=>{
    if(!failing)return Response.json(directory);
    await new Promise(resolve=>{answer=resolve;});
    return new Response('',{status:503});
  };
  const store=createCatalogStore(transport);
  const seen=[];store.subscribe(()=>seen.push(store.getSnapshot().status));
  await store.load();const ready=store.getSnapshot();
  failing=true;const retry=store.load();
  assert.equal(store.getSnapshot().status,'loading');assert.equal(store.getSnapshot().catalog,ready.catalog);
  answer();await assert.rejects(retry);
  assert.equal(store.getSnapshot().status,'error');assert.equal(store.getSnapshot().catalog,ready.catalog);
  assert.equal(store.getSnapshot().message,'数据目录暂时无法读取或格式无效');
  assert.deepEqual(seen,['ready','loading','error']);store.dispose();
});

test('the initial state is shared until the first request, which publishes loading and then ready',async()=>{
  assert.equal(initialCatalogState.status,'loading');
  const store=createCatalogStore(respond(directory));assert.equal(store.getSnapshot(),initialCatalogState);
  const seen=[];const unsubscribe=store.subscribe(()=>seen.push(store.getSnapshot().status));
  await store.load();assert.deepEqual(seen,['ready']);assert.equal(store.getSnapshot().catalog.regions.length,2);
  unsubscribe();store.dispose();
});
