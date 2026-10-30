/* A real HTTP error may send headers and never finish its body. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const preview=new URL(process.env.PREVIEW_URL||'http://127.0.0.1:8766');
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/json-error-body');
const auditOnly=process.env.JSON_ERROR_BODY_AUDIT_ONLY==='1';
(async()=>{
  let failing=true;const requests=[],errors=[],external=[];
  const server=http.createServer((request,response)=>{
    if(failing&&new URL(request.url,preview).pathname==='/catalog.json'){
      const item={started:Date.now(),closed:false};requests.push(item);
      response.on('close',()=>{item.closed=true;item.close_ms=Date.now()-item.started;});
      response.writeHead(503,{'content-type':'application/json'});response.write('{"unavailable":');return;
    }
    const proxy=http.request(new URL(request.url,preview),{method:request.method,headers:{...request.headers,host:preview.host}},upstream=>{response.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(response);});
    proxy.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
    response.on('close',()=>{if(!response.writableFinished)proxy.destroy();});request.pipe(proxy);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==base)external.push(r.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.goto(base+'/?feature=node%2F676578837&q='+encodeURIComponent('沈阳北站')+'#map=13.50/41.81733/123.43854');
    await page.locator('.feature-title').waitFor();
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
    await page.evaluate(()=>window.originalCanvas=document.querySelector('.maplibregl-canvas'));
    const before=page.url();await page.locator('#dataset-picker summary').click();
    const retry=page.getByRole('button',{name:'重试数据目录',exact:true});
    for(let n=0;n<4;n++){
      await retry.waitFor();await page.waitForTimeout(300);
      assert.equal(requests.length,n+1);
      if(!auditOnly)assert(requests[n].closed,'HTTP rejection must close the unread error body without waiting for retry or unmount');
      assert.equal(page.url(),before);assert.equal(await page.locator('#search').inputValue(),'沈阳北站');
      assert(await page.locator('#feature-panel').isVisible());
      assert(await page.evaluate(()=>window.originalCanvas===document.querySelector('.maplibregl-canvas')));
      if(n<3)await retry.click();
    }
    const observed=requests.map(({closed,close_ms})=>({closed,close_ms}));
    failing=false;await retry.click();await page.locator('#dataset-version').waitFor();
    assert.equal(page.url(),before);assert(await page.locator('#feature-panel').isVisible());
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.mkdir(output,{recursive:true});
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),audit_only:auditOnly,requests:observed,recovered:true,errors,external,scope:'Four real loopback HTTP 503 responses with unfinished chunked bodies; same map canvas, selection, query and URL retained; successful retry. Not device or full network acceptance.'},null,2));
    console.log(JSON.stringify({audit_only:auditOnly,requests:observed,recovered:true}));
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
