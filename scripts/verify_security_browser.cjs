/* Browser enforcement and hostile source text, all external traffic locally intercepted. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8781';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/security');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],workers=[],checks=[];let allowedReferrer,blockedNetwork=0;
  const payload='<img src=x onerror="window.__sourceExecuted=true">';
  try{
    const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('worker',w=>workers.push(w.url()));
    await p.addInitScript(()=>{
      localStorage.setItem('railway-atlas:basemap:v1','false');
      window.policyViolations=[];
      document.addEventListener('securitypolicyviolation',e=>window.policyViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI,disposition:e.disposition}));
    });
    await p.route('https://tile.openstreetmap.org/**',async route=>{
      allowedReferrer=(await route.request().allHeaders()).referer;
      await route.fulfill({status:200,contentType:'text/plain',body:'local fixture',headers:{'access-control-allow-origin':'*'}});
    });
    await p.route('https://csp-test.invalid/**',async route=>{blockedNetwork++;await route.abort();});
    await p.route('**/details/*.json',async route=>{
      const response=await route.fetch(),body=await response.json();
      const feature=body['node/676578837'];
      if(feature){feature.properties.display_name=payload;feature.properties.tags.audit_test=payload;}
      await route.fulfill({response,json:body});
    });
    await p.goto(base+'/?feature=node/676578837&q=CSP-referrer-check');
    await p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
    await p.locator('.feature-title').filter({hasText:payload}).waitFor();
    assert.equal(await p.locator('#feature-panel img').count(),0);
    assert.equal(await p.evaluate(()=>window.__sourceExecuted),undefined);
    await p.locator('#detail-close').click();await p.locator('#search').fill('沈阳北站');
    await p.locator('#results button').first().waitFor();
    await p.locator('#share-open').click();await p.locator('#share-link').waitFor();await p.locator('#share-close').click();
    await p.locator('#about-open').click();await p.locator('#about-close').click();
    assert(workers.length>0);assert(workers.every(url=>new URL(url).origin===new URL(base).origin));
    assert.deepEqual(await p.evaluate(()=>window.policyViolations),[]);
    checks.push('map with same-origin worker, hostile source text, search, share and about work without CSP violations');
    assert.equal(await p.evaluate(()=>fetch('https://tile.openstreetmap.org/0/0/0.png').then(r=>r.text())),'local fixture');
    assert.equal(allowedReferrer,new URL(base).origin+'/');
    checks.push('declared raster origin remains allowed; cross-origin referrer excludes feature/query/view URL');
    const result=await p.evaluate(async()=>{
      const script=document.createElement('script');script.textContent='window.__inlineExecuted=true';document.body.append(script);
      const element=document.createElement('div');element.style.width='17px';document.body.append(element);
      const originalBase=document.baseURI,baseElement=document.createElement('base');baseElement.href='https://csp-test.invalid/';document.head.append(baseElement);
      let rejected=false;try{await fetch('https://csp-test.invalid/blocked');}catch{rejected=true;}
      return {rejected,inline:window.__inlineExecuted===true,inlineCSS:element.style.width,baseUnchanged:document.baseURI===originalBase,
        permissions:['geolocation','camera','microphone'].map(name=>({name,allowed:document.featurePolicy.allowsFeature(name)}))};
    });
    assert.equal(result.inline,false);assert.equal(result.rejected,true);assert.equal(result.inlineCSS,'17px');assert.equal(result.baseUnchanged,true);
    assert(result.permissions.every(item=>!item.allowed));assert.equal(blockedNetwork,0);
    await p.waitForFunction(()=>window.policyViolations.some(v=>v.directive==='connect-src')&&window.policyViolations.some(v=>v.directive==='script-src-elem')&&window.policyViolations.some(v=>v.directive==='base-uri'));
    const violations=await p.evaluate(()=>window.policyViolations);assert(violations.every(v=>v.disposition==='enforce'));
    checks.push('browser blocks inline scripts, undeclared connections and base URL replacement; denies location/camera/microphone while allowing required inline CSS');
    assert.deepEqual(errors,[]);
    const report={date:new Date().toISOString(),base,checks,workers,observed_raster_referrer:allowedReferrer,probe_result:result,expected_probe_violations:violations,blocked_network_requests:blockedNetwork,errors,
      scope:'Local Chrome production client with hostile detail and raster response fixtures; not public HTTPS, every browser, independent penetration test or full N07 acceptance'};
    await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
