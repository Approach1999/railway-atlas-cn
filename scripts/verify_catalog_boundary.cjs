/* Malformed directory responses stay isolated from the working railway map. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/catalog-boundary');
const auditOnly=process.env.CATALOG_AUDIT_ONLY==='1';
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const cases=[],external=[];
  try{
    const bootstrap=await browser.newContext(),response=await bootstrap.request.get(base+'/catalog.json');assert.equal(response.status(),200);
    const catalog=await response.json();await bootstrap.close();
    const mutations=[
      ['object region name',value=>{value.regions[0].name={bad:true};}],
      ['null camera longitude',value=>{value.regions[0].default_view.longitude=null;}],
      ['string object-list capability',value=>{value.regions[0].snapshots[0].object_list='false';}],
      ['duplicate snapshot identity',value=>{value.regions[0].snapshots.push({...value.regions[0].snapshots[0]});}],
      ['missing snapshot identity',value=>{delete value.regions[0].snapshots[0].id;}],
      ['unlisted recommended snapshot',value=>{value.regions[0].current_snapshot='not-in-this-directory';}],
      ['object build date',value=>{value.regions[0].snapshots[0].build_time={bad:true};}],
    ];
    for(const [name,mutate] of mutations){
      const context=await browser.newContext(),page=await context.newPage(),errors=[];let broken=true;
      const fixture=structuredClone(catalog);mutate(fixture);
      page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
      await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
      await page.route('**/catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(broken?fixture:catalog)}));
      await page.goto(base);
      await page.waitForFunction(()=>document.querySelector('#dataset-picker [role="alert"]')||document.querySelector('#dataset-version')||!document.querySelector('#map'));
      await page.waitForTimeout(100);
      const observed=await page.evaluate(()=>({map_present:Boolean(document.querySelector('#map')),canvas_count:document.querySelectorAll('.maplibregl-canvas').length,
        retry_present:[...document.querySelectorAll('#dataset-picker button')].some(button=>button.textContent==='重试数据目录'),
        picker_text:document.querySelector('#dataset-picker')?.textContent||'',versions:document.querySelectorAll('#dataset-version option').length}));
      if(!auditOnly){
        assert.equal(observed.retry_present,true,name+' must offer a catalog retry');assert.equal(observed.canvas_count,1,name+' must preserve the map');
        assert.equal(observed.versions,0,name+' must not publish malformed options');assert.deepEqual(errors,[]);
        await page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
        await page.locator('#search').fill('沈阳北');await page.waitForFunction(()=>new URL(location.href).searchParams.get('q')==='沈阳北');
        const before=page.url();await page.evaluate(()=>window.originalCatalogCanvas=document.querySelector('.maplibregl-canvas'));
        await page.locator('#dataset-picker summary').click();broken=false;await page.getByRole('button',{name:'重试数据目录',exact:true}).click();
        await page.locator('#dataset-version').waitFor();
        assert.equal(page.url(),before);assert.equal(await page.locator('#search').inputValue(),'沈阳北');
        assert(await page.evaluate(()=>window.originalCatalogCanvas===document.querySelector('.maplibregl-canvas')));
      }
      cases.push({name,...observed,errors,recovery_verified:!auditOnly});await context.close();
    }
    assert.deepEqual(external,[]);await fs.mkdir(output,{recursive:true});
    await fs.writeFile(path.join(output,'catalog-boundary.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),audit_only:auditOnly,cases,external},null,2));
    console.log(JSON.stringify(cases.map(({name,map_present,retry_present,errors})=>({name,map_present,retry_present,errors})),null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
