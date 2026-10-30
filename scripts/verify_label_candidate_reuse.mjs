import fs from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {prepareLineLabelCandidates,selectLineLabelCandidates} from '../apps/web/client/src/line-label-candidates.ts';
import {decodeView} from '../apps/web/client/src/view-state.ts';
import {expandedState,trackVisible} from '../apps/web/shared/model.mjs';
const directory=process.argv[2]||'data/manifests/local/line-label-callout-padding20';
const beforeFile=process.argv[3]||'docs/evidence/history/label-filter-cache-candidates-before.ts';
const output=process.argv[4]||'data/manifests/local/label-filter-cache/replay.json';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const beforeBytes=await fs.readFile(beforeFile),currentFile='apps/web/client/src/line-label-candidates.ts';
let code=stripTypeScriptTypes(beforeBytes.toString());
code=code.replace('./line-label-fragments.ts',pathToFileURL(path.resolve('apps/web/client/src/line-label-fragments.ts')).href);
const {buildLineLabelCandidates:before}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const saved=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8')),results=[];
for(const scene of saved.scenes){
  const bytes=await fs.readFile(path.join(directory,scene.name+'-input.json')),input=JSON.parse(bytes);
  const scale=512*2**input.zoom,world=p=>[(p[0]+180)/360*scale,(1-Math.asinh(Math.tan(p[1]*Math.PI/180))/Math.PI)/2*scale],center=world([input.center.lng,input.center.lat]);
  const view={zoom:input.zoom,width:input.width,height:input.height,project:p=>{const [x,y]=world(p);return [x-center[0]+input.width/2,y-center[1]+input.height/2];}};
  const prepared=prepareLineLabelCandidates(input.features,view),comparisons=[];
  for(const preset of ['overview','highspeed','conventional','urban']){
    const filters=expandedState(decodeView('http://127.0.0.1/?snapshot=shenyang-mvp-20261023#map='+scene.hash).view.filters);filters.preset=preset;
    const options={...view,visible:p=>trackVisible(p,filters,input.zoom)},initial=before(input.features,options);
    for(const previous of [undefined,new Set(initial.anchors.map(a=>a.id))]){
      const opts={...options,previous},a=before(input.features,opts),b=selectLineLabelCandidates(prepared,opts);
      assert.equal(JSON.stringify(a.collection),JSON.stringify(b.collection));assert.deepEqual(a.anchors,b.anchors);
      assert.equal(a.skippedShort,b.skippedShort);assert.equal(a.ownFragmentJoins,b.ownFragmentJoins);assert.equal(a.candidateCount,b.candidateCount);
      comparisons.push({preset,previous_ids:previous?.size??null,collection_sha256:sha(JSON.stringify(b.collection)),byte_identical:true});
    }
  }
  results.push({scene:scene.name,input_sha256:sha(bytes),fragments:input.features.length,comparisons});
}
const report={date:new Date().toISOString(),before_module:beforeFile,before_sha256:sha(beforeBytes),current_module:currentFile,current_sha256:sha(await fs.readFile(currentFile)),fragment_module_sha256:sha(await fs.readFile('apps/web/client/src/line-label-fragments.ts')),results,scope:'Byte-exact before/after collections on four captured real views, four presets, with/without previous IDs; not live source invalidation or performance.'};
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(s=>({scene:s.scene,comparisons:s.comparisons.length}))));
