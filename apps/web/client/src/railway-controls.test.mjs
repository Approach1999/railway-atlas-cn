import test from 'node:test';
import assert from 'node:assert/strict';
import {createRailwayControls,initialFilterSession,reduceFilters} from './railway-controls.ts';
import {DEFAULTS,expandedState} from '../../shared/model.mjs';
const defaults=()=>expandedState(DEFAULTS);
test('preset undo restores all earlier filter options and explicit empty line selection',()=>{
  const before={...defaults(),preset:'custom',types:['rail'],classes:['branch'],states:['construction'],history:true,lineKeys:[],facilities:true,lineNames:false,stationNames:false,sidings:false};
  const initial=initialFilterSession(before),urban=reduceFilters(initial,{type:'preset',preset:'urban'});
  assert.deepEqual(urban.filters.types,['subway','light_rail','tram']);assert.equal(urban.filters.facilities,false);
  assert.deepEqual(reduceFilters(urban,{type:'undo'}).filters,before);
  before.types.push('tram');assert.deepEqual(initial.filters.types,['rail']);
  assert.throws(()=>initial.filters.types.push('subway'));assert.throws(()=>urban.previous.lineKeys.push('one'));
});
test('temporary single-line view exits without replacing persistent line choices and survives unrelated options',()=>{
  let session=initialFilterSession({...defaults(),lineKeys:['metro/2','metro/4']});
  session=reduceFilters(session,{type:'isolate',key:'metro/1'});assert.deepEqual(session.filters.lineKeys,['metro/2','metro/4']);
  session=reduceFilters(session,{type:'option',key:'facilities',enabled:true});assert.equal(session.isolatedLine,'metro/1');
  session=reduceFilters(session,{type:'isolate',key:null});assert.deepEqual(session.filters.lineKeys,['metro/2','metro/4']);assert.equal(session.filters.facilities,true);
  session=reduceFilters(session,{type:'line',key:'metro/2',enabled:false,available:['metro/1','metro/2','metro/4']});assert.deepEqual(session.filters.lineKeys,['metro/4']);
  session=reduceFilters(session,{type:'line',key:'metro/4',enabled:false,available:[]});assert.deepEqual(session.filters.lineKeys,[]);
  assert.equal(reduceFilters(session,{type:'all-lines'}).filters.lineKeys,null);
});
test('empty mode/status selections remain empty and history option has explicit custom-state semantics',()=>{
  let session=initialFilterSession({...defaults(),types:['rail'],states:['mapped']});
  session=reduceFilters(session,{type:'dimension',field:'types',value:'rail',enabled:false});
  session=reduceFilters(session,{type:'dimension',field:'states',value:'mapped',enabled:false});
  assert.deepEqual(session.filters.types,[]);assert.deepEqual(session.filters.states,[]);assert.equal(session.filters.history,false);
  session=reduceFilters(session,{type:'option',key:'history',enabled:true});assert(session.filters.states.includes('construction'));
  session=reduceFilters(session,{type:'option',key:'history',enabled:false});assert.deepEqual(session.filters.states,['mapped']);assert.deepEqual(session.filters.types,[]);
});
test('store snapshot is stable between updates; URL restore and rollback preserve the intended session',()=>{
  const store=createRailwayControls(defaults(),10.5);assert.equal(store.getSnapshot(),store.getSnapshot());
  let notifications=0;const unsubscribe=store.subscribe(()=>notifications++);
  store.dispatch({type:'undo'});assert.equal(notifications,0);
  store.dispatch({type:'preset',preset:'urban'});store.dispatch({type:'isolate',key:'metro/2'});const prior=store.getSnapshot().session;
  store.dispatch({type:'restore',filters:{...defaults(),preset:'custom',types:[],states:[],lineKeys:[]}});
  assert.equal(store.getSnapshot().session.isolatedLine,null);assert.deepEqual(store.getSnapshot().session.filters.lineKeys,[]);
  store.restoreSession(prior);assert.equal(store.getSnapshot().session.isolatedLine,'metro/2');
  assert.deepEqual(store.getSnapshot().session.previous,defaults());
  const session=store.getSnapshot().session;store.updateData({ready:true,zoom:15,schemaVersion:2});assert.equal(store.getSnapshot().session,session);
  store.dispatch({type:'discard-undo'});assert.equal(store.getSnapshot().session.previous,null);assert.equal(store.getSnapshot().session.isolatedLine,'metro/2');
  unsubscribe();const count=notifications;store.dispatch({type:'isolate',key:null});assert.equal(notifications,count);store.dispose();
});
test('unchanged camera metadata does not publish a new controls snapshot or wake subscribers',()=>{
  const store=createRailwayControls(defaults(),15.5);let count=0;store.subscribe(()=>count++);const initial=store.getSnapshot();
  for(let i=0;i<300;i++)store.updateData({zoom:15.5,schemaVersion:0});store.updateData({});assert.equal(count,0);assert.equal(store.getSnapshot(),initial);
  store.updateData({zoom:16});assert.equal(count,1);assert.equal(store.getSnapshot().data.zoom,16);assert.equal(store.getSnapshot().session,initial.session);
  store.updateData({zoom:16});assert.equal(count,1);store.dispose();
});
