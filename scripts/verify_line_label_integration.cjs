/* Built product integration: capture public Map only, do not replace its label pipeline. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const captionGuard=require('./caption_layout_guard.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/line-label-integration');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const layers=['line-names','line-captions','minor-line-names','minor-line-captions'];
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[],external=[];let observation;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.route('**/assets/index-*.js',async route=>{
      const response=await route.fetch(),original=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(original.split(needle).length-1,1);
      const body=original.replace(needle,'addLayer(e,t){globalThis.__labelIntegrationMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');
      observation={original_sha256:hash(original),observed_sha256:hash(body),scope:'Capture only, no layout, data or camera mutation except explicit error injection described by the check.'};await route.fulfill({response,body});
    });
    const settled=()=>page.waitForFunction(()=>{const m=window.__labelIntegrationMap,p=m?.style.placement;return m?.loaded()&&m.areTilesLoaded()&&p&&performance.now()-p.commitTime>p.fadeDuration+50;});
    await page.goto(base+'/?snapshot=shenyang-mvp-20261023#map=10.50/41.80000/123.42000');
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await settled();
    assert.equal(await page.locator('[data-resource="labels"]').count(),0);
    const initial=await page.evaluate(async layers=>{
      const m=window.__labelIntegrationMap,data=await m.getSource('rail-line-labels').getData();
      const mark=performance.getEntriesByName('atlas:first-usable')[0].detail;
      return {features:data.features.length,rendered:m.queryRenderedFeatures({layers}).length,source_loaded:m.isSourceLoaded('rail-line-labels'),expected_layers:mark.style_layers.expected.length,name_labels:mark.name_labels};
    },layers);
    assert(initial.features>0&&initial.rendered>0&&initial.source_loaded);assert.equal(initial.expected_layers,41);assert.deepEqual(initial.name_labels,{status:'ready',enabled:true,source_loaded:true});checks.push({check:'first usable includes the product name source; no injected replacement source',...initial});
    const target=await page.evaluate(()=>{
      const m=window.__labelIntegrationMap,pl=m.style.placement,manager=m.style.tileManagers['rail-line-labels'],box=m.getCanvas().getBoundingClientRect(),seen=new Set();
      const captions=[];let target;
      for(const id of manager.getRenderableIds(true)){
        const t=manager.getTileByID(id),c=t.tileID.canonical,vt=Object.values(t.latestFeatureIndex.loadVTLayers())[0];
        for(const layer of ['line-captions','minor-line-captions']){
          const b=t.buckets[layer];if(!b)continue;const inputs=pl.lastOpacityInputs.get(b);
          for(let i=0;i<b.symbolInstances.length;i++){
            const s=b.symbolInstances.get(i);if(inputs?.duplicates[i]||seen.has(s.crossTileID)||!pl.placements[s.crossTileID]?.text)continue;seen.add(s.crossTileID);
            const raw=vt.feature(s.featureIndex).properties,cb=t.collisionBoxArray.get(s.textBoxStartIndex);
            captions.push({kind:'short',text:raw.label_text,collision_box:{width:cb.x2-cb.x1,height:cb.y2-cb.y1}});
            const x=(c.x+s.anchorX/8192)/2**c.z+t.tileID.wrap,y=(c.y+s.anchorY/8192)/2**c.z,p=m.project([x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI]);
            const click=[p.x,p.y-22];
            if(!target&&click[0]>70&&click[1]>80&&click[0]<box.width-100&&click[1]<box.height-100&&m.queryRenderedFeatures(click,{layers:[layer]}).some(f=>f.properties.label_id===raw.label_id))target={id:raw.osm_id,name:raw.display_name,x:box.x+click[0],y:box.y+click[1]};
          }
        }
      }
      return {target,captions};
    });
    assert(target.target);const guard=captionGuard(target.captions);assert(guard.captions_checked>0);
    await page.mouse.click(target.target.x,target.target.y);
    if(await page.locator('#candidates').isVisible())await page.locator('#candidate-list button').filter({hasText:target.target.id}).click();
    await page.locator('.feature-title').filter({hasText:target.target.name}).waitFor();assert.equal(new URL(page.url()).searchParams.get('feature'),target.target.id);
    await page.locator('#share-open').click();const shared=await page.locator('#share-link').inputValue();assert.equal(new URL(shared).searchParams.get('feature'),target.target.id);await page.locator('#share-close').click();
    checks.push({check:'actual short caption click opens original track identity and share preserves it; caption boxes are single-row',id:target.target.id,name:target.target.name,...guard});
    await page.goto(shared);await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await settled();await page.locator('.feature-title').filter({hasText:target.target.name}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('feature'),target.target.id);await page.locator('#detail-close').click();
    await page.locator('#filters summary').click();await page.locator('#show-lines').uncheck();await settled();
    assert.equal(await page.evaluate(layers=>window.__labelIntegrationMap.queryRenderedFeatures({layers}).length,layers),0);
    await page.locator('#show-lines').check();await settled();assert(await page.evaluate(layers=>window.__labelIntegrationMap.queryRenderedFeatures({layers}).length,layers)>0);
    checks.push({check:'shared track restores original detail; line-name switch hides and restores every name layer'});
    await page.evaluate(()=>window.__labelIntegrationMap.jumpTo({center:[123.32379,41.85780],zoom:15.5}));await settled();
    assert(await page.evaluate(()=>window.__labelIntegrationMap.queryRenderedFeatures({layers:['minor-line-names','minor-line-captions']}).length)>0);
    await page.locator('#show-sidings').uncheck();await settled();assert.equal(await page.evaluate(()=>window.__labelIntegrationMap.queryRenderedFeatures({layers:['minor-line-names','minor-line-captions']}).length),0);
    await page.locator('#show-sidings').check();await settled();
    assert(await page.evaluate(()=>window.__labelIntegrationMap.queryRenderedFeatures({layers:['minor-line-names','minor-line-captions']}).length)>0);
    checks.push({check:'actual zoom/pan rebuilds names and minor labels obey siding visibility'});
    const before=page.url();await page.evaluate(()=>{
      const m=window.__labelIntegrationMap,original=m.querySourceFeatures.bind(m);window.__restoreLabelQuery=()=>m.querySourceFeatures=original;
      m.querySourceFeatures=(source,options)=>{const rows=original(source,options);if(source==='tracks'){const index=rows.findIndex(f=>f.properties.feature_kind==='track');if(index>=0)rows[index]={...rows[index],geometry:rows[index].geometry,properties:{...rows[index].properties,display_name:123}};}return rows;};
    });
    await page.locator('#show-lines').uncheck();await page.locator('#show-lines').check();await page.locator('[data-resource="labels"] [role=alert]').waitFor();
    assert.equal(page.url(),before);assert(await page.evaluate(()=>window.__labelIntegrationMap.queryRenderedFeatures({layers:['track-major-mapped','track-minor-mapped']}).length)>0);
    await page.evaluate(()=>window.__restoreLabelQuery());await page.locator('[data-resource="labels"] button').click();await page.locator('[data-resource="labels"]').waitFor({state:'detached'});await settled();
    assert.equal(page.url(),before);checks.push({check:'malformed name source fails independently, leaves track drawing and URL, explicit retry recovers'});
    await page.locator('#dataset-picker summary').click();await page.locator('#dataset-version').selectOption('shenyang-mvp-progress-20261022');await page.getByRole('button',{name:'使用此版本',exact:true}).click();await page.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();await settled();
    await page.locator('#dataset-version').selectOption('shenyang-mvp-20261023');await page.getByRole('button',{name:'使用此版本',exact:true}).click();await page.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();await settled();
    assert.equal(await page.evaluate(layers=>window.__labelIntegrationMap.getStyle().layers.filter(l=>layers.includes(l.id)).length,layers),4);
    assert.equal(await page.locator('[data-resource="labels"]').count(),0);checks.push({check:'real snapshot round trip replaces label source and restores exactly four name layers'});
    await page.screenshot({path:path.join(output,'product.png')});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),observation,checks,errors,external,scope:'Built product actual data, source caption selection/share, zoom/filter/source failure/snapshot integration. Software Chrome, not full performance/device/reader/R17 acceptance.'},null,2));console.log(JSON.stringify({checks,errors,external}));
  }catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({date:new Date().toISOString(),error:String(error),checks,errors,states:await Promise.all(browser.contexts().flatMap(c=>c.pages()).map(p=>p.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,7000)})).catch(()=>null)))},null,2));throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
