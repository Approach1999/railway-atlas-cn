import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadDataset,DatasetLoadError,validatePalette} from './dataset.ts';
import {neutralPalette} from './resources.ts';
import {JsonReadTimeoutError} from './json-request.ts';
const palette=JSON.parse(fs.readFileSync(new URL('../../../../config/line-colors.json',import.meta.url),'utf8'));
function fixtures(){return {
  '/dataset.json':{snapshot_id:'fixture',region:'shenyang',schema_version:2,bbox:[123,41.5,123.8,42.1],tiles:{bounds:[123,41.5,123.8,42.1],minzoom:8,maxzoom:15}},
  '/palette.json':structuredClone(palette),'/lines.json':{snapshot_id:'fixture',lines:[]},
  '/stations.geojson':{type:'FeatureCollection',features:[{type:'Feature',id:'node/1',properties:{osm_id:'node/1',display_name:'示例站',rail_mode:'rail',status:'mapped'},geometry:{type:'Point',coordinates:[123.4,41.8]}}]}
};}
function fetcher(files){return async url=>new Response(JSON.stringify(files[url.replace('/snapshots/fixture','')]),{headers:{'content-type':'application/json'}});}
const pending=signal=>new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});

test('one snapshot deadline bounds stalled headers, unfinished bodies and the later line index',async()=>{
  for(const mode of ['headers','body','lines']){
    const observed=[],files=fixtures();
    const transport=async(url,{signal})=>{
      observed.push(signal);
      if(mode==='headers')return pending(signal);
      if(mode==='body'||url.endsWith('/lines.json'))return {ok:true,json:()=>pending(signal)};
      return Response.json(files[url.replace('/snapshots/fixture','')]);
    };
    await assert.rejects(loadDataset('fixture',new AbortController().signal,transport,30),error=>error instanceof JsonReadTimeoutError);
    assert(observed.some(signal=>signal.aborted));
  }
});

test('a failed staged asset cancels siblings while explicit caller cancellation retains its reason',async()=>{
  const hanging=[];
  await assert.rejects(loadDataset('fixture',new AbortController().signal,async(url,{signal})=>{
    if(url.endsWith('/palette.json'))return new Response('',{status:410});
    hanging.push(signal);return pending(signal);
  }),error=>error instanceof DatasetLoadError&&error.status===410);
  assert.equal(hanging.length,2);assert(hanging.every(signal=>signal.aborted));
  const parent=new AbortController(),reason=new DOMException('user cancelled','AbortError');
  const request=loadDataset('fixture',parent.signal,async(_url,{signal})=>pending(signal));
  parent.abort(reason);await assert.rejects(request,error=>error===reason);
});

test('later line loading uses the remaining snapshot budget rather than restarting it',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  let releaseManifest,noticeLines,lineSignal;
  const manifest=new Promise(resolve=>{releaseManifest=resolve;}),linesStarted=new Promise(resolve=>{noticeLines=resolve;});
  const files=fixtures();
  const request=loadDataset('fixture',new AbortController().signal,async(url,{signal})=>{
    const key=url.replace('/snapshots/fixture','');
    if(key==='/dataset.json')await manifest;
    if(key==='/lines.json'){lineSignal=signal;noticeLines();return pending(signal);}
    return Response.json(files[key]);
  },30);
  context.mock.timers.tick(20);releaseManifest();await linesStarted;
  context.mock.timers.tick(10);assert.equal(lineSignal.aborted,true);
  await assert.rejects(request,error=>error instanceof JsonReadTimeoutError);
});
test('staged bundle validates matching identity, geometry, palette and route index',async()=>{
  const bundle=await loadDataset('fixture',new AbortController().signal,fetcher(fixtures()));
  assert.equal(bundle.root,'/snapshots/fixture');assert.equal(bundle.stations.features[0].id,'node/1');
  for(const mutate of [files=>files['/dataset.json'].snapshot_id='other',files=>files['/dataset.json'].bbox=[0,99,0,100],files=>delete files['/palette.json'].class_palette.high_speed,files=>files['/stations.geojson'].features[0].geometry.type='Polygon']){
    const files=fixtures();mutate(files);await assert.rejects(loadDataset('fixture',new AbortController().signal,fetcher(files)));
  }
});
test('unsafe identities make no requests; 410 is distinguishable; abort wins even if transport completes',async()=>{
  let called=false;await assert.rejects(loadDataset('../private',new AbortController().signal,async()=>{called=true;}));assert.equal(called,false);
  await assert.rejects(loadDataset('fixture',new AbortController().signal,async()=>new Response('',{status:410})),error=>error instanceof DatasetLoadError&&error.status===410);
  const abort=new AbortController();const request=loadDataset('fixture',abort.signal,fetcher(fixtures()));abort.abort();await assert.rejects(request,{name:'AbortError'});
});
test('invalid nested assets are rejected before any staged layer replacement',async()=>{
  for(const mutate of [
    files=>files['/dataset.json'].schema_version='2',
    files=>files['/dataset.json'].tiles.minzoom=99,
    files=>files['/palette.json'].class_palette.extra=null,
    files=>files['/palette.json'].operators={broken:{lines:{'1':{color:'red'}}}},
    files=>files['/palette.json'].operators[Object.keys(files['/palette.json'].operators)[0]].name=[],
    files=>files['/stations.geojson'].features[0].properties.aliases=[null],
    files=>files['/stations.geojson'].features[0].properties.line_tokens=123,
    files=>files['/stations.geojson'].features.push(structuredClone(files['/stations.geojson'].features[0])),
    files=>files['/lines.json'].lines=[{line_key:'safe/1',name:'示例',ref:'1',mode:'subway',relation_ids:['relation/1'],source_tags:[null]}],
  ]){const files=fixtures();mutate(files);await assert.rejects(loadDataset('fixture',new AbortController().signal,fetcher(files)));}
});
test('neutral recovery palette is structurally valid and contains no line colour inference',()=>{
  const neutral=neutralPalette();validatePalette(neutral);
  assert.deepEqual(neutral.operators,{});assert.deepEqual(neutral.overrides,[]);
  assert(Object.values(neutral.class_palette).every(entry=>entry.color==='#697579'));
});
