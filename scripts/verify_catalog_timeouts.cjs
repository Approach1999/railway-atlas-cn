/* Loopback HTTP fixture stalls real headers or a real chunked JSON body.
 * Production timers are unchanged; all other traffic proxies the local preview. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const preview=new URL(process.env.PREVIEW_URL||'http://127.0.0.1:8766');
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/catalog-timeouts');
const auditOnly=process.env.CATALOG_TIMEOUT_AUDIT_ONLY==='1';
const old='shenyang-mvp-progress-20261022',modern='shenyang-mvp-accessible-20261022';
async function fixture(target,body){
  let stalled=true;const requests=[];
  const server=http.createServer((request,response)=>{
    const url=new URL(request.url,preview);
    if(stalled&&url.pathname===target){
      const item={started:Date.now(),headers_sent:body,closed:false};requests.push(item);
      response.on('close',()=>{item.closed=true;item.close_ms=Date.now()-item.started;});
      if(body){response.writeHead(200,{'content-type':'application/json'});response.write('{"unfinished":');}
      return;
    }
    const proxy=http.request(new URL(request.url,preview),{method:request.method,headers:{...request.headers,host:preview.host}},upstream=>{
      response.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(response);
    });
    proxy.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
    response.on('close',()=>{if(!response.writableFinished)proxy.destroy();});request.pipe(proxy);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+server.address().port,requests,recover:()=>{stalled=false;},close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const cases=[],errors=[],external=[];
  try{
    const specs=auditOnly?[['catalog','headers'],['snapshot','headers']]:[['catalog','headers'],['catalog','body'],['snapshot','headers'],['lines','body'],['cancel','body']];
    for(const [kind,phase] of specs){
      const target=kind==='catalog'?'/catalog.json':kind==='lines'?'/snapshots/'+modern+'/lines.json':'/snapshots/'+old+'/dataset.json';
      const site=await fixture(target,phase==='body'),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
      try{
        page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==site.url)external.push(request.url());});
        await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
        await page.goto(site.url);await page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
        await page.locator('#search').fill('沈阳北站');await page.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();await page.locator('.feature-title').waitFor();
        await page.waitForFunction(()=>Number(location.hash.slice(5).split('/')[0])>=13.5);
        const before=page.url();await page.evaluate(()=>window.timeoutCanvas=document.querySelector('.maplibregl-canvas'));
        await page.locator('#dataset-picker summary').click();
        const started=Date.now();
        if(kind!=='catalog'){
          await page.locator('#dataset-version').selectOption(kind==='lines'?modern:old);
          await page.getByRole('button',{name:'使用此版本',exact:true}).click();
        }
        for(let n=0;n<100&&!site.requests.length;n++)await page.waitForTimeout(20);
        assert(site.requests.length,'the fixture must actually receive the held request');
        let outcome;
        if(auditOnly){
          await page.waitForTimeout(Math.max(1,site.requests[0].started+16500-Date.now()));
          outcome={retry_present:await page.getByRole('button',{name:'重试数据目录',exact:true}).count(),message:await page.locator('#dataset-switch-status').innerText(),busy:await page.getByRole('button',{name:'取消切换',exact:true}).count()};
        }else if(kind==='cancel'){
          await page.getByRole('button',{name:'取消切换',exact:true}).click();await page.waitForTimeout(200);
          assert(site.requests[0].closed,'cancel must abort the unfinished response body');
          assert.match(await page.locator('#dataset-switch-status').innerText(),/已取消/);
          assert.equal(page.url(),before);outcome={cancelled:true};
        }else{
          if(kind==='catalog')await page.getByRole('button',{name:'重试数据目录',exact:true}).waitFor({timeout:22000});
          else await page.locator('#dataset-switch-status').filter({hasText:'超时'}).waitFor({timeout:22000});
          assert.equal(page.url(),before);assert.equal(await page.locator('#feature-panel').isVisible(),true);
          assert.equal(await page.locator('#search').inputValue(),'沈阳北站');
          assert(await page.evaluate(()=>window.timeoutCanvas===document.querySelector('.maplibregl-canvas')));
          await page.waitForTimeout(100);assert(site.requests[0].closed,'timeout must abort the held connection');
          outcome={timed_out:true,elapsed_ms:Date.now()-site.requests[0].started};
        }
        if(!auditOnly){
          site.recover();
          if(kind==='catalog'){await page.getByRole('button',{name:'重试数据目录',exact:true}).click();await page.locator('#dataset-version').waitFor();assert.equal(page.url(),before);}
          else{await page.getByRole('button',{name:'使用此版本',exact:true}).click();await page.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();assert.equal(new URL(page.url()).searchParams.get('snapshot'),kind==='lines'?modern:old);}
          outcome.recovered=true;
        }
        cases.push({kind,phase,outcome,requests:site.requests.map(({headers_sent,closed,close_ms})=>({headers_sent,closed,close_ms})),operation_ms:Date.now()-started});
        console.log(JSON.stringify(cases.at(-1)));
      }finally{await context.close();await site.close();}
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await fs.mkdir(output,{recursive:true});
    await fs.writeFile(path.join(output,'catalog-timeouts.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),audit_only:auditOnly,cases,errors,external,scope:'Real loopback header/body stalls with production timeout duration. Not an explanation of the earlier unrecorded intermittent status timeout, or real-device acceptance.'},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
