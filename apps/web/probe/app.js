/* Bounded Shenyang map preview. Tracks are tiled; details load only on selection. */
import * as maplibregl from '/vendor/maplibre-gl.mjs';
import {DEFAULTS,CLASS_LABELS,MODE_LABELS,STATUS_LABELS,PRESET_LABELS,findStations,stationVisible,trackFilter} from '/model.mjs';
const $=id=>document.getElementById(id);
const empty=()=>({type:'FeatureCollection',features:[]});
let state={...DEFAULTS},previous=null,stations=empty(),manifest,palette,selected=null,selectionGeneration=0,ready=false,composing=false,searchTimer,activeResult=-1,lastTrigger=null;
let resultFeatures=[];
const detailCache=new Map(),layerSpecs=[];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const map=new maplibregl.Map({container:'map',center:[123.42,41.80],zoom:10.5,minZoom:8,maxZoom:18,
  localIdeographFontFamily:'Microsoft YaHei, PingFang SC, sans-serif',attributionControl:false,
  style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#f0f3ed'}}]}});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
map.addControl(new maplibregl.ScaleControl({unit:'metric'}),'bottom-left');
map.addControl(new maplibregl.AttributionControl({compact:false,customAttribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL'}),'bottom-right');

const textPaint={'text-color':'#203b44','text-halo-color':'#f9fbf6','text-halo-width':1.8};
const font=['Microsoft YaHei','sans-serif'];
async function getJSON(url){const r=await fetch(url);if(!r.ok)throw Error(`读取失败（${r.status}）`);return r.json();}
function say(message){$('status').textContent=message;}
function notice(message){$('map-notice').hidden=!message;$('map-notice').textContent=message;}
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function colors(){return ['match',['get','line_class'],...Object.entries(palette.class_palette).flatMap(([k,v])=>[k,v.color]),'#8a8f98'];}
function lineWidth(){return ['interpolate',['linear'],['zoom'],8,['match',['get','line_class'],'high_speed',1.8,'conventional_main',1.4,1],14,['match',['get','line_class'],'high_speed',4,'conventional_main',3.2,'branch',1.6,'industrial',1.4,2.4],18,5];}
function addTrackLayers(){
  for(const minor of [false,true])for(const lifecycle of ['mapped','other']){
    const suffix=`${minor?'minor':'major'}-${lifecycle}`;
    const color=lifecycle==='mapped'?colors():['match',['get','status'],'construction',colors(),'proposed',colors(),'disused','#899190','#8c7965'];
    const spec={minor,lifecycle};layerSpecs.push({id:`casing-${suffix}`,...spec},{id:`track-${suffix}`,...spec});
    map.addLayer({id:`casing-${suffix}`,type:'line',source:'tracks','source-layer':'rail_tracks',minzoom:minor?12:8,filter:trackFilter(state,spec),layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#fff','line-width':['+',lineWidth(),2.2],'line-opacity':.85}});
    map.addLayer({id:`track-${suffix}`,type:'line',source:'tracks','source-layer':'rail_tracks',minzoom:minor?12:8,filter:trackFilter(state,spec),layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':color,'line-width':lineWidth(),...(lifecycle==='mapped'?{}:{'line-dasharray':[3,2],'line-opacity':.7})}});
  }
  map.addSource('selection',{type:'geojson',data:empty()});
  map.addLayer({id:'selected-halo',type:'line',source:'selection',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#fff','line-width':10}});
  map.addLayer({id:'selected-track',type:'line',source:'selection',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#154e9d','line-width':7,'line-opacity':.55}});
  map.addLayer({id:'selected-color',type:'line',source:'selection',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':colors(),'line-width':3}});
  map.addSource('stations',{type:'geojson',data:empty(),promoteId:'osm_id'});
  map.addLayer({id:'station-dots',type:'circle',source:'stations',paint:{'circle-radius':['case',['==',['get','label_priority'],0],5,3.5],'circle-color':'#fff','circle-stroke-width':2,'circle-stroke-color':['case',['==',['get','rail_mode'],'subway'],'#8657a6','#1f5a8a']}});
  map.addLayer({id:'selected-station',type:'circle',source:'selection',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':8,'circle-color':'#fff','circle-stroke-color':'#154e9d','circle-stroke-width':3}});
  map.addLayer({id:'selected-name',type:'symbol',source:'selection',filter:['==',['geometry-type'],'Point'],layout:{'text-field':['get','display_name'],'text-font':font,'text-size':15,'text-anchor':'bottom','text-offset':[0,-1.1],'text-padding':6},paint:textPaint});
  for(const major of [true,false])map.addLayer({id:major?'major-station-names':'station-names',type:'symbol',source:'stations',minzoom:major?8:12,filter:major?['==',['get','label_priority'],0]:['!=',['get','label_priority'],0],layout:{'text-field':['get','label_name'],'text-font':font,'text-size':major?14:12,'text-variable-anchor':['top','bottom','left','right'],'text-radial-offset':.8,'text-padding':5,'symbol-sort-key':['get','label_priority']},paint:textPaint});
  map.addLayer({id:'line-names',type:'symbol',source:'tracks','source-layer':'rail_tracks',minzoom:9,filter:['all',trackFilter(state),['!=',['get','display_name'],'']],layout:{'symbol-placement':'line','symbol-spacing':350,'text-field':['get','display_name'],'text-font':font,'text-size':12,'text-max-angle':30,'text-padding':5,'text-keep-upright':true},paint:{...textPaint,'text-color':'#506975'}});
}
// Place station symbols above line labels so collisions favor station names.
function prioritizeLabels(){for(const id of ['line-names','station-names','major-station-names','selected-name'])map.moveLayer(id);}
function currentStations(){return stations.features.map((f,i)=>({...f,id:i})).filter(f=>stationVisible(f.properties,state)&&f.properties.osm_id!==selected?.properties.osm_id).map(f=>{
  const p=f.properties;
  return {...f,properties:{...p,label_name:p.display_name+(p.rail_mode==='subway'?' · 地铁':'')}};
});}
function updateLayers(){if(!ready)return;
  layerSpecs.forEach(spec=>map.setFilter(spec.id,trackFilter(state,spec)));
  map.setFilter('line-names',['all',trackFilter(state),['!=',['get','display_name'],'']]);
  map.setLayoutProperty('line-names','visibility',state.lineNames?'visible':'none');
  for(const id of ['major-station-names','station-names'])map.setLayoutProperty(id,'visibility',state.stationNames?'visible':'none');
  map.getSource('stations').setData({type:'FeatureCollection',features:currentStations()});
  $('filter-summary').textContent=`${PRESET_LABELS[state.preset]} · ${state.history?'含建设 / 规划 / 历史':'仅当前标注'}${state.preset==='highspeed'||state.preset==='conventional'?' · 车站不推断线路等级':''}`;
  document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===state.preset)));
  for(const [id,key] of [['show-history','history'],['show-sidings','sidings'],['show-lines','lineNames'],['show-stations','stationNames']])$(id).checked=state[key];
  renderLegend();search();updateNotice();
}
function renderLegend(){const box=$('legend');box.replaceChildren();
  const classes=state.preset==='urban'?['metro','light_rail','tram']:state.preset==='highspeed'?['high_speed']:state.preset==='conventional'?['conventional_main','conventional_other']:['high_speed','conventional_main','conventional_other',...(state.sidings?['branch','industrial']:[])];
  for(const key of classes){const entry=palette.class_palette[key];const row=node('div',undefined,'legend-row');const sw=node('span',undefined,'swatch');sw.style.borderColor=entry.color;row.append(sw,node('span',entry.label));if(['branch','industrial'].includes(key))row.append(node('small','放大后显示'));box.append(row);}
  const stationRow=node('div',undefined,'legend-row');stationRow.append(node('span','○'),node('span','车站 / 乘降所'));box.append(stationRow);
  if(state.history){const row=node('div',undefined,'legend-row');const sw=node('span',undefined,'swatch dash');row.append(sw,node('span','建设 / 规划 / 历史标注'));box.append(row);}
}
function setPreset(preset){previous={...state};state={...DEFAULTS,preset};$('undo').hidden=false;clearSelection(false);updateLayers();say(`已切换为${PRESET_LABELS[preset]}，可撤销。`);}
function updateNotice(){
  if(selected?.properties.feature_kind==='station'&&!stationVisible(selected.properties,state)){notice('此车站为搜索中临时显示，关闭详情后恢复原筛选。');return;}
  const b=map.getBounds(),[w,s,e,n]=manifest.bbox;
  if(b.getEast()<w||b.getWest()>e||b.getNorth()<s||b.getSouth()>n){notice('当前数据未覆盖此处，可点击“回到试验区”。');return;}
  if(state.preset==='highspeed'&&!manifest.class_counts.high_speed){notice('本次样本没有显式高速标注，不能按名称或限速猜测。');return;}
  notice('');
}
function search(){if(composing)return;const term=$('search').value;const list=$('results');list.replaceChildren();activeResult=-1;$('search').removeAttribute('aria-activedescendant');
  resultFeatures=findStations(stations.features,term);$('search').setAttribute('aria-expanded',String(resultFeatures.length>0));
  if(!term.trim())return;
  resultFeatures.slice(0,20).forEach((f,i)=>{const p=f.properties,b=node('button');b.id=`result-${i}`;b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.append(node('span',p.display_name||'未命名车站'),node('small',`${MODE_LABELS[p.rail_mode]||'制式未标注'} · ${stationVisible(p,state)?'沈阳试验区':'当前筛选已隐藏 · 点击临时显示'}`));b.onclick=()=>selectFeature(f,{focus:true,trigger:b});list.append(b);});
  if(!resultFeatures.length)list.append(node('p','当前区域没有匹配记录，请试试“沈阳”或检查名称。','hint'));
  if(resultFeatures.length>20)list.append(node('p','匹配超过 20 条，请补充名称。','hint'));
}
async function fullFeature(feature){if(feature.properties.tags)return feature;
  const key=feature.properties.osm_id;const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));const shard=new Uint8Array(hash)[0].toString(16).padStart(2,'0');
  if(!detailCache.has(shard))detailCache.set(shard,getJSON(`/details/${shard}.json`).catch(e=>{detailCache.delete(shard);throw e;}));
  const record=(await detailCache.get(shard))[key];if(!record)throw Error('该记录详情暂不可用');return record;
}
function selectionData(f){map.getSource('selection').setData(f?{type:'FeatureCollection',features:[f]}:empty());}
async function selectFeature(feature,{focus=false,trigger=null}={}){if(!feature)return;lastTrigger=trigger||document.activeElement;const token=++selectionGeneration;selected=feature;$('candidates').hidden=true;$('feature-panel').hidden=false;document.body.classList.add('detail-open');map.resize();selectionData(feature);map.getSource('stations').setData({type:'FeatureCollection',features:currentStations()});updateNotice();
  $('detail-body').replaceChildren(node('p','正在读取来源记录…','feature-note'));if(focus)focusOn(feature);else ensureVisible(feature);
  try{const full=await fullFeature(feature);if(token!==selectionGeneration)return;selected=full;selectionData(full);renderDetails(full);updateNotice();}
  catch(e){if(token!==selectionGeneration)return;$('detail-body').replaceChildren(node('p',e.message,'feature-note'));const retry=node('button','重试详情');retry.onclick=()=>selectFeature(feature);$('detail-body').append(retry);}
}
function renderDetails(f){const p=f.properties,box=$('detail-body');box.replaceChildren(node('h2',p.display_name||p.name||'未命名要素','feature-title'));const badges=node('div',undefined,'badges');
  badges.append(node('span',p.feature_kind==='station'?(MODE_LABELS[p.rail_mode]||'制式未标注'):(CLASS_LABELS[p.line_class]||'等级未标注'),'badge'),node('span',STATUS_LABELS[p.status]||p.status,'badge'));box.append(badges);
  box.append(node('p',p.feature_kind==='station'?'车站记录不按附近轨道推断高铁站或运营状态。':'轨道片段的名称与等级来自源标签，不等同于整条运营线路。','feature-note'));
  const rows=p.feature_kind==='station'?[['记录类别','车站 / 乘降所'],['制式',MODE_LABELS[p.rail_mode]||'未标注'],['车站编码',p.tags?.['railway:ref']]]:[['等级',CLASS_LABELS[p.line_class]],['名称来源',({'name:zh':'源中文名称',name:'源名称',missing:'未标注'})[p.name_source]],['分类依据',({'service-v1':'站场功能优先','industrial-v1':'显式工业用途','explicit-highspeed-v1':'显式高速标注','branch-v1':'显式支线用途','main-v1':'显式干线用途','rail-fallback-v1':'铁路标签，等级未标注','mode-v1':'显式轨道制式','ambiguous-values-v1':'标签多值，待复核'})[p.class_rule_id]||'待复核'],['用途',({main:'干线',branch:'支线',industrial:'工业用途'})[p.usage]||p.usage],['站场功能',({siding:'侧线',spur:'岔线',crossover:'渡线',yard:'站场线'})[p.service]||p.service],['显式高速',p.highspeed],['限速标注',p.maxspeed],['电气化',p.electrified]];
  const dl=node('dl');for(const [title,value] of rows){const row=node('div');row.append(node('dt',title),node('dd',value||'未标注'));dl.append(row);}box.append(dl);
  if(p.class_warnings?.length)box.append(node('p',p.class_warnings.join('；'),'feature-note'));
  const source=node('details');source.append(node('summary','数据来源与原始标注'));source.append(node('p',`源对象 ${p.osm_id} · ${manifest.snapshot_id}`,'feature-note'));
  if(p.mode_evidence)source.append(node('p',`制式核对：${p.mode_evidence}`,'feature-note'));
  const link=node('a','在 OpenStreetMap 查看记录 ↗');if(/^(node|way)\/\d+$/.test(p.osm_id)){link.href=`https://www.openstreetmap.org/${p.osm_id}`;link.target='_blank';link.rel='noopener noreferrer';source.append(link);}source.append(node('pre',JSON.stringify(p.tags||{},null,2)));box.append(source,node('p','地图数据 © OpenStreetMap contributors · 当前标注不保证运营。','feature-note'));
}
function clearSelection(restoreFocus=true){++selectionGeneration;selected=null;$('feature-panel').hidden=true;document.body.classList.remove('detail-open');map.resize();$('candidates').hidden=true;if(ready){selectionData(null);map.getSource('stations').setData({type:'FeatureCollection',features:currentStations()});}if(restoreFocus&&lastTrigger?.isConnected)lastTrigger.focus({preventScroll:true});if(ready)updateNotice();}
function anchor(f){const g=f.geometry;if(g.type==='Point')return g.coordinates;const points=g.type==='MultiLineString'?g.coordinates.flat():g.coordinates;return points[Math.floor(points.length/2)];}
function focusOn(f){const c=anchor(f);map.easeTo({center:c,zoom:f.geometry.type==='Point'?Math.max(map.getZoom(),13.5):map.getZoom(),offset:matchMedia('(max-width:700px)').matches?[0,-35]:[-150,0],duration:reduced?0:450});}
function ensureVisible(f){const c=anchor(f);const point=map.project(c),rect=map.getContainer().getBoundingClientRect();if(point.x>rect.width-365||point.y>rect.height-40||point.x<30||point.y<50)focusOn(f);}
function hitDistance(feature,point){
  const g=feature.geometry,lines=g.type==='Point'?[[g.coordinates]]:g.type==='MultiLineString'?g.coordinates:[g.coordinates];let best=Infinity;
  for(const line of lines){const pixels=line.map(c=>map.project(c));for(let i=0;i<pixels.length;i++){const a=pixels[i],b=pixels[i+1]||a,dx=b.x-a.x,dy=b.y-a.y;const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy));}}return best;
}
function showCandidates(features){const box=$('candidate-list');box.replaceChildren();features.forEach(f=>{const p=f.properties,b=node('button',`${p.display_name||p.name||'未命名轨道'} · ${p.feature_kind==='station'?(MODE_LABELS[p.rail_mode]||'制式未标注'):(CLASS_LABELS[p.line_class]||'等级未标注')}`);b.onclick=()=>selectFeature(f,{trigger:b});box.append(b);});$('candidates').hidden=false;box.querySelector('button')?.focus();}
map.on('load',async()=>{try{
  [manifest,palette,stations]=await Promise.all([getJSON('/dataset.json'),getJSON('/palette.json'),getJSON('/stations.geojson')]);
  const source=manifest.source;const time=source.osm_base?.osm_base||source.osm_base||source.osm_timestamp||source.source_time||'';
  $('source-date').textContent=time?`源数据 ${time.slice(0,10)}`:'源数据时间见关于数据';
  $('dataset-info').textContent=`源数据截至 ${time||'未标注'}。快照 ${manifest.snapshot_id}；分类规则 ${manifest.classification_version}；配色 ${manifest.palette_version}。来源：OpenStreetMap / Overpass 有界样本。`;
  map.addSource('tracks',{type:'vector',tiles:[`${location.origin}/tiles/{z}/{x}/{y}.pbf`],minzoom:8,maxzoom:14,bounds:manifest.tiles.bounds,promoteId:'osm_id'});
  const [w,s,e,n]=manifest.bbox;map.addSource('coverage',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[w,s],[e,s],[e,n],[w,n],[w,s]]}}});
  map.addLayer({id:'coverage',type:'line',source:'coverage',paint:{'line-color':'#b1bfb6','line-dasharray':[4,5],'line-width':1}});
  addTrackLayers();prioritizeLabels();ready=true;updateLayers();say('铁路地图已就绪。名称与属性来自源标签，点击可查看依据。');
}catch(e){say(`地图加载失败：${e.message}`);const retry=node('button','重新加载地图');retry.onclick=()=>location.reload();$('status').after(retry);}});
map.on('error',e=>{say('部分地图资源加载失败，可刷新重试。'+(e.error?.message||''));});
map.on('moveend',()=>{if(ready)updateNotice();});
map.on('click',e=>{if(!ready)return;const r=e.originalEvent.pointerType==='touch'||'touches' in e.originalEvent?12:6;
  const layers=['selected-station','selected-track','station-dots','selected-name','major-station-names','station-names','line-names',...layerSpecs.filter(s=>s.id.startsWith('track-')).map(s=>s.id)];
  const hit=map.queryRenderedFeatures([[e.point.x-r,e.point.y-r],[e.point.x+r,e.point.y+r]],{layers});const seen=new Set();const features=[];
  for(const f of hit){const key=f.properties.osm_id;if(!key||seen.has(key))continue;seen.add(key);features.push(stations.features.find(v=>v.id===key)||f);}
  features.sort((a,b)=>hitDistance(a,e.point)-hitDistance(b,e.point)||Number(b.geometry.type==='Point')-Number(a.geometry.type==='Point')||a.properties.osm_id.localeCompare(b.properties.osm_id));
  if(features.length===1)selectFeature(features[0]);else if(features.length)showCandidates(features);else $('candidates').hidden=true;
});
$('search').addEventListener('compositionstart',()=>{composing=true;clearTimeout(searchTimer);});
$('search').addEventListener('compositionend',()=>{composing=false;search();});
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(search,200);});
$('search').addEventListener('keydown',e=>{const buttons=[...$('results').querySelectorAll('button')];if(['ArrowDown','ArrowUp'].includes(e.key)&&buttons.length){e.preventDefault();activeResult=(activeResult+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons.forEach((b,i)=>b.setAttribute('aria-selected',String(i===activeResult)));$('search').setAttribute('aria-activedescendant',buttons[activeResult].id);buttons[activeResult].scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&buttons.length){e.preventDefault();buttons[Math.max(0,activeResult)].click();}});
$('search-clear').onclick=()=>{$('search').value='';search();$('search').focus();};
$('presets').onclick=e=>{const button=e.target.closest('[data-preset]');if(button&&ready)setPreset(button.dataset.preset);};
$('undo').onclick=()=>{if(!previous)return;state=previous;previous=null;$('undo').hidden=true;clearSelection(false);updateLayers();};
$('reset-filters').onclick=()=>setPreset('overview');
for(const [id,key] of [['show-history','history'],['show-sidings','sidings'],['show-lines','lineNames'],['show-stations','stationNames']])$(id).onchange=e=>{state[key]=e.target.checked;updateLayers();};
$('home').onclick=()=>{clearSelection(false);map.easeTo({center:[123.42,41.80],zoom:10.5,duration:reduced?0:500});};
$('detail-close').onclick=()=>clearSelection();$('candidate-close').onclick=()=>{$('candidates').hidden=true;map.getCanvas().focus();};
$('panel-toggle').onclick=()=>{const collapsed=document.body.classList.toggle('panel-collapsed');$('panel-toggle').textContent=collapsed?'打开面板':'收起面板';$('panel-toggle').setAttribute('aria-expanded',String(!collapsed));map.resize();};
$('about-open').onclick=()=>$('about').showModal();$('about-close').onclick=()=>$('about').close();
window.addEventListener('resize',()=>{map.resize();if(selected)ensureVisible(selected);});
document.addEventListener('keydown',e=>{if(e.key!=='Escape'||$('about').open)return;if(!$('candidates').hidden){$('candidates').hidden=true;return;}if(selected){clearSelection();return;}if($('search').value){$('search').value='';search();}});
