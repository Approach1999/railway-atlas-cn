/* Actual station records plus delayed/failed detail transport. No public raster. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/react-details');
const dataDir=process.env.MVP_DATA_DIR||'data/processed/shenyang-mvp-20261023';
const shard=key=>crypto.createHash('sha256').update(key).digest('hex').slice(0,2);
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const stations=JSON.parse(await fs.readFile(path.join(dataDir,'stations.geojson'),'utf8')).features;
  const manifest=JSON.parse(await fs.readFile(path.join(dataDir,'dataset.json'),'utf8'));
  const a=stations.find(f=>f.properties.osm_id==='node/676578837');assert(a);
  const b=stations.find(f=>f.properties.display_name&&f.properties.feature_kind==='station'&&f.properties.rail_mode==='rail'&&shard(f.properties.osm_id)!==shard(a.properties.osm_id)&&stations.filter(s=>s.properties.display_name===f.properties.display_name).length===1);assert(b);
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[],external=[];
  async function page(options={}){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});return p;}
  async function ready(p){await p.goto(base);await p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();assert.equal(new URL(p.url()).searchParams.get('snapshot'),manifest.snapshot_id);}
  async function choose(p,f){await p.locator('#search').fill(f.properties.display_name);await p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).filter({hasText:f.properties.display_name}).first().click();}
  async function source(p,f){await p.locator('.feature-title').filter({hasText:f.properties.display_name}).waitFor();const section=p.locator('#detail-body details');await section.locator('summary').click();assert.match(await section.innerText(),new RegExp(f.properties.osm_id));assert.match(await section.innerText(),new RegExp(manifest.snapshot_id));const full=JSON.parse(await fs.readFile(path.join(dataDir,'details',shard(f.properties.osm_id)+'.json'),'utf8'))[f.properties.osm_id];assert.deepEqual(JSON.parse(await section.locator('pre').innerText()),full.properties.tags||{});assert.equal(await section.locator('a').getAttribute('href'),'https://www.openstreetmap.org/'+f.properties.osm_id);}
  try{
    {
      const p=await page();let fail=true,release,started;const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);
      await p.route('**/details/*.json',async route=>{if(fail)return route.fulfill({status:503,body:'unavailable'});const response=await route.fetch();started();await gate;await route.fulfill({response});});
      await ready(p);await choose(p,a);await p.locator('#detail-retry').waitFor();fail=false;await p.locator('#detail-retry').click();await begin;await p.locator('#search').fill('新的查询');release();await p.locator('.feature-title').waitFor();assert.equal(await p.locator('#search').evaluate(el=>el===document.activeElement),true);assert.equal(await p.locator('#search').inputValue(),'新的查询');await source(p,a);
      checks.push('retry completion preserves newer search input and does not steal its focus; source identity, snapshot, original tags and external record URL match actual data');await p.close();
    }
    {
      const p=await page();let release,started;const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);
      await p.route('**/details/'+shard(a.properties.osm_id)+'.json',async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response});});
      await ready(p);await choose(p,a);await begin;await p.locator('#detail-close').click();assert.equal(await p.locator('#feature-panel').isVisible(),false);const response=p.waitForResponse(r=>r.url().endsWith('/details/'+shard(a.properties.osm_id)+'.json'));release();await response;await p.waitForTimeout(150);assert.equal(await p.locator('#feature-panel').isVisible(),false);assert.equal(new URL(p.url()).searchParams.has('feature'),false);
      checks.push('closing a loading detail invalidates its response and does not reopen the panel or URL selection');await p.close();
    }
    {
      const p=await page();let release,started;const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);
      await p.route('**/details/'+shard(a.properties.osm_id)+'.json',async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response});});
      await ready(p);await choose(p,a);await begin;await choose(p,b);await source(p,b);const response=p.waitForResponse(r=>r.url().endsWith('/details/'+shard(a.properties.osm_id)+'.json'));release();await response;await p.waitForTimeout(150);assert.equal(new URL(p.url()).searchParams.get('feature'),b.properties.osm_id);assert.equal(await p.locator('.feature-title').innerText(),b.properties.display_name);
      checks.push('a delayed previous selection cannot replace a newer ready record or its share identity');await p.close();
    }
    {
      const p=await page({viewport:{width:390,height:844}});await ready(p);await choose(p,a);await p.locator('.feature-title').waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const box=await p.locator('#detail-close').boundingBox();assert(box.height>=44&&box.width>=44);await p.screenshot({path:path.join(output,'mobile.png')});checks.push('390px detail has no horizontal page overflow and a 44px close target');await p.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const report={date:new Date().toISOString(),snapshot:manifest.snapshot_id,checks,errors,external,scope:'Local Chrome, real station records, injected detail races and simulated narrow viewport; not OS IME, screen-reader or physical-device acceptance'};await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
