/* Migration comparison against an explicitly preserved implementation. No data writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as current from '../apps/web/shared/model.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [beforePath,stationsPath,reportPath]=process.argv.slice(2);
assert(beforePath&&stationsPath&&reportPath,'Usage: node verify_shared_rules.mjs BEFORE.mjs STATIONS.geojson REPORT.json');
const before=await import(pathToFileURL(path.resolve(beforePath)).href);
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function expressionForm(value){
 if(!Array.isArray(value))return value;
 if(value.length===3&&value[0]==='=='&&value[1]===1&&(value[2]===0||value[2]===1))return ['literal',value[2]===1];
 return value.map(expressionForm);
}
for(const key of ['DEFAULTS','CLASS_LABELS','STATUS_LABELS','STATUS_STYLES','PRESET_LABELS','FACILITY_LABELS','FILTER_MODES','FILTER_CLASSES','FILTER_STATES'])assert.deepEqual(current[key],before[key],key);
assert.deepEqual(current.MODE_LABELS,{...before.MODE_LABELS,other:'其他轨道'});
const variants=[];
for(const preset of ['overview','highspeed','conventional','urban'])for(const history of [false,true])for(const sidings of [false,true])for(const lineKeys of [null,[],['metro/1']])variants.push({...current.DEFAULTS,preset,history,sidings,lineKeys});
for(const filters of [
 {types:[],classes:[],states:[]},
 {types:['rail','other','unknown'],classes:current.FILTER_CLASSES,states:current.FILTER_STATES},
 {types:['subway','light_rail','tram'],classes:[],states:['mapped','construction']},
 {types:current.FILTER_MODES,classes:['high_speed'],states:['mapped']},
 ...current.FILTER_STATES.map(state=>({types:current.FILTER_MODES,classes:current.FILTER_CLASSES,states:[state]})),
])for(const sidings of [false,true])for(const lineKeys of [null,[],['metro/1'],['metro/10']])variants.push({...current.expandedState(current.DEFAULTS),...filters,preset:'custom',sidings,lineKeys});
const properties=[];
for(const rail_mode of [...current.FILTER_MODES,'monorail',undefined])for(const status of [...current.FILTER_STATES,undefined])for(const line_class of [...current.FILTER_CLASSES,undefined]){
 const keys=[[],['metro/1'],['metro/10'],['metro/1','metro/10']][properties.length%4];
 properties.push({feature_kind:'track',rail_mode,status,line_class,line_keys:keys,line_tokens:keys.map(k=>'|'+k+'|').join('')});
}
let predicates=0,expressions=0;
const output=crypto.createHash('sha256');
for(const state of variants){
 assert.deepEqual(current.expandedState(state),before.expandedState(state));
 assert.deepEqual(expressionForm(current.overlayFilter(state)),expressionForm(before.overlayFilter(state)));expressions++;
 for(const minor of [false,true])for(const lifecycle of [null,'other',...current.FILTER_STATES]){
  const result=current.trackFilter(state,{minor,lifecycle});assert.deepEqual(expressionForm(result),expressionForm(before.trackFilter(state,{minor,lifecycle})));
  output.update(JSON.stringify(result));expressions++;
 }
 for(const p of properties){
  const actual=[current.overlayVisible(p,state),current.stationVisible(p,state),...[8,11,12,14,18].map(zoom=>current.trackVisible(p,state,zoom))];
  const original=[before.overlayVisible(p,state),before.stationVisible(p,state),...[8,11,12,14,18].map(zoom=>before.trackVisible(p,state,zoom))];
  assert.deepEqual(actual,original,JSON.stringify({state,p}));predicates+=actual.length;output.update(JSON.stringify(actual));
 }
}
const stationsRaw=await fs.readFile(stationsPath),stations=JSON.parse(stationsRaw).features;
const prior=JSON.stringify(stations),queries=['沈阳','沈阳北','沈阳北站','沈阳站','  沈阳北站  ','ＳＨＥＮＹＡＮＧ','','　','不存在的测试车站'];
for(const query of queries){
 const actual=current.findStations(stations,query).map(f=>f.id);
 assert.deepEqual(actual,before.findStations(stations,query).map(f=>f.id));output.update(JSON.stringify(actual));
}
assert.equal(JSON.stringify(stations),prior,'Search modified source records');
const report={date:new Date().toISOString(),before_sha256:sha(await fs.readFile(beforePath)),implementation_sha256:sha(await fs.readFile(path.join(root,'apps/web/shared/model.mjs'))),
 stations_sha256:sha(stationsRaw),stations:stations.length,search_queries:queries.length,states:variants.length,properties:properties.length,
 predicate_comparisons:predicates,expression_comparisons:expressions,identical_results_sha256:output.digest('hex'),
 intended_metadata_change:{'MODE_LABELS.other':'其他轨道'},
 expression_comparison:'Only the legacy constant conditions [==,1,0] and [==,1,1] are canonicalized to literal booleans before AST comparison.',
 scope:'Finite migration grid, including missing properties, exact line tokens and current station searches. Not all possible filters, real rendering or independent railway classification acceptance.'};
await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
