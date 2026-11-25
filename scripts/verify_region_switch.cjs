/* Region switching on real local snapshots; staged failures use fixture responses.
 * The basemap is kept off, so no public tile is requested. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/region-switch-browser');
const encode=value=>encodeURIComponent(value);
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const registry=JSON.parse(await fs.readFile('config/catalog.json','utf8'));
  const served=await (await fetch(base+'/catalog.json')).json();
  const [home,away]=registry.regions.map(region=>region.id);
  const info=id=>({profile:registry.regions.find(region=>region.id===id),entry:served.regions.find(region=>region.id===id)});
  const first=info(home),second=info(away);
  assert(first.entry&&second.entry,'both regions need a complete snapshot on this server to run this check');
  const view=profile=>`#map=${profile.default_view.zoom.toFixed(2)}/${profile.default_view.latitude.toFixed(5)}/${profile.default_view.longitude.toFixed(5)}`;
  const browser=await chromium.launch({channel:process.env.ATLAS_BROWSER_CHANNEL||'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],external=[],checks=[];
  async function page(options={viewport:{width:1440,height:1000}}){
    const p=await browser.newPage(options);p.setDefaultTimeout(25000);
    // Disable the basemap before any script runs; no public tile may be requested by this check.
    await p.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','false'));
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
    // Capture only, as in verify_line_label_levels.cjs: expose the map instance at the public addLayer call so
    // rendered features can be read. Layout, data and camera behaviour are left untouched.
    await p.route('**/assets/index-*.js',async route=>{
      const response=await route.fetch(),original=await response.text();
      const needle='addLayer(e,t){return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}';
      assert.equal(original.split(needle).length-1,1,'the map capture anchor must occur exactly once in the served bundle');
      await route.fulfill({response,body:original.replace(needle,'addLayer(e,t){globalThis.__atlasMap=this;return this._lazyInitEmptyStyle(),this.style.addLayer(e,t),this._update(!0)}')});
    });
    return p;
  }
  const ready=p=>p.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
  // Wait until the track source has loaded every tile, then read the tracks that are actually drawn.
  // A camera jump can read as loaded for an instant before the tiles of the new view start loading, so the
  // state must hold twice with the camera at rest, and the renderer is given a moment before anything is read.
  const loaded=p=>p.evaluate(()=>{const m=window.__atlasMap;return Boolean(m&&m.loaded()&&m.areTilesLoaded()&&m.isSourceLoaded('tracks')&&!m.isMoving());});
  const settled=async p=>{
    for(let attempt=0;attempt<60;attempt++){
      if(await loaded(p)){await p.waitForTimeout(700);if(await loaded(p)){await p.waitForTimeout(600);return;}}
      await p.waitForTimeout(250);
    }
    assert.fail('the map did not finish loading its tracks');
  };
  const drawnTracks=p=>p.evaluate(()=>{
    const m=window.__atlasMap,layers=m.getStyle().layers.filter(layer=>layer.id.startsWith('track-')).map(layer=>layer.id);
    const features=m.queryRenderedFeatures({layers});
    return {count:features.length,snapshots:[...new Set(features.map(feature=>feature.properties.snapshot_id))],
      classes:[...new Set(features.map(feature=>feature.properties.line_class))].sort()};
  });
  const assertDrawn=async(p,id)=>{
    await settled(p);const state=await drawnTracks(p);
    assert(state.count>0,'tracks of the shown region must be drawn');
    assert.deepEqual(state.snapshots,[info(id).entry.current_snapshot],'every drawn track must belong to the version of the shown region');
    return state;
  };
  // Switch status text lives inside the collapsed version panel, so wait for it to exist, not to be visible.
  const status=p=>p.locator('#dataset-switch-status');
  const switchedTo=(p,id)=>status(p).filter({hasText:'已切换到'+info(id).profile.name}).waitFor({state:'attached'});
  // The object index of a snapshot is read on demand; the list names the snapshot only once it has loaded.
  const listLoaded=p=>p.locator('#accessible-explorer').filter({hasText:'找到 '}).waitFor();
  const url=p=>new URL(p.url());
  const param=(p,name)=>url(p).searchParams.get(name);
  // The header shows a switch when the directory offers more than one region, otherwise the region name as plain text.
  const shownRegion=async p=>({switch:await p.locator('#region-switch').count()?await p.locator('#region-switch').inputValue():null,
    name:await p.locator('.region-name').count()?await p.locator('.region-name').innerText():null,title:await p.title(),caption:(await p.locator('.map-caption').innerText()).replace(/\s+/g,' '),
    headline:(await p.locator('#explore h1').innerText()).replace(/\s+/g,''),placeholder:await p.locator('#search').getAttribute('placeholder'),
    canvas:await p.locator('.maplibregl-canvas').getAttribute('aria-label'),
    pickerRegion:await p.locator('#dataset-region').count()?await p.locator('#dataset-region').inputValue():null,
    pickerVersion:await p.locator('#dataset-version').count()?await p.locator('#dataset-version').inputValue():null});
  // With a directory the version panel must agree with the region; without one it offers nothing.
  const assertShown=async(p,id,{directory=true}={})=>{
    const {profile,entry}=info(id),state=await shownRegion(p);
    assert(state.switch===id||(state.switch===null&&state.name===profile.name));assert.equal(state.title,'铁路图集 · '+profile.name);assert(state.caption.includes(profile.caption));
    assert.equal(state.headline,'沿着铁路线'+profile.ui.headline);assert.equal(state.placeholder,profile.ui.search_placeholder);
    assert.equal(state.canvas,profile.city+'铁路地图');
    assert.equal(state.pickerRegion,directory?id:null);assert.equal(state.pickerVersion,directory?entry.current_snapshot:null);
    for(const other of registry.regions.filter(region=>region.id!==id))assert(!JSON.stringify(state).includes(other.caption),'another region must not be named on the page chrome');
    assert.equal(param(p,'region'),id);assert.equal(param(p,'snapshot'),entry.current_snapshot);
  };
  try{
    // A. The default region opens as before, and the header offers every region that has data here.
    const p=await page();await p.goto(base);await ready(p);
    await assertShown(p,home);const homeTracks=await assertDrawn(p,home);
    assert.deepEqual(await p.locator('#region-switch option').evaluateAll(options=>options.map(option=>option.value)),served.regions.map(region=>region.id));
    assert.equal(await p.locator('#region-switch').getAttribute('aria-label'),'切换地区');
    checks.push('default region loads from the registry; the header switch lists exactly the regions the directory has data for');
    // B. Switching region keeps filters and the query, clears the selection, and evaluates everything against the new region.
    await p.getByRole('button',{name:'仅高速',exact:true}).click();await p.locator('#search').fill('沈阳北站');
    await p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).first().click();await p.locator('.feature-title').waitFor();
    await p.evaluate(()=>{window.__originalCanvas=document.querySelector('.maplibregl-canvas');});
    const requests=[];p.on('request',r=>requests.push({at:Date.now(),url:r.url()}));
    await p.locator('#region-switch').selectOption(away);await switchedTo(p,away);const completed=Date.now();
    await assertShown(p,away);const awayTracks=await assertDrawn(p,away);
    assert.equal(url(p).hash,view(second.profile));
    assert.equal(await p.locator('#feature-panel').isVisible(),false);assert.equal(await p.locator('.feature-title').count(),0);
    assert.equal(await p.locator('#search').inputValue(),'沈阳北站');assert.equal(await p.getByRole('button',{name:'仅高速',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await p.evaluate(()=>window.__originalCanvas===document.querySelector('.maplibregl-canvas')),true);
    assert.equal(await p.locator('#basemap-toggle').getAttribute('aria-checked'),'false');
    await p.locator('#search-status').filter({hasText:'当前区域没有匹配记录'}).waitFor();
    assert.match(await p.locator('#search-status').innerText(),new RegExp('请试试“'+second.profile.ui.search_example+'”'));
    assert.equal(await p.locator('#results button').count(),0);
    // Once the new region is in place, nothing may read the previous region's version any more.
    // Tiles requested before that moment belong to the view the user still had.
    await p.waitForTimeout(1200);await p.mouse.move(700,500);await p.mouse.wheel(0,-200);await p.waitForTimeout(1200);
    assert.deepEqual(requests.filter(request=>request.at>=completed&&request.url.includes('/snapshots/'+first.entry.current_snapshot)).map(request=>request.url),[]);
    await p.locator('#search').fill('金州');
    await p.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).first().click();await p.locator('.feature-title').filter({hasText:'金州'}).waitFor();
    assert.match(await p.locator('#results').innerText(),new RegExp(second.profile.name));
    await p.locator('#about-open').click();const about=await p.locator('#about').innerText();
    assert.match(about,new RegExp(second.profile.ui.about_scope));assert.match(about,new RegExp(second.entry.current_snapshot));assert(!about.includes(first.profile.ui.about_scope));
    // The provenance rows are inside a folded section; open it before reading.
    await p.locator('#about summary').filter({hasText:'当前版本的来源与处理记录'}).click();
    const provenance=await p.locator('#provenance-info').innerText();
    assert.match(provenance,new RegExp('试验区域\\s*'+second.profile.name));assert.match(provenance,new RegExp('范围说明\\s*'+second.profile.description));
    await p.locator('#about-close').click();
    checks.push(`a region switch keeps filters and the query, clears the selection, moves to the region default view, keeps the map instance and basemap preference, and never reads the previous region afterwards (${awayTracks.count} track features drawn at the default view, all from ${second.entry.current_snapshot}; ${homeTracks.count} from ${first.entry.current_snapshot} before)`);
    checks.push('after a switch the search, header, caption, headline, placeholder, canvas name, version panel and about text all describe the new region only');
    // J. Home returns to the default view of the region shown without touching its filters.
    await p.locator('#detail-close').click();await p.locator('.maplibregl-canvas').hover();await p.mouse.move(700,500);await p.mouse.down();await p.mouse.move(400,420,{steps:8});await p.mouse.up();
    await p.waitForFunction(lat=>location.hash.startsWith('#map=')&&!location.hash.includes(lat),second.profile.default_view.latitude.toFixed(5));
    await p.locator('#home').click();await p.waitForFunction(expected=>location.hash===expected,view(second.profile));
    assert.equal(await p.getByRole('button',{name:'仅高速',exact:true}).getAttribute('aria-pressed'),'true');
    checks.push('"回到试验区" restores the shown region default view and leaves its filters unchanged');
    // C. A share link made in the new region reopens that region, that version and the selected record.
    await p.getByRole('button',{name:'城市轨道',exact:true}).click();await p.locator('#search').fill('大连北站');
    await p.locator('#results button').filter({hasText:'地铁'}).first().click();await p.locator('.feature-title').waitFor();
    await p.locator('#share-open').click();const link=await p.locator('#share-link').inputValue();await p.locator('#share-close').click();
    const shared=new URL(link);assert.equal(shared.searchParams.get('region'),away);assert.equal(shared.searchParams.get('snapshot'),second.entry.current_snapshot);
    assert.equal(shared.searchParams.get('q'),'大连北站');assert.equal(shared.searchParams.get('types'),'light_rail,subway,tram');
    const receiver=await page();await receiver.goto(link);await ready(receiver);await receiver.locator('.feature-title').waitFor();
    assert.equal(await receiver.locator('#region-switch').inputValue(),away);assert.equal(param(receiver,'snapshot'),second.entry.current_snapshot);
    assert.equal(await receiver.locator('#dataset-version').inputValue(),second.entry.current_snapshot);assert.equal(url(receiver).hash,shared.hash);
    assert.equal(await receiver.locator('#search').inputValue(),'大连北站');
    checks.push('a share link carries the region, version, filters, query, camera and selected record, and reopens them in a new page');
    // Links that name a region without a version, an unknown region, or a mismatched version.
    const bare=await page();await bare.goto(base+'/?region='+away);await ready(bare);await assertShown(bare,away);assert.equal(url(bare).hash,view(second.profile));
    checks.push('a link naming only a region opens that region current version from the directory');
    const unknown=await page();await unknown.goto(base+'/?region=beijing');await ready(unknown);await assertShown(unknown,home);
    await unknown.locator('#navigation-status').filter({hasText:'暂无数据'}).waitFor();assert.match(await unknown.locator('#navigation-status').innerText(),new RegExp(first.profile.name));
    assert.equal(url(unknown).hash,view(first.profile));
    checks.push('an unpublished region is announced as having no data and the default region opens in its own default view; it is not shown as an empty map');
    const mixed=await page();await mixed.goto(base+'/?region='+away+'&snapshot='+first.entry.current_snapshot);await ready(mixed);await assertShown(mixed,home);
    await mixed.locator('#navigation-status').filter({hasText:'链接中的地区与此数据版本不一致'}).waitFor();
    checks.push('a link whose region and version disagree shows the region of the version and says so; the two are never mixed');
    await bare.close();await unknown.close();await mixed.close();await receiver.close();
    // F. Back and forward cross regions in place. Several entries made in the new region
    // (selection, filters) follow the switch, so step back until the region itself changes.
    let steps=0;
    while(param(p,'region')===away&&steps<10){await p.goBack();await p.waitForTimeout(500);steps++;}
    assert.equal(param(p,'region'),home);assert(steps<10);
    await p.waitForFunction(id=>document.querySelector('#region-switch')?.value===id,home);
    assert.equal(param(p,'snapshot'),first.entry.current_snapshot);await assertShown(p,home);await assertDrawn(p,home);
    // That entry was made while a Shenyang station was selected: going back restores it.
    await p.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();assert.equal(await p.locator('#search').inputValue(),'沈阳北站');
    await p.goForward();
    await p.waitForFunction(id=>new URL(location.href).searchParams.get('region')===id,away);
    await p.waitForFunction(id=>document.querySelector('#region-switch')?.value===id,away);assert.equal(param(p,'snapshot'),second.entry.current_snapshot);
    await assertShown(p,away);await assertDrawn(p,away);assert.equal(await p.locator('#feature-panel').isVisible(),false);
    assert.equal(await p.evaluate(()=>window.__originalCanvas===document.querySelector('.maplibregl-canvas')),true);
    checks.push('browser back and forward cross regions in place and restore the region, version, query and selection of each entry');
    // H. The text list follows the region of the address.
    await p.locator('#list-open').click();await listLoaded(p);
    assert.match(await p.locator('#accessible-explorer').innerText(),new RegExp(second.entry.current_snapshot));
    await p.locator('#list-query').fill('金州');await p.locator('.object-list button').filter({hasText:'金州'}).first().waitFor();
    await p.getByRole('button',{name:'关闭要素列表',exact:true}).click();
    const homeList=await page();await homeList.goto(base);await ready(homeList);await homeList.locator('#list-open').click();await listLoaded(homeList);
    await homeList.locator('#list-query').fill('金州');await homeList.locator('#accessible-explorer').filter({hasText:'没有符合当前搜索与筛选的记录'}).waitFor();
    await homeList.locator('#list-query').fill('沈阳北站');await homeList.locator('.object-list button').filter({hasText:'沈阳北站'}).first().waitFor();
    await homeList.close();
    checks.push('the text list reads the version of the address: a Dalian station is listed in Dalian and absent from the Shenyang list');
    // G. A line filter carried from another region is reported there and honoured once its region is shown.
    const carried=await page();await carried.goto(base+'/?region='+home+'&snapshot='+first.entry.current_snapshot+'&types=subway&lines='+encode(away+'-metro/1'));
    await ready(carried);await carried.locator('#map-notice').filter({hasText:'所选线路不在此快照'}).waitFor();
    await carried.locator('#region-switch').selectOption(away);await switchedTo(carried,away);
    await carried.locator('#line-panel').waitFor();assert.equal(await carried.locator('#line-panel .line-option input[aria-label="显示1号线"]').isChecked(),true);
    assert.equal(param(carried,'lines'),away+'-metro/1');
    // Once its own region is shown the same filter is valid, so the "not in this snapshot" notice is gone.
    await carried.locator('#map-notice').filter({hasText:'所选线路不在此快照'}).waitFor({state:'hidden'});
    checks.push('a retained line filter names a line the current region does not have and says so; the same filter applies once its region is shown');
    await carried.close();await p.close();
    // D. A failed region switch keeps the current region and everything on screen, and can be retried.
    const kept=await page();await kept.goto(base);await ready(kept);
    await kept.getByRole('button',{name:'仅高速',exact:true}).click();await kept.locator('#search').fill('沈阳北站');
    await kept.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).first().click();await kept.locator('.feature-title').waitFor();
    const before=kept.url();
    await kept.route('**/snapshots/'+second.entry.current_snapshot+'/palette.json',r=>r.fulfill({status:503,body:'unavailable'}));
    await kept.locator('#region-switch').selectOption(away);
    await status(kept).filter({hasText:'地区切换失败'}).waitFor({state:'attached'});
    await kept.locator('#map-notice').filter({hasText:'地区切换失败'}).waitFor();
    assert.equal(kept.url(),before);assert.equal(await kept.locator('#region-switch').inputValue(),home);
    assert.match(await kept.locator('.feature-title').innerText(),/沈阳北/);assert.equal(await kept.locator('#search').inputValue(),'沈阳北站');
    assert.equal(await kept.getByRole('button',{name:'仅高速',exact:true}).getAttribute('aria-pressed'),'true');
    await kept.getByRole('button',{name:'关闭提示',exact:true}).click();await kept.locator('#map-notice').waitFor({state:'hidden'});
    assert.equal(await kept.locator('.feature-title').count(),1);
    await kept.locator('#region-switch').selectOption(away);await kept.locator('#map-notice').filter({hasText:'地区切换失败'}).waitFor();
    await kept.unroute('**/snapshots/'+second.entry.current_snapshot+'/palette.json');
    await kept.getByRole('button',{name:'重试切换地区',exact:true}).click();await switchedTo(kept,away);await assertShown(kept,away);
    assert.equal(await kept.locator('#search').inputValue(),'沈阳北站');
    checks.push('a failed region switch keeps the region, address, camera, filters, query and selection, is announced with retry and dismiss controls, and the retry completes');
    await kept.close();
    // E. Cancelling a region switch cannot be undone by a delayed response.
    const cancel=await page();await cancel.goto(base);await ready(cancel);const origin=cancel.url();let release;const held=new Promise(resolve=>{release=resolve;});
    await cancel.route('**/snapshots/'+second.entry.current_snapshot+'/dataset.json',async route=>{await held;try{await route.continue();}catch{}});
    await cancel.locator('#region-switch').selectOption(away);await cancel.locator('#map-notice').filter({hasText:'正在切换地区'}).waitFor();
    await cancel.getByRole('button',{name:'取消切换地区',exact:true}).click();release();
    await status(cancel).filter({hasText:'已取消'}).waitFor({state:'attached'});
    await cancel.waitForTimeout(900);assert.equal(cancel.url(),origin);await assertShown(cancel,home);
    await cancel.locator('#map-notice').waitFor({state:'hidden'});
    checks.push('a region switch can be cancelled while it loads; a delayed response afterwards does not change the region');
    await cancel.close();
    // I. Without the directory the map stays usable, the header names the region without a switch, and retry restores it.
    const blind=await page();let fail=true;await blind.route('**/catalog.json',r=>fail?r.fulfill({status:503,body:'unavailable'}):r.continue());
    await blind.goto(base);await ready(blind);assert.equal(await blind.locator('#region-switch').count(),0);assert.equal(await blind.locator('.region-name').innerText(),first.profile.name);
    await blind.locator('#dataset-picker summary').click();await blind.getByRole('button',{name:'重试数据目录',exact:true}).waitFor();
    fail=false;await blind.getByRole('button',{name:'重试数据目录',exact:true}).click();await blind.locator('#region-switch').waitFor();
    assert.equal(await blind.locator('.region-name').count(),0);await assertShown(blind,home);
    checks.push('a directory failure leaves the map usable with the region named as plain text; retrying the directory brings back the switch');
    const unresolved=await page();await unresolved.route('**/catalog.json',r=>r.fulfill({status:503,body:'unavailable'}));
    await unresolved.goto(base+'/?region='+away);await ready(unresolved);await assertShown(unresolved,home,{directory:false});
    await unresolved.locator('#navigation-status').filter({hasText:'数据目录暂不可用'}).waitFor();
    assert.equal(url(unresolved).hash,view(first.profile));
    checks.push('a link naming a region without a version falls back to the default region and says the directory was unavailable, rather than guessing a version');
    await blind.close();await unresolved.close();
    // K. On a phone-width touch viewport the header switch keeps its size and nothing overflows.
    const phone=await page({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    await phone.goto(base);await ready(phone);
    const box=await phone.locator('#region-switch').boundingBox();assert(box&&box.height>=44&&box.width>=44);
    assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    const header=await phone.locator('header').boundingBox(),aboutButton=await phone.locator('#about-open').boundingBox();
    assert(aboutButton.x+aboutButton.width<=header.x+header.width+1&&box.x>=0);
    assert.equal(await phone.locator('#source-date').isVisible(),true);
    await assertDrawn(phone,home);
    await phone.screenshot({path:path.join(output,'phone-header-shenyang.png')});
    await phone.locator('#region-switch').selectOption(away);await switchedTo(phone,away);
    await assertDrawn(phone,away);
    const awayBox=await phone.locator('#region-switch').boundingBox();assert(awayBox&&awayBox.height>=44);
    assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    assert.equal(await phone.locator('#search').getAttribute('placeholder'),second.profile.ui.search_placeholder);
    await phone.screenshot({path:path.join(output,'phone-header-dalian.png')});
    await phone.locator('#list-open').click();await listLoaded(phone);
    assert.match(await phone.locator('#accessible-explorer').innerText(),new RegExp(second.entry.current_snapshot));
    checks.push('at 390x844 the header switch is a 44px target, the header does not overflow, and the bottom sheet and list follow the region');
    await phone.close();
    // L. Zoomed in on a station of the second region, its facilities draw once "站场与设施" is on, and only from its version.
    // The station is read from that region's own station index, so the view follows the data.
    const station=JSON.parse(await fs.readFile('data/processed/'+second.entry.current_snapshot+'/stations.geojson','utf8')).features.find(feature=>feature.properties.display_name==='大连北');
    assert(station&&station.geometry.type==='Point','the second region needs the station this check zooms in on');
    const yard=await page();await yard.goto(base+'/?region='+away+'#map=15.50/'+station.geometry.coordinates[1].toFixed(5)+'/'+station.geometry.coordinates[0].toFixed(5));await ready(yard);await settled(yard);
    const facilityLayers=['facility-points','facility-lines','facility-areas'];
    const facilities=()=>yard.evaluate(layers=>{
      const m=window.__atlasMap,features=m.queryRenderedFeatures({layers});
      // A feature that crosses a tile edge is returned once per tile, so objects are counted separately.
      return {count:features.length,objects:new Set(features.map(feature=>feature.properties.osm_id)).size,
        snapshots:[...new Set(features.map(feature=>feature.properties.snapshot_id))],
        kinds:[...new Set(features.map(feature=>feature.properties.facility_kind))].sort(),
        layers:m.getStyle().layers.filter(layer=>layer.id.startsWith('facility-')).map(layer=>layer.id+':'+layer.layout.visibility)};
    },facilityLayers);
    const hidden=await facilities();assert.equal(hidden.count,0);assert(hidden.layers.every(layer=>layer.endsWith(':none')));
    await yard.locator('#filters summary').click();await yard.locator('#show-facilities').check();
    await settled(yard);const shown=await facilities();
    assert(shown.layers.every(layer=>layer.endsWith(':visible')),'the facility layers must be shown once the option is on');
    // Points (switches, entrances, stop positions) and platforms are both present around this station in the source.
    assert(shown.kinds.includes('switch')&&shown.kinds.includes('platform'),'facility points and platforms must both be drawn');
    assert.deepEqual(shown.snapshots,[second.entry.current_snapshot],'every drawn facility must belong to the version of the shown region');
    await yard.screenshot({path:path.join(output,'station-facilities-dalian.png')});
    await yard.locator('#show-facilities').uncheck();await settled(yard);assert.equal((await facilities()).count,0);
    assert.equal(param(yard,'region'),away);assert.equal(param(yard,'snapshot'),second.entry.current_snapshot);
    assert(shown.objects>0&&shown.objects<=shown.count);
    checks.push(`zoomed in on ${station.properties.display_name}站 in ${second.profile.name}, "站场与设施" draws ${shown.objects} facility objects (${shown.count} rendered features: ${shown.kinds.join(', ')}) once it is on and none before or after, all from ${second.entry.current_snapshot}`);
    await yard.close();
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={date:new Date().toISOString(),server_url:base,browser:await browser.version(),regions:served.regions.map(region=>({id:region.id,snapshot:region.current_snapshot})),
      checks,errors,external_requests:external,scope:'Local Chrome region switching on real snapshots with fixture failures; not real-device, screen-reader, performance or MVP acceptance'};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
