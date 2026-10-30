/* Check the intended predicate correction against real data and edge properties. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import * as current from '../apps/web/shared/model.mjs';
const [beforePath,source,output]=process.argv.slice(2);
assert(beforePath&&source&&output,'Usage: node verify_urban_minor_rules.mjs BEFORE.mjs DATA_DIR REPORT.json');
const before=await import(pathToFileURL(path.resolve(beforePath)).href);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const states=[];
for(const preset of ['overview','highspeed','conventional','urban'])for(const history of [false,true])for(const sidings of [false,true])states.push({...current.DEFAULTS,preset,history,sidings});
for(const sidings of [false,true])states.push({...current.expandedState(current.DEFAULTS),preset:'custom',sidings,types:current.FILTER_MODES,classes:current.FILTER_CLASSES,states:current.FILTER_STATES});
const shards={},records=[];
for(const file of (await fs.readdir(path.join(source,'details'))).filter(f=>f.endsWith('.json')).sort()){
 const bytes=await fs.readFile(path.join(source,'details',file));shards[file]=hash(bytes);
 for(const f of Object.values(JSON.parse(bytes)))records.push(f.properties);
}
const synthetic=[];
for(const rail_mode of [...current.FILTER_MODES,'monorail',undefined])for(const line_class of [...current.FILTER_CLASSES,undefined])for(const status of [...current.FILTER_STATES,undefined])synthetic.push({feature_kind:'track',rail_mode,line_class,status});
let realEvaluations=0,syntheticEvaluations=0,realChanges=0,syntheticChanges=0,filterPairs=0;
for(const state of states){
 for(const minor of [false,true])for(const lifecycle of [null,'other',...current.FILTER_STATES]){
  assert.deepEqual(current.trackFilter(state,{minor,lifecycle}),before.trackFilter(state,{minor,lifecycle}));filterPairs++;
 }
 for(const [properties,real] of [[records,true],[synthetic,false]])for(const p of properties)for(const zoom of [8,11.99,12,15]){
  const a=before.trackVisible(p,state,zoom),b=current.trackVisible(p,state,zoom);
  const expectedCorrection=state.preset==='urban'&&['subway','light_rail','tram'].includes(p.rail_mode)&&['branch','industrial'].includes(p.line_class)&&(!state.sidings||zoom<12)&&(state.history||p.status==='mapped');
  if(a!==b){assert(expectedCorrection&&a&&!b,'Only the documented urban/minor correction may change visibility');if(real)realChanges++;else syntheticChanges++;}
  assert.equal(a!==b,expectedCorrection);
  if(real)realEvaluations++;else syntheticEvaluations++;
 }
}
assert.equal(realChanges,0,'Current snapshot should have no affected records');assert(syntheticChanges>0);
const report={date:new Date().toISOString(),source_sha256:hash(await fs.readFile('scripts/verify_urban_minor_rules.mjs')),before_sha256:hash(await fs.readFile(beforePath)),current_sha256:hash(await fs.readFile('apps/web/shared/model.mjs')),manifest_sha256:hash(await fs.readFile(path.join(source,'dataset.json'))),shards,states:states.length,zooms:[8,11.99,12,15],real_records:records.length,synthetic_properties:synthetic.length,real_evaluations:realEvaluations,synthetic_evaluations:syntheticEvaluations,real_changes:realChanges,synthetic_changes:syntheticChanges,unchanged_filter_pairs:filterPairs,scope:'Exact previous predicate comparison for enumerated states/zoom boundaries and all detail records; intentional urban/minor corrections isolated. No visual or independent classification acceptance.'};
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,shards:undefined}));
