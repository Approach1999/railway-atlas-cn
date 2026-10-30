import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultView,encodeView,decodeView} from './view-state.ts';

test('share round trip keeps typed identity, full filters, labels and empty selections',()=>{
  const view=defaultView();Object.assign(view,{snapshot:'shenyang-mvp-work-20261022',feature:'node/6179162407',query:'沈阳站',zoom:15.5});
  Object.assign(view.filters,{types:['subway','tram'],classes:[],states:['construction','mapped'],lineKeys:[],facilities:true,stationNames:false});
  const result=decodeView(encodeView(view));assert.deepEqual(result.warnings,[]);
  assert.equal(result.view.feature,view.feature);assert.equal(result.view.query,view.query);
  assert.deepEqual(result.view.filters.lineKeys,[]);assert.deepEqual(result.view.filters.classes,[]);
  assert.equal(result.view.filters.facilities,true);assert.equal(result.view.filters.stationNames,false);
  assert.equal(result.view.zoom,15.5);
});
test('invalid values do not become script, unsafe snapshot paths or out of range camera moves',()=>{
  const {view,warnings}=decodeView('/?snapshot=../../secret&feature=javascript:alert(1)&types=rail,nope&region=unknown#map=99/999/999');
  assert.equal(view.snapshot,'');assert.equal(view.feature,null);assert.deepEqual(view.filters.types,['rail']);
  assert.equal(view.latitude,41.8);assert(warnings.length>=4);
});
test('unknown and duplicate parameters are reported, first valid occurrence wins',()=>{
  const {view,warnings}=decodeView('/?types=rail&types=tram&extra=1&lines=shenyang-metro/1,shenyang-metro/10');
  assert.deepEqual(view.filters.types,['rail']);assert.equal(view.filters.lineKeys.length,2);assert(warnings.length>=2);
});
test('long addresses fall back without loading arbitrary snapshot paths',()=>{
  const result=decodeView('/?q='+'字'.repeat(9000));assert.equal(result.view.snapshot,'');assert(result.warnings.length);
});
