/* Built client and the native probe module use the same checked shared rules. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/shared-rules-browser');
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const records=JSON.parse(await fs.readFile('data/processed/shenyang-mvp-20261023/objects.json','utf8')).records;
 const source=records.find(p=>p.rail_mode==='other');assert(source,'Actual other-mode record required');
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const checks=[],errors=[],external=[];
 try{
  for(const failMap of [false,true]){
   const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
   await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
   if(failMap)await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};});
   p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
   await p.goto(base+'/?snapshot=shenyang-mvp-20261023&feature='+encodeURIComponent(source.osm_id)+'&types=other&classes=unknown&states=mapped');
   if(!failMap){
    await p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();await p.locator('.feature-title').waitFor();
    const mode=p.locator('#detail-body dl div').filter({has:p.locator('dt').filter({hasText:/^制式$/})});
    assert.equal(await mode.locator('dd').innerText(),'其他轨道');
    await p.locator('#detail-close').click();await p.locator('#list-open').click();
   }else await p.locator('#accessible-explorer').waitFor();
   await p.locator('#list-query').fill(source.osm_id);
   const item=p.locator('.object-list button').filter({hasText:source.osm_id});await item.waitFor();
   await item.click();await p.locator('.list-record h3').waitFor();
   const mode=p.locator('.list-record dl div').filter({has:p.locator('dt').filter({hasText:/^制式$/})});
   assert.equal(await mode.locator('dd').innerText(),'其他轨道');
   await p.getByRole('button',{name:'关闭记录详情',exact:true}).click();
   await p.getByText('列表筛选',{exact:true}).click();
   const checkbox=p.getByRole('checkbox',{name:'列表轨道类型：其他轨道',exact:true});assert.equal(await checkbox.isChecked(),true);
   await checkbox.uncheck();await p.waitForFunction(()=>document.querySelectorAll('.object-list button').length===0);
   await checkbox.check();await item.waitFor();
   checks.push((failMap?'WebGL-failure list':'map and list')+': actual '+source.osm_id+' retains other-mode identity, Chinese label and independent filter');
   const native=await p.evaluate(async()=>{
    const model=await import('/model.mjs');
    return {label:model.MODE_LABELS.other,found:model.findStations([{id:'node/1',properties:{display_name:'测试站',aliases:['测试别名']}}],'测试别名').map(f=>f.id),filter:model.trackFilter({...model.DEFAULTS,preset:'urban'})};
   });
   assert.equal(native.label,'其他轨道');assert.deepEqual(native.found,['node/1']);assert.equal(native.filter[0],'all');
   checks.push('native browser probe module imports the checked .mjs directly and executes search/filter rules');
   await p.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={date:new Date().toISOString(),snapshot:'shenyang-mvp-20261023',source_record:source,checks,errors,external,
   scope:'Actual local record in built client and native-module probe, including simulated WebGL failure; not independent source classification, real reader or physical device acceptance.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
