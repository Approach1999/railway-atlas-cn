/* Model-supported nonurban grades must be reachable from map/list/legend UI. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),target=require('./browser_target.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/other-grade'),before=process.env.OTHER_GRADE_BEFORE==='1',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),checks=[],errors=[],external=[];
 try{
  const snapshot=(await (await fetch(base+'/dataset.json')).json()).snapshot_id;
  const indexData=await (await fetch(base+'/snapshots/'+snapshot+'/objects.json')).json(),sourceOtherTracks=indexData.records.filter(p=>p.feature_kind==='track'&&p.line_class==='other').length;
  for(const viewport of before?[{width:1440,height:1000}]:[{width:1440,height:1000},{width:390,height:844}]){
   const p=await browser.newPage({viewport,reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
   await p.addInitScript(()=>{localStorage.setItem('railway-atlas:basemap:v1','false');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('controlled denial');}}});});
   const url=base+'/?snapshot='+snapshot+'&types=rail&classes=other&q='+encodeURIComponent('沈阳')+'#map=10.50/41.80000/123.42000';
   await p.goto(url);await p.locator('#status').filter({hasText:/铁路地图已就绪|地图已打开/}).waitFor();await p.locator('#advanced-filters summary').click();
   const control=p.getByRole('checkbox',{name:'铁路等级：其他轨道',exact:true}),legend=p.getByRole('button',{name:'图例等级：其他轨道',exact:true});
   if(before){const mapCount=await control.count(),legendCount=await legend.count();await p.locator('#list-open').click();await p.locator('.object-list button').first().waitFor();const listCount=await p.getByRole('checkbox',{name:'列表铁路等级：其他轨道',exact:true}).count();assert.equal(mapCount,0);assert.equal(legendCount,0);assert.equal(listCount,0);checks.push({name:'confirmed-missing-controls',mapCount,legendCount,listCount});await p.close();continue;}
   assert(await control.isChecked());assert.equal(await legend.getAttribute('aria-pressed'),'true');
   const initial=p.url();await control.focus();await p.keyboard.press('Space');assert.equal(await control.isChecked(),false);assert.equal(new URL(p.url()).searchParams.get('classes'),'');assert.equal(await legend.getAttribute('aria-pressed'),'false');assert.equal(await control.evaluate(e=>e===document.activeElement),true);checks.push({viewport,name:'valid-other-only-link-is-controllable-with-keyboard-and-retained-legend'});
   await legend.focus();await p.keyboard.press('Space');assert.equal(await control.isChecked(),true);assert.equal(new URL(p.url()).searchParams.get('classes'),'other');assert.equal(new URL(p.url()).hash,new URL(initial).hash);assert.equal(new URL(p.url()).searchParams.get('q'),'沈阳');checks.push({viewport,name:'legend-can-reenable-other-grade-without-moving-camera-or-query'});
   await p.locator('#share-open').click();const shared=await p.locator('#share-link').inputValue();assert.equal(new URL(shared).searchParams.get('classes'),'other');await p.locator('#share-close').click();await p.goto(shared);await p.locator('#status').filter({hasText:/铁路地图已就绪|地图已打开/}).waitFor();await p.locator('#advanced-filters summary').click();assert(await control.isChecked());checks.push({viewport,name:'share-and-fresh-navigation-preserve-other-only-grade'});
   await p.locator('#list-open').click();await p.locator('.object-list button').first().waitFor();await p.locator('#accessible-explorer').getByText('列表筛选',{exact:true}).click();const listControl=p.getByRole('checkbox',{name:'列表铁路等级：其他轨道',exact:true});assert(await listControl.isChecked());await listControl.focus();await p.keyboard.press('Space');assert.equal(await listControl.isChecked(),false);await p.getByRole('button',{name:'复制当前视图与记录链接',exact:true}).click();await p.locator('#list-share').waitFor();assert.equal(new URL(await p.locator('#list-share').inputValue()).searchParams.get('classes'),'');checks.push({viewport,name:'list-other-grade-control-updates-the-independent-share-state'});
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.close();
  }
  if(!before){
   const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));p.on('pageerror',e=>errors.push(e.message));
   await p.route('**/palette.json',async route=>{const response=await route.fetch(),body=await response.json();delete body.class_palette.other;await route.fulfill({response,body:JSON.stringify(body)});});
   await p.goto(base+'/?snapshot='+snapshot+'&types=rail&classes=other');await p.locator('#status').filter({hasText:/铁路地图已就绪|地图已打开/}).waitFor();const legend=p.getByRole('button',{name:'图例等级：其他轨道',exact:true});await legend.waitFor();assert.equal(await legend.locator('.swatch').evaluate(e=>getComputedStyle(e).borderTopColor),'rgb(138, 143, 152)');assert.equal(await p.locator('[data-resource="palette"]').count(),0);checks.push({name:'valid-nine-entry-palette-uses-the-same-neutral-fallback-as-unmatched-map-grades'});await p.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const index=await fs.readFile('apps/web/client/dist/index.html'),asset=index.toString().match(/\/assets\/index-[^" ]+\.js/)[0],build={asset,index_sha256:sha(index),asset_sha256:sha(await fs.readFile('apps/web/client/dist'+asset))};
  const report={date:new Date().toISOString(),browser_target:await target.describe(browser),source_sha256:sha(await fs.readFile(__filename)),snapshot,source_other_tracks:sourceOtherTracks,before,build,checks,errors,external,scope:'Real current data and valid other-only filter URLs, native keyboard/legend/list/share operations. Missing palette key is a controlled compatibility case. No fabricated OSM record or proof of rendering an other-grade source record when current count is zero; not device or human acceptance.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({before,checks:checks.length,sourceOtherTracks}));
 }catch(error){await target.failure(browser,error,{checks});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
