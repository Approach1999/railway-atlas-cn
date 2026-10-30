/* Read-only native placement audit of the built product. No replacement label source. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const captionGuard=require('./caption_layout_guard.cjs');
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/line-label-integration/spacing');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const layers=['line-names','line-captions','minor-line-names','minor-line-captions'];
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const scenes=[],errors=[],external=[];let source_sha256;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.route('**/assets/index-*.js',async route=>{
      const response=await route.fetch(),body=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(body.split(needle).length-1,1);
      source_sha256=crypto.createHash('sha256').update(body).digest('hex');
      await route.fulfill({response,body:body.replace(needle,'addLayer(e,t){globalThis.__labelAuditMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}')});
    });
    for(const scene of [{name:'overview-z10',hash:'10.00/41.80000/123.42000'},{name:'overview-z10-5',hash:'10.50/41.80000/123.42000'},{name:'yard',hash:'15.50/41.85780/123.32379'},{name:'tram',hash:'17.00/41.68560/123.47900',types:'tram'}]){
      await page.goto(base+'/?snapshot=shenyang-mvp-20261023'+(scene.types?'&types='+scene.types:'')+'#map='+scene.hash);
      await page.waitForFunction(()=>{const m=window.__labelAuditMap,p=m?.style.placement;return performance.getEntriesByName('atlas:first-usable').length&&m?.loaded()&&m.areTilesLoaded()&&p&&performance.now()-p.commitTime>p.fadeDuration+50;});
      const anchors=await page.evaluate(layers=>{
        const m=window.__labelAuditMap,pl=m.style.placement,manager=m.style.tileManagers['rail-line-labels'],seen=new Set(),result=[],bounds=m.getCanvas().getBoundingClientRect();
        for(const id of manager.getRenderableIds(true)){
          const t=manager.getTileByID(id),c=t.tileID.canonical,vt=Object.values(t.latestFeatureIndex.loadVTLayers())[0];
          for(const layer of layers){const b=t.buckets[layer];if(!b)continue;const inputs=pl.lastOpacityInputs.get(b);
            for(let i=0;i<b.symbolInstances.length;i++){
              const s=b.symbolInstances.get(i);if(inputs?.duplicates[i]||seen.has(s.crossTileID)||!pl.placements[s.crossTileID]?.text)continue;seen.add(s.crossTileID);
              const raw=vt.feature(s.featureIndex).properties,cb=t.collisionBoxArray.get(s.textBoxStartIndex);
              const x=(c.x+s.anchorX/8192)/2**c.z+t.tileID.wrap,y=(c.y+s.anchorY/8192)/2**c.z,p=m.project([x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI]);
              if(p.x<0||p.y<0||p.x>bounds.width||p.y>bounds.height)continue;
              result.push({id:raw.label_id,identity:raw.label_identity,osm_id:raw.osm_id,text:raw.label_text,kind:raw.label_kind,point:[p.x,p.y],tile:t.tileID.key,collision_box:{width:cb.x2-cb.x1,height:cb.y2-cb.y1}});
            }
          }
        }return result;
      },layers);
      assert(anchors.length>0);const pairs=[];
      for(let i=0;i<anchors.length;i++)for(let j=i+1;j<anchors.length;j++)if(anchors[i].identity===anchors[j].identity){
        const a=anchors[i],b=anchors[j],distance=Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1]);
        pairs.push({a:a.id,b:b.id,distance,cross_tile:a.tile!==b.tile});assert(distance>=300,'same-identity repetition closer than 300 CSS px');
      }
      const guard=captionGuard(anchors);scenes.push({...scene,anchors,pairs,...guard});
      await page.screenshot({path:path.join(output,scene.name+'.png')});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),source_sha256,scenes,errors,external,scope:'Read native placement only on four settled product views; not an all-view coverage, legibility or real-device acceptance.'},null,2));
    console.log(JSON.stringify(scenes.map(s=>({scene:s.name,anchors:s.anchors.length,captions:s.captions_checked,pairs:s.pairs.length,minimum:s.pairs.length?Math.min(...s.pairs.map(p=>p.distance)):null}))));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
