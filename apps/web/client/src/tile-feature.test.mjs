import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTileFeature} from './tile-feature.ts';
import {validateRailFeature} from './dataset-validation.ts';
const feature=()=>({type:'Feature',geometry:{type:'Point',coordinates:[123.4,41.8]},properties:{osm_id:'node/1',display_name:'示例',rail_mode:'rail',status:'mapped',feature_kind:'facility',line_class:'unknown',line_keys:'["metro/1"]',station_links:'["node/2"]',anchor:'[123.4,41.8]'}});
test('rendered MVT arrays decode at the tile boundary without mutating source properties',()=>{
  const wire=feature(),decoded=decodeTileFeature(wire);
  assert.deepEqual(decoded.properties.line_keys,['metro/1']);assert.deepEqual(decoded.properties.station_links,['node/2']);assert.deepEqual(decoded.properties.anchor,[123.4,41.8]);
  assert.equal(wire.properties.line_keys,'["metro/1"]');
  assert.throws(()=>validateRailFeature(wire),'the same scalar coercion must not leak into source JSON');
});
test('rendered MVT decoder rejects malformed JSON, wrong array elements and invalid anchors',()=>{
  for(const [key,value] of [['line_keys','oops'],['line_keys','[123]'],['station_links','{}'],['anchor','[999,42]']]){const wire=feature();wire.properties[key]=value;assert.throws(()=>decodeTileFeature(wire));}
});
test('tile-clipped multipolygons are accepted only at the rendered boundary',()=>{
  const wire=feature();wire.geometry={type:'MultiPolygon',coordinates:[[[[123,41],[124,41],[124,42],[123,41]]]]};
  assert.equal(decodeTileFeature(wire).geometry.type,'MultiPolygon');
  const decoded=decodeTileFeature(wire);assert.throws(()=>validateRailFeature(decoded),'normalized node/way source contract remains Point/LineString/Polygon');
  decoded.geometry.coordinates[0][0][3]=[125,42];assert.throws(()=>decodeTileFeature(decoded));
});
