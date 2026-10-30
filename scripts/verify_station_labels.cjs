/* Public Map API capture in browser response only; no source or layout mutation. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/station-labels');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],external=[],checks=[];let observation;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.route('**/assets/index-*.js',async route=>{
      const response=await route.fetch(),original=await response.text();
      const needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';
      assert.equal(original.split(needle).length-1,1);
      const body=original.replace(needle,'addLayer(e,t){globalThis.__stationLabelMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');
      observation={original_sha256:hash(original),observed_sha256:hash(body),scope:'Captures public Map instance; no data, layout, camera or layers changed. Not a performance measurement.'};
      await route.fulfill({response,body});
    });
    await page.goto(base+'/?snapshot=shenyang-mvp-20261023&types=tram#map=17.00/41.68560/123.47900');
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
    await page.waitForLoadState('networkidle');await page.waitForTimeout(400);
    const ids=['node/4065246592','node/4065246593','node/4065341667'];
    const stationData=()=>page.evaluate(()=>window.__stationLabelMap.getSource('stations').getData());
    const original=await stationData(),group=original.features.filter(f=>ids.includes(f.properties.osm_id));
    assert.equal(group.length,3);assert.equal(group.filter(f=>f.properties.label_name).length,1);
    assert.equal(group.find(f=>f.properties.label_name).properties.label_name,'新松智慧园 · 有轨电车');
    for(const f of group){assert.equal(f.properties.link_status,'confirmed');assert.deepEqual(f.properties.link_evidence,['relation/19556148']);}
    const dots=await page.evaluate(ids=>window.__stationLabelMap.queryRenderedFeatures({layers:['station-dots']}).map(f=>f.properties.osm_id).filter(id=>ids.includes(id)),ids);
    assert.deepEqual([...new Set(dots)].sort(),ids);
    const names=await page.evaluate(ids=>window.__stationLabelMap.queryRenderedFeatures({layers:['station-names']}).filter(f=>ids.includes(f.properties.osm_id)).map(f=>({id:f.properties.osm_id,label:f.properties.label_name})),ids);
    assert.equal(names.length,1);await page.screenshot({path:path.join(output,'group.png')});
    checks.push({check:'real stop-area name is submitted/drawn once; all three actual point symbols remain',ids,relation:'relation/19556148',names});
    for(const id of ids){
      const target=group.find(f=>f.properties.osm_id===id);
      const point=await page.evaluate(coords=>{const map=window.__stationLabelMap,p=map.project(coords),b=map.getCanvas().getBoundingClientRect();return {x:b.x+p.x,y:b.y+p.y};},target.geometry.coordinates);
      await page.mouse.click(point.x,point.y);
      if(await page.locator('#candidates').isVisible())await page.locator('#candidate-list button').filter({hasText:id}).click();
      await page.locator('.feature-title').filter({hasText:'新松智慧园'}).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('feature'),id);
      const data=await stationData();assert.equal(data.features.filter(f=>ids.includes(f.properties.osm_id)&&f.properties.label_name).length,0);
      const selection=await page.evaluate(()=>window.__stationLabelMap.getSource('selection').getData());
      assert.equal(selection.features[0].properties.osm_id,id);assert.equal(selection.features[0].properties.label_name,'新松智慧园 · 有轨电车');
      await page.waitForTimeout(350);
      const selected=await page.evaluate(()=>window.__stationLabelMap.queryRenderedFeatures({layers:['selected-name']}).map(f=>f.properties.label_name));
      assert(selected.includes('新松智慧园 · 有轨电车'));
      await page.locator('#detail-close').click();
      const restored=await stationData();assert.equal(restored.features.filter(f=>ids.includes(f.properties.osm_id)).length,3);
      assert.equal(restored.features.filter(f=>ids.includes(f.properties.osm_id)&&f.properties.label_name).length,1);
    }
    checks.push({check:'all three original nodes remain independently clickable; selected name carries mode and suppresses its confirmed sibling names, close restores one name',ids});
    await page.goto(base+'/?snapshot=shenyang-mvp-20261023&types=subway#map=15.50/41.73880/123.47920');
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await page.waitForLoadState('networkidle');
    const unnamed=(await stationData()).features.filter(f=>['way/658333063','way/658333064'].includes(f.properties.osm_id));
    assert.equal(unnamed.length,2);assert(unnamed.every(f=>f.properties.label_name===''));
    checks.push({check:'two real unnamed station areas remain in the source without fabricated mode-only names',ids:unnamed.map(f=>f.properties.osm_id)});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'browser.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),checks,observation,errors,external,scope:'Actual dated station/stop-area data, software renderer and read-only public Map API observation; not full R17, physical device or independent relation/classification review.'},null,2));
    console.log(JSON.stringify({checks,errors,external}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
