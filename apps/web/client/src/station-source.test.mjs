import test from 'node:test';
import assert from 'node:assert/strict';
import {createStationSourceUpdater} from './station-source.ts';
const feature=(id,name=id)=>({type:'Feature',geometry:{type:'Point',coordinates:[123.4,41.8]},properties:{osm_id:id,display_name:name}});

test('unchanged station visibility skips worker updates, selection and mode changes restore exact ordered identities',()=>{
  const calls=[],source={setData:data=>calls.push(data)},update=createStationSourceUpdater();
  const dataset={type:'FeatureCollection',features:[feature('node/1'),feature('node/2')]};
  assert.equal(update(source,dataset,dataset.features),true);
  assert.equal(update(source,dataset,dataset.features.map(value=>({...value,properties:{...value.properties}}))),false);
  assert.equal(update(source,dataset,dataset.features.slice(1)),true);
  assert.equal(update(source,dataset,dataset.features),true);
  assert.equal(update(source,dataset,[]),true);assert.equal(update(source,dataset,[]),false);
  assert.deepEqual(calls.map(call=>call.features.map(value=>value.properties.osm_id)),[['node/1','node/2'],['node/2'],['node/1','node/2'],[]]);
});

test('same IDs in a new snapshot and a replaced map source still publish, failed writes remain retryable',()=>{
  const calls=[],source={setData:data=>calls.push(data)},update=createStationSourceUpdater();
  const first={type:'FeatureCollection',features:[feature('node/1','旧名称')]};
  const second={type:'FeatureCollection',features:[feature('node/1','新名称')]};
  update(source,first,first.features);update(source,second,second.features);
  assert.equal(calls[1].features[0].properties.display_name,'新名称');
  const replacement={setData:data=>calls.push(data)};
  assert.equal(update(replacement,second,second.features),true);
  let attempts=0;const failing={setData:()=>{if(++attempts===1)throw Error('source lost');}};
  assert.throws(()=>update(failing,second,second.features),/source lost/);
  assert.equal(update(failing,second,second.features),true);assert.equal(attempts,2);
});

test('selection may change a linked station label without changing visible identities',()=>{
  const calls=[],source={setData:data=>calls.push(data)},update=createStationSourceUpdater();
  const first=feature('node/1');first.properties.label_name='同名站 · 铁路';const dataset={type:'FeatureCollection',features:[first]};
  const hidden={...first,properties:{...first.properties,label_name:''}};
  assert.equal(update(source,dataset,[first]),true);
  assert.equal(update(source,dataset,[hidden]),true);assert.equal(update(source,dataset,[hidden]),false);
  assert.equal(update(source,dataset,[first]),true);
  assert.deepEqual(calls.map(call=>call.features[0].properties.label_name),['同名站 · 铁路','','同名站 · 铁路']);
});
