/* Fixed 30-second local station-yard trajectory. rAF is a browser scheduling
 * proxy, not a claim about hardware GPU frame delivery or real mobile devices. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const os=require('node:os');
const trajectory=process.env.BENCH_TRAJECTORY||'keyboard';
assert(['keyboard','drag'].includes(trajectory),'known pan trajectory');
const requireCompleteStyle=require('./benchmark_style_guard.cjs');
const runDragPath=require('./pan_drag.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8773';
const snapshot=process.env.MVP_DATA_DIR||'data/processed/shenyang-mvp-accessible-20261022';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/pan-performance');
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,median:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
(async()=>{
  await fs.mkdir(output,{recursive:true});const stations=JSON.parse(await fs.readFile(path.join(snapshot,'stations.geojson'),'utf8'));
  const station=stations.features.find(f=>f.properties.osm_id==='node/676578837');assert(station);
  const software=process.env.BENCH_RENDERER!=='default';
  const browser=await chromium.launch({channel:'chrome',headless:true,args:software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1250000,uploadThroughput:1250000,connectionType:'ethernet'});
    const [longitude,latitude]=station.geometry.coordinates;
    await page.goto(base+'/?snapshot='+path.basename(snapshot)+'&facilities=1#map=15.50/'+latitude+'/'+longitude);
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await page.waitForLoadState('networkidle');await page.locator('.maplibregl-canvas').focus();
    const style_layers=await page.evaluate(()=>performance.getEntriesByName('atlas:first-usable')[0].detail.style_layers);
    requireCompleteStyle(style_layers);
    await page.evaluate(()=>{
      document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-frames',{detail:{active:true}}));
      window.__pan={running:true,frames:[],longTasks:[],start:performance.now()};let previous;
      const tick=timestamp=>{if(!window.__pan.running)return;if(previous!==undefined)window.__pan.frames.push(timestamp-previous);previous=timestamp;requestAnimationFrame(tick);};requestAnimationFrame(tick);
      new PerformanceObserver(list=>{if(window.__pan.running)window.__pan.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})));}).observe({type:'longtask'});
    });
    const diagnostics=process.env.BENCH_DIAGNOSTICS==='1';
    if(diagnostics)await page.evaluate(()=>{window.__pan.notice_mutations=0;window.__panObserver=new MutationObserver(records=>{window.__pan.notice_mutations+=records.length;});window.__panObserver.observe(document.querySelector('#map-notice'),{attributes:true,childList:true,characterData:true,subtree:true});});
    const initialView=page.url(),keys=['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'];let actions=0;
    const dragPath=[];
    let start=Date.now();
    if(trajectory==='drag'){
      const driven=await runDragPath(page);actions=driven.path.length;dragPath.push(...driven.path);
    }else while(Date.now()-start<30000){const elapsed=Date.now()-start;await page.keyboard.press(keys[Math.floor(elapsed/5000)%keys.length]);actions++;await page.waitForTimeout(Math.max(1,actions*100-(Date.now()-start)));}
    const sample=await page.evaluate(()=>{window.__pan.running=false;window.__panObserver?.disconnect();document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-frames',{detail:{active:false}}));const renders=performance.getEntriesByName('atlas:map-render').map(entry=>entry.startTime);return {...window.__pan,map_frames:renders.slice(1).map((time,index)=>time-renders[index]),duration_ms:performance.now()-window.__pan.start,final_view:location.href};});
    if(trajectory==='drag'){await page.waitForTimeout(250);await page.mouse.up();await page.waitForTimeout(250);sample.final_view=page.url();}
    const finalCamera=new URL(sample.final_view).hash.slice(5).split('/').map(Number);
    const world=([lon,lat],zoom)=>{const scale=512*2**zoom;return [(lon+180)/360*scale,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*scale];};
    const initialPixel=world([longitude,latitude],15.5),finalPixel=world([finalCamera[2],finalCamera[1]],finalCamera[0]);
    const endpointError=Math.hypot(finalPixel[0]-initialPixel[0],finalPixel[1]-initialPixel[1]);
    if(trajectory==='drag'){assert(actions>100);assert(endpointError<2,'closed drag must return within two CSS pixels, including URL rounding');}
    const renderer=await page.evaluate(()=>{const gl=document.querySelector('.maplibregl-canvas').getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info');return debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'not exposed';});
    assert(sample.frames.length>100);assert(sample.map_frames.length>100,'actual MapLibre render events must be sampled');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const estimatedDropped=sample.frames.reduce((sum,value)=>sum+Math.max(0,Math.round(value/(1000/60))-1),0);
    const fingerprint=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    const sources=['apps/web/client/src/map-controller.ts','apps/web/client/src/railway-controls.ts','apps/web/client/dist/index.html','scripts/benchmark_pan.cjs','scripts/pan_drag.cjs',path.join(snapshot,'dataset.json')];
    const resourceNames=await page.evaluate(()=>performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>new URL(name).pathname.startsWith('/assets/')&&name.endsWith('.js')));
    const report={build_evidence:{sha256:Object.fromEntries(await Promise.all(sources.map(async file=>[file,await fingerprint(file)]))),loaded_scripts:resourceNames.map(url=>new URL(url).pathname)},machine:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length,node:process.version},diagnostics,notice_mutations:sample.notice_mutations??null,date:new Date().toISOString(),browser:browser.version(),snapshot:path.basename(snapshot),source_anchor:station.properties.osm_id,source_anchor_name:station.properties.display_name,
      style_layers,profile:{viewport:{width:1440,height:1000},zoom:15.5,facilities:true,basemap:false,download_mbps:10,latency_ms:100,renderer:software?'Headless Chrome/forced SwiftShader':'Headless Chrome/default renderer',webgl_renderer:renderer},
      trajectory:{input:trajectory,duration_ms:sample.duration_ms,actions,initial_view:initialView,endpoint_error_css_px:endpointError,
        definition:trajectory==='drag'?'CDP mouse down/up with rAF-driven DOM mousemove: six 5-second legs on a fixed closed screen path for 30 seconds; release after capture and 250ms hold to suppress inertia. DOM moves are synthetic, not physical-device acceptance.':'right, left, down, up in 5-second phases; one keyboard pan every 100ms; actual camera path can vary with animation timing',drag_points:dragPath},
      map_render_interval_ms:sample.map_frames.length?stats(sample.map_frames):null,map_render_intervals_ms:sample.map_frames,raf_interval_ms:stats(sample.frames),estimated_dropped_frames_at_60hz:estimatedDropped,estimated_dropped_fraction:estimatedDropped/(sample.frames.length+estimatedDropped),long_tasks_over_50ms:sample.longTasks,frames_ms:sample.frames,final_view:sample.final_view,errors,external,
      scope:'MapLibre render event submissions plus browser rAF/long-task proxy on real station-yard geometry. Main-thread render events are not physical GPU/display delivery or real-device N03 acceptance.'};
    await fs.writeFile(path.join(output,'benchmark-pan.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({map_render_interval_ms:report.map_render_interval_ms,notice_mutations:report.notice_mutations,raf_interval_ms:report.raf_interval_ms,estimated_dropped_fraction:report.estimated_dropped_fraction,long_tasks:sample.longTasks.length},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
