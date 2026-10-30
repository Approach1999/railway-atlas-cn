/* Actual selected-heading visibility and user wheel intent during late reads. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const target=require('./browser_target.cjs'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/list-detail-scroll');
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),checks=[],errors=[],external=[];
  try{
    async function open(viewport){
      const page=await browser.newPage({viewport,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
      await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));await page.goto(base+'/?snapshot=shenyang-mvp-20261023');
      await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length);await page.locator('#list-open').click();
      await page.locator('.object-list button').first().waitFor();await page.locator('#list-query').fill('沈阳北站');await page.locator('#list-kind').selectOption('stations');
      await page.locator('.object-list button').filter({hasText:'node/676578837'}).waitFor();return page;
    }
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      const page=await open(viewport),button=page.locator('.object-list button').filter({hasText:'node/676578837'});
      await button.focus();await button.press('Enter');await page.locator('.list-record h3').filter({hasText:'沈阳北'}).waitFor();
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='列表记录详情');
      const geometry=await page.evaluate(()=>{const h=document.querySelector('.list-record h3').getBoundingClientRect(),d=document.querySelector('#accessible-explorer').getBoundingClientRect();return {heading:{top:h.top,bottom:h.bottom},dialog:{top:d.top,bottom:d.bottom},viewport:innerHeight};});
      assert(geometry.heading.top>=geometry.dialog.top&&geometry.heading.bottom<=Math.min(geometry.dialog.bottom,geometry.viewport),'selected heading must be fully visible');
      await page.getByRole('button',{name:'关闭记录详情',exact:true}).click();assert(await button.evaluate(b=>b===document.activeElement));
      checks.push({check:'selected heading visible and close returns focus',viewport,geometry});await page.close();
    }
    const page=await open({width:1440,height:1000});let release,started;
    const requested=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve);
    await page.route('**/details/*.json',async route=>{started();await held;await route.continue();});
    const button=page.locator('.object-list button').filter({hasText:'node/676578837'});await button.focus();await button.press('Enter');await requested;
    await page.evaluate(()=>{window.__origin=document.activeElement;const d=document.querySelector('#accessible-explorer'),p=document.querySelector('.list-record'),scroll=p.scrollIntoView;window.__detailScrollCalls=0;p.scrollIntoView=function(...args){window.__detailScrollCalls++;return scroll.apply(this,args);};d.addEventListener('wheel',e=>window.__wheel={trusted:e.isTrusted,dy:e.deltaY},{once:true});});
    await page.locator('#list-query').hover();await page.mouse.wheel(0,120);await page.waitForFunction(()=>Boolean(window.__wheel));
    release();await page.locator('.list-record h3').filter({hasText:'沈阳北'}).waitFor();
    const late=await page.evaluate(()=>({focus_preserved:document.activeElement===window.__origin,programmatic_scrolls:window.__detailScrollCalls,wheel:window.__wheel}));
    assert(late.focus_preserved);assert.equal(late.programmatic_scrolls,0);assert.equal(late.wheel.trusted,true);assert(late.wheel.dy>0);
    checks.push({check:'real wheel during delayed detail prevents late focus and programmatic scroll',...late});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={date:new Date().toISOString(),browser_target:await target.describe(browser),checks,errors,external,scope:'Actual heading geometry in desktop/390px simulation, focus return, actual browser wheel during intercepted delayed detail. Not physical mobile/reader or all list tasks.'};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }catch(error){await target.failure(browser,error,{checks,errors,external});throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
