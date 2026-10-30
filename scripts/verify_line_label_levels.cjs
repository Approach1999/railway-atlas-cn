/* Real label zoom/filter/click integration; captures public Map in response copy. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/line-label-levels');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[],external=[];let observation;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.route('**/assets/index-*.js',async route=>{
      const response=await route.fetch(),original=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(original.split(needle).length-1,1);
      const body=original.replace(needle,'addLayer(e,t){globalThis.__labelsMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');
      observation={original_sha256:hash(original),observed_sha256:hash(body),scope:'Capture only, no layout/data/camera changes; placement internals used solely to target a real label click.'};await route.fulfill({response,body});
    });
    async function settled(){await page.waitForFunction(()=>{const m=window.__labelsMap,p=m?.style.placement;return m?.loaded()&&m.areTilesLoaded()&&p&&performance.now()-p.commitTime>p.fadeDuration+50;});}
    await page.goto(base+'/?snapshot=shenyang-mvp-20261023#map=8.00/41.80000/123.42000');
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await settled();
    const region=await page.evaluate(()=>{const m=window.__labelsMap;return {major:m.queryRenderedFeatures({layers:['line-names']}).map(f=>({id:f.properties.osm_id,name:f.properties.display_name})),minor:m.queryRenderedFeatures({layers:['minor-line-names']}).length};});
    assert(region.major.length>0);assert.equal(region.minor,0);assert(region.major.every(f=>f.name));checks.push({check:'z8 now renders source-named regional lines; detailed names remain hidden',...region});
    await page.goto(base+'/?snapshot=shenyang-mvp-20261023#map=15.50/41.85780/123.32379');await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await settled();
    const detailed=await page.evaluate(()=>window.__labelsMap.queryRenderedFeatures({layers:['minor-line-names']}).map(f=>({id:f.properties.osm_id,name:f.properties.display_name,line_class:f.properties.line_class})));
    assert(detailed.length>0);assert(detailed.every(f=>f.name&&['branch','industrial'].includes(f.line_class)));
    await page.screenshot({path:path.join(output,'detailed.png')});
    const target=await page.evaluate(()=>{
      const m=window.__labelsMap,pl=m.style.placement,tm=m.style.tileManagers.tracks,box=m.getCanvas().getBoundingClientRect(),seen=new Set();
      for(const id of tm.getRenderableIds(true)){
        const t=tm.getTileByID(id),b=t.buckets['minor-line-names'];if(!b)continue;
        const vt=t.latestFeatureIndex.loadVTLayers().rail_tracks,c=t.tileID.canonical,inputs=pl.lastOpacityInputs.get(b);
        for(let i=0;i<b.symbolInstances.length;i++){
          const s=b.symbolInstances.get(i);if(inputs?.duplicates[i]||seen.has(s.crossTileID)||!pl.placements[s.crossTileID]?.text)continue;seen.add(s.crossTileID);
          const x=(c.x+s.anchorX/8192)/2**c.z+t.tileID.wrap,y=(c.y+s.anchorY/8192)/2**c.z;
          const p=m.project([x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI]);
          if(p.x<50||p.y<100||p.x>box.width-80||p.y>box.height-100)continue;
          const raw=vt.feature(s.featureIndex).properties;
          if(m.queryRenderedFeatures([p.x,p.y],{layers:['minor-line-names']}).some(f=>f.properties.osm_id===raw.osm_id))return {id:raw.osm_id,name:raw.display_name,x:box.x+p.x,y:box.y+p.y};
        }
      }
      return null;
    });
    assert(target,'a visible named minor-line anchor must be clickable');await page.mouse.click(target.x,target.y);
    if(await page.locator('#candidates').isVisible())await page.locator('#candidate-list button').filter({hasText:target.id}).click();
    await page.locator('.feature-title').filter({hasText:target.name}).waitFor();assert.equal(new URL(page.url()).searchParams.get('feature'),target.id);await page.locator('#detail-close').click();
    checks.push({check:'real named minor tracks render and their actual label opens the original source record',labels:detailed,target:{id:target.id,name:target.name}});
    await page.locator('#filters summary').click();await page.locator('#show-lines').uncheck();await settled();
    assert.equal(await page.evaluate(()=>window.__labelsMap.queryRenderedFeatures({layers:['line-names','minor-line-names']}).length),0);
    await page.locator('#show-lines').check();await settled();
    await page.locator('#show-sidings').uncheck();await settled();
    assert.equal(await page.evaluate(()=>window.__labelsMap.queryRenderedFeatures({layers:['minor-line-names']}).length),0);
    await page.locator('#show-sidings').check();await settled();
    assert(await page.evaluate(()=>window.__labelsMap.queryRenderedFeatures({layers:['minor-line-names']}).length)>0);
    checks.push({check:'line-name switch controls both layers; siding switch removes and restores actual minor labels'});
    await page.locator('#dataset-picker summary').click();await page.locator('#dataset-version').selectOption('shenyang-mvp-progress-20261022');await page.getByRole('button',{name:'使用此版本',exact:true}).click();await page.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();
    await page.locator('#dataset-version').selectOption('shenyang-mvp-20261023');await page.getByRole('button',{name:'使用此版本',exact:true}).click();await page.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();await settled();
    assert.equal(await page.evaluate(()=>window.__labelsMap.getStyle().layers.filter(l=>['line-names','minor-line-names'].includes(l.id)).length),2);
    checks.push({check:'both label layers are removed/reinstalled cleanly through actual snapshot switches'});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),observation,checks,errors,external,scope:'Real local source labels, zoom/filter/click and snapshot integration. No 300px-repeat, glyph-clearance, full R17 or physical-device acceptance claim.'},null,2));console.log(JSON.stringify({checks,errors,external}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
