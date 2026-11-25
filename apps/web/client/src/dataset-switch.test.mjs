import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatasetSwitch,initialSwitchState,switchMessage} from './dataset-switch.ts';
import {JsonReadTimeoutError} from './json-request.ts';

const camera={longitude:121.575,latitude:39.105,zoom:10.5};
const within={snapshot:'shenyang-old',region:'shenyang',camera,crossRegion:false};
const across={snapshot:'dalian-now',region:'dalian',camera,crossRegion:true};
const names=id=>({'shenyang':'沈阳试验区',dalian:'大连试验区'}[id]);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('a switch is one cancellable request; its status is frozen and quiet when unchanged',async()=>{
  const run=deferred(),seen=[];
  const store=createDatasetSwitch(()=>run.promise),unsubscribe=store.subscribe(()=>seen.push(store.getSnapshot().status));
  assert.equal(store.getSnapshot(),initialSwitchState);assert.equal(switchMessage(store.getSnapshot(),names),'');
  store.request(within);
  const busy=store.getSnapshot();assert.equal(busy.status,'busy');assert.equal(busy.request,within);assert(Object.isFrozen(busy));
  assert.equal(switchMessage(busy,names),'正在准备所选版本，当前地图仍可浏览…');
  run.resolve();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(store.getSnapshot().status,'done');assert.equal(store.getSnapshot().request,within);
  assert.equal(switchMessage(store.getSnapshot(),names),'已切换数据版本，筛选与查询已保留。');
  assert.deepEqual(seen,['busy','done']);unsubscribe();store.dispose();
});
test('cancelling aborts the work and reports the cancelled state; history navigation has its own wording',async()=>{
  let signal;
  const store=createDatasetSwitch((_request,current)=>{signal=current;return new Promise(()=>{});});
  store.request(within);assert.equal(signal.aborted,false);
  store.cancel();assert.equal(signal.aborted,true);assert.equal(store.getSnapshot().status,'cancelled');assert.equal(store.getSnapshot().outcome,'user');
  assert.equal(switchMessage(store.getSnapshot(),names),'已取消，继续浏览原版本。');
  store.request(within);store.cancel('history');assert.equal(store.getSnapshot().outcome,'history');
  assert.equal(switchMessage(store.getSnapshot(),names),'已取消版本切换，正在恢复历史视图。');
  const settled=store.getSnapshot();store.cancel();assert.equal(store.getSnapshot(),settled);store.dispose();
});
test('failures keep the current region in the wording and distinguish timeout from other errors',async()=>{
  const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
  for(const [error,outcome,message] of [
    [new JsonReadTimeoutError(),'timeout','版本读取超时，已保留原地图、视图和选中记录。可重试或选择其他版本。'],
    [new Error('HTTP 404'),'error','版本加载失败，已保留原地图、视图和选中记录。可重试或选择其他版本。'],
    [new DOMException('Aborted','AbortError'),'aborted','已取消，继续浏览原版本。'],
  ]){
    const store=createDatasetSwitch(async()=>{throw error;});
    store.request(within);await settle();
    assert.equal(store.getSnapshot().status,'failed');assert.equal(store.getSnapshot().outcome,outcome);assert.equal(switchMessage(store.getSnapshot(),names),message);
    store.request(across);await settle();assert.equal(store.getSnapshot().outcome,outcome);
    // An abandoned attempt was not a failed switch; a real one says which kind of switch failed.
    assert.equal(switchMessage(store.getSnapshot(),names),outcome==='aborted'?'已取消，继续浏览原版本。':'地区切换失败，已保留原地图、视图和选中记录。可重试或选择其他版本。');
    store.dispose();
  }
});
test('a newer request supersedes the earlier one, whose late result never reports over it',async()=>{
  const runs=[];const store=createDatasetSwitch((_request,signal)=>{const work=deferred();runs.push({work,signal});return work.promise;});
  store.request(within);store.request(across);
  assert.equal(runs[0].signal.aborted,true);assert.equal(runs[1].signal.aborted,false);assert.equal(store.getSnapshot().request,across);
  runs[0].work.resolve();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(store.getSnapshot().status,'busy');
  runs[1].work.resolve();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(store.getSnapshot().status,'done');
  assert.equal(store.getSnapshot().request,across);store.dispose();
});
test('retry asks again for exactly the failed request, and only after a failure',async()=>{
  const asked=[];let fail=true;
  const store=createDatasetSwitch(async request=>{asked.push(request);if(fail)throw new Error('unavailable');});
  store.retry();assert.deepEqual(asked,[]);
  store.request(across);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(store.getSnapshot().status,'failed');
  fail=false;store.retry();assert.deepEqual(asked,[across,across]);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(store.getSnapshot().status,'done');store.retry();assert.equal(asked.length,2);
  assert.equal(switchMessage(store.getSnapshot(),names),'已切换到大连试验区，筛选与查询已保留，选中已清除。');store.dispose();
});
test('a cross-region switch says so while it loads and never names the new region before it succeeded',()=>{
  const store=createDatasetSwitch(()=>new Promise(()=>{}));
  store.request(across);const loading=store.getSnapshot();
  assert.equal(switchMessage(loading,names),'正在切换地区，当前地图仍可浏览…');assert.equal(switchMessage(loading,names).includes('已切换'),false);
  assert.equal(switchMessage({...loading,status:'done'},names),'已切换到大连试验区，筛选与查询已保留，选中已清除。');
  assert.equal(switchMessage({...loading,status:'done',request:{...across,region:'unknown'}},names),'已切换到所选地区，筛选与查询已保留，选中已清除。');
  assert.equal(switchMessage({...loading,status:'done',request:{...across,crossRegion:false}},names),'已切换数据版本，筛选与查询已保留。');
  store.dispose();
});
test('a disposed store abandons its request and ignores late completion',async()=>{
  const work=deferred(),signals=[];const store=createDatasetSwitch((_request,signal)=>{signals.push(signal);return work.promise;});
  let notifications=0;store.subscribe(()=>notifications++);
  store.request(within);store.dispose();assert.equal(signals[0].aborted,true);
  work.resolve();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(store.getSnapshot().status,'busy');assert.equal(notifications,1);
  store.request(across);assert.equal(store.getSnapshot().request,within);
});
