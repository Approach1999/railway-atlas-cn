/* Real product symbol order and placement. --experiment isolates one public moveLayer change. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const target=require('./browser_target.cjs'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/label-priority'),experiment=process.argv.includes('--experiment');
const lineLayers=['minor-line-captions','minor-line-names','line-captions','line-names'];
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),scenes=[],errors=[],external=[];let observation;
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
  await page.route('**/assets/index-*.js',async route=>{
   const response=await route.fetch(),original=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(original.split(needle).length-1,1);
   const body=original.replace(needle,'addLayer(e,t){globalThis.__priorityMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');
   const hash=s=>crypto.createHash('sha256').update(s).digest('hex');observation={asset:new URL(route.request().url()).pathname,original_sha256:hash(original),observed_sha256:hash(body),meaning:'Capture public map reference only; original data and layer code executes.'};await route.fulfill({response,body});
  });
  async function settled(){await page.waitForFunction(()=>{const m=window.__priorityMap,p=m?.style.placement;return performance.getEntriesByName('atlas:first-usable').length&&m?.loaded()&&m.areTilesLoaded()&&p&&performance.now()-p.commitTime>p.fadeDuration+100;});}
  async function sample(){return page.evaluate(lineLayers=>{
   const m=window.__priorityMap,order=m.getStyle().layers.map(l=>l.id),groups={};
   for(const layer of ['facility-symbols',...lineLayers,'station-names','major-station-names','selected-name']){
    if(!m.getLayer(layer))continue;
    groups[layer]=[...new Set(m.queryRenderedFeatures({layers:[layer]}).map(f=>f.properties.label_id||f.properties.osm_id))].sort();
   }
   const station=order.indexOf('station-names'),major=order.indexOf('major-station-names'),selected=order.indexOf('selected-name'),facility=order.indexOf('facility-symbols');
   return {order,groups,priority_correct:lineLayers.every(id=>facility<order.indexOf(id)&&order.indexOf(id)<station)&&station<major&&major<selected};
  },lineLayers);}
  for(const scene of [{name:'yard',hash:'15.50/41.85780/123.32379'},{name:'north-yard',hash:'16.00/41.81733/123.43854'},{name:'tram',hash:'17.00/41.68560/123.47900',types:'tram'}]){
   await page.goto(base+'/?snapshot=shenyang-mvp-20261023&facilities=1'+(scene.types?'&types='+scene.types:'')+'#map='+scene.hash);await settled();
   const before=await sample();let after;
   if(experiment){await page.evaluate(()=>window.__priorityMap.moveLayer('facility-symbols','minor-line-captions'));await settled();after=await sample();assert(after.priority_correct);}
   else assert(before.priority_correct,'facility captions must yield to line and station names');
   scenes.push({...scene,before,after});await page.screenshot({path:path.join(output,scene.name+'.png')});
  }
  if(!experiment){
   await page.goto(base+'/?snapshot=shenyang-mvp-20261023&facilities=1#map=16.00/41.81733/123.43854');await settled();
   await page.locator('#search').fill('沈阳北站');await page.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();await page.locator('.feature-title').waitFor();await settled();
   const selected=await sample();assert(selected.priority_correct);assert(selected.groups['selected-name'].includes('node/676578837'));scenes.push({name:'selected-station',before:selected});
   await page.locator('#detail-close').click();
   // Actual supported snapshot transition reinstalls layers; apply it and verify the URL.
   await page.locator('#dataset-picker summary').click();const versions=await page.locator('#dataset-version option').evaluateAll(ns=>ns.map(n=>n.value));
   const initial=await page.locator('#dataset-version').inputValue(),other=versions.find(v=>v!==initial);assert(other);await page.locator('#dataset-version').selectOption(other);await page.getByRole('button',{name:'使用此版本',exact:true}).click();await page.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();await settled();
   assert.equal(new URL(page.url()).searchParams.get('snapshot'),other);
   const changed=await page.evaluate(()=>window.__priorityMap.getStyle().layers.map(l=>l.id));
   const lines=lineLayers.map(l=>changed.indexOf(l));assert(lines.every(i=>i>=0&&i<changed.indexOf('station-names')));assert(changed.indexOf('station-names')<changed.indexOf('major-station-names'));assert(changed.indexOf('major-station-names')<changed.indexOf('selected-name'));
   scenes.push({name:'snapshot-transition',snapshot:other,order:changed});
   await page.locator('#dataset-version').selectOption(initial);await page.getByRole('button',{name:'使用此版本',exact:true}).click();await page.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();await settled();assert.equal(new URL(page.url()).searchParams.get('snapshot'),initial);const restored=await sample();assert(restored.priority_correct);scenes.push({name:'snapshot-return',before:restored});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser_target:await target.describe(browser),mode:experiment?'response-capture and isolated public order experiment':'product validation',observation,scenes,errors,external,scope:'Actual product symbol stack and unique public rendered feature IDs on three settled real views, plus selection/snapshot in validation. IDs are not an all-label native anchor/coverage or physical-device audit.'},null,2));
  console.log(JSON.stringify(scenes.map(s=>({name:s.name,correct:s.before?.priority_correct,before:s.before?.groups,after:s.after?.groups}))));
 }catch(e){await target.failure(browser,e,{scenes,errors,external});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
