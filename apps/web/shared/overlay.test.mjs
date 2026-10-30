import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,expandedState,overlayFilter,overlayVisible,trackFilter,STATUS_STYLES,FILTER_STATES} from './model.mjs';

// Evaluate the expression vocabulary used by overlayFilter independently of
// MapLibre. Browser checks separately validate the actual rendering pipeline.
function evaluate(value,properties){
  if(!Array.isArray(value))return value;
  const [operator,...args]=value,e=i=>evaluate(args[i],properties);
  switch(operator){
    case 'literal':return args[0];case 'get':return properties[args[0]];
    case 'all':return args.every(v=>evaluate(v,properties));
    case 'any':return args.some(v=>evaluate(v,properties));
    case '==':return e(0)===e(1);case '!=':return e(0)!==e(1);case '!':return !e(0);case 'in':return e(1).includes(e(0));
    case 'coalesce':return args.map(v=>evaluate(v,properties)).find(v=>v!=null);
    case 'match':{const input=e(0);for(let i=1;i<args.length-1;i+=2)if(input===args[i])return evaluate(args[i+1],properties);return evaluate(args.at(-1),properties);}
    default:throw Error('Unsupported expression '+operator);
  }
}
test('station and facility filtering agrees with vector filtering for mode, state and exact line identity',()=>{
  const variants=[DEFAULTS,{...DEFAULTS,preset:'urban'},
    {...expandedState(DEFAULTS),preset:'custom',types:['rail','subway'],states:['mapped','construction'],lineKeys:['metro/1']},
    {...expandedState(DEFAULTS),preset:'custom',types:[]},
    {...expandedState(DEFAULTS),preset:'custom',states:[]},
    {...DEFAULTS,lineKeys:[]}];
  for(const state of variants)for(const rail_mode of ['rail','subway','tram','unknown','monorail'])for(const status of ['mapped','construction','disused'])for(const key of ['metro/1','metro/10',null]){
    const p={rail_mode,status,line_keys:key?[key]:[],line_tokens:key?'|'+key+'|':''};
    assert.equal(evaluate(overlayFilter(state),p),overlayVisible(p,state),JSON.stringify({state,p}));
  }
});
test('facilities and stations remain visible in high-speed view without guessing their track grade',()=>{
  const state={...DEFAULTS,preset:'highspeed'};
  assert(overlayVisible({rail_mode:'rail',status:'mapped',line_class:'unknown'},state));
  assert(!overlayVisible({rail_mode:'subway',status:'mapped'},state));
  assert(!overlayVisible({rail_mode:'unknown',status:'construction'},state));
});
test('generic label filter follows enabled lifecycle states, exact drawing layers partition them',()=>{
  const p={feature_kind:'track',rail_mode:'rail',line_class:'conventional_main',status:'construction'};
  assert.equal(evaluate(trackFilter(DEFAULTS),p),false);
  assert.equal(evaluate(trackFilter({...DEFAULTS,history:true}),p),true);
  for(const status of FILTER_STATES){
    const record={...p,status},state={...DEFAULTS,history:true};
    assert.equal(FILTER_STATES.filter(lifecycle=>evaluate(trackFilter(state,{lifecycle}),record)).length,1);
    assert(STATUS_STYLES[status]);
  }
  assert.notDeepEqual(STATUS_STYLES.construction.dash,STATUS_STYLES.proposed.dash);
  assert(STATUS_STYLES.unknown.warning);assert(STATUS_STYLES.conflict.warning);
});
