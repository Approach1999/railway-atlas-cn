/* Local actual HTTP failures for about metadata/colour provenance and basemap config. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const preview=new URL(process.env.PREVIEW_URL||'http://127.0.0.1:8766');
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/auxiliary-transport');
const auditOnly=process.env.AUXILIARY_AUDIT_ONLY==='1';
const snapshot='shenyang-mvp-20261023';
async function fixture(kind,phase){
  let failing=true,armed=kind==='basemap';const requests=[];
  const target=kind==='basemap'?'/basemap.json':'/snapshots/'+snapshot+'/'+(kind==='manifest'?'dataset.json':'palette.json');
  const server=http.createServer((request,response)=>{
    if(kind==='manifest'&&!armed&&new URL(request.url,preview).pathname===target){response.writeHead(503);response.end('initial map manifest unavailable');return;}
    if(armed&&failing&&new URL(request.url,preview).pathname===target){
      const item={started:Date.now(),closed:false};requests.push(item);
      response.on('close',()=>{item.closed=true;item.close_ms=Date.now()-item.started;});
      if(phase==='http'||phase==='body'){response.writeHead(phase==='http'?503:200,{'content-type':'application/json'});response.write('{"unfinished":');}
      return;
    }
    const proxy=http.request(new URL(request.url,preview),{method:request.method,headers:{...request.headers,host:preview.host}},upstream=>{response.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(response);});
    proxy.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
    response.on('close',()=>{if(!response.writableFinished)proxy.destroy();});request.pipe(proxy);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+server.address().port,requests,arm:()=>{armed=true;},recover:()=>{failing=false;},close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const cases=[],errors=[],external=[];
  try{
    const specs=auditOnly?[['manifest','http'],['palette','http'],['basemap','headers']]:[['manifest','http'],['manifest','headers'],['manifest','cancel'],['palette','http'],['palette','body'],['palette','cancel'],['basemap','http'],['basemap','headers'],['basemap','body']];
    for(const [kind,phase] of specs){
      const site=await fixture(kind,phase),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
      let rasterFixtures=0;
      try{
        page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(u.origin!==site.url&&u.hostname!=='tile.openstreetmap.org')external.push(r.url());});
        await page.route('https://tile.openstreetmap.org/**',async route=>{
          rasterFixtures++;
          await route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4/eEZAAWLAsKy3pYOAAAAAElFTkSuQmCC','base64'),headers:{'access-control-allow-origin':'*'}});
        });
        await page.addInitScript(({enabled})=>localStorage.setItem('railway-atlas:basemap:v1',String(enabled)),{enabled:kind==='basemap'});
        await page.goto(site.url+'/?snapshot='+snapshot+'&feature=node%2F676578837&q='+encodeURIComponent('沈阳北站')+'#map=13.50/41.81733/123.43854');
        if(kind==='basemap'){
          await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await page.locator('.feature-title').waitFor();
          await page.evaluate(()=>window.originalCanvas=document.querySelector('.maplibregl-canvas'));
        }else{
          if(kind==='manifest')await page.locator('[data-resource="manifest"]').waitFor();
          else{await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await page.locator('.feature-title').waitFor();}
          site.arm();await page.locator('#about-open').click();await page.locator('#about').waitFor();
          if(kind==='palette')await page.locator('#palette-provenance>summary').click();
        }
        const before=page.url();
        for(let n=0;n<100&&!site.requests.length;n++)await page.waitForTimeout(20);
        assert.equal(site.requests.length,1,'fixture must receive the actual target request');
        let observation;
        const retry=kind==='basemap'?page.locator('#basemap-retry'):page.getByRole('button',{name:kind==='manifest'?'重试此版本说明':'重试配色记录',exact:true});
        if(phase==='cancel'){
          await page.locator('#about-close').click();await page.waitForTimeout(200);
          assert(site.requests[0].closed&&site.requests[0].close_ms<5000);observation={...site.requests[0]};
          site.recover();await page.locator('#about-open').click();
          if(kind==='palette')await page.locator('#palette-provenance>summary').click();
        }else if(auditOnly&&kind==='basemap'){
          await page.waitForTimeout(Math.max(1,site.requests[0].started+16500-Date.now()));
          observation={...site.requests[0],retry_present:await retry.count(),message:await page.locator('#basemap-status').innerText()};
        }else{
          await retry.waitFor({timeout:22000});await page.waitForTimeout(300);observation={...site.requests[0]};
          if(!auditOnly){assert(observation.closed);assert(observation.close_ms<(phase==='http'?5000:22000));if(phase!=='http')assert(observation.close_ms>=14000);}
          if(kind!=='basemap')assert.match(await page.locator('#about').innerText(),/OpenStreetMap contributors/);
          if(kind==='palette')assert.match(await page.locator('#dataset-info').innerText(),new RegExp(snapshot));
          site.recover();await retry.click();
          if(kind!=='basemap'){
            await retry.waitFor({state:'detached'});
            const focus=kind==='manifest'?'#about-title':'#palette-provenance>summary';
            assert.equal(await page.locator(focus).evaluate(el=>el===document.activeElement),true);
          }
        }
        if(!(auditOnly&&kind==='basemap')){
          if(kind==='basemap'){
            await page.locator('#basemap-status').filter({hasText:'底图已显示'}).waitFor();
            assert(rasterFixtures>0);assert(await page.evaluate(()=>window.originalCanvas===document.querySelector('.maplibregl-canvas')));
            assert(await page.locator('.feature-title').isVisible());
          }else{
            await page.locator('#dataset-info').filter({hasText:snapshot}).waitFor();
            if(kind==='palette')await page.locator('#palette-provenance').filter({hasText:'核对日期：2026-10-22'}).waitFor();
          }
          assert.equal(page.url(),before);
        }
        const item={kind,phase,request:{closed:observation.closed,close_ms:observation.close_ms},recovered:!(auditOnly&&kind==='basemap'),raster_fixture_requests:rasterFixtures};
        if('retry_present' in observation)item.baseline={retry_present:observation.retry_present,message:observation.message};
        cases.push(item);console.log(JSON.stringify(item));
      }catch(error){
        await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({kind,phase,error:String(error),cases,requests:site.requests,state:await page.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,8000)})).catch(()=>null)},null,2));throw error;
      }finally{await context.close();await site.close();}
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),audit_only:auditOnly,cases,errors,external,scope:'Real loopback transport for about manifest/palette and basemap configuration; software WebGL; all OSM raster requests fulfilled locally with a PNG, no public tile download. Not full R10/R11/R19/N09 or device acceptance.'},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
