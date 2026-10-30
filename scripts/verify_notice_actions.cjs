/* Contextual recovery in the built product, actual data, desktop/tablet/phone-sized views. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const target=require('./browser_target.cjs'),base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/notice-actions/native');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),checks=[],errors=[],external=[],captures=[];
 const snapshot=(await (await fetch(base+'/dataset.json')).json()).snapshot_id;
 try{
  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]){
   const p=await browser.newPage({viewport,reducedMotion:'reduce',hasTouch:viewport.width<1000});
   p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
   await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
   await p.route('**/assets/index-*.js',async route=>{
    const response=await route.fetch(),original=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(original.split(needle).length-1,1);
    const body=original.replace(needle,'addLayer(e,t){globalThis.__noticeActionMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');captures.push({original_sha256:sha(original),observed_sha256:sha(body)});await route.fulfill({response,body});
   });
   const address=(extra='',hash='10.50/41.80000/123.42000')=>base+'/?snapshot='+snapshot+'&q='+encodeURIComponent('沈阳')+extra+'#map='+hash;
   const settled=()=>p.waitForFunction(()=>window.__noticeActionMap?.loaded()&&window.__noticeActionMap.areTilesLoaded());
   async function state(){return p.evaluate(()=>{const m=window.__noticeActionMap,u=new URL(location.href);return {camera:[m.getCenter().lng,m.getCenter().lat,m.getZoom()],query:u.searchParams.get('q'),snapshot:u.searchParams.get('snapshot'),types:u.searchParams.get('types'),classes:u.searchParams.get('classes'),states:u.searchParams.get('states'),sidings:u.searchParams.get('sidings'),lines:u.searchParams.get('lines'),basemap:localStorage.getItem('railway-atlas:basemap:v1')};});}
   async function button(name){const b=p.locator('#map-notice').getByRole('button',{name,exact:true});await b.waitFor();const box=await b.boundingBox();assert(box.width>=44&&box.height>=44);assert(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);return b;}
   async function activate(b){await b.focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.activeElement===window.__noticeActionMap.getCanvas());await settled();}
   function preserved(a,b,fields){for(const field of fields)assert.deepEqual(b[field],a[field],field);}
   const invariant=['camera','query','snapshot','basemap'];
   await p.goto(address('&types='));await settled();const original=await state(),reset=await button('恢复默认图层');
   await p.screenshot({path:path.join(output,'empty-'+viewport.width+'.png')});await activate(reset);const restored=await state();preserved(original,restored,invariant);assert(restored.types.split(',').includes('rail'));assert.equal(await p.locator('#map-notice').textContent(),'');checks.push({viewport,name:'keyboard-reset-preserves-camera-query-snapshot-basemap-and-returns-focus'});
   await p.locator('#undo').click();await button('恢复默认图层');assert.equal((await state()).types,'');preserved(original,await state(),invariant);checks.push({viewport,name:'reset-can-be-undone-to-the-original-empty-selection'});
   await p.goto(address('&types=light_rail'));await settled();await button('恢复默认图层');if(viewport.width<=700)await p.locator('#panel-toggle').click();await activate(await button('恢复默认图层'));assert((await state()).types.split(',').includes('rail'));checks.push({viewport,name:'actual-empty-view-recovery-works-with-compact-panel-collapsed'});
   for(const lines of ['', 'shenyang-metro/404']){
    await p.goto(address('&types=subway&states=construction&sidings=0&lines='+lines));await settled();const previous=await state();await activate(await button('恢复全部线路'));const next=await state();assert.equal(next.lines,null);preserved(previous,next,[...invariant,'types','classes','states','sidings']);checks.push({viewport,name:lines?'missing-line-recovery-preserves-other-filters':'empty-line-recovery-preserves-other-filters'});
   }
   await p.goto(address('&types=rail&states=mapped&sidings=0','10.50/39.90000/116.40000'));await settled();const outside=await state();await activate(await button('回到试验区'));const home=await state();assert(Math.abs(home.camera[0]-123.42)<1e-5&&Math.abs(home.camera[1]-41.8)<1e-5);preserved(outside,home,['query','snapshot','basemap','types','classes','states','sidings','lines']);checks.push({viewport,name:'coverage-recovery-returns-home-without-resetting-filters-or-query'});
   await p.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const index=await fs.readFile('apps/web/client/dist/index.html'),asset=index.toString().match(/\/assets\/index-[^" ]+\.js/)[0],build={asset,index_sha256:sha(index),asset_sha256:sha(await fs.readFile('apps/web/client/dist'+asset))};assert(captures.every(c=>c.original_sha256===build.asset_sha256));
  const report={date:new Date().toISOString(),browser_target:await target.describe(browser),source_sha256:sha(await fs.readFile(__filename)),snapshot,build,checks,errors,external,captures,scope:'Actual snapshot and keyboard activation, CSS phone/tablet sizes and touch flags; not actual mobile browser, screen reader or 200-percent acceptance.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,browser:report.browser_target.version}));
 }catch(error){await target.failure(browser,error,{checks});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
