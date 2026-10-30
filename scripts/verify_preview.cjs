/* Browser integration checks for our own local preview. Playwright is a test tool,
 * not shipped to visitors. Set PLAYWRIGHT_MODULE to an installed module if needed. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/preview-browser');
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[],requests=[],failedResponses=[];
  const attach=async page=>{
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>requests.push(r.url()));
    page.on('response',r=>{if(r.status()>=400)failedResponses.push([r.status(),r.url()]);});
    // Expose our module's map only in this intercepted test response, never in shipped code.
    await page.route('**/app.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:await r.text()+'\nglobalThis.__previewTestMap=map;'});});
  };
  const idle=async page=>{
    await page.waitForFunction(()=>globalThis.__previewTestMap?.loaded()&&!globalThis.__previewTestMap.isMoving());
    await page.waitForTimeout(400); // Allow symbol collision fades before screenshots.
  };
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});await attach(page);
    await page.goto(base);await page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();await idle(page);
    const labels=await page.evaluate(()=>globalThis.__previewTestMap.queryRenderedFeatures({layers:['major-station-names']}).map(f=>f.properties.osm_id));
    assert(labels.includes('node/6179162407'),'沈阳 station label must be visible');
    assert(labels.includes('node/676578837'),'沈阳北 station label must be visible');
    checks.push('区域级沈阳、沈阳北站名与线路名可见');
    assert((await page.evaluate(()=>globalThis.__previewTestMap.queryRenderedFeatures({layers:['line-names']}).length))>0);
    await page.screenshot({path:path.join(output,'desktop.png')});
    await page.getByRole('button',{name:'仅高速',exact:true}).click();await idle(page);
    const classes=await page.evaluate(()=>globalThis.__previewTestMap.queryRenderedFeatures({layers:['track-major-mapped']}).map(f=>f.properties.line_class));
    assert(classes.length&&classes.every(c=>c==='high_speed'));checks.push('仅高速没有混入普速与站场线');
    await page.getByRole('button',{name:'城市轨道',exact:true}).click();await page.locator('#undo').click();
    assert.equal(await page.getByRole('button',{name:'仅高速',exact:true}).getAttribute('aria-pressed'),'true');checks.push('预设撤销恢复原筛选');
    await page.getByRole('button',{name:'铁路概览',exact:true}).click();
    await page.locator('#search').fill('沈阳北站');await page.locator('#results button').filter({hasText:'铁路'}).waitFor();
    await page.locator('#search').press('ArrowDown');await page.locator('#search').press('ArrowDown');await page.locator('#search').press('Enter');
    await page.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();await idle(page);
    assert.equal(await page.locator('.feature-title').innerText(),'沈阳北');checks.push('中文别名搜索、铁路/地铁消歧与键盘选择');
    const selectedLabels=await page.evaluate(()=>globalThis.__previewTestMap.queryRenderedFeatures({layers:['selected-name','major-station-names','station-names']}).filter(f=>f.properties.osm_id==='node/676578837').length);
    assert.equal(selectedLabels,1,'selected station must not show duplicate labels');
    await page.screenshot({path:path.join(output,'station.png')});
    await page.locator('#detail-close').click();await page.getByRole('button',{name:'城市轨道',exact:true}).click();
    await page.locator('#search').fill('沈阳站');await page.locator('#results button').filter({hasText:'铁路'}).click();
    await page.locator('.feature-title').waitFor();assert.match(await page.locator('#map-notice').innerText(),/临时显示/);
    await page.locator('#detail-close').click();assert.equal(await page.getByRole('button',{name:'城市轨道',exact:true}).getAttribute('aria-pressed'),'true');checks.push('临时显示铁路结果后保留城轨筛选');
    await page.getByRole('button',{name:'铁路概览',exact:true}).click();await page.locator('#home').click();await idle(page);
    const position=await page.evaluate(()=>{const p=globalThis.__previewTestMap.project([123.4294351,41.8173345]);return {x:p.x,y:p.y};});
    const rect=await page.locator('#map').boundingBox();await page.mouse.click(rect.x+position.x,rect.y+position.y);
    if(await page.locator('#candidates').isVisible())await page.locator('#candidate-list button').filter({hasText:'沈阳北'}).first().click();
    await page.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();checks.push('地图符号点击与重叠候选选择');
    await page.locator('#detail-close').click();
    const trackPoint=await page.evaluate(()=>{
      const m=globalThis.__previewTestMap;const width=m.getCanvas().clientWidth,height=m.getCanvas().clientHeight;
      for(const f of m.queryRenderedFeatures({layers:['track-major-mapped']})){
        const lines=f.geometry.type==='MultiLineString'?f.geometry.coordinates:[f.geometry.coordinates];
        for(const line of lines)for(const c of line){const p=m.project(c);if(p.x>80&&p.x<width-100&&p.y>100&&p.y<height-100)return {x:p.x,y:p.y};}
      }
    });
    assert(trackPoint,'a visible track must be selectable');await page.mouse.click(rect.x+trackPoint.x,rect.y+trackPoint.y);
    if(await page.locator('#candidates').isVisible())await page.locator('#candidate-list button').filter({hasText:/高速铁路|普速|等级未标注/}).first().click();
    await page.locator('#detail-body dt').filter({hasText:'分类依据'}).waitFor();checks.push('轨道点击加载原始详情与分类依据');
    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await attach(mobile);
    await mobile.goto(base);await mobile.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();await idle(mobile);
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await mobile.screenshot({path:path.join(output,'mobile.png')});
    await mobile.locator('#search').fill('沈阳北站');await mobile.locator('#results button').filter({hasText:'铁路'}).click();
    await mobile.locator('.feature-title').waitFor();await idle(mobile);
    const panel=await mobile.locator('#feature-panel').boundingBox();const attribution=await mobile.locator('.maplibregl-ctrl-attrib').boundingBox();
    assert(attribution.y+attribution.height<=panel.y+1,'详情 must not cover attribution');
    assert(await mobile.locator('#detail-close').isVisible());await mobile.screenshot({path:path.join(output,'mobile-detail.png')});
    await mobile.locator('#detail-close').tap();await mobile.locator('#panel-toggle').tap();
    assert.equal(await mobile.locator('#panel-toggle').innerText(),'打开面板');await mobile.locator('#panel-toggle').tap();
    checks.push('390px 手机布局、详情署名避让与面板切换');
    assert(!requests.some(url=>/\/(railway|tracks)\.geojson/.test(url)),'full track GeoJSON must not be requested');
    assert(!requests.some(url=>url.startsWith('http')&&new URL(url).origin!==new URL(base).origin),'no external font/basemap requests');
    assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(failedResponses.length,0,JSON.stringify(failedResponses));
    checks.push('按需瓦片/详情；无整份轨道下载、外部请求、浏览器错误或 HTTP 失败');
    const report={browser:browser.version(),date:new Date().toISOString(),scope:'Headless desktop Chrome and 390px emulation; not real mobile acceptance',checks,errors,failedResponses,request_count:requests.length};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
