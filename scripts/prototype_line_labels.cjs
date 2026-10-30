/* Isolated renderer prototype. Current product and immutable source files are unchanged. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const captionLayoutGuard=require('./caption_layout_guard.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/line-label-prototype');
const shortLayout=process.env.LABEL_SHORT_LAYOUT||'tangent',shortPadding=Number(process.env.LABEL_SHORT_PADDING||20);
const shortWidth=Number(process.env.LABEL_SHORT_WIDTH||64);
assert(['tangent','callout'].includes(shortLayout));assert([5,12,20].includes(shortPadding));
assert([0,64].includes(shortWidth));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{
  const {buildLineLabelCandidates}=await import('../apps/web/client/src/line-label-candidates.ts');
  const {shortLineLabelLayout,createCaptionTick,CAPTION_TICK}=await import('../apps/web/client/src/line-label-presentation.ts');
  const {decodeView}=await import('../apps/web/client/src/view-state.ts');
  const {expandedState,trackVisible}=await import('../apps/web/shared/model.mjs');
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const scenes=[],errors=[],external=[];let observation;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.route('**/assets/index-*.js',async route=>{
      const response=await route.fetch(),original=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(original.split(needle).length-1,1);
      const body=original.replace(needle,'addLayer(e,t){globalThis.__prototypeMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');
      observation={original_sha256:hash(original),observed_sha256:hash(body),short_layout:shortLayout,short_padding:shortPadding,short_width:shortWidth,adopted:false,acceptance:false};await route.fulfill({response,body});
    });
    const settled=()=>page.waitForFunction(()=>{
      const m=window.__prototypeMap,p=m.style.placement;
      if(!m.loaded()||!m.areTilesLoaded()||!p||performance.now()-p.commitTime<=p.fadeDuration+50)return false;
      const manager=m.style.tileManagers['line-name-prototype'];if(!manager)return true;
      const buckets=manager.getRenderableIds(true).flatMap(id=>{const t=manager.getTileByID(id);return ['line-name-prototype','line-name-short-prototype'].map(layer=>t.buckets[layer]).filter(b=>b&&b.symbolInstances.length);});
      return buckets.length>0&&buckets.every(b=>p.lastOpacityInputs.get(b)&&p.retainedQueryData[b.bucketInstanceId]);
    });
    for(const scene of [{name:'overview-z10',hash:'10.00/41.80000/123.42000',types:'rail,other,unknown'},{name:'overview-z10-5',hash:'10.50/41.80000/123.42000',types:'rail,other,unknown'},{name:'yard',hash:'15.50/41.85780/123.32379',types:'rail,other,unknown'},{name:'tram',hash:'17.00/41.68560/123.47900',types:'tram'}]){
      await page.goto(base+'/?snapshot=shenyang-mvp-20261023&types='+scene.types+'#map='+scene.hash);await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await settled();
      const input=await page.evaluate(()=>{
        const m=window.__prototypeMap,b=m.getCanvas().getBoundingClientRect(),features=m.querySourceFeatures('tracks',{sourceLayer:'rail_tracks'}).filter(f=>f.properties.feature_kind==='track'&&['LineString','MultiLineString'].includes(f.geometry.type)).map(f=>({type:'Feature',geometry:f.geometry,properties:{...f.properties}}));
        const first=features[0].geometry.type==='LineString'?features[0].geometry.coordinates[0]:features[0].geometry.coordinates[0][0];
        const p=m.project(first);
        const beforeAnchors=[],pl=m.style.placement,tm=m.style.tileManagers.tracks,seen=new Set();
        for(const id of tm.getRenderableIds(true)){
          const tile=tm.getTileByID(id),c=tile.tileID.canonical,vt=tile.latestFeatureIndex.loadVTLayers().rail_tracks;
          for(const layer of ['line-names','minor-line-names']){
            const bucket=tile.buckets[layer];if(!bucket)continue;const inputs=pl.lastOpacityInputs.get(bucket);
            for(let i=0;i<bucket.symbolInstances.length;i++){
              const s=bucket.symbolInstances.get(i);if(inputs?.duplicates[i]||seen.has(s.crossTileID)||!pl.placements[s.crossTileID]?.text)continue;seen.add(s.crossTileID);
              const x=(c.x+s.anchorX/8192)/2**c.z+tile.tileID.wrap,y=(c.y+s.anchorY/8192)/2**c.z,point=m.project([x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI]);
              if(point.x<0||point.y<0||point.x>b.width||point.y>b.height)continue;
              beforeAnchors.push({id:vt.feature(s.featureIndex).properties.osm_id,point:[point.x,point.y]});
            }
          }
        }
        return {features,center:m.getCenter(),zoom:m.getZoom(),width:b.width,height:b.height,projection_probe:{coordinate:first,point:[p.x,p.y]},before_anchors:beforeAnchors,before_ids:[...new Set(m.queryRenderedFeatures({layers:['line-names','minor-line-names']}).map(f=>f.properties.osm_id))]};
      });
      const scale=512*2**input.zoom,world=p=>[(p[0]+180)/360*scale,(1-Math.asinh(Math.tan(p[1]*Math.PI/180))/Math.PI)/2*scale],center=world([input.center.lng,input.center.lat]);
      const project=p=>{const [x,y]=world(p);return [x-center[0]+input.width/2,y-center[1]+input.height/2];};
      const probe=project(input.projection_probe.coordinate);assert(Math.hypot(probe[0]-input.projection_probe.point[0],probe[1]-input.projection_probe.point[1])<.01);
      const filters=expandedState(decodeView(page.url()).view.filters),started=performance.now();
      const candidates=buildLineLabelCandidates(input.features,{zoom:input.zoom,width:input.width,height:input.height,project,visible:p=>trackVisible(p,filters,input.zoom)});
      const generationMs=performance.now()-started;
      assert(candidates.collection.features.length>0);
      await fs.writeFile(path.join(output,scene.name+'-input.json'),JSON.stringify(input));
      await fs.writeFile(path.join(output,scene.name+'-candidates.json'),JSON.stringify(candidates.collection));
      const tick=createCaptionTick();
      await page.evaluate(({data,shortLayout,shortPadding,shortWidth,captionLayout,tick,tickName})=>{
        const m=window.__prototypeMap;
        for(const id of ['line-names','minor-line-names'])m.setLayoutProperty(id,'visibility','none');
        m.addSource('line-name-prototype',{type:'geojson',data,promoteId:'label_id',maxzoom:18,buffer:512});
        const paint={'text-color':'#506975','text-halo-color':'#f9fbf6','text-halo-width':1.8};
        let callout={};
        if(shortLayout==='callout'){
          m.addImage(tickName,{width:tick.width,height:tick.height,data:Uint8Array.from(tick.data)});
          callout={...captionLayout,'text-padding':shortPadding,'text-max-width':shortWidth};
        }
        m.addLayer({id:'line-name-short-prototype',type:'symbol',source:'line-name-prototype',filter:['==',['get','label_kind'],'short'],layout:{'symbol-placement':'point','text-field':['get','label_text'],'text-font':['Microsoft YaHei','sans-serif'],'text-size':12,'text-max-width':shortWidth,'text-padding':shortPadding,'text-rotate':shortLayout==='callout'?0:['get','label_angle'],'text-rotation-alignment':'viewport','text-offset':[0,-.8],...callout},paint},'facility-symbols');
        m.addLayer({id:'line-name-prototype',type:'symbol',source:'line-name-prototype',filter:['==',['get','label_kind'],'along'],layout:{'symbol-placement':'line-center','text-field':['get','label_text'],'text-font':['Microsoft YaHei','sans-serif'],'text-size':12,'text-max-angle':30,'text-padding':5,'text-keep-upright':true},paint},'facility-symbols');
      },{data:candidates.collection,shortLayout,shortPadding,shortWidth,captionLayout:shortLineLabelLayout,tick:{...tick,data:Array.from(tick.data)},tickName:CAPTION_TICK});
      await settled();
      const actual=await page.evaluate(()=>{
        const m=window.__prototypeMap,pl=m.style.placement,tm=m.style.tileManagers['line-name-prototype'],box=m.getCanvas().getBoundingClientRect(),anchors=[],seen=new Set();
        for(const id of tm.getRenderableIds(true)){
          const t=tm.getTileByID(id),vt=Object.values(t.latestFeatureIndex.loadVTLayers())[0],c=t.tileID.canonical;
          for(const layer of ['line-name-prototype','line-name-short-prototype']){
          const b=t.buckets[layer];if(!b)continue;const inputs=pl.lastOpacityInputs.get(b);
          for(let i=0;i<b.symbolInstances.length;i++){
            const s=b.symbolInstances.get(i);if(inputs?.duplicates[i]||seen.has(s.crossTileID)||!pl.placements[s.crossTileID]?.text)continue;seen.add(s.crossTileID);
            const raw=vt.feature(s.featureIndex).properties;
            const x=(c.x+s.anchorX/8192)/2**c.z+t.tileID.wrap,y=(c.y+s.anchorY/8192)/2**c.z,p=m.project([x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI]);
            if(p.x<0||p.y<0||p.x>box.width||p.y>box.height)continue;
            const collisionBox=t.collisionBoxArray.get(s.textBoxStartIndex);
            anchors.push({id:raw.label_id,identity:raw.label_identity,osm_id:raw.osm_id,text:raw.label_text,kind:raw.label_kind,point:[p.x,p.y],tile:[c.z,c.x,c.y],collision_box:{width:collisionBox.x2-collisionBox.x1,height:collisionBox.y2-collisionBox.y1}});
          }
          }
        }
        const close=[];for(let i=0;i<anchors.length;i++)for(let j=i+1;j<anchors.length;j++)if(anchors[i].identity===anchors[j].identity){
          const a=anchors[i],b=anchors[j],d=Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1]);if(d<300)close.push({distance:d,a,b});
        }
        return {anchors,close_pairs:close,public_ids:[...new Set(m.queryRenderedFeatures({layers:['line-name-prototype','line-name-short-prototype']}).map(f=>f.properties.osm_id))]};
      });
      await fs.writeFile(path.join(output,scene.name+'-observed.json'),JSON.stringify(actual,null,2));
      await page.screenshot({path:path.join(output,scene.name+'-observed.png')});
      assert(actual.anchors.length>0);assert.deepEqual(actual.close_pairs,[]);
      if(shortLayout==='callout'){
        if(shortWidth===0){
          assert.throws(()=>captionLayoutGuard(actual.anchors),/vertical column/);
          await fs.writeFile(path.join(output,'negative-width.json'),JSON.stringify({date:new Date().toISOString(),observation,rejected:true,reason:'native caption collision boxes are vertical at text-max-width=0',witnesses:actual.anchors.filter(a=>a.kind==='short'&&a.collision_box.height>a.collision_box.width)},null,2));
          console.log(JSON.stringify({negative_width_rejected:true}));return;
        }
        actual.caption_layout=captionLayoutGuard(actual.anchors);
      }
      assert(actual.anchors.every(a=>actual.public_ids.includes(a.osm_id)));
      const available=new Set(candidates.anchors.map(a=>a.osm_id)),rendered=new Set(actual.anchors.map(a=>a.osm_id));
      const sourceDistances=input.before_anchors.map(anchor=>{
        let minimum=Infinity;
        for(const feature of input.features.filter(f=>f.properties.osm_id===anchor.id)){
          const parts=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.coordinates;
          for(const part of parts){const points=part.map(project);for(let i=1;i<points.length;i++){
            const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((anchor.point[0]-a[0])*dx+(anchor.point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
            minimum=Math.min(minimum,Math.hypot(anchor.point[0]-a[0]-dx*t,anchor.point[1]-a[1]-dy*t));
          }}
        }
        assert(Number.isFinite(minimum));return {...anchor,nearest_own_source_path_css_px:minimum};
      });
      const properties=new Map(input.features.map(f=>[f.properties.osm_id,f.properties]));
      const {lineLabelText}=await import('../apps/web/client/src/line-label-candidates.ts');
      const beforeTexts=[...new Set(input.before_ids.map(id=>lineLabelText(properties.get(id))))].sort(),afterTexts=[...new Set(actual.anchors.map(a=>a.text))].sort();
      let minimumRepeat=Infinity;for(let i=0;i<actual.anchors.length;i++)for(let j=i+1;j<actual.anchors.length;j++){
        const a=actual.anchors[i],b=actual.anchors[j];if(a.identity===b.identity)minimumRepeat=Math.min(minimumRepeat,Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1]));
      }
      const report={...scene,input_fragments:input.features.length,own_fragment_joins:candidates.ownFragmentJoins,candidates_before_spacing:candidates.candidateCount,accepted:candidates.anchors.length,generation_ms_exploratory:generationMs,short_fragments:candidates.skippedShort,before_source_ids:input.before_ids,candidate_source_ids:[...available].sort(),rendered_source_ids:[...rendered].sort(),old_ids_without_candidates:input.before_ids.filter(id=>!available.has(id)),old_ids_not_rendered:input.before_ids.filter(id=>!rendered.has(id)),before_texts:beforeTexts,after_texts:afterTexts,lost_texts:beforeTexts.filter(text=>!afterTexts.includes(text)),before_anchor_source_distances:sourceDistances,minimum_repeat_css_px:Number.isFinite(minimumRepeat)?minimumRepeat:null,...actual};
      await page.screenshot({path:path.join(output,scene.name+'.png')});
      report.isolated_missing_names=[];
      for(const text of report.lost_texts){
        const count=candidates.collection.features.filter(f=>f.properties.label_text===text).length;
        assert(count>0,'a prior visible name must retain source-based candidates');
        await page.evaluate(text=>{const m=window.__prototypeMap;for(const [id,kind] of [['line-name-prototype','along'],['line-name-short-prototype','short']])m.setFilter(id,['all',['==',['get','label_kind'],kind],['==',['get','label_text'],text]]);},text);
        await settled();
        const ids=await page.evaluate(()=>[...new Set(window.__prototypeMap.queryRenderedFeatures({layers:['line-name-prototype','line-name-short-prototype']}).map(f=>f.properties.osm_id))]);
        assert(ids.length>0,'isolated source-name candidates must actually render');report.isolated_missing_names.push({text,candidates:count,rendered_source_ids:ids});
      }
      if(report.lost_texts.length){await page.evaluate(()=>{const m=window.__prototypeMap;for(const [id,kind] of [['line-name-prototype','along'],['line-name-short-prototype','short']])m.setFilter(id,['==',['get','label_kind'],kind]);});await settled();}
      scenes.push(report);
      console.log(JSON.stringify({scene:scene.name,fragments:input.features.length,candidates:candidates.anchors.length,rendered:actual.anchors.length,close_pairs:actual.close_pairs.length,old_ids_without_candidates:report.old_ids_without_candidates.length,old_ids_not_rendered:report.old_ids_not_rendered.length,generation_ms:generationMs}));
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),observation,scenes,errors,external,scope:'Isolated real loaded-MVT fragment prototype, four flat settled views. Product renderer is unchanged. Does not establish dynamic zoom/pan, all-filter integration, first-usable/performance budget, full seam coverage or R17/MVP acceptance.'},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
