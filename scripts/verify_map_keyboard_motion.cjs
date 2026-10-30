/* Real keyboard and real MediaQueryList events; no private map API or public basemap traffic. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/map-keyboard-motion');
const camera=url=>new URL(url).hash.slice(5).split('/').map(Number);
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],external=[],checks=[];
  try{
    const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await p.addInitScript(()=>{
      localStorage.setItem('railway-atlas:basemap:v1','false');
      window.motionChanges=[];
      const original=window.matchMedia.bind(window);
      window.matchMedia=condition=>{
        const query=original(condition);
        if(condition==='(prefers-reduced-motion: reduce)')query.addEventListener('change',()=>{
          queueMicrotask(()=>window.motionChanges.push({matches:query.matches,url:location.href,time:performance.now()}));
        });
        return query;
      };
    });
    await p.goto(base+'/#map=14/41.81/123.44');
    await p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
    await p.locator('#home').focus();await p.keyboard.press('Enter');
    assert.notEqual(camera(p.url())[0],10.5,'preference changes during an active home animation');
    await p.emulateMedia({reducedMotion:'reduce'});
    await p.waitForFunction(()=>window.motionChanges.some(event=>event.matches));
    const changes=await p.evaluate(()=>window.motionChanges);
    const changedCamera=changes.filter(event=>event.matches).map(event=>camera(event.url));
    assert(changedCamera.some(([zoom,lat,lon])=>zoom===10.5&&lat===41.8&&lon===123.42),'home target is reached in the preference event task, rather than left mid-flight');
    checks.push('enabling reduced motion during an active home animation completes its exact destination in the preference event task');
    await p.locator('#keyboard-help summary').focus();await p.keyboard.press('Enter');
    await p.getByRole('button',{name:'进入地图操作',exact:true}).focus();await p.keyboard.press('Enter');
    const canvas=p.locator('.maplibregl-canvas');assert.equal(await canvas.evaluate(e=>e===document.activeElement),true);
    assert.equal(await canvas.getAttribute('aria-label'),'沈阳铁路地图');assert.equal(await canvas.getAttribute('aria-describedby'),'map-keyboard-help');
    assert.deepEqual(await canvas.evaluate(e=>({style:getComputedStyle(e).outlineStyle,width:getComputedStyle(e).outlineWidth})),{style:'solid',width:'3px'});
    const cdp=await p.context().newCDPSession(p),ax=await cdp.send('Accessibility.getFullAXTree');
    const accessibleCanvas=ax.nodes.find(node=>node.role?.value==='region'&&node.name?.value==='沈阳铁路地图'&&node.description?.value?.includes('方向键'));
    assert(accessibleCanvas,'map instructions are present in the actual browser accessibility tree');
    checks.push('keyboard entry focuses the Chinese-named canvas, visible focus ring and mapped description in the accessibility tree');
    const history=await p.evaluate(()=>window.history.length),before=camera(p.url());let address=p.url();
    await p.keyboard.press('ArrowRight');await p.waitForFunction(old=>location.href!==old,address);
    const right=camera(p.url());assert(right[2]>before[2]);address=p.url();
    await p.keyboard.press('ArrowUp');await p.waitForFunction(old=>location.href!==old,address);assert(camera(p.url())[1]>right[1]);address=p.url();
    await p.keyboard.press('+');await p.waitForFunction(old=>location.href!==old,address);assert(camera(p.url())[0]>right[0]);address=p.url();
    await p.keyboard.press('-');await p.waitForFunction(old=>location.href!==old,address);assert.equal(camera(p.url())[0],right[0]);
    assert.equal(await p.evaluate(()=>window.history.length),history);
    await p.keyboard.press('Tab');assert.equal(await canvas.evaluate(e=>e===document.activeElement),false);
    checks.push('arrows pan, plus/minus zoom, map movement replaces history and Tab exits the canvas');
    const zoom=camera(p.url())[0];await p.getByRole('button',{name:'放大地图',exact:true}).focus();await p.keyboard.press('Enter');
    await p.waitForFunction(old=>Number(location.hash.slice(5).split('/')[0])>old,zoom);
    await p.getByRole('button',{name:'缩小地图',exact:true}).focus();await p.keyboard.press('Enter');
    await p.waitForFunction(old=>Number(location.hash.slice(5).split('/')[0])===old,zoom);
    await p.locator('#search').focus();await p.keyboard.type('沈阳北站');await p.locator('#results button').first().waitFor();
    await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');await p.locator('.feature-title').waitFor();
    assert(new URL(p.url()).searchParams.get('feature'));
    await p.keyboard.press('Escape');await p.locator('#feature-panel').waitFor({state:'hidden'});
    assert.equal(await p.locator('#search').evaluate(e=>e===document.activeElement),true);
    checks.push('Chinese zoom buttons, keyboard search/selection and Escape-to-search focus return work with reduced motion');
    await p.emulateMedia({reducedMotion:'no-preference'});await p.waitForFunction(()=>window.motionChanges.some(event=>!event.matches));
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={date:new Date().toISOString(),base,checks,preference_changes:await p.evaluate(()=>window.motionChanges),map_accessible_description:accessibleCanvas.description.value,errors,external,
      scope:'Local Chrome keyboard, actual media-query event tasks and browser accessibility tree; not NVDA/VoiceOver, physical device, OS IME, actual 200% zoom or full N09 acceptance'};
    await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
