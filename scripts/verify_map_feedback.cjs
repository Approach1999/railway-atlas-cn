/* Real immutable data, React status/recovery UI, and browser history. Raster off. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/map-feedback');
const current='shenyang-mvp-20261023',old='shenyang-mvp-progress-20261022';
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const checks=[],errors=[],external=[];
 async function page(options={}){
  const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});
  await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
  p.on('pageerror',e=>errors.push(e.message));
  p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  return p;
 }
 const ready=p=>p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
 async function choose(p,snapshot){
  await p.locator('#dataset-version').selectOption(snapshot);
  await p.getByRole('button',{name:'使用此版本',exact:true}).click();
 }
 try{
  const p=await page();
  await p.goto(base+'/?invalid_test=1');await ready(p);
  const initialWarning=await p.locator('#navigation-status').innerText(),initialDate=await p.locator('#source-date').innerText();
  assert.match(initialWarning,/未知参数/);
  await p.evaluate(()=>window.originalCanvas=document.querySelector('.maplibregl-canvas'));
  let failing=true;
  await p.route('**/snapshots/'+old+'/dataset.json',r=>failing?r.fulfill({status:503,body:'unavailable'}):r.continue());
  await p.locator('#dataset-picker summary').click();await choose(p,old);
  await p.locator('#dataset-switch-status').filter({hasText:'版本加载失败'}).waitFor();
  assert.equal(await p.locator('#navigation-status').innerText(),initialWarning);
  assert.equal(await p.locator('#source-date').innerText(),initialDate);
  assert.equal(new URL(p.url()).searchParams.get('snapshot'),current);
  checks.push('failed staged switch preserves the current source date, navigation explanation and snapshot');
  failing=false;await choose(p,old);
  await p.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();
  assert.equal(await p.locator('#navigation-status').textContent(),'');
  assert.equal(await p.evaluate(()=>window.originalCanvas===document.querySelector('.maplibregl-canvas')),true);
  const response=await p.request.get(base+'/snapshots/'+old+'/dataset.json');assert.equal(response.status(),200);
  const manifest=await response.json(),source=manifest.source;
  const sourceTime=(typeof source.osm_base==='object'?source.osm_base.osm_base:source.osm_base)||source.osm_timestamp||source.source_time;
  assert.equal(await p.locator('#source-date').textContent(),'铁路数据 '+sourceTime.slice(0,10));
  checks.push('successful switch clears the reproduced stale warning and renders the active source date without replacing the map canvas');

  const incoming=new URL(p.url());incoming.searchParams.set('snapshot',current);
  const hostile='test<img src=x onerror=alert(1)>';incoming.searchParams.set(hostile,'1');
  await p.evaluate(address=>history.pushState(null,'',address),incoming.href);
  await p.goBack();await p.waitForFunction(snapshot=>new URL(location.href).searchParams.get('snapshot')===snapshot,old);
  await p.goForward();await p.locator('#navigation-status').filter({hasText:hostile}).waitFor();
  await p.waitForFunction(snapshot=>new URL(location.href).searchParams.get('snapshot')===snapshot,current);
  assert.equal(await p.locator('#navigation-status img').count(),0);
  assert.equal(await p.locator('#navigation-status').getAttribute('role'),'status');
  await p.goBack();await p.waitForFunction(snapshot=>new URL(location.href).searchParams.get('snapshot')===snapshot,old);
  await p.waitForFunction(()=>document.querySelector('#navigation-status').textContent==='');
  checks.push('cross-snapshot back/forward restores its own warnings as inert text and clears them again on valid history');
  await p.close();

  const retry=await page();let responseStatus=410;
  await retry.route('**/snapshots/'+current+'/dataset.json',r=>responseStatus===200?r.continue():r.fulfill({status:responseStatus,body:'unavailable'}));
  await retry.goto(base+'/?snapshot='+current+'&q='+encodeURIComponent('沈阳北站'));
  await retry.locator('#navigation-status').filter({hasText:'超过保留期'}).waitFor();
  const recovery=retry.locator('[data-latest-recovery]');assert.equal(await recovery.count(),1);
  responseStatus=503;await retry.getByRole('button',{name:'重试数据说明',exact:true}).click();
  await retry.locator('#navigation-status').filter({hasText:'暂不可用'}).waitFor();assert.equal(await recovery.count(),1);
  await retry.locator('#search').fill('沈阳站');
  responseStatus=200;await retry.getByRole('button',{name:'重试数据说明',exact:true}).click();await ready(retry);
  await recovery.waitFor({state:'detached'});
  assert.equal(await retry.locator('#navigation-status').textContent(),'');
  assert.equal(await retry.locator('#search').inputValue(),'沈阳站');
  assert.equal(await retry.locator('#status').evaluate(el=>el===document.activeElement),true);
  await retry.locator('#about-open').click();await retry.getByRole('button',{name:'关闭数据说明',exact:true}).click();
  assert.equal(await retry.locator('#navigation-status').textContent(),'');assert.equal(await recovery.count(),0);
  checks.push('410 then 503 then successful manifest retry has one React recovery action, clears stale status, preserves edited query and returns focus');
  await retry.close();

  const recoveryPage=await page();
  await recoveryPage.route('**/snapshots/retired/**',r=>r.fulfill({status:410,body:'retention ended'}));
  await recoveryPage.goto(base+'/?snapshot=retired&feature=node%2F676578837&q='+encodeURIComponent('原查询')+'#map=13.50/41.80/123.42');
  await recoveryPage.locator('[data-latest-recovery]').waitFor();
  await recoveryPage.locator('#search').fill('沈阳北站');
  await recoveryPage.getByRole('button',{name:'打开当前版本',exact:true}).click();await ready(recoveryPage);
  await recoveryPage.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
  assert.equal(await recoveryPage.locator('#search').inputValue(),'沈阳北站');
  assert.equal(new URL(recoveryPage.url()).searchParams.get('feature'),'node/676578837');
  assert.equal(await recoveryPage.locator('[data-latest-recovery]').count(),0);
  checks.push('current-version recovery uses the edited query and original typed selection, then removes the obsolete action');
  await recoveryPage.close();

  const mobile=await page({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await mobile.goto(base);await ready(mobile);
  for(let i=0;i<6;i++){
   await mobile.locator('#panel-toggle').tap();
   const collapsed=i%2===0;
   assert.equal(await mobile.locator('#panel-toggle').getAttribute('aria-expanded'),String(!collapsed));
   assert.equal(await mobile.locator('#panel-toggle').innerText(),collapsed?'打开面板':'收起面板');
   assert.equal(await mobile.locator('#explore').isVisible(),!collapsed);
  }
  assert.equal(await mobile.locator('body').evaluate(el=>el.classList.contains('panel-collapsed')),false);
  await mobile.locator('#home').tap();
  await mobile.waitForFunction(()=>location.hash==='#map=10.50/41.80000/123.42000');
  checks.push('React mobile panel toggles keep label, expanded state and layout consistent; home uses the existing map reset action');
  await mobile.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={date:new Date().toISOString(),checks,errors,external,scope:'Local Chrome built-client state/history and actual snapshots with explicit HTTP fixtures; not physical devices, screen readers or full MVP acceptance.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
