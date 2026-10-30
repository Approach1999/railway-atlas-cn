import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const source='apps/web/client/node_modules/maplibre-gl/src/symbol/merge_lines.ts';
const output=process.argv[2]||'data/manifests/local/line-label-prototype';
const bytes=await fs.readFile(source);await fs.mkdir(output,{recursive:true});
// Node does not strip TS inside node_modules. Import an identical local copy;
// all imports in this particular SDK source are type-only.
const copy=path.resolve(output,'sdk-merge-source.ts');await fs.writeFile(copy,bytes);
const {mergeLines}=await import(pathToFileURL(copy).href);
const feature=(id,text,x1,x2)=>({id,properties:{osm_id:id},text,geometry:[[{x:x1,y:0},{x:x2,y:0}]]});
const sameText=mergeLines([feature('way/1','同名线路',0,10),feature('way/2','同名线路',10,20)]);
assert.equal(sameText.length,1);assert.equal(sameText[0].id,'way/1');assert.equal(sameText[0].geometry[0].length,3);
const differentText=mergeLines([feature('way/1','甲线',0,10),feature('way/2','乙线',10,20)]);assert.equal(differentText.length,2);
const report={date:new Date().toISOString(),source,source_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),checks:{distinct_ids_same_text_and_shared_endpoint:{input_ids:['way/1','way/2'],output_ids:sameText.map(f=>f.id),output_points:sameText[0].geometry[0]},different_text_not_merged:differentText.length},scope:'Exact installed SDK mergeLines source executed on synthetic fragments. Establishes text/endpoint-only merging despite distinct source IDs; not real OSM equivalence or current product acceptance.'};
await fs.writeFile(path.join(output,'sdk-merge.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
