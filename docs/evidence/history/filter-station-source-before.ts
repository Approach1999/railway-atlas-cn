import * as maplibregl from 'maplibre-gl';
import type {ExpressionSpecification,GeoJSONSource} from 'maplibre-gl';
import type {FilterState,TrackSpec,TrackLayerSpec,RailFeature,RailProperties,DatasetManifest,Palette,LineIndex,LineRecord,Stations} from '../../shared/atlas-types.ts';
import type {ResourceIssue,ResourceKey} from './resources.ts';
import type {ShareFilters,ShareView} from './view-state.ts';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {createMapMotion} from './map-motion';
import {createMapFeedback,sourceDateLabel} from './map-feedback';
import {trackWidth as lineWidth} from './track-width';
maplibregl.setWorkerUrl(workerUrl);
import {DEFAULTS,STATUS_STYLES,PRESET_LABELS,FILTER_STATES,expandedState,trackVisible,overlayVisible,overlayFilter,trackFilter} from '../../shared/model.mjs';
import {decodeView,encodeView} from './view-state.ts';
import {loadDataset,validateManifest,validatePalette,validateStations,validateLines} from './dataset.ts';
import {neutralPalette} from './resources.ts';
import {validateRailFeature} from './dataset-validation.ts';
import {decodeTileFeature} from './tile-feature.ts';
import {createRailwayControls,type FilterAction} from './railway-controls.ts';
import {createStationSearch} from './station-search.ts';
import {createFeaturePanels} from './feature-details.ts';
import {captureShareContext} from './share-session.ts';
import {contrastingCasing} from './contrast.ts';
import {resolveLinePaint,paletteColorExpression} from './palette-colours.ts';
import {createMapHover,hoverItems} from './map-hover.ts';
interface AtlasOptions {onMapFailure?:(message:string)=>void;onDatasetChanged?:(snapshot:string)=>void;onResourceIssue?:(issue:ResourceIssue)=>void}
type Events=HTMLElementEventMap&WindowEventMap&DocumentEventMap&{webglcontextlost:Event;'atlas:profile-frames':CustomEvent<unknown>;'atlas:profile-filters':CustomEvent<unknown>};
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'数据读取失败';
const errorName=(error:unknown)=>error instanceof Error?error.name:'';
const httpStatus=(error:unknown)=>error instanceof Error&&'status' in error?error.status:undefined;
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
function failedTile(event:unknown):{x:number;y:number;z:number}|null{
  if(!record(event)||!record(event.tile)||!record(event.tile.tileID)||!record(event.tile.tileID.canonical))return null;
  const {x,y,z}=event.tile.tileID.canonical;
  if(typeof x!=='number'||typeof y!=='number'||typeof z!=='number'||!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(z)||z<0||z>22||x<0||y<0||x>=2**z||y>=2**z)return null;
  return {x,y,z};
}

// The proven renderer is retained as an isolated imperative controller.
export function mountAtlas(root:HTMLElement,{onMapFailure=()=>{},onDatasetChanged=()=>{},onResourceIssue=()=>{}}:AtlasOptions={}){
/* Bounded Shenyang map preview. Tracks are tiled; details load only on selection. */
const abort=new AbortController();let disposed=false;
const cleanups:Array<()=>void>=[];
function listen<Key extends keyof Events>(target:EventTarget,event:Key,handler:(event:Events[Key])=>void){const listener=handler as EventListener;target.addEventListener(event,listener);cleanups.push(()=>target.removeEventListener(event,listener));}
const empty=():Stations=>({type:'FeatureCollection',features:[]});
const initial=decodeView(location.href),hasLinkedState=Boolean(location.search||location.hash);
const featurePanels=createFeaturePanels();
const feedback=createMapFeedback();
const hover=createMapHover();let hoverFrame=0;
const stationSearch=createStationSearch(initial.view.query,{onCommit:()=>writeView('replace')});
let restoring=true,restoreGeneration=0,datasetGeneration=0,selectedException=Boolean(initial.view.feature);
let dataRoot=initial.view.snapshot?'/snapshots/'+initial.view.snapshot:'';
const controls=createRailwayControls(hasLinkedState?sharedFilters(initial.view.filters):expandedState(DEFAULTS),initial.view.zoom);
const filterState=()=>controls.getSnapshot().session.filters;
const isolation=()=>controls.getSnapshot().session.isolatedLine;
function activeLineKeys():string[]|null{const isolated=isolation();return isolated?[isolated]:filterState().lineKeys;}
let stations=empty(),manifest:DatasetManifest,palette:Palette,selected:RailFeature|null=null,ready=false,lastTrigger:HTMLElement|null=null;
let lineCatalog:LineIndex={lines:[]};
const detailCache=new Map<string,Promise<Record<string,RailFeature>>>(),layerSpecs:TrackLayerSpec[]=[];
let assetEpoch=0,tileRetry=false,booting=false,tileTimer:ReturnType<typeof setTimeout>|undefined;
const issues:Partial<Record<ResourceKey,ResourceIssue>>={},attempts:Partial<Record<ResourceKey,number>>={};
const failedTiles=new Map<string,{x:number;y:number;z:number}>();
const retriedTiles=new Set<string>(),retryTileFailures=new Set<string>();
function resource(key:ResourceKey,status:ResourceIssue['status'],message=''){const issue:ResourceIssue={key,status,message};issues[key]=issue;if(!disposed){onResourceIssue(issue);if(ready)publishControls();if(key==='stations'||key==='manifest')refreshSearch();}}
const failed=(key:ResourceKey)=>issues[key]?.status==='error'||issues[key]?.status==='loading'&&Boolean(issues[key]?.message);
const assetMessages={palette:'轨道配色暂不可用，轨道暂用中性色。',stations:'车站索引暂不可用，轨道仍可浏览，搜索输入已保留。',lines:'线路索引暂不可用，当前按类型配色，单线选择暂不可用。'};
let firstUsableMarked=false,profileFrames=false,profileFrameCount=0;
let profileFilters=false,profileFilterCount=0;
let pendingFilterProfile:{revision:number;preset:string;rendered:boolean}|null=null;
const map=new maplibregl.Map({container:'map',center:[initial.view.longitude,initial.view.latitude],zoom:initial.view.zoom,minZoom:8,maxZoom:18,
  locale:{'Map.Title':'沈阳铁路地图','NavigationControl.ZoomIn':'放大地图','NavigationControl.ZoomOut':'缩小地图','AttributionControl.ToggleAttribution':'展开或收起地图署名'},
  localIdeographFontFamily:'Microsoft YaHei, PingFang SC, sans-serif',attributionControl:false,
  style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#f0f3ed'}}]}});
const motion=createMapMotion(map,matchMedia('(prefers-reduced-motion: reduce)'));
cleanups.push(()=>motion.dispose());
map.getCanvas().setAttribute('aria-describedby','map-keyboard-help');
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
map.addControl(new maplibregl.ScaleControl({unit:'metric'}),'bottom-left');
map.addControl(new maplibregl.AttributionControl({compact:false,customAttribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL'}),'bottom-right');
listen(map.getCanvas(),'webglcontextlost',event=>{event.preventDefault();hover.clear();onMapFailure('地图显示已中断，可以通过列表继续浏览，也可以重试地图。');});

const textPaint={'text-color':'#203b44','text-halo-color':'#f9fbf6','text-halo-width':1.8};
const font=['Microsoft YaHei','sans-serif'];
function geojson(id:string):GeoJSONSource{const source=map.getSource(id);if(!source||source.type!=='geojson')throw Error('地图来源尚未就绪：'+id);return source as GeoJSONSource;}
async function getJSON(url:string,requestRoot=dataRoot):Promise<unknown>{const dataRequest=/^\/(dataset\.json|palette\.json|stations\.geojson|lines\.json|details\/)/.test(url);const r=await fetch((dataRequest?requestRoot:'')+url,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});if(!r.ok){const error=Object.assign(new Error(r.status===410?'此快照已超过保留期':`读取失败（${r.status}）`),{status:r.status});throw error;}return r.json();}
function say(message:string){feedback.update({status:message});}
function notice(message:string){feedback.update({notice:message});}
function sharedFilters(filters:ShareFilters):FilterState{
  const equal=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  for(const preset of ['overview','highspeed','conventional','urban'] as const){
    const candidate=expandedState({...DEFAULTS,...filters,preset});
    if(equal(candidate.types,filters.types)&&equal(candidate.classes,filters.classes)&&equal(candidate.states,filters.states))return {...DEFAULTS,...filters,preset};
  }return {...DEFAULTS,...filters};
}
function collectView():ShareView{
  const center=map.getCenter(),filters=expandedState(filterState());
  return {region:'shenyang',snapshot:manifest?.snapshot_id||initial.view.snapshot,feature:selected?.properties.osm_id||null,
    query:stationSearch.getSnapshot().committedQuery,zoom:map.getZoom(),latitude:center.lat,longitude:center.lng,filters:{...filters,preset:'custom'}};
}
function writeView(mode:'push'|'replace'){
  if(!ready||restoring||disposed)return;const address=encodeView(collectView());
  if(address===location.pathname+location.search+location.hash)return;
  window.history[mode==='push'?'pushState':'replaceState'](null,'',address);
}
function changeScene(change:()=>void){
  // Resizing the detail panel can synchronously emit moveend. Persist only
  // the completed scene, so a preset change occupies one history entry.
  ++restoreGeneration;restoring=true;
  try{change();}finally{restoring=false;}
  writeView('push');
}
async function restoreFeature(key:string,generation=restoreGeneration){
  try{const f=stations.features.find(f=>f.properties.osm_id===key)||await fullFeature({properties:{osm_id:key}});if(disposed||generation!==restoreGeneration)return;selectedException=true;await selectFeature(f,{restore:true});}
  catch{if(!disposed&&generation===restoreGeneration)feedback.update({navigation:'该记录不在此快照或详情暂不可用；地图视图已保留。'});}
}
async function restoreAddress(){
  ++datasetGeneration;
  const incoming=decodeView(location.href),generation=++restoreGeneration;
  if(incoming.view.snapshot&&incoming.view.snapshot!==manifest.snapshot_id){try{await switchSnapshot(incoming.view.snapshot,abort.signal,{restoreView:incoming.view,restoreWarnings:incoming.warnings});}catch(error){if(errorName(error)!=='AbortError'&&generation===restoreGeneration)feedback.update({navigation:'目标版本加载失败，已保留当前地图，可通过数据版本面板重试。'});}return;}
  restoring=true;clearSelection(false,false);controls.dispatch({type:'restore',filters:sharedFilters(incoming.view.filters)});
  stationSearch.restore(incoming.view.query);feedback.update({navigation:incoming.warnings.join(' ')});
  map.jumpTo({center:[incoming.view.longitude,incoming.view.latitude],zoom:incoming.view.zoom});updateLayers();
  if(incoming.view.feature)await restoreFeature(incoming.view.feature,generation);
  if(generation!==restoreGeneration)return;restoring=false;writeView('replace');
}
function featureVisible(f:RailFeature){
  const p=f.properties;if(['station','station_area'].includes(p.feature_kind||''))return showStation(p);
  const effective:FilterState=isolation()?{...expandedState(filterState()),preset:'custom',types:['subway','light_rail','tram']}:filterState();
  if(p.feature_kind==='facility')return filterState().facilities&&overlayVisible(p,effective,activeLineKeys());
  if(!trackVisible(p,effective,map.getZoom()))return false;
  const keys=activeLineKeys();
  return keys===null||keys.some(key=>(p.line_tokens||'').includes('|'+key+'|'));
}
function linePaint(line:LineRecord){return resolveLinePaint(palette,line,!failed('palette'));}
function colors(casing=false):string|ExpressionSpecification{return paletteColorExpression(palette,lineCatalog,casing,!failed('palette'));}
function visibleTrackFilter(spec:TrackSpec={}):ExpressionSpecification{
  const filtered=trackFilter(isolation()?{...expandedState(filterState()),preset:'custom',types:['subway','light_rail','tram']}:filterState(),spec);
  const keys=activeLineKeys();
  if(keys===null||keys===undefined)return filtered;
  return ['all',filtered,keys.length?['any',...keys.map<ExpressionSpecification>(key=>['in','|'+key+'|',['coalesce',['get','line_tokens'],'']])]:['literal',false]];
}
function showStation(p:RailProperties){
  return overlayVisible(p,isolation()?{...expandedState(filterState()),preset:'custom',types:['subway','light_rail','tram']}:filterState(),activeLineKeys());
}
function addFacilityLayers(){
  if(manifest.schema_version<2)return;
  const base={source:'tracks','source-layer':'rail_facilities'};
  map.addLayer({id:'station-areas',type:'fill',source:'tracks','source-layer':'rail_stations',minzoom:14,paint:{'fill-color':'#1f5a8a','fill-opacity':.08}},'station-dots');
  for(const [id,color,width] of [['station-area-halo','#ffffff',4],['station-area-outline','#1f5a8a',1.5]] as const)map.addLayer({id,type:'line',source:'tracks','source-layer':'rail_stations',minzoom:14,paint:{'line-color':color,'line-width':width}},'station-dots');
  map.addLayer({id:'facility-areas',type:'fill',...base,minzoom:14,filter:['==',['geometry-type'],'Polygon'],layout:{visibility:'none'},paint:{'fill-color':'#749181','fill-opacity':.35}},'station-dots');
  map.addLayer({id:'facility-line-halo',type:'line',...base,minzoom:14,filter:['in',['geometry-type'],['literal',['LineString','Polygon']]],layout:{visibility:'none'},paint:{'line-color':'#ffffff','line-width':4}},'station-dots');
  map.addLayer({id:'facility-lines',type:'line',...base,minzoom:14,filter:['in',['geometry-type'],['literal',['LineString','Polygon']]],layout:{visibility:'none'},paint:{'line-color':'#5f8071','line-width':1.5}},'station-dots');
  map.addLayer({id:'facility-points',type:'circle',...base,minzoom:15,filter:['==',['geometry-type'],'Point'],layout:{visibility:'none'},paint:{'circle-radius':3,'circle-color':'#916e3d','circle-stroke-color':'#fff','circle-stroke-width':1}},'station-dots');
  map.addLayer({id:'facility-symbols',type:'symbol',...base,minzoom:15,filter:['==',['geometry-type'],'Point'],layout:{visibility:'none','text-field':['match',['get','facility_kind'],'switch','岔','signal','信','entrance','出','buffer_stop','挡','level_crossing','道口','stop_position','停','设施'],'text-font':font,'text-size':10,'text-anchor':'top','text-offset':[0,.7],'text-padding':5},paint:textPaint});
  map.addLayer({id:'selected-area',type:'fill',source:'selection',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#154e9d','fill-opacity':.18}},'station-dots');
}
function updateFacilities(){
  if(!ready)return;
  const active:FilterState=isolation()?{...expandedState(filterState()),preset:'custom',types:['subway','light_rail','tram']}:filterState();
  const filter=overlayFilter(active,activeLineKeys());
  for(const id of ['station-areas','station-area-halo','station-area-outline'])if(map.getLayer(id))map.setFilter(id,['all',filter,['==',['geometry-type'],'Polygon']]);
  const geometries:Array<[string,ExpressionSpecification]>=[['facility-line-halo',['in',['geometry-type'],['literal',['LineString','Polygon']]]],['facility-areas',['==',['geometry-type'],'Polygon']],['facility-lines',['in',['geometry-type'],['literal',['LineString','Polygon']]]],['facility-points',['==',['geometry-type'],'Point']],['facility-symbols',['==',['geometry-type'],'Point']]];
  for(const [id,geometry] of geometries)if(map.getLayer(id)){
    map.setFilter(id,['all',filter,geometry]);map.setLayoutProperty(id,'visibility',filterState().facilities?'visible':'none');
  }
  controls.updateData({zoom:map.getZoom(),schemaVersion:manifest.schema_version});
}
function lineLabel():ExpressionSpecification{
  const ref:ExpressionSpecification=['coalesce',['get','line_ref'],''];
  return ['case',['all',['in',['get','rail_mode'],['literal',['subway','light_rail','tram']]],['==',['get','line_complete'],true],['!=',['get','line_shared'],true],['!=',ref,'']],
    ['concat',['match',['get','rail_mode'],'tram','有轨电车 ','light_rail','轻轨 ',''],ref,'号线'],['coalesce',['get','display_name'],'']];
}
function addTrackLayers(){
  map.addLayer({id:'urban-boundary',type:'line',source:'tracks','source-layer':'rail_tracks',minzoom:8,filter:['all',visibleTrackFilter(),['in',['get','rail_mode'],['literal',['subway','tram','light_rail']]]],layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#1b2a32','line-width':lineWidth(4.4),'line-opacity':1}});

  for(const minor of [false,true])for(const lifecycle of FILTER_STATES){
    const suffix=`${minor?'minor':'major'}-${lifecycle}`;
    const style=STATUS_STYLES[lifecycle],color=style.color||colors();
    const spec={minor,lifecycle};layerSpecs.push({id:`casing-${suffix}`,...spec},{id:`track-${suffix}`,...spec});
    map.addLayer({id:`casing-${suffix}`,type:'line',source:'tracks','source-layer':'rail_tracks',minzoom:minor?12:8,filter:visibleTrackFilter(spec),layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':style.color?contrastingCasing(style.color):colors(true),'line-width':lineWidth(2.2),'line-opacity':1}});
    map.addLayer({id:`track-${suffix}`,type:'line',source:'tracks','source-layer':'rail_tracks',minzoom:minor?12:8,filter:visibleTrackFilter(spec),layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':color,'line-width':lineWidth(),'line-opacity':style.opacity,...(style.dash?{'line-dasharray':style.dash}:{})}});
    if(style.warning){const id=`warning-${suffix}`;layerSpecs.push({id,...spec});map.addLayer({id,type:'symbol',source:'tracks','source-layer':'rail_tracks',minzoom:minor?12:10,filter:visibleTrackFilter(spec),layout:{'symbol-placement':'line','symbol-spacing':200,'text-field':style.warning,'text-font':font,'text-size':13},paint:textPaint});}
  }
  map.addSource('selection',{type:'geojson',data:empty()});
  map.addLayer({id:'selected-halo',type:'line',source:'selection',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#fff','line-width':10}});
  map.addLayer({id:'selected-track',type:'line',source:'selection',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#154e9d','line-width':7,'line-opacity':1}});
  map.addLayer({id:'selected-color',type:'line',source:'selection',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':colors(),'line-width':3}});
  map.addSource('stations',{type:'geojson',data:empty(),promoteId:'osm_id'});
  map.addLayer({id:'station-dots',type:'circle',source:'stations',paint:{'circle-radius':['case',['==',['get','label_priority'],0],5,3.5],'circle-color':'#fff','circle-stroke-width':2,'circle-stroke-color':['case',['==',['get','rail_mode'],'subway'],'#8657a6','#1f5a8a']}});
  map.addLayer({id:'selected-station',type:'circle',source:'selection',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':8,'circle-color':'#fff','circle-stroke-color':'#154e9d','circle-stroke-width':3}});
  map.addLayer({id:'selected-name',type:'symbol',source:'selection',filter:['==',['geometry-type'],'Point'],layout:{'text-field':['get','display_name'],'text-font':font,'text-size':15,'text-anchor':'bottom','text-offset':[0,-1.1],'text-padding':6},paint:textPaint});
  for(const major of [true,false])map.addLayer({id:major?'major-station-names':'station-names',type:'symbol',source:'stations',minzoom:major?8:12,filter:major?['==',['get','label_priority'],0]:['!=',['get','label_priority'],0],layout:{'text-field':['get','label_name'],'text-font':font,'text-size':major?14:12,'text-variable-anchor':['top','bottom','left','right'],'text-radial-offset':.8,'text-padding':5,'symbol-sort-key':['get','label_priority']},paint:textPaint});
  map.addLayer({id:'line-names',type:'symbol',source:'tracks','source-layer':'rail_tracks',minzoom:9,filter:['all',visibleTrackFilter(),['!=',lineLabel(),'']],layout:{'symbol-placement':'line','symbol-spacing':350,'text-field':lineLabel(),'text-font':font,'text-size':12,'text-max-angle':30,'text-padding':5,'text-keep-upright':true},paint:{...textPaint,'text-color':'#506975'}});
}
// Place station symbols above line labels so collisions favor station names.
function prioritizeLabels(){for(const id of ['line-names','facility-symbols','station-names','major-station-names','selected-name'])if(map.getLayer(id))map.moveLayer(id);}
function currentStations(){return stations.features.map((f,i)=>({...f,id:i})).filter(f=>showStation(f.properties)&&f.properties.osm_id!==selected?.properties.osm_id).map(f=>{
  const p=f.properties;
  return {...f,properties:{...p,label_name:p.display_name+(p.rail_mode==='subway'?' · 地铁':'')}};
});}
function updateLayers(){hover.clear();if(!ready)return;
  layerSpecs.forEach(spec=>map.setFilter(spec.id,visibleTrackFilter(spec)));
  map.setFilter('urban-boundary',['all',visibleTrackFilter(),['in',['get','rail_mode'],['literal',['subway','tram','light_rail']]]]);
  map.setFilter('line-names',['all',visibleTrackFilter(),['!=',lineLabel(),'']]);
  map.setLayoutProperty('line-names','visibility',filterState().lineNames?'visible':'none');
  for(const id of ['major-station-names','station-names'])map.setLayoutProperty(id,'visibility',filterState().stationNames?'visible':'none');
  geojson('stations').setData({type:'FeatureCollection',features:currentStations()});
  updateFacilities();refreshSearch();updateNotice();if(selected)selectionData(selected);publishControls();writeView('push');
  if(profileFilters&&profileFilterCount<1000){
    pendingFilterProfile={revision:++profileFilterCount,preset:filterState().preset,rendered:false};
    performance.mark('atlas:filters-applied',{detail:{revision:profileFilterCount,preset:filterState().preset}});
  }
}
function changeFilters(action:FilterAction){
  if(!ready||disposed)return;
  if(action.type==='undo'&&!controls.getSnapshot().session.previous)return;
  if(action.type==='preset'||action.type==='undo')changeScene(()=>{controls.dispatch(action);clearSelection(false,false);updateLayers();});
  else{controls.dispatch(action);updateLayers();}
  if(action.type==='preset')say(`已切换为${PRESET_LABELS[action.preset]}，可撤销。`);
}
function publishControls(){
  if(!ready)return;
  const paints=lineCatalog.lines.map(line=>[line.line_key,linePaint(line)] as const);
  controls.updateData({ready,palette,lines:lineCatalog.lines,lineColors:Object.fromEntries(paints.map(([key,paint])=>[key,paint.color])),lineSources:Object.fromEntries(paints.map(([key,paint])=>[key,{source:paint.source,confidence:paint.confidence,verifiedAt:paint.verifiedAt}])),linesUnavailable:Boolean(failed('lines')),schemaVersion:manifest.schema_version,zoom:map.getZoom()});
}
function updateNotice(){
  if(selected&&!featureVisible(selected)){notice(selectedException?'此对象为搜索或分享中临时显示，关闭详情后恢复原筛选。':'选中对象已被当前筛选隐藏，详情仍保留，可恢复图层查看。');return;}
  const active=expandedState(filterState());if(!active.types.length||!active.states.length){notice('当前没有启用的轨道类型或状态，可恢复默认图层。');return;}
  const selectedLines=activeLineKeys();
  if(selectedLines?.length===0){notice('当前没有启用城市轨道线路，可在城市轨道线路面板恢复全部线路。');return;}
  if(!failed('lines')&&selectedLines!==null&&!selectedLines.some(key=>lineCatalog.lines.some(line=>line.line_key===key))){notice('所选线路不在此快照，可在城市轨道线路面板恢复全部线路。');return;}
  const b=map.getBounds(),[w,s,e,n]=manifest.bbox;
  if(b.getEast()<w||b.getWest()>e||b.getNorth()<s||b.getSouth()>n){notice('当前数据未覆盖此处，可点击“回到试验区”。');return;}
  if(filterState().preset==='highspeed'&&!manifest.class_counts?.high_speed){notice('本次样本没有显式高速标注，不能按名称或限速猜测。');return;}
  notice('');
}
function refreshSearch(){
  stationSearch.updateSource(stations.features,failed('manifest')?'blocked':failed('stations')?'unavailable':ready?'ready':'loading',feature=>!showStation(feature.properties));
}
function selectSearchResult(key:string,trigger:HTMLElement){
  if(!ready||disposed||stationSearch.getSnapshot().composing)return;
  stationSearch.flush();const entry=stationSearch.getSnapshot().results.find(entry=>entry.feature.id===key);
  if(entry){stationSearch.activate(key);void selectFeature(entry.feature,{focus:true,trigger});}
}
async function fullFeature(feature:RailFeature|{properties:{osm_id:string}}):Promise<RailFeature>{if('tags' in feature.properties&&'geometry' in feature)return feature;
  const epoch=assetEpoch,requestRoot=dataRoot;
  const key=feature.properties.osm_id;const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));const shard=new Uint8Array(hash)[0].toString(16).padStart(2,'0');
  if(disposed||epoch!==assetEpoch)throw new DOMException('Aborted','AbortError');
  let request=detailCache.get(shard);
  if(!request){request=getJSON(`/details/${shard}.json`,requestRoot).then(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('详情分片无效');const records:Record<string,RailFeature>={};for(const [id,record] of Object.entries(value)){validateRailFeature(record);if(record.properties.osm_id!==id)throw Error('详情身份与分片不一致');records[id]=record;}return records;}).catch(e=>{if(detailCache.get(shard)===request)detailCache.delete(shard);throw e;});detailCache.set(shard,request);}
  const records=await request;if(disposed||epoch!==assetEpoch)throw new DOMException('Aborted','AbortError');
  const record=records[key];if(!record)throw Error('该记录详情暂不可用');return record;
}
function selectionData(f:RailFeature|null){if(f&&!featureVisible(f)&&!selectedException)f=null;const features:RailFeature[]=f?[{...f,id:0}]:[];if(f&&(f.geometry.type==='Polygon'||f.geometry.type==='MultiPolygon')&&f.properties.anchor)features.push({...f,id:1,geometry:{type:'Point',coordinates:f.properties.anchor}});geojson('selection').setData({type:'FeatureCollection',features});}
async function selectFeature(feature:RailFeature,{focus=false,trigger=null,restore=false}:{focus?:boolean;trigger?:HTMLElement|null;restore?:boolean}={}){if(!feature)return;hover.clear();if(!restore){++restoreGeneration;restoring=true;selectedException=focus;}lastTrigger=trigger||(document.activeElement instanceof HTMLElement?document.activeElement:null);const token=featurePanels.begin(feature,manifest.snapshot_id,lineCatalog.lines,manifest);selected=feature;document.body.classList.add('detail-open');selectionData(feature);geojson('stations').setData({type:'FeatureCollection',features:currentStations()});updateNotice();
  if(!restore){if(focus)focusOn(feature);else ensureVisible(feature);restoring=false;}writeView('push');
  try{const full=await fullFeature(feature);if(!featurePanels.complete(token,full))return;selected=full;selectionData(full);updateNotice();}
  catch(e){featurePanels.fail(token,errorMessage(e));}
}
function retryDetails(){const detail=featurePanels.getSnapshot().detail;if(detail.status==='error')void selectFeature(detail.feature,{restore:true,trigger:lastTrigger});}
function closeCandidates(){featurePanels.closeCandidates();map.getCanvas().focus({preventScroll:true});}
function chooseCandidate(feature:RailFeature){void selectFeature(feature,{trigger:map.getCanvas()});}
function panelsLayout(){if(!disposed)map.resize();}
function clearSelection(restoreFocus=true,persist=true){if(persist){++restoreGeneration;restoring=true;}featurePanels.close();selected=null;selectedException=false;document.body.classList.remove('detail-open');if(ready){selectionData(null);geojson('stations').setData({type:'FeatureCollection',features:currentStations()});}if(restoreFocus){const target=lastTrigger?.isConnected&&lastTrigger!==document.body&&!lastTrigger.closest('[hidden]')?lastTrigger:root.querySelector<HTMLElement>('#search');target?.focus({preventScroll:true});}if(persist)restoring=false;if(ready){updateNotice();if(persist)writeView('push');}}
function anchor(f:RailFeature):[number,number]{if(f.properties.anchor)return [f.properties.anchor[0],f.properties.anchor[1]];const g=f.geometry;if(g.type==='Point')return [g.coordinates[0],g.coordinates[1]];const points=g.type==='MultiPolygon'?g.coordinates.flat(2):g.type==='MultiLineString'||g.type==='Polygon'?g.coordinates.flat():g.coordinates;const c=points[Math.floor(points.length/2)];return [c[0],c[1]];}
function focusOn(f:RailFeature){const c=anchor(f);motion.easeTo({center:c,zoom:f.geometry.type==='Point'?Math.max(map.getZoom(),13.5):map.getZoom(),offset:matchMedia('(max-width:700px)').matches?[0,-35]:[-150,0],duration:450});}
function ensureVisible(f:RailFeature){const c=anchor(f);const point=map.project([c[0],c[1]]),rect=map.getContainer().getBoundingClientRect();if(point.x>rect.width-365||point.y>rect.height-40||point.x<30||point.y<50)focusOn(f);}
function hitDistance(feature:RailFeature,point:{x:number;y:number}){
  const g=feature.geometry,lines=g.type==='Point'?[[g.coordinates]]:g.type==='MultiPolygon'?g.coordinates.flat():g.type==='MultiLineString'||g.type==='Polygon'?g.coordinates:[g.coordinates];let best=Infinity;
  for(const line of lines){const pixels=line.map(c=>map.project([c[0],c[1]]));for(let i=0;i<pixels.length;i++){const a=pixels[i],b=pixels[i+1]||a,dx=b.x-a.x,dy=b.y-a.y;const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy));}}return best;
}
function showCandidates(features:RailFeature[]){featurePanels.showCandidates(features);}
function installDatasetLayers(){
  feedback.update({sourceDate:sourceDateLabel(manifest.source)});
  map.addSource('tracks',{type:'vector',tiles:[`${location.origin}${dataRoot}/tiles/{z}/{x}/{y}.pbf`],minzoom:8,maxzoom:manifest.tiles.maxzoom,bounds:[manifest.tiles.bounds[0],manifest.tiles.bounds[1],manifest.tiles.bounds[2],manifest.tiles.bounds[3]],promoteId:'osm_id'});
  const [w,s,e,n]=manifest.bbox;map.addSource('coverage',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[w,s],[e,s],[e,n],[w,n],[w,s]]}}});
  map.addLayer({id:'coverage',type:'line',source:'coverage',paint:{'line-color':'#b1bfb6','line-dasharray':[4,5],'line-width':1}});
  addTrackLayers();addFacilityLayers();prioritizeLabels();
}
function removeDatasetLayers(){hover.clear();
  const sources=new Set(['tracks','coverage','selection','stations']);
  for(const layer of [...map.getStyle().layers].reverse())if('source' in layer&&sources.has(layer.source))map.removeLayer(layer.id);
  for(const source of sources)if(map.getSource(source))map.removeSource(source);
  layerSpecs.length=0;
}
async function switchSnapshot(snapshot:string,signal:AbortSignal,{restoreView=null,restoreWarnings=[],defaultView=null}:{restoreView?:ShareView|null;restoreWarnings?:string[];defaultView?:{longitude:number;latitude:number;zoom:number}|null}={}){
  if(!ready||disposed)throw Error('地图尚未就绪');
  const generation=++datasetGeneration;
  // Stage all small assets before touching current layers, selection or camera.
  const bundle=await loadDataset(snapshot,signal);
  if(signal.aborted||disposed||generation!==datasetGeneration)throw new DOMException('Aborted','AbortError');
  const prior={manifest,palette,stations,lineCatalog,dataRoot,selected,session:controls.getSnapshot().session,issues:{...issues},failedTiles:new Map(failedTiles),searchInput:stationSearch.captureInput(),
    camera:map.getCenter(),zoom:map.getZoom(),exception:selectedException,navigation:feedback.getSnapshot().navigation};
  ++restoreGeneration;restoring=true;
  try{
    clearSelection(false,false);ready=false;removeDatasetLayers();
    ++assetEpoch;tileRetry=false;clearTimeout(tileTimer);
    failedTiles.clear();
    retriedTiles.clear();retryTileFailures.clear();
    for(const key of ['manifest','palette','stations','lines','tiles'] as const)resource(key,'ready');
    ({manifest,palette,stations}=bundle);lineCatalog=bundle.lines;dataRoot=bundle.root;detailCache.clear();
    installDatasetLayers();ready=true;
    if(restoreView){controls.dispatch({type:'restore',filters:sharedFilters(restoreView.filters)});stationSearch.restore(restoreView.query);map.jumpTo({center:[restoreView.longitude,restoreView.latitude],zoom:restoreView.zoom});}
    else if(defaultView)map.jumpTo({center:[defaultView.longitude,defaultView.latitude],zoom:defaultView.zoom});
    updateLayers();
    feedback.update({navigation:restoreView?restoreWarnings.join(' '):''});
    if(restoreView?.feature)await restoreFeature(restoreView.feature);
    controls.dispatch({type:'discard-undo'});onDatasetChanged(manifest.snapshot_id);
    say('铁路地图已就绪。名称与属性来自源标签，点击可查看依据。');
  }catch(error){
    ready=false;removeDatasetLayers();({manifest,palette,stations,lineCatalog,dataRoot}=prior);controls.restoreSession(prior.session);detailCache.clear();
    ++assetEpoch;tileRetry=false;clearTimeout(tileTimer);
    failedTiles.clear();for(const [key,value] of prior.failedTiles)failedTiles.set(key,value);
    retriedTiles.clear();retryTileFailures.clear();
    for(const key of ['manifest','palette','stations','lines','tiles'] as const){const issue=prior.issues[key];resource(key,issue?.status==='loading'?'error':issue?.status||'ready',issue?.message||'');}
    installDatasetLayers();ready=true;stationSearch.restoreInput(prior.searchInput);map.jumpTo({center:prior.camera,zoom:prior.zoom});updateLayers();
    if(prior.selected){selectedException=prior.exception;await selectFeature(prior.selected,{restore:true});}
    feedback.update({navigation:prior.navigation});
    throw error;
  }finally{restoring=false;}
  writeView(restoreView?'replace':'push');
}
const assetPaths={palette:'/palette.json',stations:'/stations.geojson',lines:'/lines.json'};
type AssetKey=keyof typeof assetPaths;
type AssetResult={key:'palette';value:Palette}|{key:'stations';value:Stations}|{key:'lines';value:LineIndex};
async function readAsset(key:AssetKey):Promise<AssetResult>{
  const value=await getJSON(assetPaths[key]);
  if(key==='palette'){validatePalette(value);return {key,value};}
  if(key==='stations'){validateStations(value);return {key,value};}
  validateLines(value,manifest.snapshot_id);return {key,value};
}
function repaint(){
  for(const spec of layerSpecs){const status=STATUS_STYLES[spec.lifecycle];if(spec.id.startsWith('track-'))map.setPaintProperty(spec.id,'line-color',status.color||colors());else if(spec.id.startsWith('casing-'))map.setPaintProperty(spec.id,'line-color',status.color?contrastingCasing(status.color):colors(true));}
  map.setPaintProperty('selected-color','line-color',colors());
  updateLayers();
}
async function retryResource(key:ResourceKey){
  if(disposed||issues[key]?.status==='loading')return;
  if(key==='manifest'){await bootstrap();return;}
  if(!ready)return;
  if(key==='tiles'){
    resource(key,'loading','正在重新读取轨道瓦片，车站搜索与已有详情仍可使用。');
    const epoch=assetEpoch;tileRetry=true;clearTimeout(tileTimer);retriedTiles.clear();retryTileFailures.clear();
    for(const key of failedTiles.keys())retriedTiles.add(key);
    tileTimer=setTimeout(()=>{if(!disposed&&epoch===assetEpoch&&tileRetry){tileRetry=false;resource(key,'error','轨道瓦片读取超时，已加载内容保留，可再次重试。');}},15000);
    // Explicit tile IDs force a network load for errored tiles in MapLibre
    // 6.15. Refreshing the whole source can leave failed actor tiles pending.
    try{map.refreshTiles('tracks',[...failedTiles.values()]);map.triggerRepaint();}catch{tileRetry=false;clearTimeout(tileTimer);resource(key,'error','轨道瓦片重试失败，已加载内容保留。');}return;
  }
  if(key!=='palette'&&key!=='stations'&&key!=='lines')return;
  const epoch=assetEpoch,attempt=attempts[key]=(attempts[key]||0)+1;
  resource(key,'loading',assetMessages[key]);
  try{
    const result=await readAsset(key);
    // A delayed retry must never write into a newly selected snapshot.
    if(disposed||epoch!==assetEpoch||attempt!==attempts[key])return;
    if(result.key==='palette')palette=result.value;else if(result.key==='stations')stations=result.value;else lineCatalog=result.value;
    resource(key,'ready');repaint();
    say('已恢复'+({palette:'轨道配色',stations:'车站搜索',lines:'线路索引'})[key]+'，视图与筛选已保留。');
  }catch(error){if(!disposed&&epoch===assetEpoch&&attempt===attempts[key]){resource(key,'error',assetMessages[key]+' '+errorMessage(error));refreshSearch();publishControls();}}
}
async function bootstrap(){if(booting||disposed)return;booting=true;resource('manifest','loading');say('正在加载铁路地图…');try{
  const description=await getJSON('/dataset.json');
  if(disposed)return;
  validateManifest(description,initial.view.snapshot||undefined);manifest=description;resource('manifest','ready');
  feedback.update({currentVersionRecovery:false});
  // Resolve the current-version alias once. All indexes, tiles and details
  // then use the same immutable namespace, including after a server restart.
  dataRoot='/snapshots/'+manifest.snapshot_id;
  const values=await Promise.all((['palette','stations','lines'] as const).map(async (key):Promise<AssetResult>=>{
    if(key==='lines'&&manifest.schema_version<2){resource(key,'ready');return {key,value:{lines:[]}};}
    try{const result=await readAsset(key);if(!disposed)resource(key,'ready');return result;}
    catch(error){if(!disposed)resource(key,'error',assetMessages[key]+' '+errorMessage(error));return key==='palette'?{key,value:neutralPalette()}:key==='stations'?{key,value:empty()}:{key,value:{lines:[]}};}
  }));
  for(const result of values){if(result.key==='palette')palette=result.value;else if(result.key==='stations')stations=result.value;else lineCatalog=result.value;}
  if(disposed)return;
  performance.mark('atlas:index-ready');
  installDatasetLayers();ready=true;updateLayers();refreshSearch();feedback.update({navigation:initial.warnings.join(' ')});if(initial.view.feature)await restoreFeature(initial.view.feature);restoring=false;onDatasetChanged(manifest.snapshot_id);writeView('replace');say(Object.values(issues).some(issue=>issue.status==='error')?'地图已打开，部分数据暂不可用，可分别重试。':'铁路地图已就绪。名称与属性来自源标签，点击可查看依据。');
}catch(e){
  if(disposed)return;
  resource('manifest','error','数据说明暂不可用，视图与输入已保留。 '+errorMessage(e));
  feedback.update({status:`地图加载失败：${errorMessage(e)}`,...(dataRoot?{
    navigation:httpStatus(e)===410?'分享所用快照已超过保留期，当前视图与输入已保留。':'分享所用快照暂不可用，当前视图与输入已保留。',
    currentVersionRecovery:true,
  }:{})});
}finally{booting=false;}}
function openCurrentVersion(){
  if(disposed)return;
  stationSearch.flush();const center=map.getCenter();
  location.assign(encodeView({...initial.view,snapshot:'',query:stationSearch.getSnapshot().committedQuery,longitude:center.lng,latitude:center.lat,zoom:map.getZoom()}));
}
map.on('load',bootstrap);
map.on('error',e=>{
  const sourceId='sourceId' in e?e.sourceId:undefined;
  if(disposed||sourceId==='context-basemap')return;
  if(sourceId==='tracks'){
    const tile=failedTile(e),key=tile?`${tile.z}/${tile.x}/${tile.y}`:'';if(tile)failedTiles.set(key,tile);
    if(tileRetry){
      // A pan/search can leave older requests in flight when retry is pressed.
      // Include each newly failed tile once in this bounded explicit attempt.
      if(tile&&!retriedTiles.has(key)){
        retriedTiles.add(key);try{map.refreshTiles('tracks',[tile]);}catch{retryTileFailures.add(key);}
      }else retryTileFailures.add(key);
      return;
    }
    tileRetry=false;clearTimeout(tileTimer);resource('tiles','error','部分轨道瓦片暂不可用，已加载的车站与详情仍可使用。');return;
  }
  say('部分地图显示资源暂不可用。'+(e.error?.message||''));
});
map.on('sourcedata',e=>{if(e.sourceId!=='tracks'||!record(e)||!record(e.tile)||e.tile.state!=='loaded')return;const tile=failedTile(e);if(tile){const key=`${tile.z}/${tile.x}/${tile.y}`;failedTiles.delete(key);retryTileFailures.delete(key);}});
map.on('idle',()=>{if(tileRetry&&ready&&map.isSourceLoaded('tracks')){tileRetry=false;clearTimeout(tileTimer);if(retryTileFailures.size)resource('tiles','error','部分轨道瓦片仍无法读取，已加载内容保留，可再次重试。');else{failedTiles.clear();resource('tiles','ready');}}});
// Explicit local diagnostics only. No map instance or coordinates are exposed.
// A ready render waits for both source workers; idle additionally waits for
// transitions. Neither callback proves physical GPU/display presentation.
function markFilterProfile(settled=false){
  const pending=pendingFilterProfile;
  if(!profileFilters||!pending||!ready||(!settled&&pending.rendered)||!map.areTilesLoaded()
    ||!map.isSourceLoaded('tracks')||!map.isSourceLoaded('stations'))return;
  const expected=['urban-boundary',...layerSpecs.map(spec=>spec.id)];
  const missing=expected.filter(id=>!map.getLayer(id));
  const layers=layerSpecs.filter(spec=>spec.id.startsWith('track-')&&map.getLayer(spec.id)).map(spec=>spec.id);
  const tracks=map.queryRenderedFeatures(undefined,{layers});
  const detail={revision:pending.revision,preset:pending.preset,snapshot:manifest.snapshot_id,
    rendered_tracks:tracks.length,track_classes:[...new Set(tracks.map(feature=>feature.properties.line_class))].sort(),
    style_layers:{expected,missing},failed_tiles:failedTiles.size,
    resource_errors:Object.values(issues).filter(issue=>issue.status==='error').map(issue=>issue.key)};
  performance.mark(settled?'atlas:filters-settled':'atlas:filters-rendered',{detail});
  if(settled)pendingFilterProfile=null;else pending.rendered=true;
}
map.on('idle',()=>markFilterProfile(true));
// Camera movement changes the zoom hint and URL, not source filters.
map.on('moveend',()=>{if(ready){updateNotice();controls.updateData({zoom:map.getZoom()});writeView('replace');}});
// Local opt-in measurement: no frame marks during ordinary browsing, bounded
// to 10,000 submissions per explicitly requested profile. No coordinates/network.
listen(map.getCanvas(),'atlas:profile-frames',event=>{
  if(!record(event.detail)||typeof event.detail.active!=='boolean')return;
  profileFrames=event.detail.active;
  if(profileFrames){profileFrameCount=0;performance.clearMarks('atlas:map-render');}
});
listen(map.getCanvas(),'atlas:profile-filters',event=>{
  if(!record(event.detail)||typeof event.detail.active!=='boolean')return;
  profileFilters=event.detail.active;pendingFilterProfile=null;
  if(profileFilters){profileFilterCount=0;for(const name of ['applied','rendered','settled'])performance.clearMarks('atlas:filters-'+name);}
});
map.on('render',()=>{
  markFilterProfile();
  if(profileFrames&&profileFrameCount<10000){performance.mark('atlas:map-render');profileFrameCount++;}
  if(!ready||firstUsableMarked||!map.isSourceLoaded('tracks')||!map.isSourceLoaded('stations'))return;
  const layers=layerSpecs.filter(spec=>spec.id.startsWith('track-')).map(spec=>spec.id);
  const count=map.queryRenderedFeatures(undefined,{layers}).length;
  // A diagnostic mark for the first drawn, selectable railway view. It stays
  // local to this page and is not sent to an analytics service.
  if(count){
    const expected=['urban-boundary',...layerSpecs.map(spec=>spec.id)];
    const missing=expected.filter(id=>!map.getLayer(id));
    firstUsableMarked=true;
    performance.mark('atlas:first-usable',{detail:{snapshot:manifest.snapshot_id,rendered_tracks:count,
      style_layers:{expected,missing}}});
  }
});
function pickFeatures(point:{x:number;y:number},r:number,reportInvalid=false):RailFeature[]{
  const layers=['facility-points','facility-symbols','facility-lines','facility-areas','station-areas','selected-station','selected-track','station-dots','selected-name','major-station-names','station-names','line-names',...layerSpecs.filter(s=>s.id.startsWith('track-')).map(s=>s.id)];
  const hit=map.queryRenderedFeatures([[point.x-r,point.y-r],[point.x+r,point.y+r]],{layers:layers.filter(id=>map.getLayer(id))});const seen=new Set<string>();const features:RailFeature[]=[];
  for(const f of hit){try{const key:unknown=f.properties.osm_id;if(typeof key!=='string'||seen.has(key))continue;const feature=stations.features.find(v=>v.id===key)||decodeTileFeature(f);seen.add(key);features.push(feature);}catch{if(reportInvalid)say('此地图记录格式无效，已保留当前视图，可通过要素列表查看原始记录。');}}
  features.sort((a,b)=>hitDistance(a,point)-hitDistance(b,point)||Number(b.geometry.type==='Point')-Number(a.geometry.type==='Point')||a.properties.osm_id.localeCompare(b.properties.osm_id));
  return features;
}
map.on('click',e=>{if(!ready)return;hover.clear();const r=('pointerType' in e.originalEvent&&e.originalEvent.pointerType==='touch')||'touches' in e.originalEvent?12:6;
  const features=pickFeatures(e.point,r,true);
  if(features.length===1)selectFeature(features[0]);else if(features.length)showCandidates(features);else featurePanels.closeCandidates();
});
listen(map.getCanvas(),'pointermove',event=>{
  if(event.pointerType!=='mouse'||event.buttons||!ready||disposed||map.isMoving()||root.querySelector('dialog[open]')||featurePanels.getSnapshot().candidates.length){cancelAnimationFrame(hoverFrame);hoverFrame=0;hover.clear();return;}
  cancelAnimationFrame(hoverFrame);
  const x=event.clientX,y=event.clientY;
  hoverFrame=requestAnimationFrame(()=>{
    hoverFrame=0;if(disposed||!ready||map.isMoving()||root.querySelector('dialog[open]')||featurePanels.getSnapshot().candidates.length)return;
    const rect=map.getCanvas().getBoundingClientRect(),features=pickFeatures({x:x-rect.left,y:y-rect.top},6);
    hover.show(hoverItems(features,lineCatalog.lines),features.length,x,y);
  });
});
listen(map.getCanvas(),'pointerleave',event=>{cancelAnimationFrame(hoverFrame);hoverFrame=0;if(event.relatedTarget instanceof Element&&event.relatedTarget.closest('#map-hover'))hover.hold();else hover.leave();});
listen(map.getCanvas(),'pointerdown',()=>{cancelAnimationFrame(hoverFrame);hoverFrame=0;hover.clear();});
map.on('movestart',()=>{cancelAnimationFrame(hoverFrame);hoverFrame=0;hover.clear();});
listen(document,'focusin',event=>{if(event.target instanceof Element&&event.target.closest('dialog'))hover.clear();});
listen(window,'blur',()=>hover.clear());
function home(){clearSelection(false);motion.easeTo({center:[123.42,41.80],zoom:10.5,duration:500});}
listen(window,'resize',()=>{hover.clear();map.resize();if(selected)ensureVisible(selected);});
listen(document,'keydown',e=>{if(e.key!=='Escape'||e.defaultPrevented||e.isComposing||stationSearch.getSnapshot().composing||root.querySelector('dialog[open]'))return;if(hover.getSnapshot()){hover.dismiss();return;}if(featurePanels.getSnapshot().candidates.length){closeCandidates();return;}if(isolation()){changeFilters({type:'isolate',key:null});return;}if(selected){clearSelection();return;}if(stationSearch.getSnapshot().query)stationSearch.clear();});
function getShareContext(){
  if(!ready||disposed)return null;
  stationSearch.flush();return captureShareContext(collectView(),isolation(),Boolean(selected&&selectedException&&!featureVisible(selected)));
}
listen(window,'popstate',()=>{if(ready)restoreAddress();});
function destroy(){disposed=true;feedback.dispose();cancelAnimationFrame(hoverFrame);hover.dispose();featurePanels.dispose();clearTimeout(tileTimer);abort.abort();cleanups.forEach(fn=>fn());controls.dispose();stationSearch.dispose();map.remove();document.body.classList.remove('detail-open');}
async function applyView(view:ShareView){
  if(!ready||disposed)throw Error('地图尚未就绪');
  const address=encodeView(view);if(address!==location.pathname+location.search+location.hash)history.pushState(null,'',address);
  await restoreAddress();if(selected)focusOn(selected);
}
return {map,getAboutManifest:():DatasetManifest|undefined=>manifest,feedback,home,openCurrentVersion,hover,getShareContext,controls,changeFilters,stationSearch,selectSearchResult,featurePanels,closeDetails:()=>clearSelection(),closeCandidates,chooseCandidate,retryDetails,panelsLayout,destroy,applyView,switchSnapshot,retryResource};
}
