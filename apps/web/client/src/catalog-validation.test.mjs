import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalog} from './catalog-validation.ts';

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
