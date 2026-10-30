import test from 'node:test';
import assert from 'node:assert/strict';
import {captureShareContext} from './share-session.ts';
import {defaultView,encodeView,decodeView} from './view-state.ts';
test('single-line sharing captures visible and original filters without changing source arrays',()=>{
  const view=defaultView();view.snapshot='sample';view.feature='node/42';view.query='沈阳';view.filters.lineKeys=['line-a','line-b'];view.filters.types=['rail'];view.filters.states=[];view.filters.facilities=true;
  const before=structuredClone(view),context=captureShareContext(view,'line-c',true);
  assert.deepEqual(view,before);assert.deepEqual(context.original,before);assert.deepEqual(context.visible.filters.types,['subway','light_rail','tram']);assert.deepEqual(context.visible.filters.lineKeys,['line-c']);assert.deepEqual(context.visible.filters.states,[]);assert.equal(context.visible.feature,'node/42');assert.equal(context.temporaryFeature,true);
  for(const mode of ['visible','original']){const decoded=decodeView(encodeView(context[mode])).view;assert.equal(decoded.snapshot,'sample');assert.equal(decoded.feature,'node/42');assert.equal(decoded.query,'沈阳');assert.deepEqual(decoded.filters.states,[]);assert.equal(decoded.filters.facilities,true);}
  view.filters.types.push('unknown');view.filters.lineKeys.pop();view.query='later';assert.deepEqual(context.original,before);assert.equal(context.visible.query,'沈阳');
});
test('no isolation and explicit empty line selection stay explicit in both share modes',()=>{
  const view=defaultView();view.filters.lineKeys=[];view.filters.types=[];view.filters.classes=[];
  const context=captureShareContext(view,null,false);assert.deepEqual(context.visible,context.original);
  for(const mode of ['visible','original'])assert.deepEqual(decodeView(encodeView(context[mode])).view.filters.lineKeys,[]);
  context.visible.filters.types.push('tram');assert.deepEqual(context.original.filters.types,[]);assert.deepEqual(view.filters.types,[]);
});
