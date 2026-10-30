/* Serial functional matrix against explicit installed browsers; no install or
 * profile reuse. Every passing result binds its actual executable and build. */
const fs=require('node:fs/promises'),stream=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const definitions={search:['verify_react_search.cjs','react-search-report.json'],filters:['verify_react_filters.cjs','react-filters-report.json'],list:['verify_accessibility.cjs','report.json'],share:['verify_react_share.cjs','report.json'],resources:['verify_resource_recovery.cjs','resource-recovery-report.json'],font:['verify_map_font.cjs','report.json']};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
  const channels=(process.env.ATLAS_BROWSER_CHANNELS||'chrome,msedge').split(','),suites=(process.env.ATLAS_TEST_SUITES||Object.keys(definitions).join(',')).split(',');
  assert(channels.every(c=>['chrome','msedge'].includes(c))&&new Set(channels).size===channels.length);
  assert(suites.every(s=>Object.hasOwn(definitions,s))&&new Set(suites).size===suites.length);
  const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/installed-browsers');await fs.mkdir(output,{recursive:true});
  const index=await fs.readFile('apps/web/client/dist/index.html'),asset=index.toString().match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  const result={started:new Date().toISOString(),runner_sha256:hash(await fs.readFile(__filename)),build:{asset,index_sha256:hash(index),asset_sha256:hash(await fs.readFile('apps/web/client/dist'+asset))},channels,suites,results:[],status:'running',scope:'Installed Chrome/Edge only; functional checks in isolated headless contexts; requested renderer recorded per result. No browser recent-two-version, Firefox/Safari, OS IME, clipboard-permission, reader or physical-device acceptance.'};
  const persist=()=>fs.writeFile(path.join(output,'matrix.json'),JSON.stringify(result,null,2)+'\n');await persist();
  for(const channel of channels)for(const suite of suites){
    const [script,filename]=definitions[suite],directory=path.join(output,channel,suite);await fs.mkdir(directory,{recursive:true});
    const logfile=path.join(directory,'process.log'),log=stream.createWriteStream(logfile);
    const started=new Date().toISOString();console.log(channel+'/'+suite+': started');
    const exit=await new Promise(resolve=>{
      const child=spawn(process.execPath,[path.join('scripts',script)],{env:{...process.env,PREVIEW_URL:process.env.PREVIEW_URL||'http://127.0.0.1:8766',PREVIEW_EVIDENCE:directory,ATLAS_BROWSER_CHANNEL:channel,ATLAS_TEST_RENDERER:process.env.ATLAS_TEST_RENDERER||'software'},stdio:['ignore','pipe','pipe']});
      child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
      child.once('error',error=>{log.write(String(error));resolve({code:null,error:String(error)});});child.once('close',(code,signal)=>resolve({code,signal}));
    });
    await new Promise(resolve=>log.end(resolve));
    const item={channel,suite,script,script_sha256:hash(await fs.readFile(path.join('scripts',script))),started,finished:new Date().toISOString(),exit,log:path.relative(output,logfile),status:'failed'};
    try{
      assert.equal(exit.code,0,'functional process must exit successfully');
      const bytes=await fs.readFile(path.join(directory,filename)),report=JSON.parse(bytes),target=report.browser_target;
      assert.equal(target.channel,channel);assert.equal(target.headless,true);assert(report.checks.length>0);assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);
      item.report=path.relative(output,path.join(directory,filename));item.report_sha256=hash(bytes);item.checks=report.checks.length;item.browser_target=target;item.status='passed';
    }catch(error){item.validation_error=String(error);}
    result.results.push(item);await persist();console.log(channel+'/'+suite+': '+item.status+(item.checks?' ('+item.checks+')':''));
  }
  assert.equal(hash(await fs.readFile('apps/web/client/dist/index.html')),result.build.index_sha256,'application build changed during matrix');
  assert.equal(hash(await fs.readFile('apps/web/client/dist'+asset)),result.build.asset_sha256,'application asset changed during matrix');
  result.status=result.results.every(r=>r.status==='passed')?'passed':'failed';result.finished=new Date().toISOString();await persist();
  console.log(JSON.stringify({status:result.status,suites:result.results.length,checks:result.results.reduce((n,r)=>n+(r.checks||0),0)}));
  if(result.status!=='passed')process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
