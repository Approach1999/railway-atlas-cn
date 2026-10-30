/* Persisted browser zoom, isolated workspace profiles; no CSS/device-metric zoom substitute. */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),target=require('./browser_target.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/notice-zoom'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 await fs.mkdir(output,{recursive:true});const cases=[],errors=[],external=[],profiles=[];
 const snapshot=(await (await fetch(base+'/dataset.json')).json()).snapshot_id;
 const index=await fs.readFile('apps/web/client/dist/index.html'),asset=index.toString().match(/\/assets\/index-[^" ]+\.js/)[0],build={asset,index_sha256:sha(index),asset_sha256:sha(await fs.readFile('apps/web/client/dist'+asset))};let browserInfo;
 const sizes=process.env.NOTICE_ZOOM_SIZES?JSON.parse(process.env.NOTICE_ZOOM_SIZES):[{width:1552,height:1000},{width:1280,height:800}];
 assert(Array.isArray(sizes)&&sizes.length>0&&sizes.length<=8&&sizes.every(s=>Number.isInteger(s.width)&&Number.isInteger(s.height)&&s.width>=640&&s.height>=480));
 for(const size of sizes){
  let baseline;
  for(const factor of [1,2]){
   const dir=await fs.mkdtemp(path.join(output,'profile-'));profiles.push(dir);await fs.mkdir(path.join(dir,'Default'));await fs.writeFile(path.join(dir,'Default/Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(factor)/Math.log(1.2)}}}));
   const opts=target.options(),context=await chromium.launchPersistentContext(dir,{...opts,viewport:null,reducedMotion:'reduce',args:[...opts.args,'--window-size='+size.width+','+size.height]});
   try{
    browserInfo=await target.describe(context.browser());const p=context.pages()[0],cdp=await context.newCDPSession(p),checks=[];
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await p.goto(base+'/?snapshot='+snapshot+'&types=#map=10.50/41.80000/123.42000');await p.locator('#map-notice button').waitFor();
    async function sample(){const metrics=await cdp.send('Page.getLayoutMetrics'),dom=await p.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,pinch:visualViewport.scale,cssZoom:getComputedStyle(document.documentElement).zoom,searchFont:getComputedStyle(document.querySelector('#search')).fontSize,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}));assert.equal(metrics.cssVisualViewport.zoom,factor);assert.equal(metrics.cssVisualViewport.scale,1);assert.equal(dom.pinch,1);assert.equal(dom.cssZoom,'1');assert.equal(dom.overflow,false);return {metrics,dom};}
    const first=await sample();
    if(factor===1){baseline=first;cases.push({size,factor,first,checks:[{name:'actual-100-percent-baseline',passed:true}]});continue;}
    assert.equal(first.dom.dpr,baseline.dom.dpr*2);assert(Math.abs(first.dom.width*2-baseline.dom.width)<=2);assert.equal(first.dom.searchFont,baseline.dom.searchFont);
    async function reachable(name,locator){
     await locator.scrollIntoViewIfNeeded();const result=await locator.evaluate(e=>{const r=e.getBoundingClientRect(),ix=Math.min(8,r.width/4),iy=Math.min(8,r.height/4),points=[];for(const x of [r.x+ix,r.x+r.width/2,r.right-ix])for(const y of [r.y+iy,r.y+r.height/2,r.bottom-iy]){const hit=document.elementFromPoint(x,y);points.push({x,y,hit:hit===e||e.contains(hit),coveredBy:hit?.id||hit?.className||hit?.tagName});}return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},hit:points.every(p=>p.hit),points,coveredBy:points.filter(p=>!p.hit).map(p=>p.coveredBy)};});
     const r=result.rect,v=result.viewport,passed=r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1&&result.hit;
     checks.push({name,passed,...result});return passed;
    }
    await reachable('empty-reset-action',p.locator('#map-notice button'));
    await reachable('notice-copy-and-box',p.locator('#map-notice'));
    for(const name of ['zoom-in','zoom-out'])await reachable(name,p.locator('.maplibregl-ctrl-'+name));
    for(const id of ['share-open','home','panel-toggle']){
     if(id==='panel-toggle'&&first.dom.width>700){assert.equal(await p.locator('#'+id).isVisible(),false);checks.push({name:'desktop-panel-toggle-intentionally-hidden',passed:true});}
     else await reachable('empty-view-'+id,p.locator('#'+id));
    }
    await reachable('attribution',p.locator('.maplibregl-ctrl-attrib a').first());
    await reachable('scale',p.locator('.maplibregl-ctrl-scale'));
    const tag=size.width+'x'+size.height,shot=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64');assert(Math.abs(shot.readUInt32BE(16)-first.dom.width*factor)<=2);assert(Math.abs(shot.readUInt32BE(20)-first.dom.height*factor)<=2);await fs.writeFile(path.join(output,'empty-'+tag+'.png'),shot);
    await p.goto(base+'/?snapshot='+snapshot+'&types=light_rail#map=10.50/41.80000/123.42000');await p.waitForFunction(()=>document.querySelector('#map-notice')?.textContent.includes('当前视野在这些筛选下没有可见要素'));
    await reachable('long-empty-copy-and-box',p.locator('#map-notice'));await reachable('long-empty-reset',p.locator('#map-notice button'));
    for(const id of ['share-open','home',...(first.dom.width<=700?['panel-toggle']:[])])await reachable('long-empty-'+id,p.locator('#'+id));
    for(const name of ['zoom-in','zoom-out'])await reachable('long-empty-'+name,p.locator('.maplibregl-ctrl-'+name));
    await reachable('long-empty-attribution',p.locator('.maplibregl-ctrl-attrib a').first());
    await fs.writeFile(path.join(output,'long-empty-'+tag+'.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64'));
    if(checks.every(c=>c.passed)){
     await p.locator('#map-notice button').focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.activeElement?.classList.contains('maplibregl-canvas'));await p.locator('#map-notice button').waitFor({state:'detached'});checks.push({name:'reset-activation-and-map-focus',passed:true});
     await p.locator('#undo').click();await p.locator('#map-notice button').waitFor();await reachable('undo-restores-empty-action',p.locator('#map-notice button'));
     if(first.dom.width<=700){await p.locator('#panel-toggle').click();await reachable('collapsed-panel-reset',p.locator('#map-notice button'));await reachable('collapsed-panel-toggle',p.locator('#panel-toggle'));await p.locator('#panel-toggle').click();}
     await reachable('short-window-search-field',p.locator('#search'));await p.locator('#search').fill('沈阳北站');const result=p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'});await result.waitFor();
     if(await reachable('short-window-full-search-result',result)){
      await result.press('Enter');await p.locator('.feature-title').waitFor();const selected=new URL(p.url()).searchParams.get('feature');await reachable('selected-detail-close',p.locator('#detail-close'));
      for(const id of ['share-open','home',...(first.dom.width<=700?['panel-toggle']:[])])await reachable('selected-view-'+id,p.locator('#'+id));
      for(const name of ['zoom-in','zoom-out'])await reachable('selected-view-'+name,p.locator('.maplibregl-ctrl-'+name));
      await reachable('selected-view-attribution',p.locator('.maplibregl-ctrl-attrib a').first());
      await p.locator('#detail-close').click();checks.push({name:'short-window-keyboard-source-selection',passed:selected==='node/676578837'&&new URL(p.url()).searchParams.get('feature')===null});
     }
    }
    cases.push({size,factor,first,checks,screenshots:['empty-'+tag+'.png','long-empty-'+tag+'.png']});
   }finally{await context.close();}
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const report={date:new Date().toISOString(),snapshot,build,browser_target:browserInfo,cases,profiles,errors,external,source_sha256:sha(await fs.readFile(__filename)),scope:'Installed headless browser, genuine default page zoom compared with identical-window 100-percent profile, CDP factor/pinch assertions. Center hit tests and finite recovery tasks, not real user window, screen-reader or complete N09 acceptance.'};
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');const failed=cases.flatMap(c=>c.checks.filter(x=>!x.passed).map(check=>({size:c.size,name:check.name,coveredBy:check.coveredBy})));console.log(JSON.stringify({cases:cases.length,checks:cases.reduce((n,c)=>n+c.checks.length,0),failed}));assert.deepEqual(failed,[]);
})().catch(error=>{console.error(error);process.exitCode=1;});
