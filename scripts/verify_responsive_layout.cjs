/* Viewport/touch simulation, not physical-device or actual browser zoom acceptance. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/responsive-layout');
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],external=[],checks=[];
  try{
    for(const [width,height] of [[320,568],[390,844],[667,375],[640,400],[720,500],[1024,768],[1440,1000]]){
      const p=await browser.newPage({viewport:{width,height},hasTouch:true,reducedMotion:'reduce'});
      p.on('pageerror',error=>errors.push(error.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
      await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
      await p.goto(base);await p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
      const inside=async selector=>{
        const r=await p.locator(selector).boundingBox();assert(r,selector);
        assert(r.x>=-1&&r.y>=-1&&r.x+r.width<=width+1&&r.y+r.height<=height+1,selector+' fits viewport');return r;
      };
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true,'page must not scroll outside its panels');
      await inside('.map-actions');
      if(await p.locator('.map-caption').isVisible())assert.equal(overlap(await inside('.map-caption'),await inside('.map-actions')),false,'caption and toolbar do not overlap');
      await inside('#explore');await inside('#map');
      for(const selector of ['.maplibregl-ctrl-zoom-in','.maplibregl-ctrl-zoom-out']){
        const r=await inside(selector);assert(r.width>=44&&r.height>=44,'touch zoom target');
      }
      if(width<=700){
        await p.locator('#panel-toggle').tap();assert.equal(await p.locator('#explore').isVisible(),false);
        await p.locator('#panel-toggle').tap();assert.equal(await p.locator('#explore').isVisible(),true);
      }
      await p.locator('#search').fill('沈阳北站');
      await p.locator('#results button').filter({hasText:'沈阳北'}).first().tap();
      await p.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
      await inside('#feature-panel');await inside('#detail-close');
      for(const selector of ['.maplibregl-ctrl-zoom-in','.maplibregl-ctrl-zoom-out']){
        const r=await inside(selector),panel=await inside('#feature-panel');assert.equal(overlap(r,panel),false,`${width}x${height} details must not cover ${selector}`);
        const exposed=await p.locator(selector).evaluate(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});assert(exposed,'zoom control remains reachable');
      }
      await p.screenshot({path:path.join(output,`${width}x${height}-detail.png`)});
      await p.locator('#detail-close').tap();await p.locator('#feature-panel').waitFor({state:'hidden'});
      await p.locator('#share-open').tap();await inside('#share-dialog');
      await p.locator('#share-close').scrollIntoViewIfNeeded();await p.locator('#share-close').tap();
      await p.locator('#about-open').tap();await inside('#about');
      await p.locator('#about-close').tap();
      checks.push({viewport:{width,height},checks:['page and panels fit viewport','caption hidden in short landscape or separated from toolbar','44px touch zoom controls remain exposed with detail open','search to station detail and close','share and about fit and close',...(width<=700?['panel collapse and reopen']:[])]});
      await p.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={date:new Date().toISOString(),server_url:base,checks,errors,external,scope:'Local Chrome seven viewport sizes with touch emulation and basemap off; 720x500 approximates CSS space of 1440x1000 at 200%, not actual browser zoom, mobile OS, Safari, NVDA or VoiceOver acceptance'};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
