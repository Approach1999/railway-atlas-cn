/* Product's 44px touch requirement, effective checkbox labels, not inline links. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const target=require('./browser_target.cjs'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/touch-targets'),observe=process.argv.includes('--observe');
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),scenes=[],failures=[],errors=[],external=[],actions=[];
  const hash=v=>crypto.createHash('sha256').update(v).digest('hex'),index=await fs.readFile('apps/web/client/dist/index.html'),html=index.toString();
  const js=html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1],css=html.match(/href="(\/assets\/index-[^"]+\.css)"/)[1],build={js,css,index_sha256:hash(index),js_sha256:hash(await fs.readFile('apps/web/client/dist'+js)),css_sha256:hash(await fs.readFile('apps/web/client/dist'+css))};
  try{
    for(const viewport of (observe?[{width:390,height:844}]:[{width:320,height:640},{width:390,height:844},{width:768,height:1024},{width:667,height:375}])){
      const page=await browser.newPage({viewport,isMobile:true,hasTouch:true,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
      await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));await page.goto(base+'/?snapshot=shenyang-mvp-20261023');await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length);
      assert(await page.evaluate(()=>matchMedia('(any-pointer:coarse)').matches));
      assert(await page.locator('link[rel=stylesheet]').evaluateAll((nodes,css)=>nodes.some(n=>new URL(n.href).pathname===css),css));
      async function audit(state,scope='body'){
        const values=await page.locator(scope).evaluate(root=>[...root.querySelectorAll('button,summary,label.check,input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&s.visibility==='visible'&&!e.disabled&&(!e.matches('label')||e.querySelector('input:not(:disabled)'));}).map(e=>{const r=e.getBoundingClientRect();return {id:e.id,tag:e.tagName,label:(e.getAttribute('aria-label')||e.innerText).trim().slice(0,90),width:r.width,height:r.height};}));
        assert(values.length>0);const bad=values.filter(v=>v.width<44-.01||v.height<44-.01);scenes.push({viewport,state,values});failures.push(...bad.map(v=>({viewport,state,...v})));
        const layout=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,inner:innerWidth,visual:visualViewport?.width}));
        assert(layout.scroll<=layout.client+1&&layout.client<=viewport.width+1,'touch layout must not overflow the configured viewport');
        scenes.at(-1).layout=layout;
      }
      if(!observe){
        await page.locator('#filters summary').tap();const label=page.locator('label.check:has(#show-facilities)'),input=page.locator('#show-facilities');
        const initial=await input.isChecked();for(const expected of [!initial,initial]){await label.scrollIntoViewIfNeeded();const b=await label.boundingBox();assert(b.width>=44&&b.height>=44);await page.touchscreen.tap(b.x+b.width-4,b.y+b.height/2);assert.equal(await input.isChecked(),expected);}
        await page.locator('#filters summary').tap();actions.push({viewport,check:'tap associated label away from small checkbox toggles and restores control'});
      }
      await audit('overview');await page.locator('#search').fill('沈阳北站');await page.locator('#results button').first().waitFor();await audit('search');
      if(!observe){const b=await page.locator('#search-clear').boundingBox();assert(b.width>=44);await page.touchscreen.tap(b.x+b.width/2+20,b.y+b.height/2);assert.equal(await page.locator('#search').inputValue(),'');actions.push({viewport,check:'clear action responds near expanded horizontal target edge'});}
      else await page.locator('#search-clear').click();
      await page.locator('#dataset-picker summary').click();await page.locator('#dataset-version').waitFor();await audit('dataset');await page.locator('#dataset-picker summary').click();
      await page.locator('#search').fill('沈阳北站');const station=page.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'});await station.tap();await page.locator('.feature-title').waitFor();await audit('detail');await page.locator('#detail-close').tap();
      await page.locator('#share-open').tap();await audit('share','#share-dialog');await page.locator('#share-close').tap();
      await page.locator('#about-open').tap();await audit('about','#about');await page.locator('#about-close').tap();
      await page.locator('#list-open').tap();await page.locator('.object-list button').first().waitFor();await audit('list','#accessible-explorer');await page.getByRole('button',{name:'关闭要素列表',exact:true}).tap();
      // Local configuration failure produces the real retry UI without raster requests.
      await page.route('**/basemap.json',route=>route.fulfill({status:503,body:'fixture'}));await page.reload();await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length);await page.locator('#basemap-toggle').tap();await page.locator('#basemap-retry').waitFor();await audit('basemap-failure');
      await page.screenshot({path:path.join(output,'touch-'+viewport.width+'x'+viewport.height+'.png')});await page.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    assert.equal(hash(await fs.readFile('apps/web/client/dist/index.html')),build.index_sha256);assert.equal(hash(await fs.readFile('apps/web/client/dist'+css)),build.css_sha256);
    const report={date:new Date().toISOString(),build,browser_target:await target.describe(browser),mode:observe?'observation':'validation',status:failures.length?'fails-size':'passes-size',scenes,actions,failures,errors,external,scope:'Laid-out active buttons, disclosure summaries authored text/select fields and associated checkbox/radio label rectangles in eight actual UI states under coarse-pointer emulation; clear-button edge and label taps, no page overflow. Not inline links, every occlusion/gesture/state or physical device acceptance.'};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({mode:report.mode,scenes:scenes.length,controls:scenes.reduce((n,s)=>n+s.values.length,0),failures:failures.length}));
    if(!observe)assert.equal(failures.length,0,'44px effective target requirement failed');
  }catch(error){await target.failure(browser,error,{failures,errors,external});throw error;}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
