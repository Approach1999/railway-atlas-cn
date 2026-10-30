/* Real empty selections, camera changes and resource faults, raster disabled. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const target=require('./browser_target.cjs'),base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/empty-view');
const before=process.env.EMPTY_VIEW_BEFORE==='1',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),checks=[],errors=[],external=[],captures=[];
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
  await p.route('**/assets/index-*.js',async route=>{
   const response=await route.fetch(),original=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(original.split(needle).length-1,1);
   const body=original.replace(needle,'addLayer(e,t){globalThis.__emptyViewMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');captures.push({original_sha256:sha(original),observed_sha256:sha(body)});await route.fulfill({response,body});
  });
  const snapshot=(await (await fetch(base+'/dataset.json')).json()).snapshot_id;
  const address=(extra='',hash='10.50/41.80000/123.42000')=>base+'/?snapshot='+snapshot+extra+'#map='+hash;
  const settled=()=>p.waitForFunction(()=>window.__emptyViewMap?.loaded()&&window.__emptyViewMap.areTilesLoaded()&&window.__emptyViewMap.isSourceLoaded('stations'));
  const message=()=>p.locator('#map-notice').textContent();
  const emptyMessage=/当前视野在这些筛选下没有可见要素/;
  await p.goto(address('&types=light_rail'));await settled();
  const observation=await p.evaluate(()=>{const m=window.__emptyViewMap,layers=m.getStyle().layers.filter(l=>l.id.startsWith('track-')||['station-dots','station-areas','facility-points','facility-lines','facility-areas'].includes(l.id)).map(l=>l.id);return {rendered:m.queryRenderedFeatures({layers}).length,notice:document.querySelector('#map-notice').textContent,notice_hidden:document.querySelector('#map-notice').hidden};});
  assert.equal(observation.rendered,0);
  if(before){assert.equal(observation.notice,'');assert(observation.notice_hidden);checks.push({name:'confirmed-unexplained-empty-view',...observation});}
  else{
   await p.waitForFunction(()=>document.querySelector('#map-notice').textContent.includes('当前视野在这些筛选下没有可见要素'));assert.match(await message(),/支线和站场线/);assert.equal(await p.locator('#map-notice').getAttribute('role'),'status');checks.push({name:'loaded-empty-selection-explained',...observation});
   await p.getByRole('button',{name:'铁路概览',exact:true}).click();await settled();assert.equal(await message(),'');checks.push({name:'preset-recovery-clears-empty-hint'});
   await p.goto(address('&types=light_rail','13.00/41.80000/123.42000'));await settled();await p.waitForFunction(()=>document.querySelector('#map-notice').textContent.includes('当前视野在这些筛选下没有可见要素'));assert.match(await message(),/调整筛选或平移/);assert.doesNotMatch(await message(),/支线和站场线/);checks.push({name:'higher-zoom-empty-view-gives-filter-and-pan-guidance'});
   await p.goto(address('&types='));await settled();assert.match(await message(),/没有启用/);assert.doesNotMatch(await message(),emptyMessage);checks.push({name:'explicit-empty-dimension-message-has-priority'});
   await p.goto(address('&types=light_rail','10.50/39.90000/116.40000'));await settled();assert.match(await message(),/未覆盖/);assert.doesNotMatch(await message(),emptyMessage);checks.push({name:'out-of-coverage-is-not-filtered-empty'});
   let release;
   const held=new Promise(resolve=>{release=resolve;});let entered=false;
   await p.route('**/stations.geojson',async route=>{entered=true;await held;await route.continue();});
   await p.goto(address('&types=light_rail'));await p.waitForTimeout(300);assert(entered);assert.doesNotMatch(await message(),emptyMessage);release();await settled();await p.waitForFunction(()=>document.querySelector('#map-notice').textContent.includes('当前视野在这些筛选下没有可见要素'));await p.unroute('**/stations.geojson');checks.push({name:'delayed-index-does-not-report-empty-before-loading-completes'});
   await p.route('**/stations.geojson',route=>route.fulfill({status:503,body:'unavailable'}));await p.goto(address('&types=light_rail'));await p.locator('[data-resource="stations"]').waitFor();await settled();assert.doesNotMatch(await message(),emptyMessage);checks.push({name:'failed-index-is-not-misreported-as-empty'});
   await p.unroute('**/stations.geojson');await p.locator('[data-resource="stations"] button').click();await p.locator('[data-resource="stations"]').waitFor({state:'detached'});await settled();await p.waitForFunction(()=>document.querySelector('#map-notice').textContent.includes('当前视野在这些筛选下没有可见要素'));checks.push({name:'successful-index-retry-restores-empty-view-explanation'});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const index=await fs.readFile('apps/web/client/dist/index.html'),asset=index.toString().match(/\/assets\/index-[^" ]+\.js/)[0],build={asset,index_sha256:sha(index),asset_sha256:sha(await fs.readFile('apps/web/client/dist'+asset))};assert(captures.every(c=>c.original_sha256===build.asset_sha256));
  const report={date:new Date().toISOString(),browser_target:await target.describe(browser),before,snapshot,source_sha256:sha(await fs.readFile(__filename)),controller_sha256:sha(await fs.readFile('apps/web/client/src/map-controller.ts')),build,checks,errors,external,captures,scope:'Capture public Map reference only; real current immutable snapshot, no fabricated empty tiles. Synthetic network delay/503. Installed browsers, not reader or physical-device acceptance.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,before,browser:report.browser_target.version}));
 }catch(error){await target.failure(browser,error,{checks});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
