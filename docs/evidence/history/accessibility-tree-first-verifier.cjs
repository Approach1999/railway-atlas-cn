/* Observe Chromium's actual accessibility tree, not DOM attributes alone. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),target=require('./browser_target.cjs');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/accessibility-tree');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),properties=n=>Object.fromEntries((n.properties||[]).map(p=>[p.name,p.value.value]));
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),checks=[],scenes=[],errors=[],external=[];
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),cdp=await p.context().newCDPSession(p);await cdp.send('Accessibility.enable');
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
  async function ax(selector){const {root}=await cdp.send('DOM.getDocument',{depth:0}),{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});assert(nodeId,selector);const {node}=await cdp.send('DOM.describeNode',{nodeId});const {nodes}=await cdp.send('Accessibility.getPartialAXTree',{backendNodeId:node.backendNodeId,fetchRelatives:false});return nodes.find(n=>n.backendDOMNodeId===node.backendNodeId);}
  async function scene(name){const {nodes}=await cdp.send('Accessibility.getFullAXTree');const file=name+'.json';await fs.writeFile(path.join(output,file),JSON.stringify({nodes},null,2)+'\n');scenes.push({name,file,sha256:sha(await fs.readFile(path.join(output,file)))});return nodes;}
  function check(name,value){checks.push({name,passed:Boolean(value)});}
  await p.goto(base);await p.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length>0);
  const initial=await scene('initial'),mapRegions=initial.filter(n=>!n.ignored&&n.role?.value==='region'&&n.name?.value==='沈阳铁路地图');
  check('one named map region, without duplicate nested landmarks',mapRegions.length===1);
  const map=await ax('.maplibregl-canvas');check('map region exposes its keyboard instructions',!map.ignored&&map.role.value==='region'&&map.description?.value.includes('方向键'));
  const search=await ax('#search');check('search is a named collapsed combobox',!search.ignored&&search.role.value==='combobox'&&search.name.value==='查找车站'&&properties(search).expanded===false);
  const basemap=await ax('#basemap-toggle');check('basemap switch exposes its off state',!basemap.ignored&&basemap.role.value==='switch'&&properties(basemap).checked==='false');
  await p.locator('#search').fill('沈阳北站');await p.locator('#results [role=option]').first().waitFor();await p.locator('#search').press('ArrowDown');
  const expanded=await ax('#search'),activeId=await p.locator('#search').getAttribute('aria-activedescendant'),option=await ax('#'+activeId);
  check('expanded search exposes selected option with name and mode',properties(expanded).expanded===true&&!option.ignored&&option.role.value==='option'&&properties(option).selected===true&&option.name.value.includes('沈阳北')&&/铁路|地铁/.test(option.name.value));await scene('search-options');
  const railway=p.locator('#results [role=option]').filter({hasText:'铁路'}).filter({hasText:'站点'});await railway.click();await p.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
  const detail=await ax('#feature-panel'),title=await ax('.feature-title');check('feature details expose a named region and source heading',!detail.ignored&&detail.name.value==='要素详情'&&!title.ignored&&title.role.value==='heading'&&title.name.value.includes('沈阳北'));await scene('feature-detail');
  await p.locator('#share-open').click();const share=await ax('#share-dialog'),background=await ax('#search'),link=await ax('#share-link');
  check('share modal is named and background search is excluded',!share.ignored&&share.role.value==='dialog'&&share.name.value==='分享这幅铁路图'&&properties(share).modal===true&&background.ignored);
  check('share field has a name, URL value and focus',!link.ignored&&link.name.value==='分享链接'&&link.value.value.includes('feature=node%2F676578837')&&properties(link).focused===true);await scene('share-modal');
  await p.locator('#share-close').press('Escape');await p.locator('#list-open').click();await p.locator('.object-list button').first().waitFor();
  const list=await ax('#accessible-explorer'),listSearch=await ax('#list-query');check('list modal and search expose distinct meaningful names',!list.ignored&&list.role.value==='dialog'&&list.name.value==='车站与要素列表'&&!listSearch.ignored&&listSearch.name.value==='搜索名称、别名、设施类别或来源编号');await scene('list-modal');
  await p.getByRole('button',{name:'关闭要素列表',exact:true}).click();await p.locator('#detail-close').click();await p.locator('#advanced-filters summary').click();
  const checkbox=p.getByRole('checkbox',{name:'数据状态：建设',exact:true});await checkbox.check();const construction=await ax('input[aria-label="数据状态：建设"]');check('lifecycle checkbox exposes its name and checked state',!construction.ignored&&construction.role.value==='checkbox'&&construction.name.value==='数据状态：建设'&&properties(construction).checked==='true');await scene('checked-filter');
  const snapshot=new URL(p.url()).searchParams.get('snapshot');await p.goto(base+'/?snapshot='+snapshot+'&types=light_rail');await p.waitForFunction(()=>document.querySelector('#map-notice')?.textContent.includes('当前视野在这些筛选下没有可见要素'));
  const notice=await ax('#map-notice'),recovery=await ax('#map-notice button');check('empty view exposes a polite status and named recovery button',!notice.ignored&&notice.role.value==='status'&&properties(notice).live==='polite'&&!recovery.ignored&&recovery.role.value==='button'&&recovery.name.value==='恢复默认图层');await scene('empty-recovery');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const index=await fs.readFile('apps/web/client/dist/index.html'),asset=index.toString().match(/\/assets\/index-[^" ]+\.js/)[0],build={asset,index_sha256:sha(index),asset_sha256:sha(await fs.readFile('apps/web/client/dist'+asset))};
  const report={date:new Date().toISOString(),browser_target:await target.describe(browser),source_sha256:sha(await fs.readFile(__filename)),snapshot,build,checks,scenes,map_regions:mapRegions.map(n=>({nodeId:n.nodeId,backendDOMNodeId:n.backendDOMNodeId,name:n.name.value})),errors,external,scope:'Actual CDP accessibility trees, finite core tasks. Verifies exposed roles/names/state and modal exclusion, not NVDA/VoiceOver speech, reading order, user comprehension or full accessibility acceptance.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');const failed=checks.filter(c=>!c.passed);console.log(JSON.stringify({checks:checks.length,failed}));assert.deepEqual(failed,[]);
 }catch(error){await target.failure(browser,error,{checks,scenes});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
