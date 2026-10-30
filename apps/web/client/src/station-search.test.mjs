import test from 'node:test';
import assert from 'node:assert/strict';
import {createStationSearch} from './station-search.ts';
const feature=(id,name,aliases=[])=>({type:'Feature',id,geometry:{type:'Point',coordinates:[123.4,41.8]},properties:{osm_id:id,display_name:name,aliases,rail_mode:'rail',status:'mapped',feature_kind:'station'}});
const index=[feature('node/1','沈阳北',['沈阳北站']),feature('node/2','沈阳北站'),feature('way/3','沈阳站区')];
function fixture(query=''){
  const scheduled=[],commits=[];
  const store=createStationSearch(query,{onCommit:()=>commits.push(store.getSnapshot().committedQuery),debounce:callback=>{const task={callback,cancelled:false};scheduled.push(task);return ()=>{task.cancelled=true;};}});
  store.updateSource(index,'ready',()=>false);return {store,scheduled,commits};
}
test('debounce discards stale callbacks and Enter flushes only the latest query',()=>{
  const {store,scheduled,commits}=fixture();store.input('沈阳');const first=scheduled[0];store.input('沈阳北站');assert.equal(first.cancelled,true);first.callback();assert.equal(commits.length,0);assert.equal(store.getSnapshot().results.length,0);
  assert.equal(store.choice().feature.id,'node/2');assert.deepEqual(commits,['沈阳北站']);assert.equal(store.getSnapshot().pending,false);
  scheduled[1].callback();assert.equal(commits.length,1);store.input('沈阳北站');assert.equal(scheduled.length,2);
  store.dispose();
});
test('IME suspends lookup and selection through source changes; confirmation commits once and clear defeats late composition end',()=>{
  const {store,scheduled,commits}=fixture('沈阳');store.input('沈阳北');const stale=scheduled[0];store.beginComposition();store.input('syb',true);stale.callback();
  store.updateSource(index,'ready',()=>true);assert.equal(store.getSnapshot().results.length,0);assert.equal(store.choice(),undefined);store.move(1);assert.equal(store.getSnapshot().activeKey,null);assert.equal(store.flush(),false);assert.equal(commits.length,0);
  store.endComposition('沈阳北站');assert.deepEqual(commits,['沈阳北站']);assert.equal(store.getSnapshot().results.length,2);assert(store.getSnapshot().results.every(entry=>entry.hidden));
  store.input('沈阳北站');assert.equal(commits.length,1);store.beginComposition();store.input('other',true);store.clear();store.endComposition('旧输入');assert.equal(store.getSnapshot().query,'');assert.equal(store.getSnapshot().results.length,0);assert.deepEqual(commits,['沈阳北站','']);store.dispose();
});
test('keyboard navigation wraps only within displayed twenty, including initial ArrowUp to the last',()=>{
  const {store}=fixture('站');store.updateSource(Array.from({length:35},(_,i)=>feature('node/'+(100+i),'站'+String(i).padStart(2,'0'))),'ready',()=>false);
  const rows=store.getSnapshot().results;assert.equal(rows.length,20);assert.equal(store.getSnapshot().total,35);
  store.move(-1);assert.equal(store.getSnapshot().activeKey,rows.at(-1).feature.id);store.move(1);assert.equal(store.getSnapshot().activeKey,rows[0].feature.id);
  store.input('站34');assert.equal(store.getSnapshot().activeKey,null);assert.equal(store.choice().feature.properties.display_name,'站34');store.dispose();
});
test('source replacement and retry preserve input but never offer an old-snapshot feature',()=>{
  const {store}=fixture('沈阳北站');store.activate('node/1');store.updateSource(index,'unavailable',()=>false);assert.equal(store.getSnapshot().query,'沈阳北站');assert.equal(store.getSnapshot().availability,'unavailable');assert.equal(store.getSnapshot().results.length,0);
  store.input('沈阳');const newer=[feature('node/9','沈阳新记录')];store.updateSource(newer,'ready',()=>false);assert.equal(store.choice().feature.id,'node/9');
  const original=store.captureInput();store.beginComposition();store.input('未确认',true);const composing=store.captureInput();store.restore('其他');store.restoreInput(composing);assert.equal(store.getSnapshot().composing,true);assert.equal(store.getSnapshot().results.length,0);
  store.restoreInput(original);assert.equal(store.getSnapshot().query,'沈阳');assert.equal(store.getSnapshot().results[0].feature.id,'node/9');store.dispose();
});
test('hidden flags refresh without losing stable active identity; disposal cancels outstanding work',()=>{
  const {store,scheduled,commits}=fixture('沈阳北站');assert.equal(store.getSnapshot(),store.getSnapshot());store.activate('node/1');store.updateSource(index,'ready',()=>true);assert.equal(store.getSnapshot().activeKey,'node/1');assert(store.getSnapshot().results.every(entry=>entry.hidden));
  let updates=0;const unsubscribe=store.subscribe(()=>updates++);store.input('沈阳');unsubscribe();const count=updates;store.dispose();scheduled.at(-1).callback();assert.equal(updates,count);assert.equal(commits.length,0);
});
test('rollback resumes a pending query and ignores the callback from before restoration',()=>{
  const {store,scheduled,commits}=fixture('沈阳北站');store.input('沈阳');const pending=store.captureInput(),old=scheduled.at(-1);
  store.restore('其他');store.restoreInput(pending);assert.equal(store.getSnapshot().pending,true);old.callback();assert.deepEqual(commits,[]);
  scheduled.at(-1).callback();assert.deepEqual(commits,['沈阳']);assert.equal(store.getSnapshot().pending,false);
  store.updateSource(index,'blocked',()=>false);assert.equal(store.choice(),undefined);assert.equal(store.getSnapshot().query,'沈阳');store.dispose();
});
