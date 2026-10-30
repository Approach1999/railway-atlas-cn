import test from 'node:test';
import assert from 'node:assert/strict';
import {createRailTileLoader,railTileURL,TileReadTimeoutError} from './rail-tile-request.ts';
const origin='https://atlas.test',url=railTileURL(origin+'/snapshots/safe/tiles/8/200/100.pbf');
const pending=signal=>new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});

test('tile loader preserves exact bytes, cache metadata and same-origin credential defaults',async()=>{
  let request;
  const load=createRailTileLoader(origin,async(target,options)=>{request={target,options};return new Response(new Uint8Array([0x1a,0x02,0xff,0x00]),{headers:{'cache-control':'public,max-age=60',expires:'Sun, 25 Oct 2026 12:00:00 GMT'}});});
  const result=await load({url,type:'arrayBuffer',cache:'reload'},new AbortController());
  assert.deepEqual([...new Uint8Array(result.data)],[0x1a,0x02,0xff,0x00]);
  assert.equal(result.cacheControl,'public,max-age=60');assert.equal(result.expires,'Sun, 25 Oct 2026 12:00:00 GMT');
  assert.equal(request.target,origin+'/snapshots/safe/tiles/8/200/100.pbf');assert.equal(request.options.cache,'reload');
  assert.equal(request.options.credentials,'same-origin');
});

test('foreign endpoints, traversal and invalid coordinates fail before any request',async()=>{
  let calls=0;const load=createRailTileLoader(origin,async()=>{calls++;});
  for(const bad of ['https://other.test/snapshots/safe/tiles/8/1/1.pbf',origin+'/private',origin+'/snapshots/../private/tiles/8/1/1.pbf',origin+'/snapshots/safe/tiles/8/256/1.pbf',origin+'/snapshots/safe/tiles/23/1/1.pbf',origin+'/snapshots/safe/tiles/8/1/1.pbf#fragment'])await assert.rejects(load({url:railTileURL(bad)},new AbortController()));
  assert.equal(calls,0);
});

test('headers and unfinished binary bodies time out with a visible non-AbortError',async()=>{
  for(const body of [false,true]){
    let observed;
    const load=createRailTileLoader(origin,async(_url,{signal})=>{observed=signal;if(!body)return pending(signal);return {ok:true,arrayBuffer:()=>pending(signal)};},20);
    await assert.rejects(load({url},new AbortController()),error=>error instanceof TileReadTimeoutError&&error.name!=='AbortError');
    assert.equal(observed.aborted,true);
  }
});

test('source cancellation preserves its reason and HTTP failures stop unread bodies',async()=>{
  const parent=new AbortController(),reason=new DOMException('view changed','AbortError');
  const request=createRailTileLoader(origin,async(_url,{signal})=>pending(signal))({url},parent);
  parent.abort(reason);await assert.rejects(request,error=>error===reason);
  let failedSignal;const load=createRailTileLoader(origin,async(_url,{signal})=>{failedSignal=signal;return {ok:false,status:503};});
  await assert.rejects(load({url},new AbortController()),error=>error.status===503);assert.equal(failedSignal.aborted,true);
});
