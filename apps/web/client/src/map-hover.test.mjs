import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapHover,hoverItems} from './map-hover.ts';
const feature=(id,name,properties={})=>({type:'Feature',geometry:{type:'Point',coordinates:[123.4,41.8]},properties:{osm_id:id,display_name:name,rail_mode:'unknown',status:'unknown',...properties}});
test('hover previews preserve missing information, line identities, status and a bounded candidate list',()=>{
  const features=[feature('node/1','',{feature_kind:'facility',facility_kind:'switch'}),feature('way/2','<script>',{feature_kind:'track',line_class:'high_speed',status:'construction',line_keys:['metro-2','missing']}),feature('node/3','station',{feature_kind:'station',rail_mode:'subway'}),feature('way/4','area',{feature_kind:'station_area'})];
  const items=hoverItems(features,[{line_key:'metro-2',name:'2号线'}]);assert.equal(items.length,3);assert.equal(items[0].name,'道岔');assert.equal(items[0].status,'状态未标注');assert.equal(items[1].name,'<script>');assert.equal(items[1].lines,'2号线 / missing');assert.match(items[1].kind,/高速/);assert.match(items[2].kind,/地铁.*车站/);
});
test('Escape suppresses the same hit until leaving, but allows a different source target; snapshots are isolated',()=>{
  const store=createMapHover(),items=hoverItems([feature('node/1','one')],[]);let events=0;store.subscribe(()=>events++);store.show(items,4,100,200);assert.equal(store.getSnapshot().total,4);assert(Object.isFrozen(store.getSnapshot().items[0]));items[0].name='changed';assert.equal(store.getSnapshot().items[0].name,'one');
  store.dismiss();store.show(items,4,110,210);assert.equal(store.getSnapshot(),null);store.show(hoverItems([feature('node/2','two')],[]),1,110,210);assert.equal(store.getSnapshot().items[0].id,'node/2');store.dismiss();store.clear();store.show(items,1,110,210);assert(store.getSnapshot());const before=events;store.dispose();store.show([],0,0,0);assert.equal(events,before);
});
test('moving from map onto the preview holds it; leaving eventually clears and disposal cancels timers',async()=>{
  const store=createMapHover(),items=hoverItems([feature('node/1','one')],[]);store.show(items,1,100,100);store.leave();store.hold();await new Promise(resolve=>setTimeout(resolve,210));assert(store.getSnapshot());store.leave();await new Promise(resolve=>setTimeout(resolve,210));assert.equal(store.getSnapshot(),null);store.show(items,1,100,100);store.leave();let count=0;store.subscribe(()=>count++);store.dispose();await new Promise(resolve=>setTimeout(resolve,210));assert.equal(count,0);
});
