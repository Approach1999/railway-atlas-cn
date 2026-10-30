/* Reject a fast-looking first view whose name generation failed. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const requireCompleteStyle=require('./benchmark_style_guard.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/name-readiness-guard');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const cases=[];let activeInvalid;
  try{
    for(const invalid of [false,true]){
      activeInvalid=invalid;
      const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
      if(invalid)await page.route('**/assets/index-*.js',async route=>{
        const response=await route.fetch(),original=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(original.split(needle).length-1,1);
        const body=original.replace(needle,'addLayer(e,t){if(e.id==="line-names"&&!this.__nameGuardInstalled){this.__nameGuardInstalled=true;const query=this.querySourceFeatures.bind(this);this.querySourceFeatures=(id,options)=>query(id,options).map(f=>id==="tracks"&&f.properties.feature_kind==="track"?{type:"Feature",geometry:f.geometry,properties:{...f.properties,display_name:123}}:f)}return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}');
        await route.fulfill({response,body});
      });
      await page.goto(base);await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
      const mark=await page.evaluate(()=>performance.getEntriesByName('atlas:first-usable')[0].detail);
      assert.equal(mark.style_layers.expected.length,41);assert.deepEqual(mark.style_layers.missing,[]);assert(mark.rendered_tracks>0);
      if(invalid){assert.equal(mark.name_labels.status,'error');await page.locator('[data-resource="labels"]').waitFor();assert.throws(()=>requireCompleteStyle(mark.style_layers,mark.name_labels),/failed or pending names/);}
      else requireCompleteStyle(mark.style_layers,mark.name_labels);
      cases.push({invalid_names:invalid,name_labels:mark.name_labels,layers:mark.style_layers.expected.length,tracks:mark.rendered_tracks,accepted:!invalid});await page.close();
    }
    await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),cases,scope:'Real browser ready/error name generation with all track/name layers installed. Invalid case mutates only the name consumer query; actual track source remains drawn. Not performance acceptance.'},null,2));console.log(JSON.stringify(cases));
  }catch(error){
    await fs.mkdir(output,{recursive:true});const states=await Promise.all(browser.contexts().flatMap(c=>c.pages()).map(p=>p.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,8000),marks:performance.getEntriesByType('mark').map(m=>({name:m.name,start:m.startTime,detail:m.detail}))})).catch(()=>null)));
    await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({date:new Date().toISOString(),error:String(error),activeInvalid,cases,states},null,2));throw error;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
