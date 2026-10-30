/* Explicit installed browser selection for functional checks, not performance. */
const assert=require('node:assert/strict'),os=require('node:os');
function options(env=process.env){
  const channel=env.ATLAS_BROWSER_CHANNEL||'chrome',renderer=env.ATLAS_TEST_RENDERER||'software';
  assert(['chrome','msedge'].includes(channel),'choose installed chrome or msedge explicitly');
  assert(['software','default'].includes(renderer),'known test renderer required');
  return {channel,headless:true,args:['--enable-automation',...(renderer==='software'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]};
}
async function launch(chromium){return chromium.launch(options());}
async function describe(browser,env=process.env){
  const session=await browser.newBrowserCDPSession();
  try{
    const version=await session.send('Browser.getVersion'),command=await session.send('Browser.getBrowserCommandLine'),selected=options(env);
    const executable=command.arguments[0];assert(executable.toLowerCase().endsWith(selected.channel==='msedge'?'msedge.exe':'chrome.exe'),'actual executable must match requested browser');
    return {channel:selected.channel,version:browser.version(),executable,product:version.product,user_agent:version.userAgent,
      renderer:selected.args.includes('--use-angle=swiftshader')?'forced SwiftShader':'default',headless:true,os:{platform:os.platform(),release:os.release(),arch:os.arch()},
      limits:'Installed version only, isolated profile, synthetic keyboard/composition/clipboard where used; not recent-two-version, reader or physical-device acceptance.'};
  }finally{await session.detach();}
}
async function failure(browser,error,extra){
  const fs=require('node:fs/promises'),path=require('node:path'),output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/browser-failure');
  await fs.mkdir(output,{recursive:true});const states=[];
  for(const [index,page] of browser.contexts().flatMap(c=>c.pages()).entries()){
    if(page.isClosed())continue;
    const result=await Promise.allSettled([page.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,9000),focus:document.activeElement?.outerHTML.slice(0,1200)})),page.screenshot({path:path.join(output,'failure-'+index+'.png')})]);
    states.push(result[0].status==='fulfilled'?result[0].value:{error:String(result[0].reason)});
  }
  await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({date:new Date().toISOString(),error:String(error),...extra,states},null,2));
}
module.exports={options,launch,describe,failure};
