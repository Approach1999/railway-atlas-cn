/* React filter ownership, keyboard identity and native disclosure continuity.
 * Uses actual immutable data; public raster traffic is disabled. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browserTarget=require('./browser_target.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/react-filters');
(async()=>{
  const metadataResponse=await fetch(base+'/dataset.json');assert(metadataResponse.ok);const snapshot=(await metadataResponse.json()).snapshot_id;assert.match(snapshot,/^[A-Za-z0-9_-]{1,80}$/);
  await fs.mkdir(output,{recursive:true});const browser=await browserTarget.launch(chromium);
  const checks=[],errors=[],external=[];
  async function page(options={}){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});return p;}
  const ready=p=>p.locator('#status').filter({hasText:/铁路地图已就绪|地图已打开/}).waitFor();
  const checkbox=(p,name)=>p.getByRole('checkbox',{name,exact:true});
  try{
    const p=await page();await p.goto(base);await ready(p);await p.locator('#advanced-filters summary').click();
    await p.evaluate(()=>{window.originalConstruction=document.querySelector('input[aria-label="数据状态：建设"]');window.originalDisclosure=document.querySelector('#advanced-filters details');window.originalCanvas=document.querySelector('.maplibregl-canvas');});
    await checkbox(p,'数据状态：建设').focus();await p.keyboard.press('Space');assert.equal(await checkbox(p,'数据状态：建设').isChecked(),true);
    assert.equal(await p.evaluate(()=>window.originalConstruction===document.activeElement),true);assert.equal(await p.locator('#advanced-filters details').getAttribute('open'),'');
    assert(new URL(p.url()).searchParams.get('states').includes('construction'));
    checks.push('keyboard toggling preserves the same focused input and open disclosure; persistent URL reflects lifecycle change');
    for(const name of ['铁路','其他轨道','制式未标注'])await checkbox(p,'轨道类型：'+name).uncheck();
    assert.equal(new URL(p.url()).searchParams.get('types'),'');assert.match(await p.locator('#map-notice').innerText(),/没有启用/);
    const before=new URL(p.url()).search;await p.getByRole('button',{name:'仅高速',exact:true}).click();await p.locator('#undo').click();assert.equal(new URL(p.url()).search,before);
    await p.reload();await ready(p);assert.equal(new URL(p.url()).searchParams.get('types'),'');assert.match(await p.locator('#map-notice').innerText(),/没有启用/);
    checks.push('preset undo and reload preserve explicitly empty modes with custom lifecycle selection');
    await p.getByRole('button',{name:'城市轨道',exact:true}).click();await checkbox(p,'显示2号线').uncheck();
    const persistentLines=new URL(p.url()).searchParams.get('lines');assert(!persistentLines.split(',').includes('shenyang-metro/2'));
    await p.getByRole('button',{name:'仅看4号线',exact:true}).click();await p.locator('#share-open').click();assert.equal(new URL(await p.locator('#share-link').inputValue()).searchParams.get('lines'),'shenyang-metro/4');await p.locator('#share-close').click();
    await p.getByRole('button',{name:'退出仅看此线',exact:true}).click();assert.equal(new URL(p.url()).searchParams.get('lines'),persistentLines);assert.equal(await checkbox(p,'显示2号线').isChecked(),false);
    checks.push('temporary isolation shares the visible line and exits to the earlier persistent choices');
    await p.locator('#advanced-filters summary').click();await p.locator('#filters summary').click();await p.locator('#show-facilities').check();
    await p.evaluate(()=>{window.railInput=document.querySelector('input[aria-label="轨道类型：铁路"]');window.disclosure=document.querySelector('#advanced-filters details');window.linesInput=document.querySelector('#show-lines');});
    await p.locator('#show-lines').focus();await p.keyboard.press('Space');assert.equal(await p.locator('#show-lines').isChecked(),false);assert.equal(await p.evaluate(()=>document.activeElement===window.linesInput),true);
    await p.locator('#dataset-picker summary').click();await p.locator('#dataset-version').selectOption('shenyang-mvp-progress-20261022');await p.getByRole('button',{name:'使用此版本',exact:true}).click();await p.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();
    assert.equal(await p.evaluate(()=>window.railInput===document.querySelector('input[aria-label="轨道类型：铁路"]')&&window.disclosure===document.querySelector('#advanced-filters details')&&window.disclosure.open),true);
    assert.equal(await p.locator('#show-facilities').isChecked(),true);assert.equal(await p.locator('#show-lines').isChecked(),false);assert.equal(await p.locator('#filters').getAttribute('open'),'');assert.match(await p.locator('#line-panel').innerText(),/尚无线路关系/);
    checks.push('snapshot changes retain React control identities, native open disclosures and display options while legacy line coverage stays explicit');
    {
      const q=await page();await q.goto(base);await ready(q);const grade=q.getByRole('button',{name:'图例等级：高速铁路',exact:true}),status=q.getByRole('button',{name:'图例状态：当前标注',exact:true});
      await grade.focus();await q.evaluate(()=>window.legendGrade=document.activeElement);await q.keyboard.press('Space');assert.equal(await grade.getAttribute('aria-pressed'),'false');assert.equal(await q.evaluate(()=>window.legendGrade===document.activeElement),true);assert(!new URL(q.url()).searchParams.get('classes').split(',').includes('high_speed'));
      await q.keyboard.press('Space');assert.equal(await grade.getAttribute('aria-pressed'),'true');await status.focus();await q.keyboard.press('Space');assert.equal(await status.getAttribute('aria-pressed'),'false');assert.equal(new URL(q.url()).searchParams.get('states'),'');assert.match(await q.locator('#map-notice').innerText(),/没有启用/);await q.keyboard.press('Space');assert.equal(await status.getAttribute('aria-pressed'),'true');
      checks.push('grade/status legend buttons support Space, retain focus and remain available after disabling the last state');
      await q.getByRole('button',{name:'城市轨道',exact:true}).click();assert.equal(await q.locator('.line-group').count(),2);assert.match(await q.locator('.line-group').last().innerText(),/运营方未确认/);
      await q.locator('summary[aria-label="1号线配色来源"]').focus();await q.keyboard.press('Enter');await q.locator('.line-source[open] p').waitFor();assert.match(await q.locator('.line-source[open] p').innerText(),/运营方线路图取色/);await q.waitForLoadState('networkidle');await q.screenshot({path:path.join(output,'react-line-sources.png')});
      checks.push('line legend groups use configured operator name or explicit unknown operator; keyboard opens colour provenance and confidence');await q.close();
    }
    {
      const q=await page();let failing=true;await q.route('**/palette.json',route=>failing?route.fulfill({status:503,body:'unavailable'}):route.continue());await q.goto(base);await ready(q);await q.getByRole('button',{name:'城市轨道',exact:true}).click();await checkbox(q,'显示2号线').focus();await q.keyboard.press('Space');
      await q.evaluate(()=>window.focusedLine=document.activeElement);failing=false;await q.locator('[data-resource="palette"] button').evaluate(button=>button.click());await q.locator('[data-resource="palette"]').waitFor({state:'detached'});
      assert.equal(await q.evaluate(()=>window.focusedLine===document.activeElement&&window.focusedLine===document.querySelector('input[aria-label="显示2号线"]')),true);assert.equal(await checkbox(q,'显示2号线').isChecked(),false);assert.equal(await q.locator('.line-chip').first().evaluate(el=>el.style.backgroundColor),'rgb(229, 0, 28)');
      checks.push('palette recovery updates real line colours without replacing focused React input or resetting its choice');await q.close();
    }
    {
      const q=await page({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await q.goto(base);await ready(q);await q.getByRole('button',{name:'城市轨道',exact:true}).click();const bounds=await q.locator('#presets button').first().boundingBox();assert(bounds.width>=44&&bounds.height>=44);assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await q.locator('#line-panel>summary').click();assert.equal(await q.locator('#line-panel').getAttribute('open'),null);await q.locator('#line-panel>summary').press('Enter');assert.equal(await q.locator('#line-panel').getAttribute('open'),'');
      await q.locator('summary[aria-label="1号线配色来源"]').click();await q.locator('.line-source[open] p').scrollIntoViewIfNeeded();const sourceBox=await q.locator('.line-source[open] p').boundingBox();assert(sourceBox.x>=0&&sourceBox.x+sourceBox.width<=390);await q.screenshot({path:path.join(output,'react-filters-mobile.png')});checks.push('390px simulation retains all presets, at least 44px touch targets, keyboard-collapsible line panel, readable colour provenance and no horizontal overflow');await q.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={browser_target:await browserTarget.describe(browser),date:new Date().toISOString(),server_url:base,snapshot,checks,errors,external,scope:'Local Chrome React ownership and keyboard/disclosure continuity, actual snapshots and 390px simulation; not real-device or full accessibility acceptance'};
    await fs.writeFile(path.join(output,'react-filters-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){
    const pages=browser.contexts().flatMap(context=>context.pages()),states=[];
    for(const [index,p] of pages.entries()){
      states.push(await p.evaluate(()=>({url:location.href,status:document.querySelector('#status')?.textContent,
        switchStatus:document.querySelector('#dataset-switch-status')?.textContent,
        selectedVersion:document.querySelector('#dataset-version')?.value,
        notice:document.querySelector('#map-notice')?.textContent,
        resourceIssues:[...document.querySelectorAll('[data-resource]')].map(element=>element.textContent)})));
      await p.screenshot({path:path.join(output,'failure-'+index+'.png')});
    }
    await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({date:new Date().toISOString(),error:String(error),checks,errors,external,states},null,2));
    throw error;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
