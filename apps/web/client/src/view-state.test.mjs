import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defaultView,encodeView,decodeView,regionProfile,regionView,defaultRegion} from './view-state.ts';
import {parseRegionConfig} from './catalog-validation.ts';

// The real registry, so these checks follow the regions the build actually ships.
const config=parseRegionConfig(JSON.parse(fs.readFileSync(new URL('../../../../config/catalog.json',import.meta.url),'utf8')));
const other=config.regions.find(region=>region.id!==config.default_region);

test('share round trip keeps typed identity, full filters, labels and empty selections',()=>{
  const view=defaultView(config);Object.assign(view,{snapshot:'shenyang-mvp-work-20261022',feature:'node/6179162407',query:'沈阳站',zoom:15.5});
  Object.assign(view.filters,{types:['subway','tram'],classes:[],states:['construction','mapped'],lineKeys:[],facilities:true,stationNames:false});
  const result=decodeView(encodeView(view),config);assert.deepEqual(result.warnings,[]);
  assert.equal(result.view.feature,view.feature);assert.equal(result.view.query,view.query);
  assert.deepEqual(result.view.filters.lineKeys,[]);assert.deepEqual(result.view.filters.classes,[]);
  assert.equal(result.view.filters.facilities,true);assert.equal(result.view.filters.stationNames,false);
  assert.equal(result.view.zoom,15.5);assert.equal(result.view.region,config.default_region);assert.equal(result.regionInLink,true);
});
test('invalid values do not become script, unsafe snapshot paths or out of range camera moves',()=>{
  const {view,warnings}=decodeView('/?snapshot=../../secret&feature=javascript:alert(1)&types=rail,nope&region=unknown#map=99/999/999',config);
  assert.equal(view.snapshot,'');assert.equal(view.feature,null);assert.deepEqual(view.filters.types,['rail']);
  assert.equal(view.latitude,defaultRegion(config).default_view.latitude);assert(warnings.length>=4);
  // An unpublished region is announced as having no data, not as having no railways, and the view returns to the default region.
  assert.match(warnings.join(' '),/暂无数据/);assert.match(warnings.join(' '),new RegExp(defaultRegion(config).name));
  assert.equal(view.region,config.default_region);
  const shaped=decodeView('/?region=<script>alert(1)</script>',config);
  assert.equal(shaped.view.region,config.default_region);assert.match(shaped.warnings.join(' '),/地区参数无效/);
  assert.doesNotMatch(shaped.warnings.join(' '),/<script>/);
});
test('unknown and duplicate parameters are reported, first valid occurrence wins',()=>{
  const {view,warnings}=decodeView('/?types=rail&types=tram&extra=1&lines=shenyang-metro/1,shenyang-metro/10',config);
  assert.deepEqual(view.filters.types,['rail']);assert.equal(view.filters.lineKeys.length,2);assert(warnings.length>=2);
});
test('long addresses fall back without loading arbitrary snapshot paths',()=>{
  const result=decodeView('/?q='+'字'.repeat(9000),config);assert.equal(result.view.snapshot,'');assert(result.warnings.length);
});
test('a link naming a configured region without a camera starts in that region, and a linked camera still wins',()=>{
  assert(other,'the registry must contain a region other than the default for this check');
  const view=decodeView('/?region='+other.id,config);
  assert.deepEqual(view.warnings,[]);assert.equal(view.view.region,other.id);
  assert.deepEqual([view.view.longitude,view.view.latitude,view.view.zoom],[other.default_view.longitude,other.default_view.latitude,other.default_view.zoom]);
  assert.notEqual(view.view.longitude,defaultRegion(config).default_view.longitude);
  const camera=decodeView('/?region='+other.id+'#map=12/30/100',config).view;
  assert.equal(camera.region,other.id);assert.deepEqual([camera.longitude,camera.latitude,camera.zoom],[100,30,12]);
  assert.equal(decodeView('/',config).view.region,config.default_region);assert.equal(decodeView('/',config).regionInLink,false);
});
test('filters and queries carried by a link are kept as given for the target region to evaluate',()=>{
  assert(other);
  const {view,warnings}=decodeView('/?region='+other.id+'&lines=shenyang-metro/1&q=沈阳&types=subway',config);
  assert.deepEqual(view.filters.lineKeys,['shenyang-metro/1']);assert.equal(view.query,'沈阳');assert.deepEqual(view.filters.types,['subway']);assert.deepEqual(warnings,[]);
});
test('each region view owns its filters, and an unknown id resolves to no profile',()=>{
  const first=regionView(defaultRegion(config));first.filters.types.push('tram');first.filters.lineKeys=[];
  assert.deepEqual(regionView(defaultRegion(config)).filters.types,['rail','other','unknown']);assert.equal(regionView(defaultRegion(config)).filters.lineKeys,null);
  assert.equal(regionProfile(config,'not-a-region'),undefined);assert.equal(regionProfile(config,null),undefined);
  assert.equal(regionProfile(config,other?.id)?.id,other?.id);
});
