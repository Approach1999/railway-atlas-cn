/* Exploratory local Chrome/SwiftShader measurements, not real-device acceptance.
 * No public basemap requests: baseline measures the actual railway subsystem. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const requireCompleteStyle=require('./benchmark_style_guard.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8772';
const count=Number(process.env.BENCH_RUNS||3),interactions=process.env.BENCH_INTERACTIONS==='1';
const software=process.env.BENCH_RENDERER!=='default';
const requestedSnapshot=process.env.BENCH_SNAPSHOT||(process.env.MVP_DATA_DIR?path.basename(process.env.MVP_DATA_DIR):'');
const address=new URL(base);if(requestedSnapshot)address.searchParams.set('snapshot',requestedSnapshot);
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/performance');
function stats(values){const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,median:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};}
(async()=>{
  assert(Number.isInteger(count)&&count>0&&count<=100);
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});
  const runs=[],errors=[],external=[];let warm=null;
  try{
    for(let i=0;i<count;i++){
      const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),resources=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
      const pending=[];
      context.on('response',response=>{pending.push((async()=>{
        await response.finished();const request=response.request(),sizes=await request.sizes(),headers=await response.allHeaders();
        resources.push({url:response.url(),status:response.status(),encoded_body_bytes:sizes.responseBodySize,header_bytes:sizes.responseHeadersSize,content_encoding:headers['content-encoding']||'identity'});
      })());});
      await page.addInitScript(()=>{
        localStorage.setItem('railway-atlas:basemap:v1','false');
        window.__longTasks=[];
        try{new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({type:'longtask',buffered:true});}catch{}
      });
      const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1250000,uploadThroughput:1250000,connectionType:'ethernet'});
      await page.goto(address.href);await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0,{},{timeout:30000});
      const times=await page.evaluate(()=>{
        const first=performance.getEntriesByName('atlas:first-usable')[0],index=performance.getEntriesByName('atlas:index-ready')[0];
        const gl=document.querySelector('.maplibregl-canvas').getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info');
        return {first_usable_ms:first.startTime,index_ready_ms:index.startTime,rendered_tracks:first.detail.rendered_tracks,snapshot:first.detail.snapshot,style_layers:first.detail.style_layers,name_labels:first.detail.name_labels,map_font:first.detail.map_font,webgl_renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'not exposed'};
      });
      requireCompleteStyle(times.style_layers,times.name_labels,times.map_font);
      if(requestedSnapshot)assert.equal(times.snapshot,requestedSnapshot);
      await page.locator('#search').focus();assert.equal(await page.evaluate(()=>document.activeElement.id),'search');
      await page.waitForLoadState('networkidle');const collected=await Promise.allSettled(pending);
      assert(!collected.some(result=>result.status==='rejected'),'every response must contribute a valid transport-size record');
      assert(resources.some(resource=>/maplibre-gl-worker.*\.js/.test(resource.url)),'worker payload must be included');
      assert(!resources.some(r=>/\/(features|raw|railway|tracks)\.geojson/.test(r.url)));
      assert(!resources.some(r=>r.url.endsWith('/objects.json')),'all-object index stays on demand');
      assert(!resources.some(r=>r.status>=400),'normal performance profile must not hide resource failures');
      const own=resources.filter(r=>new URL(r.url).origin===new URL(base).origin);
      runs.push({...times,own_encoded_body_bytes:own.reduce((sum,r)=>sum+r.encoded_body_bytes,0),own_transfer_bytes:own.reduce((sum,r)=>sum+r.encoded_body_bytes+r.header_bytes,0),resources:own,long_tasks:await page.evaluate(()=>window.__longTasks)});
      console.log(JSON.stringify({trial:i+1,first_usable_ms:Math.round(times.first_usable_ms),own_transfer_bytes:runs.at(-1).own_transfer_bytes}));
      if(interactions&&i===count-1){
        const queries=['沈阳北站','沈阳站','沈阳南','沈阳东','苏家屯','浑河','新城子','沈阳西','不存在的车站','沈阳'];
        const searches=[];
        for(let j=0;j<100;j++)searches.push(await page.evaluate(query=>new Promise((resolve,reject)=>{
          const input=document.querySelector('#search'),results=document.querySelector('#results'),start=performance.now();
          const timer=setTimeout(()=>{observer.disconnect();reject(Error('Search timeout'));},3000);
          const observer=new MutationObserver(()=>{
            const options=document.querySelector('#station-options');
            if(input.value!==query||options.getAttribute('aria-busy')!=='false'||new URL(location.href).searchParams.get('q')!==query)return;
            observer.disconnect();clearTimeout(timer);resolve(performance.now()-start);
          });
          observer.observe(results,{attributes:true,childList:true,characterData:true,subtree:true});
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,query);
          input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:query}));
        }),queries[j%queries.length]));
        const filters=[];
        for(let j=0;j<100;j++)filters.push(await page.evaluate(preset=>new Promise(resolve=>{
          const start=performance.now();document.querySelector('[data-preset="'+preset+'"]').click();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)));
        }),j%2?'overview':'highspeed'));
        warm={search_input_to_results_ms:stats(searches),filter_dom_and_two_frames_ms:stats(filters),searches_ms:searches,filters_ms:filters,
          search_note:'Search timing waits for latest committed q and aria-busy=false; pending-status mutation alone is not a result.',note:'Filter timing is UI feedback plus two animation frames; it does not prove all GPU-rendered track updates meet N02.'};
      }
      await context.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    assert.equal(new Set(runs.map(run=>run.snapshot)).size,1,'one immutable snapshot per benchmark');
    const files=['apps/web/client/src/map-controller.ts','apps/web/client/src/railway-controls.ts','apps/web/client/src/station-search.ts','apps/web/client/dist/index.html'];
    const build_evidence={sha256:Object.fromEntries(await Promise.all(files.map(async file=>[file,crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')]))),requested_snapshot:requestedSnapshot||null};
    const report={build_evidence,date:new Date().toISOString(),browser:browser.version(),environment:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length,memory_bytes:os.totalmem(),renderer:software?'Headless Chrome with forced SwiftShader':'Headless Chrome with default renderer',webgl_renderer:runs[0].webgl_renderer},
      conditions:{download_mbps:10,latency_ms:100,viewport:{width:1440,height:1000},http_cache:'disabled; new isolated context each trial',basemap:'off; no third-party requests',scope:'Exploratory railway-only headless measurements. Not a substitute for default online basemap, headed/manual checks, or real mobile/tablet N01-N04 acceptance.'},
      summary:{first_usable_ms:stats(runs.map(r=>r.first_usable_ms)),index_ready_ms:stats(runs.map(r=>r.index_ready_ms)),own_transfer_bytes:stats(runs.map(r=>r.own_transfer_bytes))},warm,runs,errors,external};
    await fs.writeFile(path.join(output,'benchmark-client.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({summary:report.summary,warm:warm?{search_input_to_results_ms:warm.search_input_to_results_ms,filter_dom_and_two_frames_ms:warm.filter_dom_and_two_frames_ms,note:warm.note}:null},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
