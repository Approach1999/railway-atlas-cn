/* Built-product cache invalidation through real camera/resize/vector-source events. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/label-filter-cache/invalidation');
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
  const checks=[],errors=[],external=[];let original_sha256;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.route('**/assets/index-*.js',async route=>{
      const response=await route.fetch(),body=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(body.split(needle).length-1,1);
      original_sha256=crypto.createHash('sha256').update(body).digest('hex');
      await route.fulfill({response,body:body.replace(needle,'addLayer(e,t){globalThis.__cacheMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}')});
    });
    const settled=()=>page.waitForFunction(()=>{const m=window.__cacheMap;return m?.loaded()&&m.areTilesLoaded()&&m.isSourceLoaded('rail-line-labels');});
    await page.goto(base+'/?snapshot=shenyang-mvp-20261023#map=10.50/41.80000/123.42000');
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length);await settled();
    await page.evaluate(()=>{window.__trackQueries=0;const m=window.__cacheMap,query=m.querySourceFeatures.bind(m);m.querySourceFeatures=(id,options)=>{if(id==='tracks')window.__trackQueries++;return query(id,options);};});
    const labelIDs=()=>page.evaluate(async()=>{const data=await window.__cacheMap.getSource('rail-line-labels').getData();return data.features.map(f=>f.id).sort();});
    const initial=await labelIDs();
    await page.locator('[data-preset="highspeed"]').click();await settled();
    assert(await page.evaluate(async()=>{const data=await window.__cacheMap.getSource('rail-line-labels').getData();return data.features.length>0&&data.features.every(f=>f.properties.line_class==='high_speed');}));
    await page.locator('[data-preset="overview"]').click();await settled();assert.deepEqual(await labelIDs(),initial);
    assert.equal(await page.evaluate(()=>window.__trackQueries),0);checks.push({check:'filter selection reuses geometry and restores the same candidates; highspeed source contains only high_speed',queries:0});
    await page.evaluate(()=>window.__cacheMap.jumpTo({center:[123.60,41.80]}));
    await page.waitForFunction(()=>window.__trackQueries>0);await settled();const panned=await labelIDs();assert.notDeepEqual(panned,initial);
    checks.push({check:'same-zoom pan invalidates preparation and changes viewport candidates',queries:await page.evaluate(()=>window.__trackQueries),candidates:panned.length});
    await page.evaluate(()=>window.__trackQueries=0);await page.setViewportSize({width:980,height:800});
    await page.waitForFunction(()=>window.__trackQueries>0);await settled();assert.notDeepEqual(await labelIDs(),panned);
    checks.push({check:'real resize invalidates preparation through map movement event',queries:await page.evaluate(()=>window.__trackQueries)});
    const beforeReload=await labelIDs();
    await page.evaluate(()=>{window.__trackQueries=0;const s=window.__cacheMap.getSource('tracks');s.setTiles([...s.tiles]);});
    await page.waitForFunction(()=>window.__trackQueries>0);await settled();assert.deepEqual(await labelIDs(),beforeReload);
    checks.push({check:'real vector-source content reload invalidates preparation with unchanged camera',queries:await page.evaluate(()=>window.__trackQueries)});
    assert.equal(await page.locator('[data-resource="labels"]').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),original_sha256,checks,errors,external,scope:'Built product, public API observation and actual filter/camera/resize/vector-source reload. Not full device/browser/reader acceptance.'},null,2));console.log(JSON.stringify(checks));
  }catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({date:new Date().toISOString(),error:String(error),checks,errors},null,2));throw error;}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
