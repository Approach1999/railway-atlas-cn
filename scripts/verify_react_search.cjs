/* Actual Shenyang indexes; synthetic composition events exercise React IME
 * handling but do not replace OS input-method or real-device acceptance. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browserTarget=require('./browser_target.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/react-search');
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await browserTarget.launch(chromium);
  const checks=[],errors=[],external=[];
  async function page(options={}){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});return p;}
  const ready=p=>p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
  async function compose(p,value,phase){await p.locator('#search').evaluate((input,{value,phase})=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;if(phase==='start')input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));set.call(input,value);if(phase==='end')input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:value}));input.dispatchEvent(new InputEvent('input',{bubbles:true,data:value,inputType:phase==='end'?'insertText':'insertCompositionText',isComposing:phase!=='end'}));},{value,phase});}
  try{
    const p=await page();await p.goto(base);await ready(p);const snapshot=new URL(p.url()).searchParams.get('snapshot');
    const stations=await (await p.request.get(base+'/snapshots/'+snapshot+'/stations.geojson')).json();
    const normalize=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
    const names=new Map();for(const feature of stations.features){const name=normalize(feature.properties.display_name);names.set(name,(names.get(name)||0)+1);}
    const target=stations.features.find(feature=>feature.properties.display_name.length>1&&names.get(normalize(feature.properties.display_name))===1&&!feature.properties.display_name.includes('沈阳北'));
    assert(target,'actual index has an unambiguous exact-name target');
    const broadQuery=['路','站','街','沈阳'].find(term=>stations.features.filter(feature=>[feature.properties.display_name,...feature.properties.aliases||[]].some(name=>normalize(name).includes(term))).length>20);assert(broadQuery,'actual index contains a query with more than twenty matches');
    await p.locator('#search').fill(broadQuery);await p.locator('#results button').first().waitFor();assert.equal(await p.locator('#results button').count(),20);assert.match(await p.locator('#results').innerText(),/匹配超过 20/);
    const last=await p.locator('#results button').last().getAttribute('id');await p.locator('#search').press('ArrowUp');assert.equal(await p.locator('#search').getAttribute('aria-activedescendant'),last);assert.equal(await p.locator('#results button[aria-selected=true]').count(),1);
    await p.locator('#search').press('ArrowDown');assert.equal(await p.locator('#search').getAttribute('aria-activedescendant'),await p.locator('#results button').first().getAttribute('id'));
    const controlled=await p.locator('#search').getAttribute('aria-controls');assert.equal(await p.locator('#'+controlled).getAttribute('role'),'listbox');
    checks.push('real query caps options at twenty, reports narrowing, initial ArrowUp chooses the last and active descendant references the visible option');
    await compose(p,'syb','start');await p.locator('#search').dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true});await p.locator('#search').dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true});await p.waitForTimeout(350);
    assert.equal(await p.locator('#search').inputValue(),'syb');assert.equal(await p.locator('#results button').count(),0);assert.equal(await p.locator('#feature-panel').isVisible(),false);assert.equal(new URL(p.url()).searchParams.get('q'),broadQuery);
    await compose(p,'沈阳北站','end');await p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).waitFor();assert.equal(new URL(p.url()).searchParams.get('q'),'沈阳北站');
    checks.push('synthetic IME Enter/Escape do not select stale results, clear composition or serialize partial text; confirmation publishes the Chinese query');
    await p.locator('#search').evaluate((input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new InputEvent('input',{bubbles:true,data:value,inputType:'insertText'}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));},target.properties.display_name);
    await p.locator('.feature-title').waitFor();assert.equal(await p.locator('.feature-title').innerText(),target.properties.display_name);assert.equal(new URL(p.url()).searchParams.get('feature'),target.id);assert.equal(new URL(p.url()).searchParams.get('q'),target.properties.display_name);
    await p.locator('#list-open').click();await p.locator('#accessible-explorer').waitFor();await p.keyboard.press('Escape');await p.locator('#accessible-explorer').waitFor({state:'hidden'});assert.equal(await p.locator('#feature-panel').isVisible(),true);assert.equal(new URL(p.url()).searchParams.get('feature'),target.id);
    await p.locator('#detail-close').click();assert.equal(await p.locator('#search').evaluate(input=>input===document.activeElement),true);
    checks.push('same-task edit plus Enter flushes the new exact-name target; modal Escape preserves map selection and closing keyboard-selected details returns to search');
    await p.locator('#search').fill('沈阳北站');await p.locator('#results button').first().waitFor();await p.getByRole('button',{name:'城市轨道',exact:true}).click();
    await p.evaluate(()=>window.searchBeforeFilter=document.querySelector('#search'));await p.locator('#search').focus();await p.locator('#search').press('ArrowDown');const active=await p.locator('#search').getAttribute('aria-activedescendant');
    await p.getByRole('button',{name:'仅高速',exact:true}).click();assert.equal(await p.locator('#search').getAttribute('aria-activedescendant'),active);assert.equal(await p.evaluate(()=>window.searchBeforeFilter===document.querySelector('#search')),true);
    const metro=p.locator('#results button').filter({hasText:'地铁'}).filter({hasText:'站点'});await metro.click();await p.locator('.feature-title').waitFor();assert.match(await p.locator('#map-notice').innerText(),/临时显示/);assert.equal(await p.getByRole('button',{name:'仅高速',exact:true}).getAttribute('aria-pressed'),'true');await p.locator('#detail-close').click();
    checks.push('filter changes keep input/active identity and a hidden metro result can temporarily display while high-speed filters remain intact');
    await p.getByRole('button',{name:'城市轨道',exact:true}).click();await p.locator('#search').fill('即将被撤销的查询');await p.goBack();await p.waitForFunction(()=>document.querySelector('#search').value===new URL(location.href).searchParams.get('q'));await p.waitForTimeout(350);assert.equal(await p.locator('#search').inputValue(),'沈阳北站');assert.equal(new URL(p.url()).searchParams.get('q'),'沈阳北站');
    checks.push('history restoration cancels pending query work instead of later replacing the restored address');
    await p.locator('#search').evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'道岔');input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'道岔',inputType:'insertText'}));document.querySelector('#list-open').click();});await p.locator('#accessible-explorer').waitFor();assert.equal(await p.locator('#list-query').inputValue(),'道岔');assert.equal(new URL(p.url()).searchParams.get('q'),'道岔');await p.keyboard.press('Escape');await p.locator('#accessible-explorer').waitFor({state:'hidden'});assert.equal(await p.locator('#search').inputValue(),'道岔');
    checks.push('same-task input and opening the all-object list uses the latest committed query rather than the earlier URL text');
    {
      const q=await page();await q.goto(base+'/?snapshot=missing-react-search&feature=node%2F676578837&q=old#map=10.50/41.80000/123.42000');await q.locator('[data-resource="manifest"]').waitFor();await q.locator('#search').fill('沈阳北站');await q.getByRole('button',{name:'打开当前版本',exact:true}).click();await ready(q);await q.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();assert.equal(await q.locator('#search').inputValue(),'沈阳北站');assert.equal(new URL(q.url()).searchParams.get('feature'),'node/676578837');assert.equal(new URL(q.url()).searchParams.get('q'),'沈阳北站');
      checks.push('unavailable snapshot recovery preserves text entered after the failure as well as the shared typed identity');await q.close();
    }
    {
      const q=await page();await q.goto(base+'/?feature=node%2F676578837&q=%E6%B2%88%E9%98%B3%E5%8C%97%E7%AB%99');await ready(q);let release,started,hold=true;const gate=new Promise(resolve=>release=resolve),requestStarted=new Promise(resolve=>started=resolve);
      await q.route('**/details/*.json',async route=>{if(!hold)return route.continue();const response=await route.fetch(),data=await response.json();started();await gate;return route.fulfill({json:data});});
      await q.locator('#list-open').click();await requestStarted;await q.locator('#list-query').fill('道岔');await q.locator('#list-kind').selectOption('facilities');await q.getByRole('checkbox',{name:'包含设施记录',exact:true}).check();await q.locator('#list-query').focus();hold=false;release();await q.locator('.list-record h3').filter({hasText:'沈阳北'}).waitFor();
      assert.equal(await q.locator('#list-query').evaluate(input=>input===document.activeElement),true);assert.equal(await q.locator('#list-query').inputValue(),'道岔');
      const facility=q.locator('.object-list button').first();await facility.focus();await facility.press('Enter');await q.locator('.list-record h3').filter({hasText:'道岔'}).waitFor();assert.equal(await q.evaluate(()=>document.activeElement.getAttribute('aria-label')),'列表记录详情');
      checks.push('delayed restored list detail cannot steal editing focus; explicit facility selection transfers focus only after its detail is committed');await q.close();
    }
    {
      const q=await page({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await q.goto(base);await ready(q);await q.locator('#search').fill('沈阳北站');await q.locator('#results button').first().waitFor();const box=await q.locator('#results button').first().boundingBox();assert(box.height>=44&&box.width>=44);assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await q.screenshot({path:path.join(output,'react-search-mobile.png')});checks.push('390px simulation keeps separated rail/metro results, status text and 44px selection targets within the viewport');await q.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={browser_target:await browserTarget.describe(browser),date:new Date().toISOString(),server_url:base,snapshot,checks,errors,external,scope:'Actual local indexes, React event integration and synthetic composition/fast-key traces; selected installed browser and 390px simulation, not OS IME, reader, real-device or full MVP acceptance'};
    await fs.writeFile(path.join(output,'react-search-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){await browserTarget.failure(browser,error,{checks,errors,external});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
