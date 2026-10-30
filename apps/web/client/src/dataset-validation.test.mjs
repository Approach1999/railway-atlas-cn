import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRailProperties,validateRailFeature,validateObjectIndex,validateLines} from './dataset-validation.ts';
const properties=()=>({osm_id:'node/1',display_name:'示例站',feature_kind:'station',rail_mode:'rail',status:'mapped',line_class:'unknown',aliases:[],line_keys:[],osm_version:2,tags:{railway:'station'}});
const feature=()=>({type:'Feature',properties:properties(),geometry:{type:'Point',coordinates:[123.4,41.8]}});
test('data boundary rejects coercible enums, bad metadata, aliases and original tags',()=>{
  validateRailProperties(properties());
  for(const mutation of [p=>p.rail_mode=['rail'],p=>p.status=['mapped'],p=>p.feature_kind=['station'],p=>p.line_class=['unknown'],p=>p.anchor=[Infinity,41.8],p=>p.aliases=[null],p=>p.tags={railway:123},p=>p.osm_version='2',p=>p.station_links='node/2',p=>p.line_shared='false']){
    const value=properties();mutation(value);assert.throws(()=>validateRailProperties(value));
  }
});
test('geometry boundary accepts supported WGS84 forms and rejects empty, open or invalid coordinates',()=>{
  validateRailFeature(feature());
  for(const geometry of [
    {type:'LineString',coordinates:[[123,41],[124,42]]},
    {type:'MultiLineString',coordinates:[[[123,41],[124,42]]]},
    {type:'Polygon',coordinates:[[[123,41],[124,41],[124,42],[123,41]]]},
  ])validateRailFeature({...feature(),geometry});
  for(const geometry of [
    {type:'Point',coordinates:[181,41]}, {type:['Point'],coordinates:[123,41]},
    {type:'LineString',coordinates:[[123,41]]}, {type:'MultiLineString',coordinates:[]},
    {type:'Polygon',coordinates:[[[123,41],[124,41],[124,42]]]},
    {type:'Polygon',coordinates:[[[123,41],[124,41],[124,42],[123,42]]]},
    {type:'Point',coordinates:[123,NaN]},
  ])assert.throws(()=>validateRailFeature({...feature(),geometry}));
});
test('object list refuses mixed snapshot identity, duplicate source objects and invalid record shapes',()=>{
  const value={snapshot_id:'fixture',records:[properties()]};validateObjectIndex(value,'fixture');
  assert.throws(()=>validateObjectIndex(value,'other'));
  assert.throws(()=>validateObjectIndex({...value,records:[properties(),properties()]},'fixture'));
  assert.throws(()=>validateObjectIndex({...value,records:[{...properties(),aliases:'站名'}]},'fixture'));
});
test('unknown operator stays null while urban line identity and original tags remain strongly checked',()=>{
  const line={line_key:'osm/relation/1',operator_key:null,name:'示例电车',ref:'1',mode:'tram',relation_ids:['relation/1'],source_tags:[{route:'tram'}]};
  validateLines({snapshot_id:'fixture',lines:[line]},'fixture');
  for(const patch of [{operator_key:[]},{mode:['tram']},{source_tags:[{route:123}]}])assert.throws(()=>validateLines({snapshot_id:'fixture',lines:[{...line,...patch}]},'fixture'));
});
