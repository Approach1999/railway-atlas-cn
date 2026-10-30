/* Official SDK before/after evaluation; no geometry or data modifications. */
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import * as current from '../apps/web/shared/model.mjs';
const {featureFilter}=createRequire(new URL('../apps/web/client/package.json',import.meta.url))('@maplibre/maplibre-gl-style-spec');
const [beforePath,source,output]=process.argv.slice(2);assert(beforePath&&source&&output);
const before=await import(pathToFileURL(path.resolve(beforePath)).href),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const states=[];
for(const preset of ['overview','highspeed','conventional','urban'])for(const history of [false,true])for(const sidings of [false,true])states.push({...current.DEFAULTS,preset,history,sidings});
for(const statuses of [[],...current.FILTER_STATES.map(s=>[s]),current.FILTER_STATES,['mapped','construction','conflict']])for(const sidings of [false,true])states.push({...current.expandedState(current.DEFAULTS),preset:'custom',states:statuses,sidings});
for(const filters of [{types:[]},{classes:[]},...current.FILTER_MODES.map(mode=>({types:[mode]}))])states.push({...current.expandedState(current.DEFAULTS),preset:'custom',states:current.FILTER_STATES,...filters});
const properties=[],shards={};let real=0;
for(const file of (await fs.readdir(path.join(source,'details'))).filter(f=>f.endsWith('.json')).sort()){
 const bytes=await fs.readFile(path.join(source,'details',file));shards[file]=hash(bytes);for(const f of Object.values(JSON.parse(bytes))){properties.push(f.properties);real++;}
}
for(const feature_kind of ['track','facility',undefined])for(const rail_mode of [...current.FILTER_MODES,'monorail',undefined])for(const line_class of [...current.FILTER_CLASSES,undefined])for(const status of [...current.FILTER_STATES,undefined])properties.push({feature_kind,rail_mode,line_class,status});
let expressions=0,evaluations=0,changed=0;
for(const state of states)for(const minor of [false,true])for(const lifecycle of [null,'other',...current.FILTER_STATES]){
 const a=before.trackFilter(state,{minor,lifecycle}),b=current.trackFilter(state,{minor,lifecycle}),left=featureFilter(a,'filter'),right=featureFilter(b,'filter');expressions++;if(JSON.stringify(a)!==JSON.stringify(b))changed++;
 for(const p of properties){const f={type:2,properties:p};assert.equal(right.filter({zoom:15},f),left.filter({zoom:15},f),JSON.stringify({state,minor,lifecycle,p}));evaluations++;}
}
const changes=module=>{let count=0;for(const minor of [false,true])for(const lifecycle of current.FILTER_STATES){const a=module.trackFilter({...current.DEFAULTS,preset:'overview'},{minor,lifecycle}),b=module.trackFilter({...current.DEFAULTS,preset:'highspeed'},{minor,lifecycle});if(JSON.stringify(a)!==JSON.stringify(b))count++;}return count;};
const report={date:new Date().toISOString(),before_sha256:hash(await fs.readFile(beforePath)),current_sha256:hash(await fs.readFile('apps/web/shared/model.mjs')),snapshot_manifest_sha256:hash(await fs.readFile(path.join(source,'dataset.json'))),shards,states:states.length,properties:properties.length,real_records:real,synthetic_properties:properties.length-real,expression_pairs:expressions,changed_expression_pairs:changed,sdk_evaluation_pairs:evaluations,changed_track_specs_per_overview_highspeed_switch:{before:changes(before),after:changes(current)},scope:'Official installed featureFilter compiler, finite modes/classes/states plus missing fields and all actual full-detail records. Verifies exact prior renderer behavior, including existing layer sidings constraint; not independent classification correctness or proof of global list/map predicate equivalence.'};
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,shards:undefined}));
