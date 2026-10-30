/* Isolated buffer experiment: compare public symbol hit extents, not private renderer state. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/buffer-positions'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 await fs.mkdir(output,{recursive:true});const snapshot=(await (await fetch(base+'/dataset.json')).json()).snapshot_id;
 const stations=await (await fetch(base+'/snapshots/'+snapshot+'/stations.geojson')).json(),yard=stations.features.find(f=>f.properties.osm_id==='node/676578837').geometry.coordinates;
 const cameras=[{name:'regional-z8',z:8,lon:123.42,lat:41.8},{name:'overview-z10',z:10.5,lon:123.42,lat:41.8},{name:'tile-edge-z12',z:12,lon:Math.floor((123.42+180)/360*2**12)/2**12*360-180,lat:41.8},{name:'city-z14',z:14,lon:123.42,lat:41.8},{name:'yard-z15',z:15.5,lon:yard[0],lat:yard[1]},{name:'yard-moved-z15',z:15.5,lon:yard[0]+.01,lat:yard[1]+.003}];
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),runs=[],errors=[],mutations=[];
 try{
  for(const [phase,buffer] of [['control',512],['candidate',Number(process.env.DIAGNOSTIC_POSITION_BUFFER||128)]]){
   assert([128,512].includes(buffer));
   const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
   await p.route('**/assets/index-*.js',async route=>{
    const response=await route.fetch(),original=await response.text(),needle='promoteId:`label_id`,maxzoom:18,buffer:512',capture='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(original.split(needle).length-1,1);assert.equal(original.split(capture).length-1,1);
    const body=original.replace(needle,'promoteId:`label_id`,maxzoom:18,buffer:'+buffer).replace(capture,'addLayer(e,t){globalThis.__bufferPositionMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');mutations.push({buffer,original_sha256:sha(original),observed_sha256:sha(body)});await route.fulfill({response,body});
   });
   await p.goto(base+'/?snapshot='+snapshot);await p.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
   for(const camera of cameras)for(const preset of ['overview','highspeed','urban']){
    await p.evaluate(c=>window.__bufferPositionMap.jumpTo({center:[c.lon,c.lat],zoom:c.z}),camera);await p.locator('[data-preset='+preset+']').click();
    await p.waitForFunction(()=>{const m=window.__bufferPositionMap;return m.loaded()&&m.areTilesLoaded()&&m.isSourceLoaded('rail-line-labels');});await p.waitForTimeout(500);
    const sample=await p.evaluate(()=>{
     const m=window.__bufferPositionMap,layers=['line-names','line-captions','minor-line-names','minor-line-captions'],box=m.getCanvas().getBoundingClientRect(),w=box.width,h=box.height;
     const all=m.queryRenderedFeatures({layers}),ids=[...new Set(all.map(f=>f.properties.label_id))].sort(),cache=new Map();
     const query=(axis,direction,value)=>{const key=[axis,direction,value].join('/');if(!cache.has(key)){const r=axis===0?(direction===0?[[0,0],[value,h]]:[[value,0],[w,h]]):(direction===0?[[0,0],[w,value]]:[[0,value],[w,h]]);cache.set(key,new Set(m.queryRenderedFeatures(r,{layers}).map(f=>f.properties.label_id)));}return cache.get(key);};
     const labels=ids.map(id=>{const bounds=[];for(const axis of [0,1])for(const direction of [0,1]){let lo=0,hi=axis===0?w:h;while(hi-lo>.5){const mid=(lo+hi)/2,hit=query(axis,direction,mid).has(id);if(hit===(direction===0))hi=mid;else lo=mid;}bounds.push((lo+hi)/2);}const props=all.find(f=>f.properties.label_id===id).properties;return {id,osm_id:props.osm_id,text:props.label_text,bounds};});
     return {labels,query_count:cache.size,zoom:m.getZoom(),center:m.getCenter().toArray()};
    });runs.push({phase,buffer,camera,preset,...sample});console.log(JSON.stringify({phase,buffer,camera:camera.name,preset,labels:sample.labels.length}));
   }
   await p.close();
  }
  assert.deepEqual(errors,[]);const comparisons=[];
  for(const before of runs.filter(r=>r.phase==='control')){
   const after=runs.find(r=>r.phase==='candidate'&&r.camera.name===before.camera.name&&r.preset===before.preset),a=new Map(before.labels.map(v=>[v.id,v])),b=new Map(after.labels.map(v=>[v.id,v]));
   const lost=[...a.keys()].filter(id=>!b.has(id)),added=[...b.keys()].filter(id=>!a.has(id)),moved=[];
   for(const [id,label] of a)if(b.has(id)){const other=b.get(id);assert.equal(label.osm_id,other.osm_id);assert.equal(label.text,other.text);const delta=Math.max(...label.bounds.map((v,i)=>Math.abs(v-other.bounds[i])));if(delta>1)moved.push({id,delta_css_px:delta,before:label.bounds,after:other.bounds});}
   comparisons.push({camera:before.camera.name,preset:before.preset,before_count:a.size,after_count:b.size,lost,added,moved});
  }
  const index=await fs.readFile('apps/web/client/dist/index.html'),asset=index.toString().match(/\/assets\/index-[^" ]+\.js/)[0],build={asset,index_sha256:sha(index),asset_sha256:sha(await fs.readFile('apps/web/client/dist'+asset))};assert(mutations.every(m=>m.original_sha256===build.asset_sha256));
  const report={date:new Date().toISOString(),snapshot,build,source_sha256:sha(await fs.readFile(__filename)),browser:browser.version(),mutations,runs,comparisons,errors,diagnostic_only:true,scope:'Public symbol rectangle hit-query extents at 0.5px bisection resolution, six finite camera states and three presets after movement. Not exact glyph pixels, all tile boundaries, continuous pan or acceptance proof.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({comparisons:comparisons.length,different:comparisons.filter(c=>c.lost.length||c.added.length||c.moved.length).map(c=>({camera:c.camera,preset:c.preset,lost:c.lost.length,added:c.added.length,moved:c.moved.length}))}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
