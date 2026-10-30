const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises');const assert=require('node:assert/strict');
(async()=>{
  const expected=JSON.parse(await fs.readFile('docs/evidence/dependency-license-inventory.json','utf8'));
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8766');
    await page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();await page.locator('#about-open').click();
    for(const name of ['第三方许可文本','依赖与来源清单']){
      const link=page.getByRole('link',{name,exact:true});assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
      const response=await page.request.get(new URL(await link.getAttribute('href'),page.url()).href);assert.equal(response.status(),200);
      if(name==='第三方许可文本'){
        assert.match(response.headers()['content-type'],/text\/plain/);
        const text=await response.text();assert.match(text,/MapLibre contributors/);
        assert.equal(text,await fs.readFile('apps/web/client/public/third-party-notices.txt','utf8'));
      }else{
        assert.deepEqual(await response.json(),expected);assert.equal(expected.code_license,'unselected');
      }
    }
    assert.deepEqual(errors,[]);
    const report={date:new Date().toISOString(),checks:['about dialog exposes safe license/inventory links','notices serves current original texts as text/plain','served inventory exactly matches current evidence and preserves unselected code license'],components:expected.components.length,gaps:expected.gaps.length,archive_evidence_components:expected.components.filter(c=>c.license_evidence_source).length,errors,scope:'local static file correspondence, not legal approval'};
    await fs.writeFile('docs/evidence/license-inventory-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
