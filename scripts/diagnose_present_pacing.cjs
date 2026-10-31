/* Presentation-pacing control: isolates browser graphics presentation factors
 * (headless/headed, occlusion detection, ANGLE backend, canvas size, clear cost,
 * browser channel) on an otherwise empty page. Diagnostic only: no map engine,
 * railway data or application code; cannot satisfy N03 or replace device acceptance.
 * Factors come from env; every run must be executed serially. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const runDragPath=require('./pan_drag.cjs'),assessPanProtocol=require('./pan_protocol_guard.cjs');
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return {samples:s.length,median:s[Math.ceil(s.length*.5)-1],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)};};
const CHANNEL=process.env.PACING_CHANNEL||'chrome';
const HEADLESS=(process.env.PACING_HEADLESS||'true')==='true';
const MODE=process.env.PACING_MODE||'clear';assert(['clear','noClear'].includes(MODE));
const CANVAS=(process.env.PACING_CANVAS||'1040x1000').split('x').map(Number);
assert(CANVAS.length===2&&CANVAS.every(n=>Number.isFinite(n)&&n>0));
const EXTRA_ARGS=(process.env.PACING_ARGS||'').split(',').map(s=>s.trim()).filter(Boolean);
const OUTPUT=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/present-pacing/run');
(async()=>{
 const args=[...EXTRA_ARGS];
 if(!HEADLESS)args.push('--window-position=40,40','--window-size=1500,1100');
 const browser=await chromium.launch({channel:CHANNEL,headless:HEADLESS,args});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html><head><title>Empty presentation pacing control</title><style>body{margin:0}.maplibregl-canvas{position:absolute;left:400px;top:0;width:calc(100% - 400px);height:100%;background:#f0f3ed}</style></head><body><canvas class="maplibregl-canvas" tabindex="0"></canvas></body></html>');
  const graphics=await page.evaluate(({mode,canvas})=>{
   const el=document.querySelector('canvas');el.width=canvas[0];el.height=canvas[1];
   const gl=el.getContext('webgl2',{antialias:false,powerPreference:'high-performance',preserveDrawingBuffer:false,failIfMajorPerformanceCaveat:false,desynchronized:false});
   if(!gl)throw Error('WebGL2 unavailable');window.__schedulerGL=mode==='clear'?gl:null;gl.clearColor(.94,.95,.93,1);
   const debug=gl.getExtension('WEBGL_debug_renderer_info');return {width:el.width,height:el.height,attributes:gl.getContextAttributes(),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'not exposed'};
  },{mode:MODE,canvas:CANVAS});
  await page.locator('canvas').focus();await page.waitForTimeout(600);
  await page.evaluate(()=>{
   window.__scheduler={running:true,frames:[],moves:0,longTasks:[],start:performance.now()};let previous;
   document.addEventListener('mousemove',()=>window.__scheduler.moves++);
   const tick=t=>{if(!window.__scheduler.running)return;if(previous!==undefined)window.__scheduler.frames.push(t-previous);previous=t;if(window.__schedulerGL)window.__schedulerGL.clear(window.__schedulerGL.COLOR_BUFFER_BIT);requestAnimationFrame(tick);};requestAnimationFrame(tick);
   new PerformanceObserver(list=>{if(window.__scheduler.running)window.__scheduler.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})));}).observe({type:'longtask'});
  });
  const driven=await runDragPath(page);
  const sample=await page.evaluate(()=>{window.__scheduler.running=false;return {...window.__scheduler,duration_ms:performance.now()-window.__scheduler.start};});
  await page.mouse.up();
  assert.deepEqual(errors,[]);assert(sample.moves>=driven.path.length);assert(sample.frames.length>100);
  const protocol=assessPanProtocol(sample),sources=[__filename,'scripts/pan_drag.cjs','scripts/pan_protocol_guard.cjs'];
  const report={date:new Date().toISOString(),browser:browser.version(),diagnostic_only:true,channel:CHANNEL,headless:HEADLESS,mode:MODE,canvas:CANVAS,extra_args:EXTRA_ARGS,graphics,viewport:{width:1440,height:1000},scope:'Empty-page presentation pacing control replicating the pan-layer scheduler protocol; no map engine, railway data or application code. Cannot satisfy N03, cannot prove application performance and cannot replace physical display or real-device acceptance.',sha256:Object.fromEntries(await Promise.all(sources.map(async f=>[f,crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex')]))),protocol,raf_interval_ms:stats(sample.frames),...sample,drag_points:driven.path,errors};
  await fs.mkdir(OUTPUT,{recursive:true});await fs.writeFile(path.join(OUTPUT,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({protocol,raf_interval_ms:report.raf_interval_ms,renderer:graphics.renderer,headless:HEADLESS,mode:MODE,canvas:CANVAS,extra_args:EXTRA_ARGS,channel:CHANNEL,browser:report.browser,long_tasks:sample.longTasks.length}));assert(protocol.valid);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
