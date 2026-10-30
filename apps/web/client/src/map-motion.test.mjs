import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapMotion} from './map-motion.ts';
function fixture(matches=false){
  const events=new Set(),changes=new Set(),calls=[];
  const map={on:(_type,listener)=>events.add(listener),off:(_type,listener)=>events.delete(listener),
    stop(){calls.push({stop:true});for(const listener of events)listener();},
    easeTo(options){calls.push(options);if(!options.duration)for(const listener of events)listener();}};
  const query={matches,addEventListener:(_type,listener)=>changes.add(listener),removeEventListener:(_type,listener)=>changes.delete(listener)};
  const motion=createMapMotion(map,query);
  return {motion,calls,events,changes,change(value){query.matches=value;for(const listener of changes)listener();}};
}
const target={center:[123.42,41.8],zoom:10.5,offset:[0,-35],duration:450};
test('changing to reduced motion completes the exact active destination and offset without animation',()=>{
  const f=fixture();f.motion.easeTo(target);assert.deepEqual(f.calls.at(-1),target);
  f.change(true);assert.deepEqual(f.calls.at(-1),{...target,duration:0});
  f.change(false);f.motion.easeTo(target);assert.equal(f.calls.at(-1).duration,450);
});
test('initial reduce and replacement moves use the latest preference and destination',()=>{
  const f=fixture(true);f.motion.easeTo(target);assert.equal(f.calls.at(-1).duration,0);
  f.change(false);f.motion.easeTo(target);
  const replacement={...target,center:[123.5,41.9]};f.motion.easeTo(replacement);
  f.change(true);assert.deepEqual(f.calls.at(-1),{...replacement,duration:0});
});
test('reduce cancels unowned movement, does not replay a completed target and removes listeners on disposal',()=>{
  const f=fixture(true);f.motion.easeTo(target);f.change(false);f.change(true);assert.deepEqual(f.calls.at(-1),{stop:true});
  f.motion.dispose();assert.equal(f.events.size,0);assert.equal(f.changes.size,0);
  const count=f.calls.length;f.change(false);f.change(true);f.motion.easeTo(target);assert.equal(f.calls.length,count);
});
