/* Observe public Map APIs in the built product; no source or style replacement. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const target=require('./browser_target.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/urban-boundary/native');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),checks=[],errors=[],external=[],captures=[];
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
  await p.route('**/assets/index-*.js',async route=>{
   const response=await route.fetch(),original=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';
   assert.equal(original.split(needle).length-1,1);
   const body=original.replace(needle,'addLayer(e,t){globalThis.__boundaryMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');
   captures.push({original_sha256:sha(original),observed_sha256:sha(body)});await route.fulfill({response,body});
  });
  const snapshot=(await (await fetch(base+'/dataset.json')).json()).snapshot_id;
  const address=extra=>base+'/?snapshot='+snapshot+extra+'#map=10.50/41.80000/123.42000';
  const settled=()=>p.waitForFunction(()=>window.__boundaryMap?.loaded()&&window.__boundaryMap.areTilesLoaded()&&window.__boundaryMap.isSourceLoaded('rail-line-labels'));
  async function check(name,enabled,lineKey){
   await settled();
   if(enabled)await p.waitForFunction(()=>window.__boundaryMap.queryRenderedFeatures({layers:['urban-boundary']}).length>0);
   const result=await p.evaluate(()=>{const m=window.__boundaryMap;return {filter:m.getFilter('urban-boundary'),rendered:m.queryRenderedFeatures({layers:['urban-boundary']}).map(f=>({mode:f.properties.rail_mode,line_tokens:f.properties.line_tokens}))};});
   if(!enabled){assert.deepEqual(result.filter,['literal',false]);assert.equal(result.rendered.length,0);}
   else{assert.notDeepEqual(result.filter,['literal',false]);assert(result.rendered.every(f=>['subway','light_rail','tram'].includes(f.mode)));if(lineKey)assert(result.rendered.every(f=>(f.line_tokens||'').includes('|'+lineKey+'|')));}
   checks.push({name,enabled,filter:result.filter,rendered_count:result.rendered.length});
  }
  await p.goto(address(''));await p.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
  for(const [name,preset] of [['铁路概览','overview'],['仅高速','highspeed'],['仅普速','conventional']]){await p.getByRole('button',{name,exact:true}).click();await check(preset,false);}
  await p.getByRole('button',{name:'城市轨道',exact:true}).click();await check('urban',true);
  await p.getByRole('button',{name:'仅看4号线',exact:true}).click();await check('isolated-line',true,'shenyang-metro/4');
  await p.getByRole('button',{name:'退出仅看此线',exact:true}).click();await check('exit-isolation',true);
  await p.goto(address('&types=rail,subway'));await check('mixed-custom',true);
  await p.goto(address('&types=rail'));await check('rail-only-custom',false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const index=await fs.readFile('apps/web/client/dist/index.html'),asset=index.toString().match(/\/assets\/index-[^" ]+\.js/)[0],build={asset,index_sha256:sha(index),asset_sha256:sha(await fs.readFile('apps/web/client/dist'+asset))};
  assert(captures.every(c=>c.original_sha256===build.asset_sha256));
  const report={date:new Date().toISOString(),browser_target:await target.describe(browser),source_sha256:sha(await fs.readFile(__filename)),snapshot,build,checks,errors,external,captures,scope:'Capture-only public Map object reference; native filters, real rendered urban tracks, mixed custom and temporary line isolation in installed browser. Not real device or visual/independent QA.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,browser:report.browser_target.version}));
 }catch(error){await target.failure(browser,error,{checks});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
