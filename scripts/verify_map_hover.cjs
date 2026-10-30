/* Actual source geometry, real pointer movement, no external raster traffic. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/map-hover');
const dataDir=process.env.MVP_DATA_DIR||'data/processed/shenyang-mvp-20261023';
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const raw=JSON.parse(await fs.readFile(path.join(dataDir,'raw.geojson'),'utf8'));
  const manifest=JSON.parse(await fs.readFile(path.join(dataDir,'dataset.json'),'utf8'));
  const station=raw.features.find(f=>f.properties.osm_id==='node/676578837');assert(station);
  const point=raw.features.filter(f=>f.geometry.type==='Point'&&f.properties.facility_kind==='switch'&&f.properties.status==='mapped').sort((a,b)=>Math.hypot(a.geometry.coordinates[0]-station.geometry.coordinates[0],a.geometry.coordinates[1]-station.geometry.coordinates[1])-Math.hypot(b.geometry.coordinates[0]-station.geometry.coordinates[0],b.geometry.coordinates[1]-station.geometry.coordinates[1]))[0];assert(point);
  const [lon,lat]=point.geometry.coordinates;
  const address=base+'/?snapshot='+manifest.snapshot_id+'&facilities=1#map=16.00/'+lat.toFixed(5)+'/'+lon.toFixed(5);
  const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[],external=[];
  async function page(options={}){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));return p;}
  async function ready(p,request=address){await p.goto(request);await p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();await p.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await p.waitForTimeout(250);}
  async function center(p){const box=await p.locator('.maplibregl-canvas').boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2};}
  async function hover(p,pos){await p.mouse.move(pos.x,pos.y);await p.locator('#map-hover').waitFor();}
  try{
    const p=await page();await ready(p);let detailRequests=0;p.on('request',r=>{if(/\/details\//.test(r.url()))detailRequests++;});
    const pos=await center(p),before=p.url(),focus=await p.evaluate(()=>document.activeElement.tagName);await hover(p,pos);
    const tip=p.locator('#map-hover');assert.match(await tip.innerText(),/道岔/);assert.match(await tip.innerText(),new RegExp(point.properties.osm_id));assert.equal(await tip.locator('.hover-item').count()<=3,true);assert.match(await tip.innerText(),/此处有 \d+ 项/);assert.equal(p.url(),before);assert.equal(await p.locator('#feature-panel').isVisible(),false);assert.equal(await p.evaluate(()=>document.activeElement.tagName),focus);assert.equal(detailRequests,0);await p.screenshot({path:path.join(output,'desktop.png')});
    checks.push('real switch and overlapping tracks preview names, kinds, lifecycle and typed IDs; bounded preview reports total without fetching detail, selecting, moving camera or changing focus/URL');
    const box=await tip.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+12);await p.waitForTimeout(300);assert.equal(await tip.isVisible(),true);await p.mouse.move(50,180);await tip.waitFor({state:'hidden'});checks.push('pointer can enter and read the preview without it disappearing; leaving both map target and preview dismisses it');
    await hover(p,pos);await p.keyboard.press('Escape');assert.equal(await tip.count(),0);assert.equal(p.url(),before);await p.locator('.maplibregl-canvas').dispatchEvent('pointermove',{pointerType:'mouse',clientX:pos.x,clientY:pos.y,buttons:0});await p.waitForTimeout(80);assert.equal(await tip.count(),0);await p.mouse.move(50,180);await p.waitForTimeout(220);await hover(p,pos);checks.push('Escape dismisses preview without changing the map and the same stationary target stays dismissed until leaving/reentering');
    await p.mouse.down();await p.mouse.move(pos.x+80,pos.y+30,{steps:5});assert.equal(await tip.count(),0);await p.mouse.up();await p.waitForTimeout(200);assert.notEqual(new URL(p.url()).hash,new URL(before).hash);checks.push('dragging dismisses the preview and map pan remains usable');
    await ready(p);const again=await center(p);await hover(p,again);await p.mouse.click(again.x,again.y);await p.locator('#candidates').waitFor();assert.equal(await tip.count(),0);assert.match(await p.locator('#candidate-list').innerText(),new RegExp(point.properties.osm_id));await p.locator('#candidate-list button').filter({hasText:point.properties.osm_id}).click();await p.locator('.feature-title').waitFor();assert.equal(new URL(p.url()).searchParams.get('feature'),point.properties.osm_id);checks.push('hover does not intercept the original map hit; clicking exposes all candidates and opens the actual source facility');
    {
      const edge=await page();await ready(edge);const rect=await edge.locator('.maplibregl-canvas').boundingBox(),zoom=16,scale=512*2**zoom;
      const desired={x:rect.width-80,y:rect.height-65},wx=(lon+180)/360*scale-(desired.x-rect.width/2),wy=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*scale-(desired.y-rect.height/2);
      const centerLon=wx/scale*360-180,centerLat=Math.atan(Math.sinh(Math.PI*(1-2*wy/scale)))*180/Math.PI;
      await ready(edge,base+'/?snapshot='+manifest.snapshot_id+'&facilities=1#map=16.00/'+centerLat.toFixed(5)+'/'+centerLon.toFixed(5));await hover(edge,{x:rect.x+desired.x,y:rect.y+desired.y});
      const bounds=await edge.locator('#map-hover').boundingBox();assert(bounds.x>=8&&bounds.y>=8&&bounds.x+bounds.width<=1440-7&&bounds.y+bounds.height<=1000-7);assert.match(await edge.locator('#map-hover').innerText(),new RegExp(point.properties.osm_id));await edge.screenshot({path:path.join(output,'edge.png')});await edge.close();checks.push('actual source at the bottom-right map edge keeps its whole preview within viewport bounds');
    }
    {
      const stationPage=await page(),[stationLon,stationLat]=station.geometry.coordinates;await ready(stationPage,base+'/?snapshot='+manifest.snapshot_id+'#map=16.00/'+stationLat.toFixed(5)+'/'+stationLon.toFixed(5));await hover(stationPage,await center(stationPage));assert.match(await stationPage.locator('#map-hover').innerText(),/沈阳北/);assert.match(await stationPage.locator('#map-hover').innerText(),new RegExp(station.properties.osm_id));assert.match(await stationPage.locator('#map-hover').innerText(),/铁路.*车站/);await stationPage.getByRole('button',{name:'城市轨道',exact:true}).click();await stationPage.locator('#map-hover').waitFor({state:'hidden'});await stationPage.close();checks.push('actual named railway station preview distinguishes station kind and clears when filters change');
    }
    const touch=await page({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await ready(touch);const target=await center(touch);await touch.touchscreen.tap(target.x,target.y);await touch.waitForFunction(()=>!document.querySelector('#candidates')?.hidden||!document.querySelector('#feature-panel')?.hidden);assert.equal(await touch.locator('#map-hover').count(),0);checks.push('simulated touch opens a selection in one tap without hover dependency');await touch.close();
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const report={date:new Date().toISOString(),snapshot:manifest.snapshot_id,source:point.properties.osm_id,checks,errors,external,scope:'Local Chrome, real source geometry and pointer events; simulated touch, not real-device, screen-reader or complete MVP acceptance'};await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
