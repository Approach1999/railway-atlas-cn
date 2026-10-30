/* Share modes against the real current Shenyang snapshot. Clipboard is controlled locally. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browserTarget=require('./browser_target.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/react-share');
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await browserTarget.launch(chromium);
  const checks=[],errors=[],external=[];
  async function page(options={}){
    const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await p.addInitScript(()=>{
      localStorage.setItem('railway-atlas:basemap:v1','false');window.copyCalls=[];window.copyMode='reject';
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>{window.copyCalls.push(text);if(window.copyMode==='reject')return Promise.reject(Error('Denied'));if(window.copyMode==='defer')return new Promise((resolve,reject)=>{window.resolveCopy=resolve;window.rejectCopy=reject;});return Promise.resolve();}}});
    });return p;
  }
  const ready=p=>p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
  const link=p=>p.locator('#share-link').inputValue();
  const radio=(p,name)=>p.getByRole('radio',{name,exact:true});
  try{
    const p=await page();await p.goto(base);await ready(p);
    await p.getByRole('button',{name:'城市轨道',exact:true}).click();await p.getByRole('checkbox',{name:'显示2号线',exact:true}).uncheck();
    const originalLines=new URL(p.url()).searchParams.get('lines');assert(!originalLines.split(',').includes('shenyang-metro/2'));
    await p.getByRole('button',{name:'仅看4号线',exact:true}).click();await p.locator('#search').fill('沈阳北站');await p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();await p.locator('.feature-title').waitFor();
    assert.match(await p.locator('#map-notice').innerText(),/临时显示/);const sourceURL=p.url();
    await p.locator('#share-open').click();assert.equal(await radio(p,'按当前所见分享').isChecked(),true);assert.equal(await p.locator('#share-link').evaluate(el=>el===document.activeElement),true);
    const visible=await link(p),visibleURL=new URL(visible);assert.equal(visibleURL.searchParams.get('lines'),'shenyang-metro/4');assert.equal(visibleURL.searchParams.get('feature'),'node/676578837');assert.equal(visibleURL.searchParams.get('q'),'沈阳北站');assert.match(await p.locator('#share-dialog').innerText(),/关闭详情后恢复/);
    await radio(p,'保留原筛选分享').check();const original=await link(p),originalURL=new URL(original);assert.equal(originalURL.searchParams.get('lines'),originalLines);assert.equal(originalURL.hash,visibleURL.hash);for(const key of ['snapshot','feature','q','states','classes','labels','facilities','sidings'])assert.equal(originalURL.searchParams.get(key),visibleURL.searchParams.get(key));assert.equal(p.url(),sourceURL);
    checks.push('default visible share encodes the isolated real line; original share restores prior explicit line exclusions without mutating the source URL, camera, query or selected temporary station');
    await p.locator('#share-copy').click();await p.locator('#share-status').filter({hasText:'无法自动复制'}).waitFor();assert.deepEqual(await p.locator('#share-link').evaluate(el=>[el===document.activeElement,el.selectionStart,el.selectionEnd]),[true,0,original.length]);
    await p.evaluate(()=>window.copyMode='accept');await p.locator('#share-copy').click();await p.locator('#share-status').filter({hasText:'链接已复制'}).waitFor();assert.deepEqual(await p.evaluate(()=>window.copyCalls),[original,original]);
    await radio(p,'按当前所见分享').focus();await p.keyboard.press('ArrowDown');assert.equal(await radio(p,'保留原筛选分享').isChecked(),true);await p.keyboard.press('Escape');assert.equal(await p.locator('#share-dialog').count(),0);assert.equal(await p.locator('#share-open').evaluate(el=>el===document.activeElement),true);assert.equal(await p.locator('#feature-panel').isVisible(),true);assert.equal(await p.getByRole('button',{name:'退出仅看此线',exact:true}).count(),1);
    checks.push('clipboard denial selects a manual-copy link; success copies the selected mode, radio arrows work, and Escape returns focus without closing the underlying detail or isolation');
    for(const [mode,address,expected] of [['visible',visible,'shenyang-metro/4'],['original',original,originalLines]]){
      const receiver=await page();await receiver.goto(address);await ready(receiver);await receiver.locator('.feature-title').waitFor();assert.equal(new URL(receiver.url()).searchParams.get('lines'),expected);assert.match(await receiver.locator('#map-notice').innerText(),/临时显示/);assert.equal(await receiver.getByRole('button',{name:'退出仅看此线',exact:true}).count(),0);await receiver.locator('#detail-close').click();assert.equal(new URL(receiver.url()).searchParams.has('feature'),false);assert.equal(new URL(receiver.url()).searchParams.get('lines'),expected);assert.equal(await receiver.getByRole('checkbox',{name:'显示2号线',exact:true}).isChecked(),false);await receiver.close();
      checks.push(mode+' recipient opens immutable data with explicit filters and temporary typed station; closing details restores exactly the link filters');
    }
    await p.locator('#share-open').click();assert.equal(await radio(p,'按当前所见分享').isChecked(),true);await p.evaluate(()=>window.copyMode='defer');await p.locator('#share-copy').click();assert.equal(await p.locator('#share-copy').isDisabled(),true);await p.keyboard.press('Escape');await p.locator('#share-open').click();const reopened=await link(p);await p.evaluate(()=>window.rejectCopy(Error('late denial')));await p.waitForTimeout(150);assert.equal(await p.locator('#share-status').innerText(),'');assert.equal(await link(p),reopened);assert.equal(await p.locator('#share-link').evaluate(el=>el===document.activeElement),true);await p.locator('#share-close').click();
    checks.push('reopening resets to visible share; a copy rejection from a closed dialog cannot alter the new session or its focus');
    await p.getByRole('button',{name:'退出仅看此线',exact:true}).click();await p.getByRole('button',{name:'铁路概览',exact:true}).click();await p.locator('#advanced-filters summary').click();await p.getByRole('checkbox',{name:'数据状态：当前标注',exact:true}).uncheck();await p.locator('#share-open').click();const emptyVisible=await link(p);await radio(p,'保留原筛选分享').check();const emptyOriginal=await link(p);assert.equal(emptyVisible,emptyOriginal);assert.equal(new URL(emptyOriginal).searchParams.get('states'),'');await p.locator('#share-close').click();
    checks.push('without isolation both choices preserve explicit empty lifecycle filters rather than expanding them');
    const mobile=await page({viewport:{width:390,height:844}});await mobile.goto(visible);await ready(mobile);await mobile.locator('.feature-title').waitFor();await mobile.locator('#share-open').click();assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);for(const selector of ['#share-close','#share-copy','.share-options label']){for(const item of await mobile.locator(selector).all()){const box=await item.boundingBox();assert(box.width>=44&&box.height>=44,selector);}}for(let i=0;i<8;i++){await mobile.keyboard.press('Tab');assert.equal(await mobile.evaluate(()=>document.querySelector('#share-dialog').contains(document.activeElement)),true);}await mobile.screenshot({path:path.join(output,'mobile.png')});await mobile.close();checks.push('390px native modal fits the screen, keeps keyboard focus inside and provides 44px share targets');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const report={browser_target:await browserTarget.describe(browser),date:new Date().toISOString(),snapshot:visibleURL.searchParams.get('snapshot'),checks,errors,external,scope:'Selected installed browser and real immutable Shenyang data; simulated clipboard and narrow viewport, not actual clipboard permissions, reader, physical devices or full MVP acceptance'};await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){await browserTarget.failure(browser,error,{checks,errors,external});throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
