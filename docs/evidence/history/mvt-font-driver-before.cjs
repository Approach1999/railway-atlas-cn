/* Actual FontFace registration, native fetch integrity failures and recovery. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browserTarget=require('./browser_target.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const guard=require('./benchmark_style_guard.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/font-build/browser');
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await browserTarget.launch(chromium);
  const checks=[],errors=[],external=[];let original_sha256;
  try{
    for(const mode of ['normal','http503','corrupt','headers-held']){
      const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();let requestStart,release;
      page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
      await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
      await page.route('**/assets/index-*.js',async route=>{
        const response=await route.fetch(),body=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(body.split(needle).length-1,1);
        original_sha256=crypto.createHash('sha256').update(body).digest('hex');
        await route.fulfill({response,body:body.replace(needle,'addLayer(e,t){globalThis.__fontMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}')});
      });
      const fault=async route=>{
        requestStart=Date.now();
        if(mode==='headers-held')await new Promise(resolve=>release=resolve);
        try{await route.fulfill({status:mode==='corrupt'?200:503,contentType:'font/woff2',body:mode==='corrupt'?'invalid font bytes':'unavailable'});}catch{/* original request was aborted by its deadline */}
      };
      if(mode!=='normal')await page.route('**/*.woff2',fault);
      await page.goto(base+'/?snapshot=shenyang-mvp-20261023#map=10.50/41.80000/123.42000');
      await page.waitForFunction(()=>window.__fontMap?.queryRenderedFeatures({layers:['track-major-mapped']}).length>0);
      const drawnBeforeFontReady=await page.evaluate(()=>window.__fontMap.queryRenderedFeatures({layers:['track-major-mapped']}).length);
      if(mode!=='normal')await page.locator('[data-resource="font"] [role="alert"]').waitFor({timeout:22000});
      const errorDelay=requestStart?Date.now()-requestStart:null;
      if(mode==='headers-held')assert(errorDelay>=14500&&errorDelay<20000);
      await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
      const mark=await page.evaluate(()=>performance.getEntriesByName('atlas:first-usable')[0].detail);
      if(mode==='normal')guard(mark.style_layers,mark.name_labels,mark.map_font);
      else{
        assert.equal(mark.map_font,'error');assert.throws(()=>guard(mark.style_layers,mark.name_labels,mark.map_font));
        assert.equal(await page.evaluate(()=>[...document.fonts].filter(f=>f.family==='Railway Atlas CJK').length),0);
        const url=page.url();await page.evaluate(()=>{window.__originalFontCanvas=document.querySelector('.maplibregl-canvas');window.__glyphResets=0;const m=window.__fontMap,original=m.setGlyphs.bind(m);m.setGlyphs=(...args)=>{window.__glyphResets++;return original(...args);};});
        await page.unroute('**/*.woff2',fault);release?.();
        await page.locator('[data-resource="font"] button').click();await page.locator('[data-resource="font"]').waitFor({state:'detached'});
        await page.waitForFunction(()=>[...document.fonts].some(f=>f.family==='Railway Atlas CJK'&&f.status==='loaded')&&window.__glyphResets===1);
        assert.match(await page.locator('#status').innerText(),/已恢复地图字体/);
        await page.waitForFunction(()=>window.__fontMap.loaded()&&window.__fontMap.areTilesLoaded());
        assert.equal(page.url(),url);const recovery=await page.evaluate(()=>({same_canvas:document.querySelector('.maplibregl-canvas')===window.__originalFontCanvas,glyph_resets:window.__glyphResets}));
        assert.deepEqual(recovery,{same_canvas:true,glyph_resets:1});
      }
      assert.equal(await page.evaluate(()=>[...document.fonts].filter(f=>f.family==='Railway Atlas CJK'&&f.status==='loaded').length),1);
      assert(await page.evaluate(()=>window.__fontMap.queryRenderedFeatures({layers:['line-names','line-captions','major-station-names']}).length>0));
      assert.deepEqual(await page.evaluate(()=>window.__fontMap.getLayoutProperty('major-station-names','text-font')),['Railway Atlas CJK','Microsoft YaHei','PingFang SC','sans-serif']);
      if(mode==='normal'){
        await page.waitForFunction(()=>{const m=window.__fontMap,p=m.style.placement;return m.loaded()&&m.areTilesLoaded()&&p&&performance.now()-p.commitTime>p.fadeDuration+50;});
        await page.locator('#about-open').click();
        for(const name of ['字体来源与构建记录','字体许可']){const link=page.getByRole('link',{name,exact:true});assert.equal(await link.getAttribute('rel'),'noopener noreferrer');const response=await page.request.get(new URL(await link.getAttribute('href'),page.url()).href);assert.equal(response.status(),200);}
        await page.locator('#about-close').click();
        await page.waitForFunction(()=>{const m=window.__fontMap,p=m.style.placement;return m.loaded()&&m.areTilesLoaded()&&p&&performance.now()-p.commitTime>p.fadeDuration+50;});
        await page.screenshot({path:path.join(output,'normal.png')});
      }
      checks.push({mode,tracks_drawn_while_font_request_independent:drawnBeforeFontReady,font_error_delay_ms:errorDelay,retry_recovers_same_canvas_and_url:mode!=='normal',performance_guard_rejects_font_error:mode!=='normal'});
      await context.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),browser_target:await browserTarget.describe(browser),original_sha256,checks,errors,external,scope:'Actual FontFace loaded registration and map stack, HTTP/integrity/held-header errors, explicit retry clears rasterized glyph cache. Held body/decode deadlines are unit tested separately. Not all-device glyph/legibility acceptance.'},null,2));console.log(JSON.stringify(checks));
  }catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({date:new Date().toISOString(),error:String(error),checks,errors,states:await Promise.all(browser.contexts().flatMap(c=>c.pages()).map(p=>p.evaluate(()=>({url:location.href,glyph_resets:window.__glyphResets,same_canvas:document.querySelector('.maplibregl-canvas')===window.__originalFontCanvas,text:document.body.innerText.slice(0,5000)})).catch(()=>null)))},null,2));throw error;}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
