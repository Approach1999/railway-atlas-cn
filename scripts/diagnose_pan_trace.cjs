/* Diagnostic sampling adds overhead. These times are not acceptance evidence. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const path=require('node:path');
const {gzipSync}=require('node:zlib');
const runDragPath=require('./pan_drag.cjs');
const requireCompleteStyle=require('./benchmark_style_guard.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/pan-trace');
const control=process.env.TRACE_CONTROL||'map',software=process.env.BENCH_RENDERER!=='default';
assert(['map','clear-canvas'].includes(control));
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const stations=JSON.parse(await fs.readFile('data/processed/shenyang-mvp-20261023/stations.geojson','utf8'));
  const station=stations.features.find(feature=>feature.properties.osm_id==='node/676578837');assert(station);
  const [lon,lat]=station.geometry.coordinates;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    const cdp=await context.newCDPSession(page),trace=await browser.newBrowserCDPSession();
    await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1250000,uploadThroughput:1250000,connectionType:'ethernet'});
    if(control==='map'){
      await page.goto(base+'/?snapshot=shenyang-mvp-20261023&facilities=1#map=15.50/'+lat+'/'+lon);
      await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
    }else{
      await page.route('**/__trace_clear_canvas',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><canvas class="maplibregl-canvas" width="1094" height="924" style="display:block;position:absolute;left:346px;top:76px"></canvas></body></html>'}));
      await page.goto(base+'/__trace_clear_canvas');
      await page.evaluate(()=>{
        const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2',{alpha:true,antialias:false,depth:true,stencil:true,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:'high-performance',desynchronized:false});
        if(!gl)throw Error('Control WebGL2 unavailable');
        gl.clearColor(240/255,243/255,237/255,1);
        const draw=()=>{gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT|gl.STENCIL_BUFFER_BIT);requestAnimationFrame(draw);};requestAnimationFrame(draw);
      });
    }
    await page.waitForLoadState('networkidle');await page.waitForTimeout(600);
    const environment=await page.evaluate(()=>{const canvas=document.querySelector('.maplibregl-canvas'),gl=canvas.getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info');return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,canvas:{width:canvas.width,height:canvas.height},context:gl?.getContextAttributes(),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'not exposed',style_layers:performance.getEntriesByName('atlas:first-usable')[0]?.detail.style_layers||null};});
    assert.deepEqual(environment.canvas,{width:1094,height:924},'map and control must use the same actual drawable size');
    if(control==='map')requireCompleteStyle(environment.style_layers);
    await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
    await trace.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,gpu,viz,cc,disabled-by-default-devtools.timeline.frame',options:'record-until-full',transferMode:'ReturnAsStream'});
    await cdp.send('Profiler.start');const start=Date.now();
    const driven=await runDragPath(page),duration_ms=Date.now()-start;
    const {profile}=await cdp.send('Profiler.stop');await fs.writeFile(path.join(output,'main-thread.cpuprofile'),JSON.stringify(profile));
    const completion=new Promise(resolve=>trace.once('Tracing.tracingComplete',resolve));await trace.send('Tracing.end');const completed=await completion,{stream}=completed;
    assert.equal(completed.dataLossOccurred,false,'trace must explicitly confirm no data loss');
    const chunks=[];
    while(true){const chunk=await trace.send('IO.read',{handle:stream,size:1048576});chunks.push(Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8'));if(chunk.eof)break;}
    await trace.send('IO.close',{handle:stream});
    const raw=Buffer.concat(chunks);chunks.length=0;
    await fs.writeFile(path.join(output,'browser-trace.json.gz'),gzipSync(raw));
    await page.waitForTimeout(250);await page.mouse.up();
    const data=JSON.parse(raw.toString('utf8')),names=new Map(),threads=new Map(),events=new Map();
    for(const event of data.traceEvents){
      if(event.ph==='M'&&event.name==='thread_name')threads.set(event.pid+'/'+event.tid,event.args.name);
      if(event.ph==='M'&&event.name==='process_name')names.set(event.pid,event.args.name);
      if(event.ph!=='X'||!Number.isFinite(event.dur))continue;
      const key=event.pid+'/'+event.tid+'/'+event.name,previous=events.get(key)||{pid:event.pid,tid:event.tid,name:event.name,category:event.cat,count:0,total_us:0,max_us:0};
      previous.count++;previous.total_us+=event.dur;previous.max_us=Math.max(previous.max_us,event.dur);events.set(key,previous);
    }
    const top_events=[...events.values()].map(event=>({...event,process:names.get(event.pid),thread:threads.get(event.pid+'/'+event.tid)})).sort((a,b)=>b.total_us-a.total_us).slice(0,80);
    const nodes=new Map(profile.nodes.map(node=>[node.id,node])),self=new Map();
    for(let i=0;i<profile.samples.length;i++){const id=profile.samples[i];self.set(id,(self.get(id)||0)+profile.timeDeltas[i]);}
    const total_us=[...self.values()].reduce((a,b)=>a+b,0);
    const cpu_top=[...self.entries()].map(([id,time])=>({function:nodes.get(id).callFrame.functionName,url:nodes.get(id).callFrame.url,line:nodes.get(id).callFrame.lineNumber,column:nodes.get(id).callFrame.columnNumber,self_us:time,percentage:100*time/total_us})).sort((a,b)=>b.self_us-a.self_us).slice(0,40);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const fingerprints={};for(const file of ['scripts/diagnose_pan_trace.cjs','scripts/pan_drag.cjs','apps/web/client/dist/index.html'])fingerprints[file]=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    for(const file of ['browser-trace.json.gz','main-thread.cpuprofile'])fingerprints[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(output,file))).digest('hex');
    fingerprints['uncompressed_trace']=crypto.createHash('sha256').update(raw).digest('hex');
    const report={date:new Date().toISOString(),browser:browser.version(),control,renderer_mode:software?'software':'default',acceptance_evidence:false,duration_ms,input_samples:driven.path.length,
      data_loss_occurred:completed.dataLossOccurred,environment,fingerprints,trace_events:data.traceEvents.length,top_events,cpu_sampled_us:total_us,cpu_top,errors,external,
      scope:'Profiling overhead; inclusive nested trace durations must not be added as CPU percentages. CPU samples describe only the page main thread. Map or empty WebGL control with the same synthetic DOM input. Controls omit all map content and cannot be acceptance evidence. Not a performance pass or physical frame proof.'};
    await fs.writeFile(path.join(output,'pan-trace-summary.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({trace_events:report.trace_events,top_events:top_events.slice(0,12),cpu_top:cpu_top.slice(0,10)},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
