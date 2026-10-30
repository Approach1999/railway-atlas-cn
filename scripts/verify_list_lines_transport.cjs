/* Actual loopback line-index failures while WebGL is unavailable. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const preview=new URL(process.env.PREVIEW_URL||'http://127.0.0.1:8766');
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/list-lines-transport');
const auditOnly=process.env.LIST_LINES_AUDIT_ONLY==='1';
async function fixture(phase){
  let failing=true;const requests=[];
  const server=http.createServer((request,response)=>{
    if(failing&&new URL(request.url,preview).pathname==='/snapshots/shenyang-mvp-20261023/lines.json'){
      const item={started:Date.now(),closed:false};requests.push(item);
      response.on('close',()=>{item.closed=true;item.close_ms=Date.now()-item.started;});
      if(phase!=='headers'&&phase!=='cancel'){
        response.writeHead(phase==='http'?503:200,{'content-type':'application/json'});response.write('{"unfinished":');
      }
      return;
    }
    const proxy=http.request(new URL(request.url,preview),{method:request.method,headers:{...request.headers,host:preview.host}},upstream=>{response.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(response);});
    proxy.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
    response.on('close',()=>{if(!response.writableFinished)proxy.destroy();});request.pipe(proxy);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+server.address().port,requests,recover:()=>{failing=false;},close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
  const cases=[],errors=[],external=[];
  try{
    for(const phase of auditOnly?['http']:['http','headers','body','cancel']){
      const site=await fixture(phase),context=await browser.newContext({viewport:{width:1000,height:800}}),page=await context.newPage();
      try{
        page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==site.url)external.push(r.url());});
        await page.addInitScript(()=>{
          localStorage.setItem('railway-atlas:basemap:v1','false');
          const original=HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};
        });
        await page.goto(site.url+'/?snapshot=shenyang-mvp-20261023&feature=node%2F11224161741&q='+encodeURIComponent('沈阳北站'));
        await page.locator('.list-record h3').filter({hasText:'沈阳北站'}).waitFor();
        await page.waitForFunction(()=>document.querySelector('#accessible-explorer')?.textContent.includes('找到'));
        const before=page.url();
        assert.equal(site.requests.length,1,'must hold the actual independent list line request');
        if(phase==='cancel'){
          await page.getByRole('button',{name:'关闭要素列表',exact:true}).click();
          await page.waitForTimeout(200);assert(site.requests[0].closed);
          assert(site.requests[0].close_ms<5000);
          site.recover();await page.getByRole('button',{name:'打开要素列表',exact:true}).click();
        }else{
          const retry=page.getByRole('button',{name:'重试列表线路名称',exact:true});
          await retry.waitFor({timeout:22000});await page.waitForTimeout(300);
          assert.equal(await page.locator('#list-query').inputValue(),'沈阳北站');
          assert.match(await page.locator('.list-record').innerText(),/node\/11224161741/);
          if(!auditOnly){
            assert(site.requests[0].closed);assert(site.requests[0].close_ms<(phase==='http'?5000:22000));
            if(phase!=='http')assert(site.requests[0].close_ms>=14000,'production deadline must not be replaced with an accelerated test timer');
          }
          const observed={...site.requests[0]};
          site.recover();await retry.click();await retry.waitFor({state:'detached'});
          await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='列表记录详情');
          // Snapshot before retry cleanup so baseline does not hide its open body.
          if(auditOnly)site.requests[0]=observed;
        }
        await page.locator('.list-record').filter({hasText:'2号线 / 4号线'}).waitFor();
        assert.equal(page.url(),before);assert.equal(await page.locator('#list-query').inputValue(),'沈阳北站');
        assert.equal(await page.getByRole('button',{name:'在地图中查看',exact:true}).count(),0);
        cases.push({phase,requests:site.requests.map(({closed,close_ms})=>({closed,close_ms})),recovered:true,identity_query_url_preserved:true});
        console.log(JSON.stringify(cases.at(-1)));
      }finally{await context.close();await site.close();}
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),audit_only:auditOnly,cases,errors,external,scope:'Real loopback unfinished HTTP 503 body, stalled headers/body, close cancellation in independent list route-name path, WebGL disabled. Not real device, screen reader or full R11.'},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
