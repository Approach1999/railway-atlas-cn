/* Decode every actual MVT independently of the tile builder/normalizer. */
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(new URL('../apps/web/probe/package.json',import.meta.url));
const {VectorTile}=await import(pathToFileURL(require.resolve('@mapbox/vector-tile')).href),{PbfReader}=await import(pathToFileURL(require.resolve('pbf')).href);
const args=process.argv.slice(2),source=path.resolve(args.shift()||'data/processed/shenyang-mvp-20261023');
let tiles=path.join(source,'tiles'),reportFile,compare,observe=false;
while(args.length){const flag=args.shift();if(flag==='--tiles')tiles=path.resolve(args.shift());else if(flag==='--report')reportFile=path.resolve(args.shift());else if(flag==='--compare')compare=path.resolve(args.shift());else if(flag==='--observe')observe=true;else throw Error('Unknown option '+flag);}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const manifestBytes=await fs.readFile(path.join(source,'dataset.json')),manifest=JSON.parse(manifestBytes),indexBytes=await fs.readFile(path.join(tiles,'build.json')),index=JSON.parse(indexBytes);
const records=new Map(),shards={};for(const name of (await fs.readdir(path.join(source,'details'))).filter(n=>n.endsWith('.json')).sort()){
 const bytes=await fs.readFile(path.join(source,'details',name));assert.equal(hash(bytes),manifest.files['details/'+name].sha256);shards[name]=hash(bytes);
 for(const [id,feature] of Object.entries(JSON.parse(bytes))){assert(!records.has(id));records.set(id,feature);}
}
assert(index.tile_count>0&&index.files.length>0,'published tile bundle must not be empty');
const kinds={rail_tracks:'track',rail_facilities:'facility',rail_stations:'station_area'},totals={tiles:0,feature_instances:0,bytes:0},failures={},examples=[],byZoom={},seen=new Map(),comparison={tiles:0,unchanged_tiles:0,surviving_feature_instances:0,collapsed_feature_instances:0};
const issue=(code,detail)=>{failures[code]=(failures[code]||0)+1;if(examples.length<120)examples.push({code,...detail});};
const area=part=>{let a=0;for(let i=1;i<part.length;i++)a+=part[i-1].x*part[i].y-part[i].x*part[i-1].y;return a;};
const coords=parts=>parts.map(part=>part.map(p=>[p.x,p.y]));
const canonical=object=>JSON.stringify(Object.entries(object).sort(([a],[b])=>a<b?-1:a>b?1:0));
const decode=bytes=>{const tile=new VectorTile(new PbfReader(bytes)),result=new Map();for(const [name,layer] of Object.entries(tile.layers))for(let i=0;i<layer.length;i++){const f=layer.feature(i);result.set(name+'|'+f.properties.osm_id,{type:f.type,properties:f.properties,parts:f.loadGeometry()});}return result;};
const oldIndex=compare?await read(path.join(compare,'build.json')):null;
const oldManifest=compare?await read(path.join(compare,'../dataset.json')):null;
if(compare)assert.deepEqual(index.files.map(f=>f.path),oldIndex.files.map(f=>f.path),'tile coverage must not change');
for(const file of index.files){
 assert(/^\d+\/\d+\/\d+\.pbf$/.test(file.path));const filename=path.resolve(tiles,file.path);assert(!path.relative(tiles,await fs.realpath(filename)).startsWith('..'));
 const bytes=await fs.readFile(filename);assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);
 const [z,x,y]=file.path.replace('.pbf','').split('/').map(Number);assert(z>=index.minzoom&&z<=index.maxzoom&&x>=0&&y>=0&&x<2**z&&y<2**z);
 const tile=new VectorTile(new PbfReader(bytes));totals.tiles++;totals.bytes+=bytes.length;byZoom[z]??={tiles:0,feature_instances:0,layers:{}};byZoom[z].tiles++;
 for(const [name,layer] of Object.entries(tile.layers)){
  assert(name in kinds);assert.equal(layer.version,2);assert.equal(layer.extent,4096);const ids=new Set();
  for(let i=0;i<layer.length;i++){
   const f=layer.feature(i),p=f.properties,id=p.osm_id,context={tile:file.path,layer:name,id},full=records.get(id);totals.feature_instances++;byZoom[z].feature_instances++;byZoom[z].layers[name]=(byZoom[z].layers[name]||0)+1;
   assert(full,'MVT source identity must exist in full details');assert.equal(full.properties.feature_kind,kinds[name]);assert(!ids.has(id),'duplicate identity within same tile layer');ids.add(id);
   const set=seen.get(z)||new Set();set.add(id);seen.set(z,set);
   for(const key of ['feature_kind','rail_mode','line_class','status','snapshot_id','display_name','line_key','line_ref','line_shared','line_complete','line_tokens','line_keys'])if(full.properties[key]!==undefined){const value=full.properties[key],expected=value!==null&&typeof value!=='object'?value:JSON.stringify(value);assert.equal(p[key],expected,id+' '+key);}
   assert.equal(f.type,{Point:1,LineString:2,MultiLineString:2,Polygon:3}[full.geometry.type]);
   const parts=f.loadGeometry();if(!parts.length)issue('empty_geometry',context);let exterior=false;
   for(const part of parts){
    if(part.length<(f.type===1?1:f.type===2?2:4))issue('too_few_positions',context);
    for(let k=0;k<part.length;k++){const v=part[k];assert(Number.isSafeInteger(v.x)&&Number.isSafeInteger(v.y));assert(v.x>=-128&&v.y>=-128&&v.x<=4224&&v.y<=4224);if(k&&v.equals(part[k-1]))issue('zero_length_edge',{...context,vertex:k});}
    if(f.type===3){if(!part[0]?.equals(part.at(-1)))issue('unclosed_ring',context);const a=area(part);if(a===0)issue('zero_area_ring',context);else if(a>0)exterior=true;else if(!exterior)issue('orphan_hole',context);}
   }
  }
 }
 if(compare){
  const oldFile=oldIndex.files.find(f=>f.path===file.path),oldBytes=await fs.readFile(path.join(compare,file.path));assert.equal(hash(oldBytes),oldFile.sha256);comparison.tiles++;if(hash(oldBytes)===hash(bytes))comparison.unchanged_tiles++;
  const old=decode(oldBytes),current=decode(bytes);
  for(const [key,f] of old){
   const paths=f.parts.map(part=>part.filter((point,i)=>!i||!point.equals(part[i-1]))).filter(part=>f.type===1?part.length>0:f.type===2?part.length>=2:part.length>=4&&area(part)!==0);
   if(!paths.length){assert(!current.has(key),'collapsed-only primitive must not survive');comparison.collapsed_feature_instances++;continue;}
   const next=current.get(key);assert(next,'noncollapsed feature must survive '+key);assert.equal(next.type,f.type);
   assert.equal(f.properties.snapshot_id,oldManifest.snapshot_id);assert.equal(next.properties.snapshot_id,manifest.snapshot_id);
   assert.equal(canonical(next.properties),canonical({...f.properties,snapshot_id:manifest.snapshot_id}),'only the expected immutable snapshot identity may change');
   assert.deepEqual(coords(next.parts),coords(paths),'surviving integer coordinates must not move');current.delete(key);comparison.surviving_feature_instances++;
  }
  assert.equal(current.size,0,'candidate cannot invent new feature identities');
 }
}
assert.equal(totals.tiles,index.tile_count);assert.equal(totals.bytes,index.total_bytes);
const expected=[...records].filter(([,f])=>f.properties.feature_kind!=='station').map(([id])=>id);
for(const [z,coverage] of seen){byZoom[z].unique_source_ids=coverage.size;byZoom[z].source_ids_not_drawn=expected.filter(id=>!coverage.has(id));}
const report={date:new Date().toISOString(),snapshot:manifest.snapshot_id,source_manifest_sha256:hash(manifestBytes),source_detail_shards:shards,tile_index_sha256:hash(indexBytes),tiles_directory:tiles,mode:observe?'observation':'validation',totals,byZoom,failures,examples,comparison:compare?comparison:null,sha256:{decoder:hash(await fs.readFile(require.resolve('@mapbox/vector-tile'))),pbf:hash(await fs.readFile(require.resolve('pbf')))},scope:'Every declared actual MVT: hashes, typed identity/full-detail semantic properties, integer buffered coordinates, primitive lengths, zero edges/area and basic ring order. Optional complete old/new decoded comparison. Not full protobuf/MVT conformance, topology, real-world accuracy, renderer/device acceptance or all-source visibility at every zoom.'};
if(reportFile){await fs.mkdir(path.dirname(reportFile),{recursive:true});await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({totals,failures,comparison:report.comparison}));if(!observe)assert.equal(Object.values(failures).reduce((a,b)=>a+b,0),0,'MVT geometry integrity failed');
