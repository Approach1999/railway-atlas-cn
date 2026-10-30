const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/about-data');
const current='shenyang-mvp-20261023',old='shenyang-mvp-progress-20261022';
(async()=>{await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const errors=[],external=[],checks=[];
  async function page(fallback=false){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));if(fallback)await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};});return p;}
  async function ready(p){await p.goto(base+'/?snapshot='+current);await p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();}
  async function listFor(p,snapshot){await p.evaluate(snapshot=>{const url=new URL(location.href);url.searchParams.set('snapshot',snapshot);url.searchParams.set('feature','node/676578837');history.replaceState(null,'',url);},snapshot);await p.locator('#list-open').click();await p.locator('.list-record h3').waitFor();await p.locator('.list-record .record-about').click();await p.locator('#about').waitFor();}
  async function palette(p){await p.locator('#palette-provenance summary').click();await p.locator('#palette-provenance').filter({hasText:'核对日期：2026-10-22'}).waitFor();}
  try{
    {
      const p=await page();await ready(p);await p.getByRole('button',{name:'城市轨道',exact:true}).click();await p.locator('summary[aria-label="2号线配色来源"]').click();assert.match(await p.locator('.line-option').filter({has:p.locator('summary[aria-label="2号线配色来源"]')}).innerText(),/核对日期：2026-10-22/);
      await p.locator('summary[aria-label="沈阳有轨电车2号线配色来源"]').click();const tram=p.locator('.line-option').filter({has:p.locator('summary[aria-label="沈阳有轨电车2号线配色来源"]')});assert.match(await tram.innerText(),/核对日期：未标注/);assert.doesNotMatch(await tram.innerText(),/2026-10-22/);
      await p.locator('#about-open').click();assert.match(await p.locator('#dataset-info').innerText(),new RegExp(current));await palette(p);await p.locator('#about details').first().locator('summary').click();assert.match(await p.locator('#provenance-info').innerText(),/Geofabrik|2026-10-23/);await p.screenshot({path:path.join(output,'current.png')});await p.locator('#about-close').click();assert.equal(await p.locator('#about-open').evaluate(el=>el===document.activeElement),true);
      checks.push('current map about uses real snapshot metadata and palette verification date; line provenance shows the same actual date and close returns focus');await p.close();
    }
    {
      const p=await page();await ready(p);const paletteRequests=[];p.on('request',r=>{if(r.url().endsWith('/palette.json'))paletteRequests.push(new URL(r.url()).pathname);});await listFor(p,old);assert.match(await p.locator('#dataset-info').innerText(),new RegExp(old));assert.doesNotMatch(await p.locator('#dataset-info').innerText(),new RegExp(current));await palette(p);assert(paletteRequests.includes('/snapshots/'+old+'/palette.json'));await p.locator('#about-close').click();assert.equal(await p.locator('.list-record .record-about').evaluate(el=>el===document.activeElement),true);
      checks.push('list using a different immutable snapshot overrides map metadata and requests its own palette; nested close returns to that list record');await p.close();
    }
    {
      const p=await page(true);await p.goto(base+'/?snapshot='+current+'&feature=node/676578837');await p.locator('.list-record h3').waitFor();await p.locator('.list-record .record-about').click();assert.match(await p.locator('#dataset-info').innerText(),new RegExp(current));assert.match(await p.locator('#dataset-info').innerText(),/Geofabrik/);await palette(p);await p.locator('#about-close').click();assert.equal(await p.locator('#accessible-explorer').isVisible(),true);
      checks.push('WebGL failure list supplies full version/provider metadata and colour provenance without a map controller');await p.close();
    }
    {
      const p=await page();await ready(p);let failing=true;await p.route('**/palette.json',r=>failing?r.fulfill({status:503,body:'unavailable'}):r.continue());const address=p.url();await p.locator('#about-open').click();await p.locator('#palette-provenance summary').click();await p.getByRole('button',{name:'重试配色记录',exact:true}).waitFor();assert.match(await p.locator('#dataset-info').innerText(),new RegExp(current));failing=false;await p.getByRole('button',{name:'重试配色记录',exact:true}).click();await p.locator('#palette-provenance').filter({hasText:'核对日期：2026-10-22'}).waitFor();assert.equal(await p.locator('#palette-provenance>summary').evaluate(el=>el===document.activeElement),true);assert.equal(p.url(),address);
      checks.push('about palette 503 preserves manifest and source view; explicit retry restores real records and meaningful focus without changing URL');await p.close();
    }
    {
      const p=await page();await ready(p);let started,release;const begin=new Promise(r=>started=r),gate=new Promise(r=>release=r);await p.route('**/snapshots/'+current+'/palette.json',async route=>{try{const response=await route.fetch();started();await gate;await route.fulfill({response});}catch{}});await p.locator('#about-open').click();await begin;await p.locator('#about-close').click();await listFor(p,old);await palette(p);release();await p.waitForTimeout(150);assert.match(await p.locator('#dataset-info').innerText(),new RegExp(old));assert.doesNotMatch(await p.locator('#dataset-info').innerText(),new RegExp(current));
      checks.push('a late palette response from a closed map about cannot overwrite reopened older-snapshot list about');await p.close();
    }
    {
      const p=await page();let failing=true;await p.route('**/dataset.json',r=>failing?r.fulfill({status:503,body:'unavailable'}):r.continue());await p.goto(base+'/?snapshot='+current);await p.locator('#about-open').click();await p.getByRole('button',{name:'重试此版本说明',exact:true}).waitFor();failing=false;await p.getByRole('button',{name:'重试此版本说明',exact:true}).click();await p.locator('#dataset-info').filter({hasText:current}).waitFor();assert.equal(await p.locator('#about-title').evaluate(el=>el===document.activeElement),true);await p.locator('#about-close').click();assert.equal(await p.locator('[data-resource="manifest"]').count(),1);
      checks.push('about can independently retry its manifest before map bootstrap succeeds; recovery does not hide the map resource failure');await p.close();
    }
    {
      const p=await page();await p.setViewportSize({width:390,height:844});await ready(p);await p.locator('#about-open').click();await palette(p);await p.locator('#about details').first().locator('summary').click();await p.locator('#about').evaluate(el=>{el.scrollTop=el.scrollHeight;});const box=await p.locator('#about-close').boundingBox();assert(box.width>=44&&box.height>=44&&box.y>=0&&box.y+box.height<=844);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const last=p.locator('#about a').last();await last.focus();await p.keyboard.press('Tab');assert.equal(await p.locator('#about-close').evaluate(el=>el===document.activeElement),true);await p.screenshot({path:path.join(output,'mobile.png')});await p.locator('#about-close').click();assert.equal(await p.locator('#about-open').evaluate(el=>el===document.activeElement),true);
      checks.push('390px long provenance remains scrollable without page overflow; sticky 44px close and Tab loop remain available at the bottom');await p.close();
    }
    {
      const p=await page();await p.route('**/dataset.json',r=>r.fulfill({status:410,body:'expired'}));await p.goto(base+'/?snapshot=expired-example');await p.locator('#about-open').click();await p.locator('#about [role=alert]').filter({hasText:'已超过保留期'}).waitFor();assert.doesNotMatch(await p.locator('#dataset-info').innerText(),new RegExp(current));await p.locator('#about-close').click();await p.getByRole('button',{name:'打开当前版本',exact:true}).waitFor();
      checks.push('expired manifest explains retention in about without silently displaying current-version metadata');await p.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const report={date:new Date().toISOString(),snapshots:[current,old],checks,errors,external,scope:'Local Chrome, actual immutable snapshots and injected transport races; no reader, real-device, source-license or full MVP acceptance claim'};await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
