const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8768';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/share-browser');
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],external=[],checks=[];
  const ready=page=>page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
  async function newPage(){const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));return p;}
  try{
    const page=await newPage();await page.goto(base);await ready(page);
    await page.getByRole('button',{name:'城市轨道',exact:true}).click();
    await page.locator('#search').fill('沈阳北站');await page.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();await page.locator('.feature-title').waitFor();await page.waitForTimeout(600);
    await page.goBack();await page.waitForTimeout(250);assert.equal(await page.locator('#feature-panel').isVisible(),false,'selection must preserve the previous unselected history entry');
    await page.goForward();await page.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
    checks.push('搜索选中不覆盖上一条历史，后退关闭详情、前进恢复详情');
    await page.locator('#filters summary').click();await page.locator('#show-facilities').check();
    await page.locator('#share-open').click();const link=await page.locator('#share-link').inputValue();
    const url=new URL(link);assert.equal(url.searchParams.get('feature'),'node/676578837');assert.equal(url.searchParams.get('facilities'),'1');assert(url.searchParams.get('snapshot'));assert(url.hash.startsWith('#map='));
    checks.push('分享编码快照、视图、查询、筛选、设施和 typed 要素身份');
    const shared=await newPage();await shared.goto(link);await ready(shared);await shared.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
    assert.equal(await shared.getByRole('button',{name:'城市轨道',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await shared.locator('#search').inputValue(),'沈阳北站');assert(await shared.locator('#show-facilities').isChecked());
    assert.match(await shared.locator('#map-notice').innerText(),/临时显示/);
    checks.push('新窗口通过不可变快照地址恢复同一视图，隐藏车站按分享例外显示');
    await shared.getByRole('button',{name:'仅普速',exact:true}).click();await shared.goBack();await shared.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
    assert.equal(await shared.getByRole('button',{name:'城市轨道',exact:true}).getAttribute('aria-pressed'),'true');
    await shared.goForward();await shared.waitForTimeout(500);assert.equal(await shared.getByRole('button',{name:'仅普速',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await shared.locator('#feature-panel').isVisible(),false);
    checks.push('前进/后退恢复筛选与选中对象，连续视图变化不会新增无意义历史');
    await shared.locator('#advanced-filters summary').click();await shared.getByRole('checkbox',{name:'数据状态：当前标注',exact:true}).uncheck();
    assert.match(await shared.locator('#map-notice').innerText(),/没有启用/);
    await shared.locator('#share-open').click();const emptyLink=await shared.locator('#share-link').inputValue();assert.equal(new URL(emptyLink).searchParams.get('states'),'');await shared.locator('#share-close').click();
    await shared.reload();await ready(shared);assert.match(await shared.locator('#map-notice').innerText(),/没有启用/);
    checks.push('状态全关不会被解释成全选，刷新保留明确的空筛选');
    const invalid=await newPage();await invalid.goto(base+'/?snapshot=..%2Fsecret&feature=javascript%3Aalert(1)&q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E#map=99/999/999');await ready(invalid);
    assert.match(await invalid.locator('#navigation-status').innerText(),/无效|越界/);assert.equal(await invalid.locator('img').count(),0);
    checks.push('无效路径、要素和越界视图回退；查询字符串作为文本处理');
    const missing=await newPage();await missing.goto(base+'/?region=shenyang&snapshot=not-present');await missing.getByRole('button',{name:'打开当前版本',exact:true}).waitFor();
    await missing.getByRole('button',{name:'打开当前版本',exact:true}).click();await ready(missing);
    checks.push('失效快照明确解释并可打开当前版本，不静默替换版本');
    assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(external.length,0);
    await fs.writeFile(path.join(output,'share-report.json'),JSON.stringify({date:new Date().toISOString(),checks,errors,scope:'Local share/navigation integration; not full MVP acceptance'},null,2));
    console.log(JSON.stringify({checks,errors},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
