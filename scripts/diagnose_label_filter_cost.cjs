/* Public API timings around real filter actions. Diagnostic, not acceptance. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const guard=require('./benchmark_style_guard.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/label-filter-cost');
(async()=>{
  const metadata=await (await fetch(base+'/dataset.json')).json(),snapshot=metadata.snapshot_id;assert.match(snapshot,/^[A-Za-z0-9_-]{1,80}$/);
  await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[],external=[],samples=[],network=[];let original_sha256,observeNetwork=false;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());if(observeNetwork)network.push({url:r.url(),time:Date.now()});});
    await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    await page.route('**/assets/index-*.js',async route=>{
      const response=await route.fetch(),body=await response.text(),needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';assert.equal(body.split(needle).length-1,1);
      original_sha256=crypto.createHash('sha256').update(body).digest('hex');
      await route.fulfill({response,body:body.replace(needle,'addLayer(e,t){globalThis.__costMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}')});
    });
    const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1250000,uploadThroughput:1250000,connectionType:'ethernet'});
    await page.goto(base+'/?snapshot='+snapshot+'#map=10.50/41.80000/123.42000');
    await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length);await page.waitForLoadState('networkidle');
    await page.evaluate(()=>{
      const m=window.__costMap,query=m.querySourceFeatures.bind(m),source=m.getSource('rail-line-labels'),setData=source.setData.bind(source);
      window.__cost=[];window.__sourceEvents=[];m.on('sourcedata',event=>window.__sourceEvents.push({source:event.sourceId,type:event.sourceDataType,time:performance.now(),loaded:event.isSourceLoaded}));
      m.querySourceFeatures=(id,options)=>{const start=performance.now(),result=query(id,options);if(id==='tracks')window.__cost.push({stage:'query',start,end:performance.now(),features:result.length});return result;};
      source.setData=data=>{const start=performance.now(),result=setData(data);window.__cost.push({stage:'submit',start,end:performance.now(),features:data.features.length});return result;};
      document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-filters',{detail:{active:true}}));
    });
    observeNetwork=true;
    for(let i=0;i<8;i++){
      const sample=await page.evaluate(preset=>new Promise((resolve,reject)=>{
        window.__cost=[];window.__sourceEvents=[];const start=performance.now(),before=performance.getEntriesByName('atlas:filters-applied').length;
        const timer=setTimeout(()=>{observer.disconnect();reject(Error('filter never settled'));},10000);
        const observer=new PerformanceObserver(list=>{
          const settled=list.getEntries().find(e=>e.name==='atlas:filters-settled'&&e.startTime>=start);if(!settled)return;
          observer.disconnect();clearTimeout(timer);
          const entries=performance.getEntriesByType('mark').filter(e=>e.detail?.revision===settled.detail.revision&&e.startTime>=start);
          resolve({preset,api:window.__cost,source_events:window.__sourceEvents.map(e=>({...e,ms:e.time-start})),stages:entries.map(e=>({name:e.name,ms:e.startTime-start,detail:e.detail}))});
        });observer.observe({type:'mark'});
        document.querySelector('[data-preset="'+preset+'"]').click();
        if(performance.getEntriesByName('atlas:filters-applied').length!==before+1){clearTimeout(timer);observer.disconnect();reject(Error('missing revision'));}
      }),i%2?'overview':'highspeed');
      for(const e of sample.stages)if(e.detail.style_layers)guard(e.detail.style_layers,e.detail.name_labels);
      samples.push(sample);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={date:new Date().toISOString(),browser:browser.version(),snapshot,original_sha256,samples,post_ready_requests:network,errors,external,scope:'Default GPU, 10Mbps/100ms, eight overview/highspeed switches, public querySourceFeatures/setData wrappers. No source/layout replacement; diagnostic timings are not an N02 benchmark.'};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(samples.map(s=>({preset:s.preset,api:s.api.map(a=>({...a,start:undefined,end:undefined,ms:a.end-a.start})),query_to_submit_ms:s.api.find(a=>a.stage==='submit')&&s.api.find(a=>a.stage==='query')?s.api.find(a=>a.stage==='submit').start-s.api.find(a=>a.stage==='query').end:null,stages:s.stages.map(e=>({name:e.name,ms:e.ms}))})),null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
