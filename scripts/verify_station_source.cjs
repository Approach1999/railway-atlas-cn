/* Actual station rendering after cached source updates and selection changes. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/station-source');
(async()=>{
  const stations=JSON.parse(await fs.readFile('data/processed/shenyang-mvp-20261023/stations.geojson','utf8'));
  const station=stations.features.find(feature=>feature.properties.osm_id==='node/676578837');assert(station);
  const id=station.properties.osm_id,[lon,lat]=station.geometry.coordinates;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],external=[],checks=[];
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.goto(base+'/?snapshot=shenyang-mvp-20261023#map=15.50/'+lat+'/'+lon);
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
    const box=await page.locator('.maplibregl-canvas').boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2};
    async function hoverStation(){
      for(let attempt=0;attempt<8;attempt++){
        await page.mouse.move(point.x+30,point.y+30);await page.mouse.move(point.x,point.y);
        try{await page.locator('#map-hover').filter({hasText:id}).waitFor({timeout:400});return;}catch(error){if(attempt===7)throw error;}
      }
    }
    async function selectStation(){
      await page.mouse.click(point.x,point.y);
      if(await page.locator('#candidates').isVisible())await page.locator('#candidate-list button').filter({hasText:id}).click();
      await page.locator('.feature-title').filter({hasText:station.properties.display_name}).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('feature'),id);
    }
    await hoverStation();await selectStation();await page.locator('#detail-close').click();
    assert.equal(new URL(page.url()).searchParams.get('feature'),null);
    await hoverStation();await selectStation();await page.locator('#detail-close').click();await hoverStation();
    checks.push('actual station is rendered, selectable twice, and restored to the base source after each selection is cleared');
    await page.evaluate(()=>document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-filters',{detail:{active:true}})));
    await page.getByRole('button',{name:'城市轨道',exact:true}).click();
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:filters-settled').some(mark=>mark.detail.preset==='urban'));
    await page.mouse.move(point.x+30,point.y+30);await page.mouse.move(point.x,point.y);await page.waitForTimeout(150);
    assert(!(await page.locator('#map-hover').count())||!(await page.locator('#map-hover').innerText()).includes(id));
    checks.push('urban mode really removes the railway station from map picking, rather than retaining cached visible data');
    await page.getByRole('button',{name:'铁路概览',exact:true}).click();
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:filters-settled').some(mark=>mark.detail.preset==='overview'));
    await hoverStation();await selectStation();
    const marks=await page.evaluate(()=>performance.getEntriesByName('atlas:filters-settled').map(mark=>mark.detail));
    assert.deepEqual(marks.map(mark=>mark.station_source_updates),[1,2]);
    checks.push('returning to overview publishes stations again; each real mode change writes once and the same station can be selected');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),station:id,checks,marks,errors,external},null,2));
    console.log(JSON.stringify({checks,errors,external}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
