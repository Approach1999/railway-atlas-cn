/* Isolated browser response mutation: recreate the rejected zoom expression.
 * The production bundle and published data remain untouched. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const requireCompleteStyle=require('./benchmark_style_guard.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const cases=[];
  try{
    for(const broken of [false,true]){
      const context=await browser.newContext(),page=await context.newPage();let replacements=0;
      const external=[];page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
      await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
      if(broken)await page.route('**/assets/index-*.js',async route=>{
        const response=await route.fetch();let body=await response.text();
        body=body.replace(/"line-width":([\w$]+)\((2\.2|4\.4)\)/g,(_,fn,extra)=>{
          replacements++;return '"line-width":["+",'+fn+'(),'+extra+']';
        });
        await route.fulfill({response,body});
      });
      await page.goto(base+'/?snapshot=shenyang-mvp-20261023');
      await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
      const mark=await page.evaluate(()=>performance.getEntriesByName('atlas:first-usable')[0].detail);
      if(broken){
        assert.equal(replacements,2,'mutate the casing and urban-boundary width recipes exactly once each');
        assert.equal(mark.style_layers.missing.length,17);
        assert.throws(()=>requireCompleteStyle(mark.style_layers),/missing actual style layers/);
      }else requireCompleteStyle(mark.style_layers);
      assert.deepEqual(external,[]);
      cases.push({broken_zoom_expression:broken,replacements,rendered_tracks:mark.rendered_tracks,
        style_layers:mark.style_layers,guard:broken?'rejected':'accepted'});
      await context.close();
    }
    const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/track-style-performance');
    await fs.mkdir(output,{recursive:true});
    await fs.writeFile(path.join(output,'style-layer-guard.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),cases},null,2));
    console.log('Actual browser guard accepted complete layers and rejected 17 missing layers.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
