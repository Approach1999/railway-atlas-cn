/* Genuine browser page zoom in owned temporary profiles, no device metrics/CSS zoom override. */
const target=require('./browser_target.cjs'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'..');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function verifyBrowserZoom(config={}){
 const {chromium}=require(config.playwrightModule||process.env.PLAYWRIGHT_MODULE||'playwright');
 const base=config.baseUrl||process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(repo,config.outputDirectory||process.env.PREVIEW_EVIDENCE||'data/manifests/local/browser-zoom');
 const browserEnv={...process.env,...(config.channel?{ATLAS_BROWSER_CHANNEL:config.channel}:{})};
 await fs.mkdir(output,{recursive:true});const cases=[],errors=[],external=[],profiles=[];
 const index=await fs.readFile(path.join(repo,'apps/web/client/dist/index.html')),asset=index.toString().match(/src="(\/assets\/index-[^"]+\.js)"/)[1],build={asset,index_sha256:hash(index),js_sha256:hash(await fs.readFile(path.join(repo,'apps/web/client/dist'+asset)))};let browserInfo;
 for(const size of [{width:1552,height:1000},{width:1280,height:800}]){
  let baseline;
  for(const factor of [1,2]){
   const dir=await fs.mkdtemp(path.join(output,'profile-'));profiles.push(dir);await fs.mkdir(path.join(dir,'Default'));
   // Chromium's default storage partition has empty relative path -> key "x".
   const level=Math.log(factor)/Math.log(1.2),preferences={partition:{default_zoom_level:process.argv.includes('--invalid-scalar')?level:{x:level}}};
   await fs.writeFile(path.join(dir,'Default/Preferences'),JSON.stringify(preferences));
   const opts=target.options(browserEnv),context=await chromium.launchPersistentContext(dir,{...opts,...(config.executablePath?{executablePath:config.executablePath}:{}),viewport:null,reducedMotion:'reduce',args:[...opts.args,'--window-size='+size.width+','+size.height]});
   const checks=[],samples=[];
   try{
    browserInfo=await target.describe(context.browser(),browserEnv);const p=context.pages()[0];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    await p.addInitScript(()=>{localStorage.setItem('railway-atlas:basemap:v1','false');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('controlled clipboard denial');}}});});
    await p.goto(base+'/?snapshot=shenyang-mvp-20261023');await p.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length);
    const cdp=await context.newCDPSession(p);
    async function sample(state){
     const metrics=await cdp.send('Page.getLayoutMetrics'),dom=await p.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,pinch:visualViewport.scale,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,searchFont:getComputedStyle(document.querySelector('#search')).fontSize,cssZoom:getComputedStyle(document.documentElement).zoom}));
     const value={state,metrics,dom};samples.push(value);
     assert.equal(metrics.cssVisualViewport.zoom,factor,'protocol must confirm actual browser page zoom');assert.equal(metrics.cssVisualViewport.scale,1,'must not substitute pinch scaling');assert.equal(dom.pinch,1);assert.equal(dom.cssZoom,'1');assert(dom.scroll<=dom.client+1,'no page horizontal overflow');return value;
    }
    const first=await sample('overview');
    if(factor===1){baseline=first;cases.push({size,factor,profile:dir,preferences,checks:['baseline actual page zoom is 1'],samples});continue;}
    assert.equal(first.dom.dpr,baseline.dom.dpr*2);assert(Math.abs(first.dom.width*2-baseline.dom.width)<=2);assert.equal(first.dom.searchFont,baseline.dom.searchFont);checks.push('actual page zoom 2, unchanged pinch/CSS zoom/font declaration, doubled DPR and halved CSS viewport against same-window baseline');
    async function reachable(locator){
     await locator.scrollIntoViewIfNeeded();const value=await locator.evaluate(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},width:innerWidth,height:innerHeight,hit:hit===e||e.contains(hit)};});
     assert(value.rect.width>0&&value.rect.height>0&&value.rect.x>=-1&&value.rect.x+value.rect.width<=value.width+1&&value.rect.y>=-1&&value.rect.y+value.rect.height<=value.height+1,'whole control must be reachable within viewport');assert(value.hit,'control center must not be covered');return value;
    }
    await p.locator('#search').fill('沈阳北站');const result=p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'});await result.waitFor();await reachable(result);await result.press('Enter');await p.locator('.feature-title').waitFor();
    await reachable(p.locator('#detail-close'));await sample('selected-detail');assert.equal(new URL(p.url()).searchParams.get('feature'),'node/676578837');checks.push('keyboard result selection retains exact source identity and visible close control');
    await p.locator('#detail-close').click();await p.locator('[data-preset=highspeed]').click();await p.locator('[data-preset=overview]').click();await sample('filter-round-trip');checks.push('highspeed and overview presets remain reachable');
    await reachable(p.locator('#share-open'));await p.locator('#share-open').click();await reachable(p.locator('#share-link'));await sample('share-dialog');await p.locator('#share-close').press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.id),'share-open');checks.push('share dialog fields reachable and Escape returns focus');
    await p.locator('#about-open').click();await reachable(p.locator('#about-close'));await sample('about-dialog');await p.locator('#about-close').press('Escape');checks.push('about dialog and close control reachable');
    await p.locator('#list-open').click();await p.locator('.object-list button').first().waitFor();await p.locator('#list-query').fill('node/676578837');await p.locator('.object-list button').press('Enter');await p.locator('.list-record h3').waitFor();
    await reachable(p.locator('.list-record h3'));await sample('list-detail');checks.push('list detail heading readable at actual 200%');
    await p.getByRole('button',{name:'复制当前视图与记录链接',exact:true}).click();await p.locator('#list-share').waitFor();await reachable(p.locator('#list-share'));const link=new URL(await p.locator('#list-share').inputValue());assert.equal(link.searchParams.get('feature'),'node/676578837');assert.equal(link.searchParams.get('snapshot'),'shenyang-mvp-20261023');await sample('list-manual-link');checks.push('manual list share remains reachable and preserves snapshot/selected source');
    // Playwright's CSS-sized clip can crop genuine page zoom. Capture the whole surface.
    const screenshot=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64');
    const dimensions={width:screenshot.readUInt32BE(16),height:screenshot.readUInt32BE(20)},last=samples.at(-1);
    assert(Math.abs(dimensions.width-last.dom.width*factor)<=2&&Math.abs(dimensions.height-last.dom.height*factor)<=2,'screenshot must contain complete zoomed surface');
    await fs.writeFile(path.join(output,'zoom200-'+size.width+'x'+size.height+'.png'),screenshot);last.screenshot_dimensions=dimensions;
    await p.getByRole('button',{name:'关闭要素列表',exact:true}).click();assert.equal(await p.evaluate(()=>document.activeElement.id),'list-open');
    await p.locator('#home').click();await sample('home');assert.equal(new URL(p.url()).searchParams.has('feature'),false);checks.push('list close returns focus and reset remains reachable');
    cases.push({size,factor,profile:dir,preferences,checks,samples});
   }catch(error){await target.failure(context.browser(),error,{cases,checks,samples,errors,external});throw error;}finally{await context.close();}
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(hash(await fs.readFile(path.join(repo,'apps/web/client/dist/index.html'))),build.index_sha256);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),build,browser_target:browserInfo,cases,errors,external,profiles,scope:'Installed headless browser, genuine persisted page zoom confirmed by CDP and same-window baseline. Two window sizes, selected core tasks, controlled clipboard denial. Not user window UI, OS input method, reader, actual device or full N09 acceptance.'},null,2));console.log(JSON.stringify({cases:cases.length,task_checks:cases.reduce((n,c)=>n+c.checks.length,0)}));
}
module.exports={verifyBrowserZoom};
if(require.main===module)verifyBrowserZoom().catch(e=>{console.error(e);process.exitCode=1;});
