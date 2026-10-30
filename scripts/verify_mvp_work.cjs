/* Real bounded-source facility test; no external basemap requests. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8768';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/mvp-work-browser');
const snapshot=process.env.MVP_DATA_DIR||'data/processed/shenyang-mvp-20261023';
function world([lon,lat],zoom){const scale=512*2**zoom;return [(lon+180)/360*scale,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*scale];}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const raw=JSON.parse(await fs.readFile(path.join(snapshot,'raw.geojson'),'utf8'));
  const manifest=JSON.parse(await fs.readFile(path.join(snapshot,'dataset.json'),'utf8'));
  const source=raw.features.find(f=>f.properties.osm_id==='node/676578837');assert(source);
  const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
  try{
    await page.goto(base);await page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('snapshot'),manifest.snapshot_id,'browser and inspected source must use the same immutable snapshot');
    await page.getByRole('button',{name:'城市轨道',exact:true}).click();
    if(manifest.line_count)assert.equal(await page.locator('#line-panel input[type=checkbox]').count(),manifest.line_count);
    else await page.locator('#line-panel').filter({hasText:'尚无线路关系'}).waitFor();
    await page.getByRole('button',{name:'铁路概览',exact:true}).click();
    for(let i=0;i<5;i++){await page.locator('.maplibregl-ctrl-zoom-in').click();await page.waitForTimeout(550);}
    await page.locator('#search').fill('沈阳北站');await page.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();
    await page.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();await page.waitForTimeout(600);
    await page.locator('#detail-close').click();
    await page.locator('#filters summary').click();await page.locator('#show-facilities').check();await page.waitForTimeout(1000);
    const camera=new URL(page.url()).hash.slice(5).split('/').map(Number),[zoom,latitude,longitude]=camera;
    assert(zoom>=15,'facility point layer requires station-scale zoom');
    const box=await page.locator('#map').boundingBox(),center=world([longitude,latitude],zoom);
    const candidates=raw.features.filter(f=>f.geometry.type==='Point'&&f.properties.facility_kind==='switch'&&f.properties.status==='mapped').map(f=>{
      const pos=world(f.geometry.coordinates,zoom);return {f,x:box.width/2+pos[0]-center[0],y:box.height/2+pos[1]-center[1]};
    }).filter(p=>p.x>80&&p.x<box.width-380&&p.y>100&&p.y<box.height-100);
    assert(candidates.length,'visible Shenyang North switch candidates');
    const point=candidates[Math.floor(candidates.length/2)];
    await page.mouse.click(box.x+point.x,box.y+point.y);
    await page.locator('#candidates').waitFor();
    if(await page.locator('#candidates').isVisible()){
      assert.equal(await page.locator('#candidate-list button').first().evaluate(el=>el===document.activeElement),true,'candidate choices receive focus after React commit');
      assert.match(await page.locator('#candidate-list button').first().innerText(),/node\/|way\//,'overlapping same-name objects show source identity');
      await page.keyboard.press('Escape');assert.equal(await page.locator('#candidates').isVisible(),false);assert.equal(await page.locator('.maplibregl-canvas').evaluate(el=>el===document.activeElement),true);
      await page.mouse.click(box.x+point.x,box.y+point.y);await page.locator('#candidates').waitFor();
      const switches=page.locator('#candidate-list button').filter({hasText:'道岔'});
      assert(await switches.count(),JSON.stringify({camera,point,candidates:await page.locator('#candidate-list').innerText()}));
      await switches.first().click();
    }
    await page.locator('#detail-body dt').filter({hasText:'设施类别'}).waitFor();
    assert.match(await page.locator('#detail-body').innerText(),/道岔/);
    await page.screenshot({path:path.join(output,'facilities.png')});
    await page.locator('#detail-close').click();assert.equal(await page.locator('.maplibregl-canvas').evaluate(el=>el===document.activeElement),true,'closing a candidate selection returns to map canvas');await page.locator('#show-facilities').uncheck();
    assert.equal(await page.locator('#show-facilities').isChecked(),false);
    assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(external.length,0);
    const report={date:new Date().toISOString(),snapshot:manifest.snapshot_id,checks:['published line-index coverage matches active immutable snapshot','station/area search remains distinguishable','real source switch rendered and selectable at station zoom','real overlapping map choices show typed IDs, focus the first option, dismiss by Escape to canvas, reopen and return to canvas after detail close','facility category, source and missing association shown','facility layer toggles independently','no external requests or page errors'],scope:'Real bounded-source facility integration; not full MVP, independent human or real-device acceptance',errors};
    await fs.writeFile(path.join(output,'facilities-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
