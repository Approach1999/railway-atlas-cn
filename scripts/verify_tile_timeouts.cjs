/* Real loopback MVT header/body stalls. Production clocks are not accelerated. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const preview=new URL(process.env.PREVIEW_URL||'http://127.0.0.1:8766');
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/tile-timeouts');
const auditOnly=process.env.TILE_TIMEOUT_AUDIT_ONLY==='1';
async function fixture(body,partial){
  let stalled=true,chosen='';const requests=[],successes=[];
  const server=http.createServer((request,response)=>{
    const url=new URL(request.url,preview);
    const tile=/\/tiles\/\d+\/\d+\/\d+\.pbf$/.test(url.pathname);
    if(tile&&!chosen)chosen=url.pathname;
    if(stalled&&tile&&(!partial||url.pathname===chosen)){
      const item={path:url.pathname,started:Date.now(),headers_sent:body,closed:false};requests.push(item);
      response.on('close',()=>{item.closed=true;item.close_ms=Date.now()-item.started;});
      if(body){response.writeHead(200,{'content-type':'application/x-protobuf'});response.write(Buffer.from([0x1a,0xff]));}
      return;
    }
    const proxy=http.request(new URL(request.url,preview),{method:request.method,headers:{...request.headers,host:preview.host}},upstream=>{
      let bytes=0;upstream.on('data',chunk=>{bytes+=chunk.length;});
      response.on('finish',()=>{if(tile&&upstream.statusCode===200)successes.push({path:url.pathname,bytes});});
      response.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(response);
    });
    proxy.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
    response.on('close',()=>{if(!response.writableFinished)proxy.destroy();});request.pipe(proxy);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+server.address().port,requests,successes,recover:()=>{stalled=false;},close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const cases=[],errors=[],external=[];
  try{
    const specs=(auditOnly?[{phase:'headers',partial:false}]:[{phase:'headers',partial:false},{phase:'body',partial:true},{phase:'headers',partial:true,switch:true}]).filter(spec=>process.env.TILE_TIMEOUT_ONLY_SWITCH!=='1'||spec.switch);
    assert(specs.length>0);
    for(const spec of specs){
      const site=await fixture(spec.phase==='body',spec.partial),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
      try{
        page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==site.url)external.push(request.url());});
        await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
        await page.goto(site.url+'/?feature=node%2F676578837&q=%E6%B2%88%E9%98%B3%E5%8C%97%E7%AB%99#map=13.50/41.81733/123.43854');await page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
        await page.locator('.feature-title').waitFor();
        await page.waitForFunction(()=>Number(location.hash.slice(5).split('/')[0])>=13.5);
        const before=page.url();await page.evaluate(()=>window.tileTimeoutCanvas=document.querySelector('.maplibregl-canvas'));
        assert(site.requests.length,'native HTTP tile request must reach the stall fixture');
        let outcome;
        if(auditOnly){
          await page.waitForTimeout(Math.max(1,site.requests[0].started+16500-Date.now()));
          outcome={retry_present:await page.locator('[data-resource="tiles"] button').count(),status:await page.locator('#status').innerText()};
        }else if(spec.switch){
          site.recover();await page.locator('#dataset-picker summary').click();await page.locator('#dataset-version').selectOption('shenyang-mvp-progress-20261022');
          await page.getByRole('button',{name:'使用此版本',exact:true}).click();await page.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();
          for(let attempt=0;attempt<150&&site.requests.some(request=>!request.closed);attempt++)await page.waitForTimeout(20);
          assert(site.requests.every(request=>request.closed&&request.close_ms<5000),'source removal must cancel held tile connections before timeout');
          assert.equal(new URL(page.url()).searchParams.get('snapshot'),'shenyang-mvp-progress-20261022');
          assert.equal(await page.locator('[data-resource="tiles"]').count(),0);assert.equal(await page.locator('#search').inputValue(),'沈阳北站');
          outcome={cancelled_by_snapshot_switch:true,recovered:true};
        }else{
          await page.locator('[data-resource="tiles"] button').waitFor({timeout:22000});
          assert.match(await page.locator('[data-resource="tiles"]').innerText(),/超时/);
          assert.equal(page.url(),before);assert.equal(await page.locator('#search').inputValue(),'沈阳北站');assert.equal(await page.locator('#feature-panel').isVisible(),true);
          assert(await page.evaluate(()=>window.tileTimeoutCanvas===document.querySelector('.maplibregl-canvas')));
          site.recover();await page.locator('[data-resource="tiles"] button').click();
          await page.locator('[data-resource="tiles"]').waitFor({state:'detached',timeout:25000});
          await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
          const mark=await page.evaluate(()=>performance.getEntriesByName('atlas:first-usable')[0].detail);assert(mark.rendered_tracks>0);
          assert.equal(page.url(),before);assert.equal(await page.locator('#feature-panel').isVisible(),true);
          const retried=site.successes.find(item=>item.path===site.requests[0].path&&item.bytes>2);assert(retried,'the originally stalled tile must actually complete on retry');
          await page.evaluate(()=>document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-filters',{detail:{active:true}})));
          if(await page.locator('#filters').getAttribute('open')===null)await page.locator('#filters summary').click();
          const labels=await page.locator('#show-lines').isChecked();await page.locator('#show-lines').setChecked(!labels);
          await page.waitForFunction(()=>performance.getEntriesByName('atlas:filters-settled').length>=1);
          await page.locator('#show-lines').setChecked(labels);await page.waitForFunction(()=>performance.getEntriesByName('atlas:filters-settled').length>=2);
          const current=await page.evaluate(()=>performance.getEntriesByName('atlas:filters-settled').at(-1).detail);
          assert(current.rendered_tracks>0);assert.deepEqual(current.style_layers.missing,[]);assert.deepEqual(current.resource_errors,[]);
          assert.equal(page.url(),before);assert.equal(await page.locator('#feature-panel').isVisible(),true);
          await page.evaluate(()=>document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-filters',{detail:{active:false}})));
          outcome={timed_out:true,recovered:true,first_usable_rendered_tracks:mark.rendered_tracks,current_rendered_tracks:current.rendered_tracks,retried_tile:retried};
        }
        cases.push({...spec,outcome,requests:site.requests.map(({path,headers_sent,closed,close_ms})=>({path,headers_sent,closed,close_ms}))});console.log(JSON.stringify({phase:spec.phase,partial:spec.partial,outcome,stalled_requests:site.requests.length}));
      }catch(error){
        const state=await page.evaluate(()=>({url:location.href,status:document.querySelector('#dataset-switch-status')?.textContent,body:document.body?.textContent.slice(0,2000)})).catch(()=>null);
        await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({spec,error:String(error),requests:site.requests,state},null,2));throw error;
      }finally{await context.close();await site.close();}
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'tile-timeouts.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),audit_only:auditOnly,cases,errors,external,scope:'Actual local MVT header/body stalls, current app clocks, real selected station preserved. Not real devices or all network interruption acceptance.'},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
