/* Fault injection against the built client and actual immutable Shenyang data.
 * Public raster traffic is disabled. This is not real-device acceptance. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browserTarget=require('./browser_target.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/resource-recovery');
(async()=>{
  const metadataResponse=await fetch(base+'/dataset.json');assert(metadataResponse.ok);const snapshot=(await metadataResponse.json()).snapshot_id;assert.match(snapshot,/^[A-Za-z0-9_-]{1,80}$/);
  await fs.mkdir(output,{recursive:true});
  const browser=await browserTarget.launch(chromium);
  const checks=[],errors=[],external=[];
  async function page(options={}){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});return p;}
  const ready=p=>p.locator('#status').filter({hasText:/地图已打开|铁路地图已就绪/}).waitFor();
  const card=(p,key)=>p.locator('[data-resource="'+key+'"]');
  async function tracks(p){await p.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);}
  async function switchOld(p){await p.locator('#dataset-picker summary').click();await p.locator('#dataset-version').selectOption('shenyang-mvp-progress-20261022');await p.getByRole('button',{name:'使用此版本',exact:true}).click();await p.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();}
  try{
    for(const [key,suffix,malformed] of [['palette','palette.json',false],['palette','palette.json',true],['stations','stations.geojson',true],['lines','lines.json',false]]){
      const p=await page();let failing=true;const counts={};
      p.on('request',r=>{const name=new URL(r.url()).pathname.split('/').pop();counts[name]=(counts[name]||0)+1;});
      await p.route('**/'+suffix,route=>failing?route.fulfill({status:malformed?200:503,contentType:'application/json',body:malformed?'{}':'unavailable'}):route.continue());
      await p.goto(base);await ready(p);await tracks(p);await card(p,key).waitFor();
      await p.evaluate(()=>window.originalCanvas=document.querySelector('.maplibregl-canvas'));
      await p.locator('#search').fill('沈阳北站');
      if(key==='stations'){await p.locator('#results').filter({hasText:'车站索引暂不可用'}).waitFor();assert.doesNotMatch(await p.locator('#results').innerText(),/没有匹配/);}
      else await p.locator('#results button').first().waitFor();
      await p.getByRole('button',{name:'城市轨道',exact:true}).click();
      if(key==='lines')assert.match(await p.locator('#line-panel').innerText(),/索引暂不可用/);
      if(key==='palette')assert.equal(await p.locator('.line-chip').first().evaluate(el=>el.style.backgroundColor),'rgb(105, 117, 121)');
      const before={...counts},hash=new URL(p.url()).hash;failing=false;
      await card(p,key).getByRole('button').click();await card(p,key).waitFor({state:'detached'});
      assert.equal(await p.locator('#status').evaluate(el=>el===document.activeElement),true);
      assert.equal(await p.locator('#search').inputValue(),'沈阳北站');assert.equal(new URL(p.url()).hash,hash);
      assert.equal(await p.evaluate(()=>window.originalCanvas===document.querySelector('.maplibregl-canvas')),true);
      for(const other of ['dataset.json','palette.json','stations.geojson','lines.json'].filter(name=>name!==suffix))assert.equal(counts[other],before[other],other+' should not be re-requested');
      await p.locator('#results button').first().waitFor();assert.equal(await p.locator('#line-panel input[type=checkbox]').count(),12);
      assert.equal(await p.locator('.line-chip').first().evaluate(el=>el.style.backgroundColor),'rgb(229, 0, 28)');
      checks.push(key+' '+(malformed?'invalid JSON shape':'HTTP 503')+': tracks remain drawn, retry restores only failed index, preserves canvas/camera/query/filter');await p.close();
    }
    {
      const p=await page();let failing=true;await p.route('**/dataset.json',route=>failing?route.fulfill({status:503,body:'unavailable'}):route.continue());
      await p.goto(base);await card(p,'manifest').waitFor();await p.locator('#search').fill('沈阳');failing=false;await card(p,'manifest').getByRole('button').click();await ready(p);await tracks(p);assert.equal(await p.locator('#search').inputValue(),'沈阳');
      checks.push('manifest failure retries in place and preserves text entered before startup completes');await p.close();
    }
    {
      const p=await page();let failing=true,releaseLate,lateStarted;const lateGate=new Promise(resolve=>releaseLate=resolve),lateRequest=new Promise(resolve=>lateStarted=resolve),lateURLs=new Set(),counts={};
      await p.route('**/tiles/**/*.pbf',async route=>{const url=route.request().url();counts[url]=(counts[url]||0)+1;const shouldFail=failing,zoom=Number(new URL(url).pathname.split('/').at(-3));if(shouldFail&&zoom>=13){lateURLs.add(url);lateStarted();await lateGate;}return shouldFail?route.fulfill({status:503,body:'unavailable'}):route.continue();});
      await p.goto(base);await ready(p);await card(p,'tiles').waitFor();await p.locator('#search').fill('沈阳北站');await p.locator('#results button').filter({hasText:'地铁'}).filter({hasText:'站点'}).click();await p.locator('.feature-title').waitFor();
      await lateRequest;const hash=new URL(p.url()).hash;failing=false;await card(p,'tiles').getByRole('button').click();releaseLate();await card(p,'tiles').waitFor({state:'detached'});await tracks(p);assert.equal(new URL(p.url()).hash,hash);assert.match(await p.locator('.feature-title').innerText(),/沈阳北站/);
      assert(lateURLs.size>0);for(const url of lateURLs)assert.equal(counts[url],2,'late failed tile receives exactly one retry');
      checks.push('tile 503 leaves search/details usable; deliberately late pre-retry zoom failures each retry once, restore real rendered tracks and keep selection/camera');await p.close();
    }
    {
      const p=await page();let failing=true,target;const counts={};
      await p.route('**/tiles/**/*.pbf',route=>{const url=route.request().url();target??=url;counts[url]=(counts[url]||0)+1;return failing&&url===target?route.fulfill({status:503,body:'unavailable'}):route.continue();});
      await p.goto(base);await ready(p);await tracks(p);await card(p,'tiles').waitFor();await p.waitForLoadState('networkidle');const before={...counts};
      // A second failed retry stays recoverable and must not start a loop.
      await card(p,'tiles').getByRole('button').click();await card(p,'tiles').getByRole('button',{name:'重试轨道瓦片',exact:true}).waitFor();await p.waitForLoadState('networkidle');const afterFailure=counts[target];assert(afterFailure>before[target]);await p.waitForTimeout(400);assert.equal(counts[target],afterFailure);
      failing=false;await card(p,'tiles').getByRole('button').click();await card(p,'tiles').waitFor({state:'detached'});
      for(const [url,count] of Object.entries(before))if(url!==target)assert.equal(counts[url],count,'successfully loaded tiles should remain cached');
      checks.push('partial tile failure keeps rendered content; repeated failure offers another explicit retry without a loop, successful tiles are not downloaded again');await p.close();
    }
    {
      const p=await page();let failing=true;await p.route('**/details/*.json',route=>failing?route.fulfill({status:503,body:'unavailable'}):route.continue());
      await p.goto(base);await ready(p);await p.getByRole('button',{name:'城市轨道',exact:true}).click();await p.locator('#search').fill('沈阳北站');await p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();await p.getByRole('button',{name:'重试详情',exact:true}).waitFor();
      assert.match(await p.locator('#map-notice').innerText(),/临时显示/);const hash=new URL(p.url()).hash;failing=false;await p.getByRole('button',{name:'重试详情',exact:true}).click();await p.locator('.feature-title').waitFor();assert.match(await p.locator('#map-notice').innerText(),/临时显示/);assert.equal(new URL(p.url()).hash,hash);assert.equal(await p.locator('.feature-title').evaluate(el=>el===document.activeElement),true);
      checks.push('detail retry preserves filtered-out temporary search selection, camera and keyboard focus');await p.close();
    }
    {
      const p=await page();let attempts=0,release;const released=new Promise(resolve=>release=resolve);let started;const retryStarted=new Promise(resolve=>started=resolve);
      await p.route('**/snapshots/'+snapshot+'/palette.json',async route=>{attempts++;if(attempts===1)return route.fulfill({status:503,body:'unavailable'});started();await released;return route.continue();});
      await p.goto(base);await ready(p);await card(p,'palette').getByRole('button').click();await retryStarted;await switchOld(p);release();await p.waitForLoadState('networkidle');
      assert.equal(new URL(p.url()).searchParams.get('snapshot'),'shenyang-mvp-progress-20261022');assert.equal(await p.locator('.resource-status').count(),0);await p.getByRole('button',{name:'城市轨道',exact:true}).click();assert.equal(await p.locator('.line-option').count(),0);
      checks.push('late retry from previous snapshot is discarded after successful version switch');await p.close();
    }
    {
      const p=await page({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await p.route('**/stations.geojson',route=>route.fulfill({status:503,body:'unavailable'}));await p.goto(base);await ready(p);await tracks(p);const button=card(p,'stations').getByRole('button');await button.waitFor();const box=await button.boundingBox();assert(box.height>=44&&box.x>=0&&box.x+box.width<=390);await p.screenshot({path:path.join(output,'mobile-resource-failure.png')});checks.push('simulated narrow viewport keeps recovery control within screen with at least 44px touch height');await p.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={browser_target:await browserTarget.describe(browser),date:new Date().toISOString(),server_url:base,snapshot,checks,errors,external,scope:'Injected failures and retries against local actual data; no real-device, reader or independent human acceptance claim'};
    await fs.writeFile(path.join(output,'resource-recovery-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){
    await fs.mkdir(output,{recursive:true});
    const states=await Promise.all(browser.contexts().flatMap(c=>c.pages()).map(p=>p.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,8000)})).catch(()=>null)));
    await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({date:new Date().toISOString(),error:String(error),checks,errors,states},null,2));throw error;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
