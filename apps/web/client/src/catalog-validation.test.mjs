import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalog,parseRegionConfig} from './catalog-validation.ts';

function valid(){return {schema_version:1,regions:[{id:'shenyang',name:'沈阳试验区',current_snapshot:'current',
  default_view:{longitude:123.42,latitude:41.8,zoom:10.5},snapshots:[{id:'current',object_list:true,build_time:'2026-10-23T05:24:30.123456+00:00',retention_until:null},{id:'previous',object_list:false}]}]};}

test('directory parsing normalizes optional dates and does not retain input object references',()=>{
  const input=valid(),result=parseCatalog(input);
  assert.equal(result.regions[0].snapshots[0].retention_until,undefined);
  assert.equal(result.regions[0].snapshots[1].object_list,false);
  input.regions[0].name={bad:true};input.regions[0].default_view.longitude=null;input.regions[0].snapshots[0].id='../escape';
  assert.equal(result.regions[0].name,'沈阳试验区');assert.equal(result.regions[0].default_view.longitude,123.42);
  assert.equal(result.regions[0].snapshots[0].id,'current');
});

test('malformed identity, display, camera and capabilities never enter the directory',()=>{
  const mutations=[
    value=>{value.schema_version='1';},value=>{value.regions=[];},value=>{value.regions=[null];},
    value=>{delete value.regions[0].id;},value=>{value.regions[0].id='../shenyang';},value=>{value.regions.push(structuredClone(value.regions[0]));},
    value=>{value.regions[0].name={bad:true};},value=>{value.regions[0].name='  ';},
    value=>{value.regions[0].default_view.longitude=null;},value=>{value.regions[0].default_view.longitude='123.42';},
    value=>{value.regions[0].default_view.latitude=86;},value=>{value.regions[0].default_view.zoom=19;},
    value=>{value.regions[0].default_view.zoom=NaN;},value=>{value.regions[0].default_view.longitude=Infinity;},
    value=>{value.regions[0].snapshots=[];},value=>{value.regions[0].snapshots[0]=null;},
    value=>{delete value.regions[0].snapshots[0].id;},value=>{value.regions[0].snapshots[0].id='../current';},
    value=>{value.regions[0].snapshots.push(structuredClone(value.regions[0].snapshots[0]));},
    value=>{value.regions[0].snapshots[0].object_list='false';},value=>{value.regions[0].snapshots[0].object_list=undefined;},
    value=>{value.regions[0].snapshots[0].build_time={bad:true};},value=>{value.regions[0].snapshots[0].build_time='not a date';},
    value=>{value.regions[0].snapshots[0].retention_until='2027-01-01';},value=>{value.regions[0].current_snapshot='unlisted';},
  ];
  for(const mutate of mutations){const value=valid();mutate(value);assert.throws(()=>parseCatalog(value),/数据目录无效/);}
  for(const value of [null,[],true,'catalog'])assert.throws(()=>parseCatalog(value),/数据目录无效/);
});

test('three-snapshot directory metadata fixture retains dates and actual list capability without local raw data',()=>{
  const input=JSON.parse(readFileSync(new URL('./fixtures/catalog.json',import.meta.url),'utf8'));
  const output=parseCatalog(input);
  assert.deepEqual(output.regions[0].snapshots.map(snapshot=>snapshot.id),input.regions[0].snapshots.map(snapshot=>snapshot.id));
  assert.deepEqual(output.regions[0].snapshots.map(snapshot=>snapshot.object_list),[true,true,false]);
  assert.deepEqual(output.regions[0].snapshots.map(({build_time,retention_until})=>({build_time,retention_until})),
    input.regions[0].snapshots.map(({build_time,retention_until})=>({build_time,retention_until})));
});

const registry=()=>JSON.parse(readFileSync(new URL('../../../../config/catalog.json',import.meta.url),'utf8'));
test('the shipped region registry parses into unique regions, a default region and complete interface copy',()=>{
  const source=registry(),config=parseRegionConfig(source);
  assert.equal(config.default_region,source.default_region);assert(config.regions.length>=2);
  assert.equal(new Set(config.regions.map(region=>region.id)).size,config.regions.length);
  assert(config.regions.some(region=>region.id===config.default_region));
  for(const region of config.regions){
    for(const text of [region.id,region.name,region.city,region.caption,region.description,...Object.values(region.ui).filter(Boolean)])assert.equal(typeof text,'string');
    assert(region.name&&region.city&&region.caption&&region.description);
    assert(region.ui.headline&&region.ui.browse_start&&region.ui.search_placeholder&&region.ui.about_scope);
    assert(region.default_view.zoom>=8&&region.default_view.zoom<=18&&Math.abs(region.default_view.latitude)<=85.051129);
  }
  // Each region starts somewhere else; a registry whose regions share a camera could not tell them apart.
  const cameras=config.regions.map(region=>JSON.stringify(region.default_view));assert.equal(new Set(cameras).size,cameras.length);
  // No region reuses another's caption or headline, which would mislabel the map.
  for(const field of ['caption','city'])assert.equal(new Set(config.regions.map(region=>region[field])).size,config.regions.length);
  source.regions[0].name='changed later';source.regions[0].ui.headline='changed later';source.regions[0].default_view.zoom=18;
  assert.notEqual(config.regions[0].name,'changed later');assert.notEqual(config.regions[0].ui.headline,'changed later');assert.equal(config.regions[0].default_view.zoom,10.5);
});
test('a malformed region registry is refused rather than shown with missing names or cameras',()=>{
  const mutate=[
    value=>{value.schema_version='1';},value=>{delete value.default_region;},value=>{value.default_region='missing';},
    value=>{value.default_region=1;},value=>{value.regions=[];},value=>{value.regions=[null];},
    value=>{value.regions.push(structuredClone(value.regions[0]));},value=>{value.regions[0].id='../shenyang';},value=>{value.regions[0].id=7;},
    value=>{delete value.regions[0].ui;},value=>{value.regions[0].ui=null;},
    ...['name','city','caption','description'].map(field=>value=>{value.regions[0][field]='  ';}),
    ...['headline','browse_start','search_placeholder','about_scope'].map(field=>value=>{value.regions[0].ui[field]='';}),
    value=>{value.regions[0].ui.search_example=5;},
    value=>{value.regions[0].default_view.zoom=19;},value=>{value.regions[0].default_view.latitude=NaN;},value=>{delete value.regions[0].default_view;},
  ];
  for(const change of mutate){const value=registry();change(value);assert.throws(()=>parseRegionConfig(value),/地区配置无效/);}
  for(const value of [null,[],true,'regions'])assert.throws(()=>parseRegionConfig(value),/地区配置无效/);
  // An empty search example and leading or trailing spaces in copy are normalised, not refused.
  const value=registry();value.regions[0].ui.search_example='';value.regions[0].ui.search_example='  大连  ';
  assert.equal(parseRegionConfig(value).regions[0].ui.search_example,'大连');
});
