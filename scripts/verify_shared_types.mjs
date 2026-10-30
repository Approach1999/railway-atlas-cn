/* Ensure the compiler checks the shared implementation and rejects faulty copies. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=path.join(root,'apps/web/client/tsconfig.json');
const tsc=path.join(root,'apps/web/client/node_modules/typescript/bin/tsc');
const sourcePath=path.join(root,'apps/web/shared/model.mjs');
const normalize=value=>path.resolve(value).replaceAll('\\','/').toLowerCase();
function compile(project,extra=[]){
  const result=spawnSync(process.execPath,[tsc,'--project',project,'--pretty','false',...extra],{cwd:root,encoding:'utf8',timeout:30000});
  if(result.error)throw result.error;
  return {status:result.status,output:result.stdout+result.stderr};
}
const actual=compile(config);assert.equal(actual.status,0,actual.output);
const listed=compile(config,['--listFilesOnly']);assert.equal(listed.status,0,listed.output);
assert(listed.output.split(/\r?\n/).some(line=>normalize(line.trim())===normalize(sourcePath)),'Shared implementation is absent from compiler inputs');
assert(!listed.output.includes('model.d.mts'),'A declaration file is shadowing the implementation');
await assert.rejects(fs.access(path.join(root,'apps/web/shared/model.d.mts')));
const source=await fs.readFile(sourcePath,'utf8');
const work=await fs.mkdtemp(path.join(root,'data/manifests/local/shared-type-guard-'));
const relative=path.relative(work,path.join(root,'apps/web/shared/atlas-types.ts')).replaceAll('\\','/');
const relocated=source.replaceAll('./atlas-types.ts',relative);
const mutations=[
  ['bad-filter-return',relocated.replace('return filters;','return "invalid-filter";')],
  ['bad-opacity',relocated.replace('mapped:{opacity:1}','mapped:{opacity:"opaque"}')],
  ['missing-mode-label',relocated.replace("other:'其他轨道',rail:","rail:")],
];
const checks=[];
for(const [name,content] of mutations){
  assert.notEqual(content,relocated,'Mutation did not match source: '+name);
  const file=path.join(work,name+'.mjs'),project=path.join(work,name+'.json');
  await fs.writeFile(file,content);
  await fs.writeFile(project,JSON.stringify({extends:config,compilerOptions:{types:[]},include:[],files:[file]}));
  const result=compile(project);
  assert.notEqual(result.status,0,'Compiler accepted '+name);
  assert(result.output.includes(name+'.mjs'),result.output);
  assert.match(result.output,/TS(2322|2741)/,result.output);
  assert.doesNotMatch(result.output,/TS2307/,result.output);
  await fs.writeFile(path.join(work,name+'.diagnostics.txt'),result.output);
  checks.push({case:name,rejected:true,diagnostic_codes:[...new Set([...result.output.matchAll(/TS(\d+)/g)].map(m=>Number(m[1])))]});
}
const report={date:new Date().toISOString(),implementation_sha256:crypto.createHash('sha256').update(source).digest('hex'),
  config_sha256:crypto.createHash('sha256').update(await fs.readFile(config)).digest('hex'),
  implementation_in_compiler_inputs:true,no_shadow_declaration:true,strict_project_typecheck_passed:true,checks,
  scope:'Faults exist only in ignored copies. This checks compiler enforcement, not correctness of all railway rules.'};
await fs.writeFile(path.join(work,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,report:path.relative(root,path.join(work,'report.json'))},null,2));
