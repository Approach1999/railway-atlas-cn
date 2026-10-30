const test=require('node:test'),assert=require('node:assert/strict');
const {options,describe}=require('./browser_target.cjs');
test('default remains Chrome software; explicit Edge/default keeps its own target',()=>{
  assert.deepEqual(options({}),{channel:'chrome',headless:true,args:['--enable-automation','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  assert.deepEqual(options({ATLAS_BROWSER_CHANNEL:'msedge',ATLAS_TEST_RENDERER:'default'}),{channel:'msedge',headless:true,args:['--enable-automation']});
  assert.throws(()=>options({ATLAS_BROWSER_CHANNEL:'unknown'}));assert.throws(()=>options({ATLAS_TEST_RENDERER:'unknown'}));
});
test('reported version must bind to the selected real executable and session is closed on mismatch',async()=>{
  let detached=false;
  const browser={version:()=> 'fixture',newBrowserCDPSession:async()=>({send:async method=>method==='Browser.getVersion'?{product:'fixture',userAgent:'fixture'}:{arguments:['wrong.exe']},detach:async()=>{detached=true;}})};
  await assert.rejects(describe(browser),/executable/);assert(detached);
});
test('explicit description environment selects Edge without changing global process settings',async()=>{
  let detached=0;
  const browser={version:()=> 'fixture',newBrowserCDPSession:async()=>({send:async method=>method==='Browser.getVersion'?{product:'fixture',userAgent:'fixture'}:{arguments:['C:/fixture/msedge.exe']},detach:async()=>{detached++;}})};
  const report=await describe(browser,{ATLAS_BROWSER_CHANNEL:'msedge',ATLAS_TEST_RENDERER:'default'});
  assert.equal(report.channel,'msedge');assert.equal(report.renderer,'default');assert.equal(detached,1);
  await assert.rejects(describe(browser,{ATLAS_BROWSER_CHANNEL:'chrome'}),/executable/);assert.equal(detached,2);
});
