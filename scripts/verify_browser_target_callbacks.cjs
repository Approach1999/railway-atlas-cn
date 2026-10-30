/* Minimal adapter for the three hook-free browser_target.test.cjs callbacks.
 * This is explicitly not a node:test runner or application unit-suite result. */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
async function verifyBrowserTargetCallbacks(){
 const filename=path.join(__dirname,'browser_target.test.cjs'),source=await fs.readFile(filename,'utf8'),req=createRequire(filename),callbacks=[];
 const register=(name,body)=>{if(typeof name!=='string'||typeof body!=='function')throw Error('Only named hook-free callbacks supported');callbacks.push({name,body});};
 new Function('require',source)(name=>name==='node:test'?register:req(name));
 if(callbacks.length!==3)throw Error('Reassess adapter if tests change');
 const checks=[];for(const callback of callbacks){await callback.body();checks.push({name:callback.name,passed:true});}
 const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
 return {date:new Date().toISOString(),source_sha256:hash(source),helper_sha256:hash(await fs.readFile(path.join(__dirname,'browser_target.cjs'))),checks,scope:'Exact existing assertions run via minimal callback registration adapter; no hooks, subprocess isolation, node:test runner or application unit-suite claim.'};
}
module.exports={verifyBrowserTargetCallbacks};
if(require.main===module)verifyBrowserTargetCallbacks().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;});
