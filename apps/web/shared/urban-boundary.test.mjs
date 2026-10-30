import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {urbanBoundaryFilter} from './urban-boundary.mjs';
import {DEFAULTS,expandedState,trackFilter,FILTER_MODES,FILTER_CLASSES,FILTER_STATES} from './model.mjs';
const {featureFilter}=createRequire(new URL('../client/package.json',import.meta.url))('@maplibre/maplibre-gl-style-spec');
test('nonurban and custom-without-urban boundaries keep a constant disabled filter',()=>{
 for(const preset of ['overview','highspeed','conventional'])assert.deepEqual(urbanBoundaryFilter({...DEFAULTS,preset},trackFilter({...DEFAULTS,preset})),['literal',false]);
 const state={...expandedState(DEFAULTS),preset:'custom',types:['rail','unknown','other']};
 assert.deepEqual(urbanBoundaryFilter(state,trackFilter(state)),['literal',false]);
});
test('official SDK boundary results match the original expression for mixed custom modes, lifecycle and line restrictions',()=>{
 const states=[];
 for(const preset of ['overview','highspeed','conventional','urban'])for(const history of [false,true])for(const sidings of [false,true])states.push({...DEFAULTS,preset,history,sidings});
 for(const types of [[],...FILTER_MODES.map(m=>[m]),['rail','subway'],FILTER_MODES])for(const statesSelected of [[],['mapped'],FILTER_STATES])states.push({...expandedState(DEFAULTS),preset:'custom',types,states:statesSelected});
 for(const state of states)for(const keys of [null,[],['metro/1'],['metro/1','metro/2']]){
  const tracks=trackFilter(state),filtered=keys===null?tracks:['all',tracks,keys.length?['any',...keys.map(key=>['in','|'+key+'|',['coalesce',['get','line_tokens'],'']])]:['literal',false]];
  const original=['all',filtered,['in',['get','rail_mode'],['literal',['subway','tram','light_rail']]]];
  const left=featureFilter(original,'filter'),right=featureFilter(urbanBoundaryFilter(state,filtered),'filter');
  for(const rail_mode of [...FILTER_MODES,'monorail',undefined])for(const line_class of FILTER_CLASSES)for(const status of FILTER_STATES)for(const line_tokens of ['', '|metro/1|','|metro/2|']){
   const feature={type:2,properties:{feature_kind:'track',rail_mode,line_class,status,line_tokens}};
   assert.equal(right.filter({zoom:14},feature),left.filter({zoom:14},feature));
  }
 }
});
