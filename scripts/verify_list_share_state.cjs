/* Real list state transitions; controlled clipboard promises, no OS clipboard writes. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const target=require('./browser_target.cjs'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/list-share-state'),observe=process.argv.includes('--observe');
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),checks=[],failures=[],errors=[],external=[];
 const hash=v=>crypto.createHash('sha256').update(v).digest('hex'),index=await fs.readFile('apps/web/client/dist/index.html'),js=index.toString().match(/src="(\/assets\/index-[^"]+\.js)"/)[1],build={js,index_sha256:hash(index),js_sha256:hash(await fs.readFile('apps/web/client/dist'+js))};
 try{
  const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  await p.addInitScript(()=>{
   localStorage.setItem('railway-atlas:basemap:v1','false');window.clipboardJobs=[];
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>new Promise((resolve,reject)=>window.clipboardJobs.push({text,resolve,reject}))}});
  });
  await p.goto(base);await p.locator('#list-open').tap();await p.locator('.object-list button').first().waitFor();
  const share=p.getByRole('button',{name:'复制当前视图与记录链接',exact:true});
  async function copy(){await share.tap();await p.locator('#list-share').waitFor();return p.locator('#list-share').inputValue();}
  async function settle(n,success){await p.evaluate(({n,success})=>{const job=window.clipboardJobs[n];success?job.resolve():job.reject(Error('fixture clipboard denial'));},{n,success});await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
  async function check(name,predicate){const ok=await predicate();checks.push({name,ok});if(!ok)failures.push(name);}
  const status=()=>p.locator('#accessible-explorer>p[role=status]').last().innerText();
  await p.locator('#list-query').fill('沈阳北站');await p.locator('.object-list button').filter({hasText:'node/676578837'}).tap();await p.locator('.list-record h3').waitFor();
  const first=await copy();assert.equal(new URL(first).searchParams.get('feature'),'node/676578837');
  await settle(0,true);await check('initial successful copy reports success',async()=>/链接已复制/.test(await status()));
  await p.getByRole('button',{name:'关闭记录详情',exact:true}).tap();
  await check('closing detail invalidates previously generated selected-object link',async()=>await p.locator('#list-share').count()===0&&await status()==='');
  const noSelection=await copy();assert.equal(new URL(noSelection).searchParams.has('feature'),false);
  await p.locator('.object-list button').filter({hasText:'node/676578837'}).tap();await p.locator('.list-record h3').waitFor();
  await check('selecting a record invalidates a link generated without selection',async()=>await p.locator('#list-share').count()===0&&await status()==='');
  await p.locator('#list-query').fill('node/676578837');
  await settle(1,false);await check('query change rejects late clipboard failure and removes old link',async()=>await p.locator('#list-share').count()===0&&await status()==='');
  await p.locator('.object-list button').tap();await p.locator('.list-record h3').waitFor();
  await copy();await p.keyboard.press('Escape');await p.locator('#list-open').tap();await p.locator('.object-list button').first().waitFor();
  await settle(2,true);await check('close and reopen rejects late clipboard success',async()=>await p.locator('#list-share').count()===0&&await status()==='');
  await copy();await copy();await settle(4,true);await settle(3,false);
  await check('older failed copy cannot replace newer successful copy status',async()=>/链接已复制/.test(await status()));
  const link=p.locator('#list-share'),box=await link.boundingBox();
  await check('generated share field meets touch size and fits dialog',async()=>box.width>=44&&box.height>=44&&await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  await copy();await settle(5,false);await check('current clipboard denial retains a selectable manual link',async()=>/请复制下方链接/.test(await status())&&await link.inputValue()!==''&&await link.getAttribute('readonly')!==null);
  await link.tap();await check('manual fallback selects the complete link',async()=>await link.evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length));
  await p.screenshot({path:path.join(output,'manual-link.png')});
  await p.getByRole('checkbox',{name:'包含设施记录',exact:true}).check();
  await check('filter change removes both old manual link and old status',async()=>await link.count()===0&&await status()==='');
  const updated=new URL(await copy());await settle(6,true);
  await check('next link reflects current filter and snapshot',async()=>updated.searchParams.get('facilities')==='1'&&updated.searchParams.get('snapshot')===new URL(first).searchParams.get('snapshot')&&/链接已复制/.test(await status()));
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(hash(await fs.readFile('apps/web/client/dist/index.html')),build.index_sha256);
  const report={date:new Date().toISOString(),build,browser_target:await target.describe(browser),mode:observe?'observation':'validation',checks,failures,errors,external,scope:'Real current list state and native touch events in 390px emulation with controlled clipboard promises. No OS clipboard, physical device or reader proof.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:checks.length,failures}));if(!observe)assert.equal(failures.length,0);
 }catch(e){await target.failure(browser,e,{checks,failures,errors,external});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
