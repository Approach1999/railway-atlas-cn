/* Schema failures against real local JSON; raster requests disabled. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/typed-boundary');
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[],external=[];
  async function page(){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});return p;}
  const ready=p=>p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
  try{
    for(const kind of ['identity','geometry']){
      const p=await page();let failing=true;
      await p.route('**/details/*.json',async route=>{if(!failing)return route.continue();const response=await route.fetch(),data=await response.json();for(const record of Object.values(data)){if(kind==='identity')record.properties.osm_id='node/999999';else record.geometry={type:'Point',coordinates:[999,41.8]};}await route.fulfill({json:data});});
      await p.goto(base);await ready(p);await p.locator('#search').fill('沈阳北站');await p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();await p.getByRole('button',{name:'重试详情',exact:true}).waitFor();
      assert.match(await p.locator('#detail-body').innerText(),kind==='identity'?/身份/:/几何/);assert.equal(await p.locator('.feature-title').count(),0);const hash=new URL(p.url()).hash;
      failing=false;await p.getByRole('button',{name:'重试详情',exact:true}).click();await p.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();assert.equal(new URL(p.url()).hash,hash);assert.equal(await p.locator('#search').inputValue(),'沈阳北站');await p.locator('#detail-body summary').filter({hasText:'数据来源与原始标注'}).click();assert.match(await p.locator('#detail-body').innerText(),/node\/676578837/);
      checks.push('invalid detail '+kind+' is rejected before display; original selection/query/camera survive and retry restores matching source');await p.close();
    }
    {
      const p=await page();let failing=true;
      await p.route('**/objects.json',async route=>{if(!failing)return route.continue();const response=await route.fetch(),data=await response.json();data.records[0].aliases='invalid scalar alias';await route.fulfill({json:data});});
      await p.goto(base);await ready(p);await p.locator('#search').fill('沈阳');await p.locator('#results button').first().waitFor();await p.locator('#list-open').click();await p.locator('#accessible-explorer').getByRole('alert').filter({hasText:'列表字段无效'}).waitFor();assert.equal(await p.locator('.object-list li').count(),0);assert.equal(await p.locator('#list-query').inputValue(),'沈阳');
      failing=false;await p.getByRole('button',{name:'重试列表',exact:true}).click();await p.locator('.object-list li').first().waitFor();assert.equal(await p.locator('#list-query').inputValue(),'沈阳');
      checks.push('malformed object-index properties produce recoverable list error instead of crashing React search/render; retry preserves list query');await p.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={date:new Date().toISOString(),server_url:base,snapshot:'shenyang-mvp-20261023',checks,errors,external,scope:'Local Chrome schema failure integration on actual snapshot; not full accessibility, independent data audit or real-device acceptance'};
    await fs.writeFile(path.join(output,'typed-boundary-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
