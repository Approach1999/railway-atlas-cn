import test from 'node:test';
import assert from 'node:assert/strict';
import {joinOwnLineFragments} from './line-label-fragments.ts';
const f=(id,coordinates,patch={})=>({type:'Feature',geometry:{type:'LineString',coordinates},properties:{osm_id:id,display_name:'同名线路',rail_mode:'rail',feature_kind:'track',status:'mapped',...patch}});
test('only same-ID equal-metadata fragments with shared endpoints assemble, independently of input orientation/order',()=>{
  const fs=[f('way/1',[[123,41],[124,41]]),f('way/1',[[125,41],[124,41]]),f('way/1',[[125,41],[126,41]])],before=JSON.stringify(fs);
  const result=joinOwnLineFragments(fs);assert.equal(result.joins,2);assert.equal(result.features.length,1);
  assert.deepEqual(result.features[0].geometry.coordinates,[[123,41],[124,41],[125,41],[126,41]]);
  assert.deepEqual(joinOwnLineFragments([...fs].reverse()),result);assert.equal(JSON.stringify(fs),before);
  assert.deepEqual(joinOwnLineFragments([...fs,fs[1]]),result);
});
test('names alone, different attributes, branch ambiguity, gaps and interior overlaps are never joined',()=>{
  for(const fs of [
    [f('way/1',[[123,41],[124,41]]),f('way/2',[[124,41],[125,41]])],
    [f('way/1',[[123,41],[124,41]]),f('way/1',[[124,41],[125,41]],{status:'disused'})],
    [f('way/1',[[123,41],[124,41]]),f('way/1',[[124.00001,41],[125,41]])],
    [f('way/1',[[123,41],[124,41]]),f('way/1',[[123.5,41],[125,41]])],
    [f('way/1',[[123,41],[124,41]]),f('way/1',[[124,41],[125,41]]),f('way/1',[[124,41],[124,42]])],
  ])assert.equal(joinOwnLineFragments(fs).joins,0);
});
test('closed same-way loops terminate and retain every source edge',()=>{
  const result=joinOwnLineFragments([f('way/1',[[123,41],[124,41]]),f('way/1',[[124,41],[124,42]]),f('way/1',[[124,42],[123,41]])]);
  assert.equal(result.joins,2);assert.equal(result.features[0].geometry.coordinates.length,4);
  assert.deepEqual(result.features[0].geometry.coordinates[0],result.features[0].geometry.coordinates.at(-1));
});
