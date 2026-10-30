import test from 'node:test';
import assert from 'node:assert/strict';
import {LineLabelController,LINE_LABEL_SOURCE,LINE_LABEL_LAYERS} from './line-label-controller.ts';
const wire=()=>({type:'Feature',geometry:{type:'LineString',coordinates:[[123.40,41.80],[123.50,41.80]]},properties:{osm_id:'way/1',display_name:'示例线',feature_kind:'track',rail_mode:'rail',status:'mapped',line_class:'conventional_main',line_keys:'[]',snapshot_id:'s1'}});
function fixture(){
  const sources=new Map(),layers=new Map(),writes=[],status=[];let queries=0;
  let filters={preset:'custom',types:['rail'],states:['mapped'],classes:['conventional_main'],sidings:true,lineNames:true},moving=false,loaded=true,input=[wire()],repaints=0,zoom=12;
  const map={
    addSource:(id,options)=>{sources.set(id,{data:options.data,loaded:true,setData(data){this.data=data;this.loaded=false;writes.push(data);return this;}});},
    getSource:id=>sources.get(id),addLayer:layer=>layers.set(layer.id,layer),getLayer:id=>layers.get(id),hasImage:()=>false,addImage:()=>{},
    setLayoutProperty:(id,key,value)=>{layers.get(id).layout={...layers.get(id).layout,[key]:value};},setFilter:(id,filter)=>{layers.get(id).filter=filter;},
    getCanvas:()=>({getBoundingClientRect:()=>({width:1200,height:900})}),getZoom:()=>zoom,
    project:([x,y])=>({x:600+(x-123.45)*5000,y:450-(y-41.8)*5000}),isMoving:()=>moving,
    isSourceLoaded:id=>id==='tracks'?loaded:sources.get(id)?.loaded,
    querySourceFeatures:()=>{queries++;return input;},triggerRepaint:()=>{repaints++;},
  };
  const c=new LineLabelController(map,{filters:()=>filters,lineKeys:()=>null,filter:()=>['literal',true],status:(state,message)=>status.push({state,message})});
  const finish=()=>{sources.get(LINE_LABEL_SOURCE).loaded=true;c.sourceData({sourceId:LINE_LABEL_SOURCE,sourceDataType:'idle'});};
  return {c,map,writes,status,layers,finish,repaints:()=>repaints,queries:()=>queries,setZoom:value=>zoom=value,setInput:value=>{input=value;c.sourceData({sourceId:'tracks',sourceDataType:'content'});},setMoving:value=>moving=value,setLoaded:value=>loaded=value,setFilters:value=>filters={...filters,...value}};
}

test('camera change does not prepare old loaded tiles before the next idle view',()=>{
 const f=fixture();f.c.install('s1');f.c.request();f.finish();assert.equal(f.queries(),1);
 f.c.cameraChanged();f.c.request();assert.equal(f.queries(),1,'source can still report loaded for the previous view');
 const next=wire();next.properties.osm_id='way/2';next.id='way/2';f.setInput([next]);f.c.idle();f.finish();
 assert.equal(f.queries(),2);assert.equal(f.writes.at(-1).features[0].properties.osm_id,'way/2');f.c.reset();
});
test('filter changes reuse geometry but still select current candidates; tile/camera/retry/disable reset the bounded preparation',()=>{
  const f=fixture();f.c.install('s1');f.c.request();f.finish();assert.equal(f.queries(),1);
  f.setFilters({types:[]});f.c.request();assert.equal(f.writes.at(-1).features.length,0);f.finish();assert.equal(f.queries(),1);
  f.setFilters({types:['rail']});f.c.request();assert(f.writes.at(-1).features.length>0);f.finish();assert.equal(f.queries(),1);
  f.c.sourceData({sourceId:'tracks',sourceDataType:'metadata'});f.c.request();assert.equal(f.queries(),1);
  f.c.sourceData({sourceId:'tracks',sourceDataType:'content'});f.c.idle();f.finish();assert.equal(f.queries(),2);
  f.c.cameraChanged();f.c.idle();f.finish();assert.equal(f.queries(),3);
  f.c.retry();f.finish();assert.equal(f.queries(),4);
  f.setFilters({lineNames:false});f.c.request();f.setFilters({lineNames:true});f.c.request();f.finish();assert.equal(f.queries(),5);
  f.c.reset();f.c.install('s1');f.c.request();f.finish();assert.equal(f.queries(),6);f.c.reset();
});
test('render-only labels resolve to validated original track geometry and cannot borrow another source identity',()=>{
  const f=fixture();f.c.install('s1');f.c.request();assert.equal(f.c.ready,false);
  const label=f.writes[0].features[0];assert(label);
  const target=f.c.resolve(label.properties);assert.equal(target.properties.osm_id,'way/1');assert.equal(target.geometry.type,'LineString');
  assert.deepEqual(target.properties.line_keys,[]);
  assert.equal(label.properties.line_keys,undefined,'worker payload omits provenance-only fields');
  for(const key of ['feature_kind','rail_mode','line_class','status','osm_id','label_identity'])assert.equal(label.properties[key],key==='label_identity'?'object:way/1':target.properties[key]);
  assert.equal(f.c.resolve({...label.properties,osm_id:'way/2'}),null);
  f.finish();assert.equal(f.c.ready,true);f.c.reset();assert.equal(f.c.resolve(label.properties),null);
});
test('unchanged views do not resubmit, motion defers work, zoom keeps old labels hidden until ready',()=>{
  const f=fixture();f.c.install('s1');f.c.request();f.finish();const initial=f.writes.length;
  f.c.request();f.c.idle();assert.equal(f.writes.length,initial);
  f.setMoving(true);f.c.zoomStart();f.c.request();assert.equal(f.writes.length,initial);
  assert(LINE_LABEL_LAYERS.every(({id})=>f.layers.get(id).layout.visibility==='none'));
  f.setMoving(false);f.c.cameraChanged();f.c.idle();f.finish();assert(LINE_LABEL_LAYERS.every(({id})=>f.layers.get(id).layout.visibility==='visible'));
  f.c.reset();
});
test('filter replacement retains previous rendered targets and ignores a loaded notification while the new worker is pending',()=>{
  const f=fixture();f.c.install('s1');f.c.request();f.finish();const label=f.writes[0].features[0];
  f.setFilters({types:[]});f.c.request();assert.equal(f.writes.at(-1).features.length,0);
  f.c.sourceData({sourceId:LINE_LABEL_SOURCE,sourceDataType:'idle'});assert.equal(f.c.ready,false);
  assert(f.c.resolve(label.properties));f.finish();assert.equal(f.c.ready,true);
  f.c.reset();f.c.install('s2');assert.equal(f.c.resolve(label.properties),null);
  f.setFilters({types:['rail']});f.c.request();assert.match(f.status.at(-1).message,/版本不一致/);f.c.reset();
});
test('malformed names fail independently without clearing loaded data, and explicit retry restores in place',()=>{
  const f=fixture();f.c.install('s1');f.c.request();f.finish();const old=f.writes[0],label=old.features[0];
  const bad=wire();bad.properties.display_name=123;f.setInput([bad]);f.c.request();
  assert.equal(f.status.at(-1).state,'error');assert(f.c.resolve(label.properties));assert.equal(f.writes.at(-1),old);
  const count=f.writes.length;f.c.idle();assert.equal(f.writes.length,count);
  f.setInput([wire()]);f.c.retry();f.finish();assert.equal(f.status.at(-1).state,'ready');f.c.reset();
});
test('worker deadline offers recovery and reset cancels the previous snapshot timer',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();f.c.install('s1');f.c.request();t.mock.timers.tick(15000);
  assert.equal(f.status.at(-1).state,'error');assert.match(f.status.at(-1).message,/超时/);
  f.c.retry();f.c.reset();f.c.install('s2');f.setLoaded(false);
  const count=f.status.length;t.mock.timers.tick(15000);assert.equal(f.status.length,count);f.c.reset();
});
test('disabling names cancels obsolete failure notices and reenabling starts a bounded new request',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture();f.c.install('s1');f.c.request();
  f.setFilters({lineNames:false});f.c.request();assert.equal(f.c.ready,true);const count=f.status.length;
  t.mock.timers.tick(15000);f.c.error();assert.equal(f.status.length,count);assert.equal(f.status.at(-1).state,'ready');
  f.setFilters({lineNames:true});f.c.request();assert.equal(f.c.ready,false);assert.equal(f.writes.length,2);
  t.mock.timers.tick(15000);assert.equal(f.status.at(-1).state,'error');f.c.reset();
});
test('an initial name failure requests a render so usable track readiness can publish its partial-error state',()=>{
  const f=fixture(),bad=wire();bad.properties.display_name=123;f.setInput([bad]);f.c.install('s1');f.c.request();
  assert.equal(f.status.at(-1).state,'error');assert.equal(f.c.ready,true);assert.equal(f.repaints(),1);assert.equal(f.writes.length,0);f.c.reset();
});
test('an unchanged request during zoom source replacement cannot reveal labels from the old zoom',t=>{
  const f=fixture();t.after(()=>f.c.reset());f.c.install('s1');f.c.request();f.finish();
  f.c.zoomStart();f.setZoom(13);f.c.cameraChanged();assert.equal(f.c.ready,false);
  f.c.request();assert(LINE_LABEL_LAYERS.every(({id})=>f.layers.get(id).layout.visibility==='none'));
  f.finish();assert(LINE_LABEL_LAYERS.every(({id})=>f.layers.get(id).layout.visibility==='none'));
  f.c.idle();f.finish();assert(LINE_LABEL_LAYERS.every(({id})=>f.layers.get(id).layout.visibility==='visible'));f.c.reset();
});
