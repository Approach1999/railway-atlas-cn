/* Real dated regional data; no fixture route geometries or public raster calls. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8775';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/real-route-browser');
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],external=[],checks=[];
  async function page(){const p=await browser.newPage({viewport:{width:1440,height:1000}});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});return p;}
  const ready=p=>p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
  try{
    const p=await page();await p.goto(base);await ready(p);const snapshot=new URL(p.url()).searchParams.get('snapshot');assert.equal(snapshot,'shenyang-mvp-20261023');
    const lines=await (await p.request.get(base+'/snapshots/'+snapshot+'/lines.json')).json();
    assert.equal(lines.lines.length,12);assert.equal(lines.lines.reduce((n,line)=>n+line.relation_ids.length,0),24);
    assert.deepEqual(lines.lines.filter(line=>line.mode==='subway').map(line=>line.ref),['1','2','3','4','9','10']);
    assert(lines.lines.every(line=>line.master_ids.length===1&&line.completeness==='members_present'&&line.identity_source==='route_master relation'));
    await p.getByRole('button',{name:'城市轨道',exact:true}).click();
    assert.equal(await p.locator('#line-panel input[type=checkbox]').count(),12);
    for(const line of lines.lines.filter(line=>line.mode==='subway')){
      const chip=p.locator('.line-option').filter({has:p.getByRole('checkbox',{name:'显示'+line.name,exact:true})}).locator('.line-chip');
      const expected=await p.evaluate(hex=>{const el=document.createElement('span');el.style.color=hex;return el.style.color;},line.color);
      assert.equal(await chip.evaluate(el=>el.style.backgroundColor),expected);
    }
    await p.waitForLoadState('networkidle');await p.waitForTimeout(800);await p.locator('#map').screenshot({path:path.join(output,'metro-map.png')});
    checks.push('24 real route directions grouped by 12 explicit route_master identities; six subway refs and configured swatches available');
    await p.getByRole('button',{name:'仅看2号线',exact:true}).click();await p.locator('#share-open').click();const link=await p.locator('#share-link').inputValue();assert.equal(new URL(link).searchParams.get('lines'),'shenyang-metro/2');await p.locator('#share-close').click();
    const shared=await page();await shared.goto(link);await ready(shared);assert(await shared.getByRole('checkbox',{name:'显示2号线',exact:true}).isChecked());assert.equal(await shared.getByRole('checkbox',{name:'显示4号线',exact:true}).isChecked(),false);
    await shared.locator('#search').fill('沈阳北站');await shared.locator('#results button').filter({hasText:'地铁'}).filter({hasText:'站点'}).click();await shared.locator('.feature-title').filter({hasText:'沈阳北站'}).waitFor();
    assert.match(await shared.locator('#detail-body').innerText(),/2号线 \/ 4号线/);assert.match(await shared.locator('#detail-body').innerText(),/明确站区与停靠位置关系/);
    await shared.locator('#detail-body summary').filter({hasText:'数据来源与原始标注'}).click();assert.match(await shared.locator('#detail-body').innerText(),/对象版本：3/);assert.match(await shared.locator('#detail-body').innerText(),/2025-01-14/);
    checks.push('single-line share restores selected filters; Shenyang North subway POI resolves lines 2/4 through explicit stop areas and retains actual object version/time');
    await shared.locator('#detail-close').click();await shared.locator('#dataset-picker summary').click();await shared.locator('#dataset-version').selectOption('shenyang-mvp-progress-20261022');await shared.getByRole('button',{name:'使用此版本',exact:true}).click();await shared.locator('#dataset-switch-status').filter({hasText:'已切换数据版本'}).waitFor();
    assert.match(await shared.locator('#map-notice').innerText(),/所选线路不在此快照/);await shared.getByRole('button',{name:'恢复全部线路',exact:true}).click();assert.equal(await shared.locator('#map-notice').isVisible(),false);
    checks.push('line filters survive version changes and missing old-snapshot identities have an explicit restore-all recovery');
    await p.locator('#about-open').click();assert.match(await p.locator('#dataset-info').innerText(),/Geofabrik/);assert.match(await p.locator('#dataset-info').innerText(),/2026-10-20/);await p.locator('#about summary').filter({hasText:'当前版本的来源与处理记录'}).click();assert.match(await p.locator('#provenance-info').innerText(),/修改集编号/);await p.locator('#about-close').click();
    checks.push('dated Geofabrik source and missing contributor/changeset metadata are disclosed accurately');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={date:new Date().toISOString(),server_url:base,snapshot,checks,errors,external,scope:'Real OSM relation membership and browser integration; complete source references do not establish complete current operating lines; full MVP acceptance remains outstanding'};
    await fs.writeFile(path.join(output,'real-routes-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
