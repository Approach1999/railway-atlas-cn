import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,findStations,stationVisible,trackVisible} from './model.mjs';
test('aliases, normalization and exact match disambiguate stations without merging identities',()=>{
  const make=(id,name,aliases)=>({id,properties:{display_name:name,aliases}});
  const records=[make('rail','沈阳',['沈阳站','沈阳火车站']),make('metro','沈阳站',['沈阳站'])];
  assert.deepEqual(findStations(records,' 沈阳站 ').map(f=>f.id),['metro','rail']);
  assert.equal(findStations(records,'\u3000').length,0);
  assert.equal(findStations(records,'沈阳火车站')[0].id,'rail');
});
test('hidden rail search result remains hidden in persistent urban filter',()=>{
  const state={...DEFAULTS,preset:'urban'};
  assert.equal(stationVisible({status:'mapped',rail_mode:'rail'},state),false);
  assert.equal(stationVisible({status:'mapped',rail_mode:'subway'},state),true);
  assert.equal(state.preset,'urban');
});
test('track functions, lifecycle and presets retain independent meaning',()=>{
  const p={status:'mapped',rail_mode:'rail',line_class:'branch'};
  assert.equal(trackVisible(p,DEFAULTS,11),false);
  assert.equal(trackVisible(p,DEFAULTS,14),true);
  assert.equal(trackVisible(p,{...DEFAULTS,preset:'highspeed'}),false);
  assert.equal(trackVisible({...p,line_class:'high_speed',status:'construction'},DEFAULTS),false);
  assert.equal(trackVisible({...p,line_class:'high_speed',status:'construction'},{...DEFAULTS,history:true,preset:'highspeed'}),true);
});
