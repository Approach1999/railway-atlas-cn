import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeaturePanels} from './feature-details.ts';
const feature=id=>({type:'Feature',geometry:{type:'Point',coordinates:[123.4,41.8]},properties:{osm_id:id,display_name:id,rail_mode:'rail',status:'mapped'}});
test('late detail responses cannot replace a newer selection or reopen a closed panel',()=>{
  const store=createFeaturePanels(),a=feature('node/1'),b=feature('node/2');
  const first=store.begin(a,'snapshot-a',[]),second=store.begin(b,'snapshot-b',[]);
  assert.equal(store.complete(first,a),false);assert.equal(store.fail(first,'old error'),false);
  assert.equal(store.complete(second,a),false);assert.equal(store.complete(second,b),true);
  assert.equal(store.getSnapshot().snapshot,'snapshot-b');assert.equal(store.getSnapshot().detail.feature,b);
  store.close();assert.equal(store.fail(second,'late error'),false);assert.equal(store.complete(second,b),false);assert.equal(store.getSnapshot().detail.status,'closed');
});
test('retry keeps source context and candidate dismissal preserves the selected detail',()=>{
  const store=createFeaturePanels(),a=feature('node/1'),lines=[];
  const first=store.begin(a,'snapshot-a',lines);store.fail(first,'unavailable');assert.equal(store.getSnapshot().detail.status,'error');
  const retry=store.begin(a,store.getSnapshot().snapshot,store.getSnapshot().lines);assert.equal(store.fail(first,'stale'),false);assert.equal(store.complete(retry,a),true);
  const candidates=[a,feature('way/2')];store.showCandidates(candidates);candidates.pop();assert.equal(store.getSnapshot().candidates.length,2);assert(Object.isFrozen(store.getSnapshot().candidates));
  store.closeCandidates();assert.equal(store.getSnapshot().detail.status,'ready');assert.equal(store.getSnapshot().candidates.length,0);
  let notifications=0;store.subscribe(()=>notifications++);store.dispose();assert.equal(store.complete(retry,a),false);store.close();assert.equal(notifications,0);
});
