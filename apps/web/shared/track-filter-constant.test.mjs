import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {trackFilter,DEFAULTS,expandedState,trackVisible,FILTER_STATES,FILTER_CLASSES,FILTER_MODES} from './model.mjs';
const {featureFilter}=createRequire(new URL('../client/package.json',import.meta.url))('@maplibre/maplibre-gl-style-spec');
test('urban branch and industrial tracks obey the same sidings switch and z12 threshold as rendered layers',()=>{
 for(const rail_mode of ['subway','light_rail','tram'])for(const line_class of ['branch','industrial'])for(const status of FILTER_STATES){
  const p={feature_kind:'track',rail_mode,line_class,status};
  for(const sidings of [false,true])for(const history of [false,true])for(const zoom of [8,11.99,12,15]){
   assert.equal(trackVisible(p,{...DEFAULTS,preset:'urban',sidings,history},zoom),sidings&&zoom>=12&&(history||status==='mapped'));
  }
 }
});
test('inactive lifecycle and impossible minor layers keep one stable false filter across presets',()=>{
 for(const preset of ['overview','highspeed','conventional','urban'])for(const lifecycle of FILTER_STATES.filter(s=>s!=='mapped'))assert.deepEqual(trackFilter({...DEFAULTS,preset,history:false},{lifecycle}),['literal',false]);
 for(const preset of ['highspeed','conventional'])assert.deepEqual(trackFilter({...DEFAULTS,preset},{minor:true}),['literal',false]);
 assert.deepEqual(trackFilter({...expandedState(DEFAULTS),preset:'custom',states:['construction']},{lifecycle:'mapped'}),['literal',false]);
});
test('selected construction and history layers still compile and expose their own records',()=>{
 for(const state of [{...DEFAULTS,history:true},{...expandedState(DEFAULTS),preset:'custom',states:['construction']}]){
  const f=featureFilter(trackFilter(state,{lifecycle:'construction'}),'filter');assert(f.filter({zoom:15},{type:2,properties:{feature_kind:'track',rail_mode:'rail',line_class:'high_speed',status:'construction'}}));
 }
});
test('official SDK expressions preserve independent visibility predicates over mode/class/state combinations',()=>{
 const states=['overview','highspeed','conventional','urban'].flatMap(preset=>[false,true].flatMap(history=>[false,true].map(sidings=>({...DEFAULTS,preset,history,sidings}))));
 states.push({...expandedState(DEFAULTS),preset:'custom',states:['construction','mapped'],types:['rail','subway'],classes:['high_speed','branch']});
 for(const state of states)for(const minor of [false,true])for(const lifecycle of FILTER_STATES){
  const filter=featureFilter(trackFilter(state,{minor,lifecycle}),'filter');
  for(const rail_mode of [...FILTER_MODES,'monorail'])for(const line_class of FILTER_CLASSES)for(const status of FILTER_STATES)for(const zoom of [8,11.99,12,15]){
   const p={feature_kind:'track',rail_mode,line_class,status},expected=trackVisible(p,state,zoom)&&(['branch','industrial'].includes(line_class)===minor)&&status===lifecycle;
   const rendered=(!minor||zoom>=12)&&filter.filter({zoom},{type:2,properties:p});
   assert.equal(rendered,expected,JSON.stringify({state,minor,lifecycle,p,zoom}));
  }
 }
});
