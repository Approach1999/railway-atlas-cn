import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeQuantizedFeature as normalize,normalizationStats} from './quantized-geometry.mjs';
const feature=(type,geometry)=>({type,geometry,tags:{osm_id:'way/1',display_name:'原名'}});
test('rounding duplicates disappear without moving surviving coordinates or mutating cached tiles',()=>{
 const source=feature(2,[[[0,0],[0,0],[2,3],[2,3],[5,6]]]),before=structuredClone(source),stats=normalizationStats();
 assert.deepEqual(normalize(source,stats),feature(2,[[[0,0],[2,3],[5,6]]]));assert.deepEqual(source,before);assert.equal(stats.duplicate_vertices_removed,2);
});
test('collapsed line parts and features are reported; surviving split pieces keep identity',()=>{
 const stats=normalizationStats(),result=normalize(feature(2,[[[1,1],[1,1]],[[4,4],[5,5]]]),stats);
 assert.deepEqual(result.geometry,[[[4,4],[5,5]]]);assert.equal(result.tags.osm_id,'way/1');assert.equal(stats.collapsed_line_parts,1);
 assert.equal(normalize(feature(2,[[[1,1],[1,1]]]),stats),null);assert.equal(stats.collapsed_features,1);
});
const outer=[[0,0],[6,0],[6,6],[0,6],[0,0]],hole=[[1,1],[1,2],[2,2],[2,1],[1,1]],flat=[[0,0],[1,1],[2,2],[0,0]];
test('polygon exterior/hole winding and a genuine closed line are preserved',()=>{
 assert.deepEqual(normalize(feature(3,[outer,hole])),feature(3,[outer,hole]));
 assert.deepEqual(normalize(feature(2,[[[0,0],[1,1],[0,0]]])).geometry,[[[0,0],[1,1],[0,0]]]);
});
test('zero-area polygon is omitted, and an ambiguous following hole cannot become filled area',()=>{
 const stats=normalizationStats();assert.equal(normalize(feature(3,[flat]),stats),null);assert.equal(stats.collapsed_polygon_rings,1);
 assert.throws(()=>normalize(feature(3,[flat,hole])),/ambiguous/);assert.throws(()=>normalize(feature(3,[outer,flat,hole])),/ambiguous/);
 assert.deepEqual(normalize(feature(3,[flat,outer])).geometry,[outer]);
});
test('invalid integer/closure/geometry input fails instead of silently snapping or changing type',()=>{
 assert.throws(()=>normalize(feature(2,[[[0,0],[1.1,1]]])),/non-integer/);
 assert.throws(()=>normalize(feature(3,[[[0,0],[1,0],[1,1],[0,1]]])),/unclosed/);
 assert.throws(()=>normalize(feature(9,[])),/unsupported/);
 const point=feature(1,[[2,3]]);assert.deepEqual(normalize(point),point);
});
