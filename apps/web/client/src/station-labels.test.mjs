import test from 'node:test';
import assert from 'node:assert/strict';
import {createStationLabeler,pointLabel} from './station-labels.ts';
const feature=(id,patch={})=>({type:'Feature',id,geometry:{type:'Point',coordinates:[123.4,41.8]},properties:{osm_id:id,display_name:'同名站',rail_mode:'rail',feature_kind:'station',label_priority:1,status:'mapped',...patch}});
const dataset=features=>({type:'FeatureCollection',features});
const paired=()=>[feature('node/1',{link_status:'confirmed',station_links:['way/2'],link_evidence:['relation/10']}),feature('way/2',{feature_kind:'station_area',link_status:'confirmed',station_links:['node/1'],link_evidence:['relation/10']})];

test('point names disclose mode consistently and never turn unnamed records into mode-only labels',()=>{
  for(const [mode,label] of Object.entries({rail:'铁路',subway:'地铁',light_rail:'轻轨',tram:'有轨电车',other:'其他轨道',unknown:'制式未标注'})){
    assert.equal(pointLabel(feature('node/1',{rail_mode:mode}).properties),'同名站 · '+label);
    assert.equal(pointLabel(feature('node/1',{rail_mode:mode,display_name:'  '}).properties),'');
  }
  assert.equal(pointLabel(feature('node/2',{feature_kind:'facility'}).properties),'同名站');
});

test('confirmed reciprocal station/area evidence yields one name but preserves every source record',()=>{
  const source=dataset(paired()),before=JSON.stringify(source),label=createStationLabeler();
  const result=label(source,source.features,null);
  assert.deepEqual(result.map(f=>f.properties.osm_id),['node/1','way/2']);
  assert.deepEqual(result.map(f=>f.properties.label_name),['同名站 · 铁路','']);
  assert.equal(JSON.stringify(source),before);
  const reversed=dataset([...source.features].reverse());
  assert.deepEqual(label(reversed,reversed.features,null),result,'source order must not choose another anchor');
});

test('same names alone, candidates, one-way links, other evidence sets or modes never suppress independent names',()=>{
  for(const patch of [{link_status:'candidate'},{station_links:[]},{link_evidence:['relation/11']},{link_evidence:[]},{rail_mode:'tram'},{display_name:'另一站'}]){
    const fs=paired();Object.assign(fs[1].properties,patch);const source=dataset(fs);
    assert.equal(createStationLabeler()(source,fs,null).filter(f=>f.properties.label_name).length,2);
  }
  const source=dataset([feature('node/1'),feature('node/2')]);
  assert.equal(createStationLabeler()(source,source.features,null).filter(f=>f.properties.label_name).length,2);
});

test('visible winner and selection follow evidence group, priority and stable source identity',()=>{
  const fs=paired(),label=createStationLabeler();fs[1].properties.label_priority=0;const source=dataset(fs);
  assert.equal(label(source,fs,null).find(f=>f.properties.label_name).properties.osm_id,'way/2');
  assert.equal(label(source,[fs[0]],null)[0].properties.label_name,'同名站 · 铁路');
  assert.equal(label(source,[fs[0]],fs[1].properties)[0].properties.label_name,'');
  assert.equal(label(source,[fs[0]],null)[0].properties.label_name,'同名站 · 铁路');
  assert.equal(label(source,[fs[0]],feature('node/99').properties)[0].properties.label_name,'同名站 · 铁路');
});
