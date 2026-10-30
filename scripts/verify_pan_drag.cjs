const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const runDragPath=require('./pan_drag.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/drag-driver');
const world=([lon,lat],zoom)=>{const scale=512*2**zoom;return [(lon+180)/360*scale,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*scale];};
(async()=>{
  const stations=JSON.parse(await fs.readFile('data/processed/shenyang-mvp-20261023/stations.geojson','utf8'));
  const station=stations.features.find(feature=>feature.properties.osm_id==='node/676578837');assert(station);
  const [lon,lat]=station.geometry.coordinates;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.goto(base+'/?snapshot=shenyang-mvp-20261023#map=15.50/'+lat+'/'+lon);
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);await page.waitForLoadState('networkidle');
    const initial=world([lon,lat],15.5),moves=[];let expected=[...initial];
    for(const delta of [[240,120],[-240,-120]]){
      const driven=await runDragPath(page,{durationMs:1000,points:[[0,0],delta]});
      await page.mouse.move(driven.origin.x+delta[0],driven.origin.y+delta[1]);await page.waitForTimeout(250);await page.mouse.up();await page.waitForTimeout(250);
      const camera=new URL(page.url()).hash.slice(5).split('/').map(Number),actual=world([camera[2],camera[1]],camera[0]);
      expected=[expected[0]-delta[0],expected[1]-delta[1]];
      const error_css_px=Math.hypot(actual[0]-expected[0],actual[1]-expected[1]);
      assert.equal(camera[0],15.5);assert(error_css_px<2,'actual camera displacement must match the driver, not merely return to a static endpoint');
      moves.push({delta,samples:driven.path.length,expected_world:expected,actual_world:actual,error_css_px,url:page.url()});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await fs.mkdir(output,{recursive:true});
    await fs.writeFile(path.join(output,'drag-driver.json'),JSON.stringify({date:new Date().toISOString(),source_anchor:station.properties.osm_id,source_anchor_name:station.properties.display_name,moves,errors,external,scope:'Synthetic DOM drag is verified against actual URL camera displacement; not a real mouse/device acceptance.'},null,2));
    console.log(JSON.stringify(moves.map(({delta,error_css_px})=>({delta,error_css_px}))));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
