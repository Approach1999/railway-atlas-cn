/* Source-tag expectations are read from the immutable QA packet, not UI helpers. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/detail-fields');
(async()=>{
  await fs.mkdir(output,{recursive:true});const packet=JSON.parse(await fs.readFile('docs/qa/shenyang-samples.json','utf8'));
  const manifest=JSON.parse(await fs.readFile('data/processed/'+packet.snapshot+'/dataset.json','utf8'));
  const groups=['track-attribute:bridge','track-attribute:tunnel','track-grade:high_speed','track-grade:conventional_main','track-grade:conventional_other','track-grade:branch','track-grade:industrial','shared-track','missing-line-colour','light-colour-line','station-areas','identity-anchor:node/11224161741','facility:turntable'];
  const chosen=[...new Map(groups.map(group=>{const record=packet.samples.find(s=>s.groups.includes(group));assert(record,group);return [record.osm_id,record];})).values()];
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const errors=[],external=[],checks=[];
  async function page(failMap=false){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));if(failMap)await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};});return p;}
  const rows=locator=>locator.locator('div').evaluateAll(nodes=>Object.fromEntries(nodes.filter(n=>n.querySelector('dt')).map(n=>[n.querySelector('dt').textContent,n.querySelector('dd').textContent])));
  try{
    const p=await page();let bridgeShot=false;
    for(const sample of chosen){
      await p.goto(new URL(sample.view,base).href);await p.locator('.feature-title').waitFor();assert.equal(new URL(p.url()).searchParams.get('feature'),sample.osm_id);
      const mapRows=await rows(p.locator('#detail-body .record-fields'));
      if(sample.feature_kind==='track')for(const [label,key] of [['轨距标注','gauge'],['桥梁标注','bridge'],['隧道标注','tunnel'],['运营方标注','operator']])assert.equal(mapRows[label],sample.source_tags[key]||'未标注',sample.osm_id+' '+label);
      if(sample.feature_kind==='station_area'){assert.equal(mapRows['记录类别'],'站区');assert.equal(mapRows['轨距标注'],undefined);}
      if(sample.line_shared)assert.match(mapRows['共线状态'],/多条线路共享/);
      await p.locator('#detail-body .record-provenance summary').click();const sourceRows=await rows(p.locator('#detail-body .record-provenance dl'));assert.equal(sourceRows['数据构建时间'],manifest.build_time);assert.equal(sourceRows['分类规则版本'],manifest.classification_version);assert.equal(sourceRows['配色版本'],manifest.palette_version);assert.match(sourceRows['当前覆盖范围'],/非行政边界/);assert.deepEqual(JSON.parse(await p.locator('#detail-body pre').innerText()),sample.source_tags);
      if(!bridgeShot&&sample.source_tags.bridge){await p.screenshot({path:path.join(output,'bridge.png')});bridgeShot=true;}
      await p.locator('#list-open').click();await p.locator('.list-record h3').waitFor();await p.waitForFunction(expected=>[...document.querySelectorAll('.list-record .record-fields>div')].find(n=>n.querySelector('dt')?.textContent==='线路归属')?.querySelector('dd')?.textContent===expected,mapRows['线路归属']);const listRows=await rows(p.locator('.list-record .record-fields'));
      for(const key of Object.keys(mapRows))assert.equal(listRows[key],mapRows[key],sample.osm_id+' equivalent '+key);
      await p.locator('.list-record .record-provenance summary').click();assert.deepEqual(await rows(p.locator('.list-record .record-provenance dl')),sourceRows);assert.deepEqual(JSON.parse(await p.locator('.list-record pre').innerText()),sample.source_tags);
      await p.locator('.list-record .record-about').click();await p.locator('#about').waitFor();const last=p.locator('#about a').last();await last.focus();await p.keyboard.press('Tab');assert.equal(await p.locator('#about-close').evaluate(el=>el===document.activeElement),true);await p.keyboard.press('Shift+Tab');assert.equal(await last.evaluate(el=>el===document.activeElement),true);await p.locator('#about-close').click();assert.equal(await p.locator('#accessible-explorer').isVisible(),true);assert.equal(await p.locator('.list-record .record-about').evaluate(el=>el===document.activeElement),true);await p.keyboard.press('Escape');
      checks.push({id:sample.osm_id,groups:sample.groups,checks:['source bridge/tunnel/gauge/operator values remain literal','map/list domain fields and resolved line names agree','same immutable snapshot source metadata and original tags','nested data/license explanation returns focus to list record']});
    }
    const fallback=await page(true);await fallback.goto(new URL(chosen[0].view,base).href);await fallback.locator('.list-record h3').waitFor();await fallback.locator('.list-record .record-about').click();await fallback.locator('#about').waitFor();await fallback.locator('#about-close').click();assert.equal(await fallback.locator('#accessible-explorer').isVisible(),true);await fallback.close();
    const failure=await page(true),tagged=chosen.find(sample=>sample.line_keys.length);assert(tagged);let failLines=true,indexRequests=0;
    failure.on('request',r=>{if(r.url().endsWith('/objects.json'))indexRequests++;});
    await failure.route('**/lines.json',r=>failLines?r.fulfill({status:503,body:'unavailable'}):r.continue());
    await failure.goto(new URL(tagged.view,base).href);await failure.locator('.list-record h3').waitFor();await failure.getByRole('button',{name:'重试列表线路名称',exact:true}).waitFor();assert.equal((await rows(failure.locator('.list-record .record-fields')))['线路归属'],tagged.line_keys.join(' / '));const before=failure.url();
    failLines=false;await failure.getByRole('button',{name:'重试列表线路名称',exact:true}).click();await failure.locator('[data-line-retry]').waitFor({state:'hidden'});const catalog=JSON.parse(await fs.readFile('data/processed/'+packet.snapshot+'/lines.json','utf8'));const expected=tagged.line_keys.map(key=>catalog.lines.find(line=>line.line_key===key)?.name||key).join(' / ');assert.equal((await rows(failure.locator('.list-record .record-fields')))['线路归属'],expected);assert.equal(indexRequests,1);assert.equal(failure.url(),before);assert.equal(await failure.locator('.list-record').evaluate(el=>el===document.activeElement),true);await failure.close();
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const report={date:new Date().toISOString(),snapshot:packet.snapshot,samples:checks.length,checks,webgl_fallback_about:true,line_name_failure_retry:true,errors,external,scope:'Automated display/source checks for selected actual QA records in local Chrome. No human classification correctness, two independent signoffs, reader or real-device acceptance claim.'};await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
