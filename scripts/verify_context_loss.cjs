/* Real browser WebGL context loss through the standard extension, not a DOM event. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/context-loss');
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],external=[],checks=[];
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.goto(base+'/?feature=node%2F676578837&q='+encodeURIComponent('沈阳北站')+'#map=13.50/41.81733/123.43854');
    for(let cycle=0;cycle<2;cycle++){
      await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
      await page.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
      const before=page.url();
      const lost=await page.evaluate(async()=>{
        const canvas=document.querySelector('.maplibregl-canvas');
        const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
        const extension=gl?.getExtension('WEBGL_lose_context');
        if(!extension)throw Error('WEBGL_lose_context unavailable; cannot claim actual loss');
        const event=new Promise(resolve=>canvas.addEventListener('webglcontextlost',e=>resolve({trusted:e.isTrusted,cancelable:e.cancelable,lost:gl.isContextLost()}),{once:true}));
        extension.loseContext();return event;
      });
      assert.deepEqual(lost,{trusted:true,cancelable:true,lost:true});
      await page.locator('#accessible-explorer [role=status]').filter({hasText:/找到 [1-9]\d* 条记录/}).waitFor();
      assert.equal(page.url(),before);
      assert.match(await page.locator('#accessible-explorer').innerText(),/地图暂不可用/);
      assert.equal(await page.locator('#list-query').inputValue(),'沈阳北站');
      await page.locator('.list-record h3').filter({hasText:'沈阳北'}).waitFor();
      assert.equal(await page.getByRole('button',{name:'在地图中查看',exact:true}).count(),0);
      await page.getByRole('button',{name:'复制当前视图与记录链接',exact:true}).click();
      const link=new URL(await page.locator('#list-share').inputValue());
      assert.equal(link.searchParams.get('feature'),'node/676578837');
      assert.equal(link.searchParams.get('q'),'沈阳北站');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.activeElement?.textContent==='打开要素列表');
      assert.equal(page.url(),before);
      await page.getByRole('button',{name:'重试地图',exact:true}).click();
      await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0&&!document.querySelector('.map-fallback'));
      await page.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
      assert.equal(page.url(),before);assert.equal(await page.locator('#search').inputValue(),'沈阳北站');
      assert.equal(await page.locator('#accessible-explorer').count(),0);
      const render=await page.evaluate(()=>performance.getEntriesByName('atlas:first-usable').at(-1).detail);
      assert(render.rendered_tracks>0);assert.deepEqual(render.style_layers.missing,[]);
      checks.push({cycle:cycle+1,event:lost,snapshot:link.searchParams.get('snapshot'),rendered_tracks:render.rendered_tracks,expected_layers:render.style_layers.expected.length,selection_query_url_preserved:true,list_details_share_and_focus:true,retry_restored:true});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={date:new Date().toISOString(),browser:browser.version(),checks,errors,external,scope:'Two actual software WebGL context losses via WEBGL_lose_context and explicit reload retry; trusted native events, real source list/details/share, current render restoration. Not physical GPU reset, real devices or full N09.'};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
