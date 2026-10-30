/* Actual source-ready render and idle, distinct from UI + two rAF.
 * Isolated desktop benchmark; not physical presentation or real-device proof. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const path=require('node:path');
const os=require('node:os');
const requireCompleteStyle=require('./benchmark_style_guard.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/filter-performance');
const count=Number(process.env.BENCH_FILTER_RUNS||100);
const software=process.env.BENCH_RENDERER!=='default';
function stats(values){const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,median:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};}
(async()=>{
  assert(Number.isInteger(count)&&count>0&&count<=400);
  const stations=JSON.parse(await fs.readFile('data/processed/shenyang-mvp-20261023/stations.geojson','utf8'));
  const station=stations.features.find(feature=>feature.properties.osm_id==='node/676578837');assert(station);
  const [lon,lat]=station.geometry.coordinates;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});
  const scenes=[],errors=[],external=[];
  try{
    for(const scene of [{name:'overview',hash:'10.50/41.80000/123.42000',facilities:false},{name:'station-yard',hash:'15.50/'+lat+'/'+lon,facilities:true}]){
      const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      page.on('request',request=>{if(new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
      await page.addInitScript(()=>{
        localStorage.setItem('railway-atlas:basemap:v1','false');window.__filterLongTasks=[];
        new PerformanceObserver(list=>window.__filterLongTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({type:'longtask'});
      });
      const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1250000,uploadThroughput:1250000,connectionType:'ethernet'});
      await page.goto(base+'/?snapshot=shenyang-mvp-20261023&facilities='+(scene.facilities?'1':'0')+'#map='+scene.hash);
      await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
      const initial=await page.evaluate(()=>performance.getEntriesByName('atlas:first-usable')[0].detail);requireCompleteStyle(initial.style_layers,initial.name_labels,initial.map_font);
      await page.waitForLoadState('networkidle');
      const disabledMarks=await page.evaluate(()=>performance.getEntriesByName('atlas:filters-applied').length);assert.equal(disabledMarks,0);
      // Invalid activation must not start capture.
      await page.evaluate(()=>document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-filters',{detail:{active:'true'}})));
      await page.locator('[data-preset="highspeed"]').click();await page.waitForTimeout(600);
      assert.equal(await page.evaluate(()=>performance.getEntriesByName('atlas:filters-applied').length),0);
      const renderer=await page.evaluate(()=>{const gl=document.querySelector('.maplibregl-canvas').getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info');return debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'not exposed';});
      await page.evaluate(()=>{window.__filterLongTasks=[];document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-filters',{detail:{active:true}}));});
      const samples=[];
      for(let i=0;i<count;i++){
        const preset=i%2?'highspeed':'overview';
        const sample=await page.evaluate(preset=>new Promise((resolve,reject)=>{
          const start=performance.now();let ui=null;
          const before=performance.getEntriesByName('atlas:filters-applied').length;
          const observer=new PerformanceObserver(list=>{
            const entries=list.getEntries();
            const settled=entries.find(entry=>entry.name==='atlas:filters-settled'&&entry.startTime>=start&&entry.detail.preset===preset);
            if(!settled)return;
            const applied=performance.getEntriesByName('atlas:filters-applied').find(entry=>entry.detail.revision===settled.detail.revision);
            const rendered=performance.getEntriesByName('atlas:filters-rendered').find(entry=>entry.detail.revision===settled.detail.revision);
            if(!applied||!rendered)return;
            observer.disconnect();clearTimeout(timer);
            resolve({preset,revision:settled.detail.revision,ui_two_raf_ms:ui,applied_ms:applied.startTime-start,
              rendered_ms:rendered.startTime-start,settled_ms:settled.startTime-start,rendered:rendered.detail,settled:settled.detail});
          });
          observer.observe({type:'mark'});
          const timer=setTimeout(()=>{observer.disconnect();reject(Error('No matching source-ready render/idle for '+preset));},10000);
          document.querySelector('[data-preset="'+preset+'"]').click();
          requestAnimationFrame(()=>requestAnimationFrame(()=>{ui=performance.now()-start;}));
          if(performance.getEntriesByName('atlas:filters-applied').length!==before+1){observer.disconnect();clearTimeout(timer);reject(Error('Filter action must produce exactly one applied revision'));}
        }),preset);
        for(const stage of [sample.rendered,sample.settled]){
          requireCompleteStyle(stage.style_layers,stage.name_labels,stage.map_font);assert.equal(stage.failed_tiles,0);assert.deepEqual(stage.resource_errors,[]);
          assert(stage.rendered_tracks>0,'real tracks must still be rendered in each preset');
          if(preset==='highspeed')assert.deepEqual(stage.track_classes,['high_speed'],'ready render must already reflect the requested filter');
          else assert(stage.track_classes.some(value=>value!=='high_speed'),'overview must restore actual other track classes');
        }
        assert(sample.applied_ms<=sample.rendered_ms&&sample.rendered_ms<=sample.settled_ms);
        assert.equal(sample.revision,i+1);samples.push(sample);
      }
      const long_tasks=await page.evaluate(()=>window.__filterLongTasks);
      await page.evaluate(()=>document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-filters',{detail:{active:false}})));
      const stopped=await page.evaluate(()=>performance.getEntriesByName('atlas:filters-applied').length);
      await page.locator('[data-preset="overview"]').click();await page.waitForTimeout(600);
      assert.equal(await page.evaluate(()=>performance.getEntriesByName('atlas:filters-applied').length),stopped);
      const summary=Object.fromEntries(['applied_ms','rendered_ms','settled_ms'].map(key=>[key,stats(samples.map(sample=>sample[key]))]));
      scenes.push({...scene,renderer,summary,long_tasks,samples});console.log(JSON.stringify({scene:scene.name,summary}));
      await context.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const files=['apps/web/client/src/map-controller.ts','apps/web/client/dist/index.html','scripts/benchmark_filters.cjs','scripts/benchmark_style_guard.cjs'];
    const report={date:new Date().toISOString(),browser:browser.version(),machine:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model},
      conditions:{renderer:software?'SwiftShader':'default',viewport:{width:1440,height:1000},download_mbps:10,latency_ms:100,basemap:false,scope:'Alternating real overview/highspeed presets, source-ready render and subsequent idle. Not GPU/display completion, all filter combinations, other browsers or real devices.'},
      sha256:Object.fromEntries(await Promise.all(files.map(async file=>[file,crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')]))),scenes,errors,external};
    await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'benchmark-filters.json'),JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
