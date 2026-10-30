/* Read-only MapLibre 6.15 placement diagnostics. Internal fields are not product APIs. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/line-labels');
const candidateSpacing=Number(process.env.LINE_LABEL_SPACING||350);
assert([350,600].includes(candidateSpacing));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const scenes=[],errors=[],external=[];
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});let observation;
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.route('**/assets/index-*.js',async route=>{
      const response=await route.fetch(),original=await response.text();
      const needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';
      assert.equal(original.split(needle).length-1,1);
      let body=original.replace(needle,'addLayer(e,t){globalThis.__lineLabelMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');
      if(candidateSpacing!==350){assert.equal(original.split('"symbol-spacing":350').length-1,1);body=body.replace('"symbol-spacing":350','"symbol-spacing":'+candidateSpacing);}
      observation={original_sha256:hash(original),observed_sha256:hash(body),candidate_spacing:candidateSpacing,production_changed:false,acceptance:false,scope:candidateSpacing===350?'Capture only; no style/data/camera mutation or performance acceptance.':'Isolated response layout experiment, not adopted in product; no data/camera mutation or performance acceptance.'};await route.fulfill({response,body});
    });
    for(const scene of [{name:'overview-z8',hash:'8.00/41.80000/123.42000',types:'rail,other,unknown'},{name:'overview-z9',hash:'9.00/41.80000/123.42000',types:'rail,other,unknown'},{name:'overview-z10',hash:'10.00/41.80000/123.42000',types:'rail,other,unknown'},{name:'overview',hash:'10.50/41.80000/123.42000',types:'rail,other,unknown'},{name:'overview-z11',hash:'11.00/41.80000/123.42000',types:'rail,other,unknown'},{name:'north-yard',hash:'13.50/41.81733/123.43854',types:'rail,other,unknown'},{name:'tram-interchange',hash:'17.00/41.68560/123.47900',types:'tram'},{name:'tram-interchange-z17-5',hash:'17.50/41.68560/123.47900',types:'tram'}]){
      await page.goto(base+'/?snapshot=shenyang-mvp-20261023&types='+scene.types+'#map='+scene.hash);
      await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await page.waitForLoadState('networkidle');await page.waitForTimeout(700);
      await page.waitForFunction(()=>{const m=window.__lineLabelMap,p=m.style.placement;return m.loaded()&&m.areTilesLoaded()&&p&&performance.now()-p.commitTime>p.fadeDuration+50;});
      const result=await page.evaluate(()=>{
        const map=window.__lineLabelMap,style=map.style,placement=style.placement,manager=style.tileManagers.tracks;
        if(!placement?.lastOpacityInputs||!manager)throw Error('Observed SDK internals changed; measurement unavailable');
        const size=map.getCanvas().getBoundingClientRect(),anchors=[],seen=new Set(),buckets=[];let duplicates=0,hidden=0;
        for(const tileID of manager.getRenderableIds(true)){
          const tile=manager.getTileByID(tileID),bucket=tile.buckets['line-names'];if(!bucket)continue;
          const vt=tile.latestFeatureIndex.loadVTLayers().rail_tracks,canonical=tile.tileID.canonical;
          const opacityInputs=placement.lastOpacityInputs.get(bucket);
          buckets.push({tile:[canonical.z,canonical.x,canonical.y],symbols:bucket.symbolInstances.length,first:bucket.symbolInstances.length?(()=>{const s=bucket.symbolInstances.get(0);return {x:s.anchorX,y:s.anchorY,crossTileID:s.crossTileID,placement:placement.placements[s.crossTileID],opacity:placement.opacities[s.crossTileID]};})():null});
          if(!opacityInputs)throw Error('No final opacity inputs for observed label bucket');
          for(let i=0;i<bucket.symbolInstances.length;i++){
            const symbol=bucket.symbolInstances.get(i),placed=placement.placements[symbol.crossTileID],opacity=placement.opacities[symbol.crossTileID];
            if(opacityInputs.duplicates[i]){duplicates++;continue;}
            const actualOpacity=opacity?.text?.placed?Math.min(1,opacity.text.opacity+placement.symbolFadeChange(performance.now())):0;
            if(!placed?.text||actualOpacity<.99){hidden++;continue;}
            const raw=vt.feature(symbol.featureIndex).properties;
            const x=(canonical.x+symbol.anchorX/8192)/2**canonical.z+tile.tileID.wrap;
            const y=(canonical.y+symbol.anchorY/8192)/2**canonical.z;
            const lon=x*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI,p=map.project([lon,lat]);
            if(p.x<0||p.y<0||p.x>size.width||p.y>size.height)continue;
            if(seen.has(symbol.crossTileID))continue;seen.add(symbol.crossTileID);
            const line=raw.line_complete===true&&raw.line_shared!==true&&raw.line_key?String(raw.line_key):String(raw.feature_key||raw.osm_id);
            anchors.push({cross_tile_id:symbol.crossTileID,osm_id:raw.osm_id,identity:line,name:raw.display_name,line_ref:raw.line_ref,line_complete:raw.line_complete,line_shared:raw.line_shared,tile:[canonical.z,canonical.x,canonical.y],anchor:[p.x,p.y]});
          }
        }
        const close=[];
        for(let i=0;i<anchors.length;i++)for(let j=i+1;j<anchors.length;j++){
          const a=anchors[i],b=anchors[j];if(a.identity!==b.identity)continue;
          const distance=Math.hypot(a.anchor[0]-b.anchor[0],a.anchor[1]-b.anchor[1]);
          if(distance<300)close.push({distance_css_px:distance,a,b,cross_tile:a.tile.join('/')!==b.tile.join('/')});
        }
        return {spacing:map.getLayoutProperty('line-names','symbol-spacing'),viewport:[size.width,size.height],buckets,anchors,duplicates_excluded:duplicates,hidden_excluded:hidden,close_pairs:close.sort((a,b)=>a.distance_css_px-b.distance_css_px),query_feature_ids:[...new Set(map.queryRenderedFeatures({layers:['line-names']}).map(f=>f.properties.osm_id))]};
      });
      await fs.writeFile(path.join(output,scene.name+'-raw.json'),JSON.stringify(result,null,2));
      assert.equal(result.spacing,candidateSpacing);
      if(Number(scene.hash.split('/')[0])>=9)assert(result.anchors.length>0,'actual placed line labels required above the existing minzoom');
      assert(result.anchors.every(a=>a.identity&&a.identity!=='undefined'));
      const queryIDs=new Set(result.query_feature_ids);assert(result.anchors.every(a=>queryIDs.has(a.osm_id)),'each observed anchor must correspond to a publicly queryable rendered label feature');
      scenes.push({...scene,...result});await page.screenshot({path:path.join(output,scene.name+'.png')});
      console.log(JSON.stringify({scene:scene.name,anchors:result.anchors.length,close_pairs:result.close_pairs.length,min_distance:result.close_pairs[0]?.distance_css_px,cross_tile:result.close_pairs.filter(p=>p.cross_tile).length}));
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'diagnostic.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),observation,scenes,errors,external,scope:'Read-only version-specific placement and anchor diagnostics, flat north-up map; excludes duplicate/fading/offscreen instances and cross-checks public rendered features. Anchor spacing is not glyph-edge clearance, physical pixels or full R17/N09/device acceptance.'},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
