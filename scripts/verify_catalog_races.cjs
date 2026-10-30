/* Real snapshot staging with deliberately held requests and visible UI actions. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/catalog-races');
const current='shenyang-mvp-20261023',previous='shenyang-mvp-progress-20261022',alternate='shenyang-mvp-accessible-20261022';
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],external=[],checks=[],held=[],failedRequests=[];
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
    page.on('requestfailed',request=>failedRequests.push({url:request.url(),failure:request.failure()?.errorText}));
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.goto(base);await page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
    await page.locator('#search').fill('沈阳北站');await page.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();
    await page.locator('.feature-title').waitFor();
    const original=page.url();await page.locator('#dataset-picker summary').click();
    async function hold(snapshot){
      const seen=deferred(),release=deferred(),finished=deferred();held.push(release);
      const pattern='**/snapshots/'+snapshot+'/dataset.json';
      await page.route(pattern,async route=>{seen.resolve();await release.promise;try{await route.continue();}catch{}finally{finished.resolve();}});
      return {seen:seen.promise,release:release.resolve,finished:finished.promise,pattern};
    }
    async function choose(snapshot){await page.locator('#dataset-version').selectOption(snapshot);await page.getByRole('button',{name:'使用此版本',exact:true}).click();}
    async function seenRequest(wait){
      let timer;try{await Promise.race([wait,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Expected staged request did not arrive')),10000);})]);}finally{clearTimeout(timer);}
    }
    const first=await hold(previous);await choose(previous);await seenRequest(first.seen);
    assert.equal(page.url(),original);assert.equal(await page.locator('#feature-panel').isVisible(),true);
    await choose(alternate);await page.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();
    const committed=page.url();assert.equal(new URL(committed).searchParams.get('snapshot'),alternate);
    assert.equal(await page.locator('#search').inputValue(),'沈阳北站');assert.equal(await page.locator('#feature-panel').isVisible(),false);
    first.release();await seenRequest(first.finished);await page.waitForTimeout(300);
    assert.equal(page.url(),committed);assert.match(await page.locator('#dataset-switch-status').innerText(),/已切换数据版本/);
    checks.push('a held earlier version cannot overwrite a newer committed version or its success message after target replacement');
    await page.locator('#about-open').click();await page.locator('#about summary').filter({hasText:'当前版本的来源与处理记录'}).click();
    assert.match(await page.locator('#provenance-info').innerText(),new RegExp(alternate));await page.locator('#about-close').click();
    checks.push('the active manifest provenance agrees with the committed alternate snapshot, not only the address or picker');
    const second=await hold(current);await choose(current);await seenRequest(second.seen);
    await page.getByRole('button',{name:'取消切换',exact:true}).click();
    const cancelled=await page.locator('#dataset-switch-status').innerText();assert.match(cancelled,/已取消/);
    second.release();await seenRequest(second.finished);await page.waitForTimeout(300);
    assert.equal(page.url(),committed);assert.equal(await page.locator('#dataset-switch-status').innerText(),cancelled);
    assert.equal(await page.getByRole('button',{name:'取消切换',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'使用此版本',exact:true}).isEnabled(),true);
    checks.push('explicit cancellation retains the committed map/query, ignores the delayed completion, and leaves retry available');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'catalog-races.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),checks,original,committed,cancelled,failedRequests,errors,external},null,2));
    console.log(JSON.stringify({checks,failedRequests,errors,external},null,2));
  }finally{held.forEach(item=>item.resolve());await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
