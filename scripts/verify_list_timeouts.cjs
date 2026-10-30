/* Real production timeout, local HTTP fixtures; no public basemap requests. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/list-timeouts');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[],checks=[];
  try{
    const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
    await p.addInitScript(()=>{
      localStorage.setItem('railway-atlas:basemap:v1','false');
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};
    });
    let holdIndex=true,holdDetail=true,releaseIndex,releaseDetail;
    await p.route('**/objects.json',async route=>{
      if(holdIndex)await new Promise(resolve=>releaseIndex=resolve);
      await route.continue().catch(()=>{});
    });
    await p.route('**/details/*.json',async route=>{
      if(holdDetail)await new Promise(resolve=>releaseDetail=resolve);
      await route.continue().catch(()=>{});
    });
    await p.goto(base);
    await p.getByRole('button',{name:'重试列表',exact:true}).waitFor({timeout:22000});
    assert.match(await p.locator('#accessible-explorer').innerText(),/读取超时/);
    holdIndex=false;releaseIndex();
    await p.getByRole('button',{name:'重试列表',exact:true}).click();
    await p.locator('#list-query').fill('node/676578837');
    await p.locator('.object-list button').click();
    checks.push('15-second index timeout offers retry and retry restores records');
    await p.getByRole('button',{name:'重试记录详情',exact:true}).waitFor({timeout:22000});
    assert.match(await p.locator('.list-record').innerText(),/读取超时/);
    assert.equal(await p.locator('.object-list button').count(),1);
    holdDetail=false;releaseDetail();
    await p.getByRole('button',{name:'重试记录详情',exact:true}).click();
    await p.locator('.list-record h3').filter({hasText:'沈阳北'}).waitFor();
    checks.push('15-second detail timeout preserves results and independently retries');
    await p.getByRole('button',{name:'关闭要素列表',exact:true}).click();
    holdIndex=true;releaseIndex=undefined;
    await p.getByRole('button',{name:'打开要素列表',exact:true}).click();
    await p.waitForFunction(()=>document.querySelector('#accessible-explorer')?.innerText.includes('正在读取要素列表'));
    while(!releaseIndex)await new Promise(resolve=>setTimeout(resolve,20));
    await p.getByRole('button',{name:'关闭要素列表',exact:true}).click();
    holdIndex=false;releaseIndex();
    await p.getByRole('button',{name:'打开要素列表',exact:true}).click();
    await p.locator('#accessible-explorer [role=status]').filter({hasText:/找到 [1-9]\d* 条记录/}).waitFor();
    assert.equal(await p.getByRole('button',{name:'重试列表',exact:true}).count(),0);
    checks.push('closing a pending list and reopening does not publish cancelled request errors');
    assert.deepEqual(errors,[]);
    const report={date:new Date().toISOString(),server_url:base,checks,errors,scope:'Local Chrome with WebGL disabled and held index/detail requests; does not establish cause of historical concurrent facility timeout'};
    await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
