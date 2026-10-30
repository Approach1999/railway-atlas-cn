/* Actual responsive changes and native keyboard focus; no reader/device claim. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),target=require('./browser_target.cjs'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/panel-keyboard'),observe=process.argv.includes('--observe');
(async()=>{
 await fs.mkdir(output,{recursive:true});const b=await target.launch(chromium),checks=[],failures=[],errors=[],external=[];
 const hash=v=>crypto.createHash('sha256').update(v).digest('hex'),index=await fs.readFile('apps/web/client/dist/index.html'),asset=index.toString().match(/src="(\/assets\/index-[^"]+\.js)"/)[1],build={asset,index_sha256:hash(index),js_sha256:hash(await fs.readFile('apps/web/client/dist'+asset))};
 try{
  const p=await b.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
  const ready=()=>p.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length),paint=()=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  async function check(name,ok,details){checks.push({name,ok,details});if(!ok)failures.push(name);}
  await p.goto(base);await ready();await p.locator('#panel-toggle').click();assert.equal(await p.locator('#explore').isVisible(),false);
  const tabs=[];for(let i=0;i<8;i++){await p.keyboard.press('Tab');tabs.push(await p.evaluate(()=>({id:document.activeElement.id,inPanel:!!document.activeElement.closest('#explore')})));}
  await check('collapsed controls do not appear in keyboard traversal',tabs.every(t=>!t.inPanel),tabs);
  await p.locator('#panel-toggle').focus();await p.setViewportSize({width:768,height:1024});await paint();
  const wide=await p.evaluate(()=>({panel:getComputedStyle(document.querySelector('#explore')).display,focus:document.activeElement.id,toggle:getComputedStyle(document.querySelector('#panel-toggle')).display,collapsed:document.querySelector('.atlas-panel-collapsed')!==null}));
  await check('expanding beyond compact layout restores panel and removes inaccessible collapsed state',wide.panel!=='none'&&!wide.collapsed,wide);
  await check('hidden compact toggle returns keyboard focus to visible search',wide.focus==='search',wide);await p.screenshot({path:path.join(output,'desktop-after-collapse.png')});
  await p.setViewportSize({width:390,height:844});await p.goto(base);await ready();await p.locator('#search').fill('沈阳北站');await p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).press('Enter');await p.locator('.feature-title').waitFor();
  await p.locator('#panel-toggle').click();assert.equal(await p.locator('#explore').isVisible(),false);await p.locator('#detail-close').click();
  const closed=await p.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,canvas:document.activeElement.classList.contains('maplibregl-canvas')}));await check('closing details with hidden search returns focus to usable map canvas',closed.canvas,closed);
  await p.locator('#panel-toggle').click();await check('reopening panel preserves prior search text',await p.locator('#search').inputValue()==='沈阳北站');
  await p.locator('#panel-toggle').click();await p.locator('.maplibregl-canvas').focus();await p.setViewportSize({width:1440,height:1000});await paint();
  await check('desktop transition preserves an already focused map',await p.evaluate(()=>document.activeElement.classList.contains('maplibregl-canvas')));
  const address=p.url();await p.evaluate(()=>window.__panelCanvas=document.querySelector('.maplibregl-canvas'));
  await p.setViewportSize({width:700,height:844});await paint();await p.locator('#panel-toggle').click();await p.setViewportSize({width:701,height:844});await paint();
  await check('exact 700 to 701 breakpoint restores panel without replacing canvas or changing view',await p.locator('#explore').isVisible()&&p.url()===address&&await p.evaluate(()=>window.__panelCanvas===document.querySelector('.maplibregl-canvas')));
  await p.setViewportSize({width:390,height:844});await paint();await check('returning to compact layout starts with available search controls',await p.locator('#explore').isVisible()&&await p.locator('#search').inputValue()==='沈阳北站');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(hash(await fs.readFile('apps/web/client/dist/index.html')),build.index_sha256);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),build,browser_target:await target.describe(b),checks,failures,errors,external,mode:observe?'observation':'validation',scope:'Real CSS breakpoint change after collapse; keyboard traversal/focus and source selection on installed browser. Not physical rotation, OS reader/IME, full resize combinations or all N09.'},null,2));console.log(JSON.stringify({checks:checks.length,failures}));if(!observe)assert.equal(failures.length,0);
 }catch(e){await target.failure(b,e,{checks,failures,errors,external});throw e;}finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
