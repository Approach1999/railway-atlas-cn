/* Empty-page rAF/input control. Never a railway-map performance acceptance. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const runDragPath=require('./pan_drag.cjs'),assessPanProtocol=require('./pan_protocol_guard.cjs');
const mode=process.env.DIAGNOSTIC_SCHEDULER_MODE||'empty';assert(['empty','webgl'].includes(mode));
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/pan-layers/scheduler');
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return {samples:s.length,median:s[Math.ceil(s.length*.5)-1],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)};};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html><head><title>Empty scheduler diagnostic</title><style>body{margin:0}.maplibregl-canvas{position:absolute;left:400px;top:0;width:calc(100% - 400px);height:100%;background:#f0f3ed}</style></head><body><canvas class="maplibregl-canvas" tabindex="0"></canvas></body></html>');
  const graphics=await page.evaluate(mode=>{
   if(mode!=='webgl')return null;
   const canvas=document.querySelector('canvas');canvas.width=1040;canvas.height=1000;
   const gl=canvas.getContext('webgl2',{antialias:false,powerPreference:'high-performance',preserveDrawingBuffer:false,failIfMajorPerformanceCaveat:false,desynchronized:false});
   if(!gl)throw Error('WebGL2 unavailable');window.__schedulerGL=gl;gl.clearColor(.94,.95,.93,1);
   const debug=gl.getExtension('WEBGL_debug_renderer_info');return {width:canvas.width,height:canvas.height,attributes:gl.getContextAttributes(),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'not exposed'};
  },mode);
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
  const report={date:new Date().toISOString(),browser:browser.version(),diagnostic_only:true,mode,graphics,viewport:{width:1440,height:1000},scope:'Empty-page input/rAF control, optionally clearing an otherwise empty WebGL2 canvas each tick; no map engine, railway data or application code. Cannot satisfy N03 or isolate physical display performance.',sha256:Object.fromEntries(await Promise.all(sources.map(async f=>[f,crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex')]))),protocol,raf_interval_ms:stats(sample.frames),...sample,drag_points:driven.path,errors};
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({protocol,raf_interval_ms:report.raf_interval_ms,moves:sample.moves,long_tasks:sample.longTasks.length}));assert(protocol.valid);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
