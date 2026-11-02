import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BasemapController, BASEMAP_SOURCE, BASEMAP_LAYER, PREFERENCE_KEY, readPreference, savePreference, validateConfig} from './basemap.ts';

const config=validateConfig(JSON.parse(await readFile(new URL('../../../../config/basemap.json',import.meta.url),'utf8')));
test('local preview raster route needs an explicit proxy marker and self declaration',()=>{
  const local={...config,tiles:['/preview-basemap/{z}/{x}/{y}.png'],request_domains:['self'],preview_proxy:true};
  assert.equal(validateConfig(local).tiles[0],local.tiles[0]);
  assert.throws(()=>validateConfig({...local,preview_proxy:false}));
  assert.throws(()=>validateConfig({...local,request_domains:['tile.openstreetmap.org']}));
});
test('preview marker cannot authorize other paths or insecure external hosts',()=>{
  for(const template of ['/other/{z}/{x}/{y}.png','//example.com/{z}/{x}/{y}.png','http://example.com/{z}/{x}/{y}.png']){
    assert.throws(()=>validateConfig({...config,tiles:[template],preview_proxy:true,request_domains:['self','example.com']}));
  }
});
class FakeMap {
  constructor(){
    this.sources=new Map([['tracks',{type:'vector'}],['selection',{type:'geojson'}]]);
    this.layers=[{id:'background',type:'background'},{id:'track-major-mapped',type:'line'},{id:'station-names',type:'symbol'}];
    this.events=new Map();this.loaded=true;this.camera={center:[123.42,41.8],zoom:10.5};
  }
  on(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);}
  off(name,fn){this.events.get(name)?.delete(fn);}
  emit(name,event={}){for(const fn of this.events.get(name)||[])fn(event);}
  isStyleLoaded(){return this.loaded;}
  getStyle(){return {layers:this.layers};}
  getSource(id){return this.sources.get(id);}
  getLayer(id){return this.layers.find(layer=>layer.id===id);}
  addSource(id,source){this.sources.set(id,source);}
  removeSource(id){this.sources.delete(id);}
  addLayer(layer,before){const index=this.layers.findIndex(item=>item.id===before);this.layers.splice(index<0?this.layers.length:index,0,layer);}
  removeLayer(id){this.layers=this.layers.filter(layer=>layer.id!==id);}
}

test('basemap toggle preserves camera, railway source identity and labels, and stops new source requests',()=>{
  const map=new FakeMap(),states=[],tracks=map.getSource('tracks'),camera=structuredClone(map.camera);
  const base=new BasemapController(map,config,state=>states.push(state));
  base.setEnabled(true);
  assert(map.getSource(BASEMAP_SOURCE));
  assert(map.layers.findIndex(layer=>layer.id===BASEMAP_LAYER)<map.layers.findIndex(layer=>layer.id==='track-major-mapped'));
  base.setEnabled(false);
  assert.equal(map.getSource(BASEMAP_SOURCE),undefined);
  assert.equal(map.getLayer(BASEMAP_LAYER),undefined);
  assert.equal(map.getSource('tracks'),tracks);
  assert(map.getLayer('station-names'));
  assert.deepEqual(map.camera,camera);
  assert.equal(states.at(-1),'off');base.destroy();
});
test('late style load respects preference; a tile error preserves imagery and recovers on a loaded tile',()=>{
  const map=new FakeMap();map.loaded=false;const states=[];
  const base=new BasemapController(map,config,state=>states.push(state));
  base.setEnabled(true);base.setEnabled(false);map.loaded=true;map.emit('load');
  assert.equal(map.getSource(BASEMAP_SOURCE),undefined);
  base.setEnabled(true);const source=map.getSource(BASEMAP_SOURCE);map.emit('error',{sourceId:BASEMAP_SOURCE});
  assert.equal(states.at(-1),'failed');assert(map.getSource('tracks'));map.emit('idle');
  assert.equal(map.getSource(BASEMAP_SOURCE),source);
  map.emit('sourcedata',{sourceId:BASEMAP_SOURCE,sourceDataType:'idle',isSourceLoaded:true});
  assert.equal(states.at(-1),'failed','idle after failed tiles is not recovery');
  map.emit('sourcedata',{sourceId:BASEMAP_SOURCE,tile:{state:'loaded'}});
  assert.equal(states.at(-1),'ready');assert.equal(map.getSource(BASEMAP_SOURCE),source);
  base.retry();assert(map.getSource(BASEMAP_SOURCE));
  map.emit('sourcedata',{sourceId:BASEMAP_SOURCE,sourceDataType:'content',isSourceLoaded:true});
  assert.equal(states.at(-1),'loading','source metadata does not mean a raster tile has loaded');
  map.emit('sourcedata',{sourceId:BASEMAP_SOURCE,sourceDataType:'idle',isSourceLoaded:true});
  assert.equal(states.at(-1),'ready');base.destroy();
});
test('pending re-enable during rail tile loading attaches when map becomes idle',()=>{
  const map=new FakeMap(),base=new BasemapController(map,config,()=>{});
  base.setEnabled(true);base.setEnabled(false);map.loaded=false;base.setEnabled(true);
  assert.equal(map.getSource(BASEMAP_SOURCE),undefined);
  map.loaded=true;map.emit('idle');assert(map.getSource(BASEMAP_SOURCE));base.destroy();
});
test('timeout retains pending raster requests for late recovery; cleanup prevents later callbacks',async()=>{
  const map=new FakeMap(),states=[];const base=new BasemapController(map,config,state=>states.push(state),10);
  base.setEnabled(true);await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(states.at(-1),'failed');assert(map.getSource(BASEMAP_SOURCE));
  map.emit('sourcedata',{sourceId:BASEMAP_SOURCE,tile:{state:'loaded'}});
  assert.equal(states.at(-1),'ready');
  const length=states.length;base.destroy();map.emit('load');map.emit('error',{sourceId:BASEMAP_SOURCE});
  assert.equal(states.length,length);
});
test('preference defaults on, remembers off, and works with unavailable storage',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  assert.equal(readPreference(storage),true);savePreference(storage,false);assert.equal(data.get(PREFERENCE_KEY),'false');
  assert.equal(readPreference(storage),false);
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(readPreference(blocked),true);assert.doesNotThrow(()=>savePreference(blocked,false));
});
test('config rejects undisclosed domains, unsafe protocols and invalid opacity',()=>{
  assert.throws(()=>validateConfig({...config,tiles:['http://tile.openstreetmap.org/{z}/{x}/{y}.png']}));
  assert.throws(()=>validateConfig({...config,tiles:['https://other.example/{z}/{x}/{y}.png']}));
  assert.throws(()=>validateConfig({...config,opacity:2}));
});
