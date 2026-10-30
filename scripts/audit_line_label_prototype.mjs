import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {decodeView} from '../apps/web/client/src/view-state.ts';
import {expandedState,trackVisible} from '../apps/web/shared/model.mjs';
const dir=process.argv[2]||'data/manifests/local/line-label-prototype';
const algorithm=process.argv[3]||'apps/web/client/src/line-label-candidates.ts';
const {buildLineLabelCandidates}=await import(pathToFileURL(path.resolve(algorithm)).href);
const report=JSON.parse(await fs.readFile(path.join(dir,'report.json'),'utf8')),scenes=[];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
for(const scene of report.scenes){
  const bytes=await fs.readFile(path.join(dir,scene.name+'-input.json')),input=JSON.parse(bytes);
  const scale=512*2**input.zoom,world=p=>[(p[0]+180)/360*scale,(1-Math.asinh(Math.tan(p[1]*Math.PI/180))/Math.PI)/2*scale],center=world([input.center.lng,input.center.lat]);
  const project=p=>{const [x,y]=world(p);return [x-center[0]+input.width/2,y-center[1]+input.height/2];};
  const filters=expandedState(decodeView('http://127.0.0.1/?snapshot=shenyang-mvp-20261023&types='+scene.types+'#map='+scene.hash).view.filters);
  const replay=buildLineLabelCandidates(input.features,{zoom:input.zoom,width:input.width,height:input.height,project,visible:p=>trackVisible(p,filters,input.zoom)});
  const saved=await fs.readFile(path.join(dir,scene.name+'-candidates.json'));
  assert.equal(sha(Buffer.from(JSON.stringify(replay.collection))),sha(saved));
  const expected=new Map(replay.anchors.map(a=>[a.id,a]));let maximumAnchorError=0;
  for(const actual of scene.anchors){
    const target=expected.get(actual.id);assert(target);
    maximumAnchorError=Math.max(maximumAnchorError,Math.hypot(actual.point[0]-target.point[0],actual.point[1]-target.point[1]));
  }
  assert(maximumAnchorError<=2,'native line-center must remain within the reserved quantization margin');
  const crossing=[];
  for(let i=0;i<scene.anchors.length;i++)for(let j=i+1;j<scene.anchors.length;j++){
    const a=scene.anchors[i],b=scene.anchors[j];if(a.identity===b.identity&&a.tile.join('/')!==b.tile.join('/'))crossing.push(Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1]));
  }
  assert(crossing.every(distance=>distance>=300));
  scenes.push({name:scene.name,input_sha256:sha(bytes),candidates_sha256:sha(saved),input_fragments:input.features.length,replay_byte_identical:true,maximum_anchor_error_css_px:maximumAnchorError,actual_cross_tile_same_identity_pairs:crossing.length,minimum_cross_tile_same_identity_distance_css_px:crossing.length?Math.min(...crossing):null,lost_name_texts:scene.lost_texts});
}
const audit={date:new Date().toISOString(),algorithm,algorithm_sha256:sha(await fs.readFile(algorithm)),scenes,scope:'Byte-exact replay of captured real loaded fragments and native anchor error/seam witnesses for the isolated prototype. Large source captures remain local/ignored. Not dynamic integration, performance or complete R17 acceptance.'};
await fs.writeFile(path.join(dir,'audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit));
