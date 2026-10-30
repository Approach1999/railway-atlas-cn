/* Keyboard/list/failure integration checks. These do not replace NVDA,
 * VoiceOver, contrast or real-device acceptance. Public raster traffic blocked. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browserTarget=require('./browser_target.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8770';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/accessible-browser');
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await browserTarget.launch(chromium);
  const errors=[],external=[],checks=[];
  async function page(options={},webgl=false){
    const p=await browser.newPage(options);p.on('pageerror',e=>errors.push(e.message));
    p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    if(webgl)await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};});
    return p;
  }
  const ready=p=>p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
  try{
    const p=await page({viewport:{width:1440,height:1000}});await p.goto(base);await ready(p);
    const snapshot=new URL(p.url()).searchParams.get('snapshot');
    let indexes=0;p.on('request',r=>{if(r.url().endsWith('/objects.json'))indexes++;});
    await p.waitForTimeout(100);assert.equal(indexes,0,'the all-object index is loaded on demand');
    await p.locator('#list-open').focus();await p.keyboard.press('Enter');
    await p.locator('#accessible-explorer [role=status]').filter({hasText:/找到 [1-9]\d* 条记录/}).waitFor();
    assert.equal(indexes,1);assert.equal(await p.evaluate(()=>document.activeElement.id),'list-title');
    await p.locator('#list-query').fill('沈阳北站');await p.locator('#list-kind').selectOption('stations');
    const station=p.locator('.object-list button').filter({hasText:'node/676578837'});await station.focus();await p.keyboard.press('Enter');
    await p.locator('.list-record h3').filter({hasText:'沈阳北'}).waitFor();
    assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),'列表记录详情');
    await p.getByRole('button',{name:'关闭记录详情',exact:true}).click();assert.equal(await station.evaluate(e=>e===document.activeElement),true);
    await station.press('Enter');await p.locator('.list-record h3').waitFor();
    await p.getByRole('button',{name:'在地图中查看',exact:true}).click();await p.locator('#accessible-explorer').waitFor({state:'hidden'});await p.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
    await p.waitForFunction(()=>document.activeElement?.classList.contains('feature-title'));
    checks.push('on-demand list supports keyboard selection, source details, focus return and map focus');
    await p.locator('#list-open').click();await p.locator('#list-query').fill('道岔');await p.locator('#list-kind').selectOption('facilities');
    await p.getByRole('checkbox',{name:'包含设施记录',exact:true}).check();
    await p.locator('.object-list button').first().click();await p.locator('.list-record h3').filter({hasText:'道岔'}).waitFor();
    assert.match(await p.locator('.list-record').innerText(),/道岔/);
    await p.getByRole('button',{name:'复制当前视图与记录链接',exact:true}).click();
    const link=new URL(await p.locator('#list-share').inputValue());assert.match(link.searchParams.get('feature'),/^node\//);assert.equal(link.searchParams.get('facilities'),'1');
    await p.keyboard.press('Escape');assert.equal(await p.locator('#accessible-explorer').isVisible(),false);
    checks.push('real source facilities have list details and snapshot/feature share links');
    await p.locator('.maplibregl-canvas').dispatchEvent('webglcontextlost',{cancelable:true});
    await p.locator('#accessible-explorer [role=status]').filter({hasText:'找到'}).waitFor();
    assert.match(await p.locator('#accessible-explorer').innerText(),/地图暂不可用/);
    for(let i=0;i<4;i++){await p.keyboard.press('Shift+Tab');assert(await p.evaluate(()=>document.querySelector('#accessible-explorer').contains(document.activeElement)));}
    checks.push('simulated context loss opens the list and modal contains keyboard focus');

    const fallback=await page({viewport:{width:390,height:844}},true);await fallback.goto(base);
    await fallback.locator('#accessible-explorer [role=status]').filter({hasText:'找到'}).waitFor();
    assert.match(await fallback.locator('#accessible-explorer').innerText(),/地图暂不可用/);
    await fallback.locator('#list-query').fill('沈阳北站');await fallback.locator('.object-list button').filter({hasText:'node/676578837'}).click();await fallback.locator('.list-record h3').waitFor();
    assert.equal(await fallback.getByRole('button',{name:'在地图中查看',exact:true}).count(),0);
    assert.equal(await fallback.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await fallback.screenshot({path:path.join(output,'webgl-unavailable-list.png')});
    await fallback.keyboard.press('Escape');await fallback.getByRole('button',{name:'打开要素列表',exact:true}).click();await fallback.locator('#accessible-explorer').waitFor();
    checks.push('WebGL unavailable automatically opens usable list; 390px layout fits and list can reopen');

    const failure=await page({},true);let failIndex=true,failDetail=true;
    await failure.route('**/objects.json',r=>failIndex?r.fulfill({status:503,body:'unavailable'}):r.continue());
    await failure.route('**/details/*.json',r=>failDetail?r.fulfill({status:503,body:'unavailable'}):r.continue());
    await failure.goto(base);await failure.getByRole('button',{name:'重试列表',exact:true}).waitFor();failIndex=false;await failure.getByRole('button',{name:'重试列表',exact:true}).click();
    await failure.locator('#list-query').fill('node/676578837');await failure.locator('.object-list button').click();await failure.getByRole('button',{name:'重试记录详情',exact:true}).waitFor();
    assert(await failure.locator('.object-list button').count(),'detail failure preserves list');failDetail=false;await failure.getByRole('button',{name:'重试记录详情',exact:true}).click();await failure.locator('.list-record h3').waitFor();
    await failure.locator('#accessible-explorer summary').filter({hasText:'列表筛选'}).click();await failure.getByRole('checkbox',{name:'列表数据状态：当前标注',exact:true}).uncheck();
    await failure.getByRole('button',{name:'恢复默认列表',exact:true}).waitFor();await failure.getByRole('button',{name:'恢复默认列表',exact:true}).click();assert(await failure.locator('.object-list button').count());
    checks.push('index and detail 503 errors retry independently, preserve loaded records, and empty filters recover');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={browser_target:await browserTarget.describe(browser),date:new Date().toISOString(),server_url:base,snapshot,checks,errors,external,scope:'Selected installed browser keyboard, simulated WebGL failure and 390px viewport; not full WCAG/NVDA/VoiceOver/real-device acceptance'};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){
    const pages=[];
    for(const p of browser.contexts().flatMap(context=>context.pages())){
      if(p.isClosed())continue;
      try{pages.push({url:p.url(),state:await p.evaluate(()=>({query:document.querySelector('#list-query')?.value,kind:document.querySelector('#list-kind')?.value,focus:document.activeElement?.outerHTML.slice(0,500),dialog:document.querySelector('#accessible-explorer')?.innerText.slice(0,5000),checkboxes:[...document.querySelectorAll('#accessible-explorer input[type=checkbox]')].map(input=>({label:input.parentElement?.textContent,checked:input.checked}))}))});}catch{}
    }
    await fs.writeFile(path.join(output,'failure-'+Date.now()+'.json'),JSON.stringify({date:new Date().toISOString(),error:String(error),checks,errors,pages},null,2));throw error;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
