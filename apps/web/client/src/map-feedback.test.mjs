import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapFeedback,sourceDateLabel} from './map-feedback.ts';

test('feedback changes are atomic, immutable and quiet for unchanged camera hints',()=>{
  const store=createMapFeedback(),observed=[];
  const unsubscribe=store.subscribe(()=>observed.push(store.getSnapshot()));
  store.update({navigation:'快照不可用',currentVersionRecovery:true});
  const failed=store.getSnapshot();
  assert.equal(observed.length,1);assert.equal(failed.currentVersionRecovery,true);
  assert.throws(()=>{failed.navigation='';},TypeError);
  store.update({navigation:'快照不可用',currentVersionRecovery:true});
  assert.equal(store.getSnapshot(),failed);assert.equal(observed.length,1);
  store.update({navigation:'',currentVersionRecovery:false,status:'铁路地图已就绪'});
  assert.deepEqual(observed.at(-1),{...failed,navigation:'',currentVersionRecovery:false,status:'铁路地图已就绪'});
  unsubscribe();store.update({notice:'超出覆盖'});assert.equal(observed.length,2);
});
test('disposed feedback ignores late async completions',()=>{
  const store=createMapFeedback();let calls=0;store.subscribe(()=>calls++);
  const before=store.getSnapshot();store.dispose();store.update({status:'迟到响应',currentVersionRecovery:true});
  assert.equal(store.getSnapshot(),before);assert.equal(calls,0);
});
test('source date follows direct and nested OSM source metadata with explicit missing fallback',()=>{
  assert.equal(sourceDateLabel({osm_base:'2026-10-20T20:23:47Z'}),'铁路数据 2026-10-20');
  assert.equal(sourceDateLabel({osm_base:{osm_base:'2026-10-21T00:00:00Z'}}),'铁路数据 2026-10-21');
  assert.equal(sourceDateLabel({osm_timestamp:'2026-10-22T00:00:00Z'}),'铁路数据 2026-10-22');
  assert.equal(sourceDateLabel({source_time:'2026-10-23T00:00:00Z'}),'铁路数据 2026-10-23');
  assert.equal(sourceDateLabel({osm_base:null}),'源数据时间见关于数据');
  assert.equal(sourceDateLabel(undefined),'源数据时间见关于数据');
});
