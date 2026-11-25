import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {Map as MapLibreMap} from 'maplibre-gl';
import {mountAtlas,type DatasetIdentity} from './map-controller.ts';
import {BasemapControl} from './BasemapControl';
import RailwayControls from './RailwayControls';
import StationSearch from './StationSearch';
import FeaturePanels from './FeaturePanels';
import ShareDialog from './ShareDialog';
import AboutDialog from './AboutDialog';
import type {DatasetManifest} from '../../shared/atlas-types';
import {decodeView} from './view-state';
import type {RegionProfile} from './catalog-validation';
import {createDatasetSwitch} from './dataset-switch';
import {REGION_CONFIG} from './region-config';
import RegionSwitch from './RegionSwitch';
import MapHover from './MapHover';
import type {ShareContext} from './share-session';
import AccessibleExplorer from './AccessibleExplorer';
import DatasetPicker from './DatasetPicker';
import type {ShareView} from './view-state';
import ResourceStatus from './ResourceStatus';
import type {ResourceIssue,ResourceKey} from './resources';
import {SourceDate,NavigationStatus,MapStatus,MapNotice} from './MapFeedback';
import type {MapNoticeAction} from './map-feedback';

const MAP_KEYBOARD_HELP='地图获得焦点后，用方向键平移，+ / − 缩放；Tab 离开地图。搜索中用上下键选择结果，Enter 查看，Escape 关闭详情。也可以通过要素列表浏览。';

export default function App(){
  const rootRef=useRef<HTMLDivElement>(null);
  const [atlasMap,setAtlasMap]=useState<MapLibreMap|null>(null);
  const atlasRef=useRef<ReturnType<typeof mountAtlas>|null>(null);
  const [atlasControls,setAtlasControls]=useState<Pick<ReturnType<typeof mountAtlas>,'controls'|'changeFilters'|'stationSearch'|'selectSearchResult'|'featurePanels'|'closeDetails'|'closeCandidates'|'chooseCandidate'|'retryDetails'|'panelsLayout'|'hover'|'feedback'|'directory'|'home'>|null>(null);
  // Every region switch, from the header or the version panel, goes through this one cancellable request.
  const [switcher]=useState(()=>createDatasetSwitch(async(request,signal)=>{
    const atlas=atlasRef.current;if(!atlas)throw Error('地图尚未就绪');
    atlas.stationSearch.flush();
    await atlas.switchSnapshot(request.snapshot,signal,{defaultView:request.camera,expectedRegion:request.region});
  }));
  const [aboutRequest,setAboutRequest]=useState<{manifest?:DatasetManifest;snapshot:string;region:RegionProfile|null}|null>(null);
  const [shareContext,setShareContext]=useState<ShareContext|null>(null);
  const mapFocusPending=useRef(false);
  const [listOpen,setListOpen]=useState(false),[mapFailure,setMapFailure]=useState('');
  const [currentSnapshot,setCurrentSnapshot]=useState('');
  // The region shown: its names, examples and scope text come from the registry, never from a fixed city.
  const [region,setRegion]=useState<RegionProfile|null>(null);
  const [resourceIssues,setResourceIssues]=useState<Partial<Record<ResourceKey,ResourceIssue>>>({});
  const [panelCollapsed,setPanelCollapsed]=useState(false);
  const panelFocusPending=useRef(false);
  useLayoutEffect(()=>{
    atlasMap?.resize();
    if(!panelCollapsed&&panelFocusPending.current){panelFocusPending.current=false;rootRef.current?.querySelector<HTMLInputElement>('#search')?.focus();}
  },[atlasMap,panelCollapsed]);
  useEffect(()=>{
    const compact=matchMedia('(max-width:700px)');
    const expand=()=>{
      if(compact.matches||!panelCollapsed)return;
      panelFocusPending.current=document.activeElement?.id==='panel-toggle'||document.activeElement===document.body;
      setPanelCollapsed(false);
    };
    compact.addEventListener('change',expand);
    return ()=>compact.removeEventListener('change',expand);
  },[panelCollapsed]);
  useEffect(()=>()=>switcher.dispose(),[switcher]);
  useEffect(()=>{
    if(!rootRef.current)return;
    try{
      const atlas=mountAtlas(rootRef.current,{onResourceIssue:(issue:ResourceIssue)=>setResourceIssues(previous=>({...previous,[issue.key]:issue})),onMapFailure:(message: string)=>{setMapFailure(message);setAtlasMap(null);openList();},onDatasetChanged:(dataset:DatasetIdentity)=>showRegion(dataset.region,dataset.snapshot)});
      atlasRef.current=atlas;setAtlasMap(atlas.map);setAtlasControls(atlas);showRegion(atlas.getRegion());
      return ()=>{atlasRef.current=null;atlas.destroy();};
    }catch{
      rootRef.current.querySelector('#map')?.replaceChildren();
      setMapFailure('此设备暂时无法显示地图。');setListOpen(true);
    }
  },[]);
  function showRegion(shown:RegionProfile,snapshot?:string){
    setRegion(shown);document.title='铁路图集 · '+shown.name;
    if(snapshot)setCurrentSnapshot(snapshot);
  }
  function showDataAbout(provided?:DatasetManifest){const manifest=provided||atlasRef.current?.getAboutManifest();setAboutRequest({manifest,snapshot:manifest?.snapshot_id||decodeView(location.href,REGION_CONFIG).view.snapshot,region:atlasRef.current?.getRegion()||null});}
  async function showOnMap(view: ShareView){
    if(!atlasRef.current)throw Error('地图尚未就绪');
    await atlasRef.current.applyView(view);mapFocusPending.current=true;
  }
  useEffect(()=>{if(!listOpen&&mapFocusPending.current){mapFocusPending.current=false;const title=rootRef.current?.querySelector<HTMLElement>('.feature-title');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}}},[listOpen]);
  function closeList(){setListOpen(false);if(mapFailure)requestAnimationFrame(()=>rootRef.current?.querySelector<HTMLButtonElement>('.map-fallback button')?.focus());}
  function openList(){
    const atlas=atlasRef.current;
    if(atlas){
      atlas.stationSearch.flush();const query=atlas.stationSearch.getSnapshot().committedQuery,url=new URL(location.href);
      if(query)url.searchParams.set('q',query);else url.searchParams.delete('q');
      if(url.href!==location.href)history.replaceState(null,'',url.pathname+url.search+url.hash);
    }
    setListOpen(true);
  }
  function recoverMapNotice(action:MapNoticeAction){
    const atlas=atlasRef.current;if(!atlas)return;
    if(action==='cancel-region-switch'||action==='retry-region-switch'){
      // The notice follows the switch; cancelling keeps the current region, retrying asks for the same target.
      if(action==='cancel-region-switch')switcher.cancel();else switcher.retry();
    }else if(action==='home')atlas.home();
    else atlas.changeFilters(action==='all-lines'?{type:'all-lines'}:{type:'preset',preset:'overview'});
    // The action can remove its own button. Return keyboard control to the map.
    requestAnimationFrame(()=>atlas.map.getCanvas().focus({preventScroll:true}));
  }
  const ui=region?.ui;
  // Map canvas is owned by the renderer; React owns the surrounding panels.
  return <div ref={rootRef} className={[mapFailure?'map-unavailable':'',panelCollapsed?'atlas-panel-collapsed':''].filter(Boolean).join(' ')||undefined}>
<header><a className="brand" href="/" aria-label="铁路图集首页"><span className="brand-icon">╫</span><span>铁路图集 <small>RAILWAY ATLAS</small></span></a>
  {atlasControls
    ?<RegionSwitch region={region} directory={atlasControls.directory} switcher={switcher}><SourceDate store={atlasControls.feedback}/></RegionSwitch>
    :<div className="region"><div className="region-name">{region?.name||''}</div></div>}
  <button id="about-open" className="quiet" onClick={()=>showDataAbout()}>关于数据 ↗</button></header>
<main><div id="map"></div><p id="map-keyboard-help" className="sr-only">{MAP_KEYBOARD_HELP}</p>
{!mapFailure&&<ResourceStatus issues={resourceIssues} onRetry={key=>{void atlasRef.current?.retryResource(key);}}/>}
{mapFailure&&<section className="map-fallback" aria-label="地图暂不可用"><h1>仍可通过列表探索铁路。</h1><p role="status">{mapFailure}</p><button onClick={openList}>打开要素列表</button><button onClick={()=>location.reload()}>重试地图</button><p>地图数据 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · ODbL</p></section>}
<aside id="explore"><div className="eyebrow">从一座城市，读懂铁路</div><h1>沿着铁路线<br />{ui?.headline||''}</h1><p className="intro">线路、车站与它们之间的真实地理关系。</p>
{atlasControls&&<DatasetPicker current={currentSnapshot} currentRegion={region?.id||null} directory={atlasControls.directory} switcher={switcher}/>}
{atlasControls&&<StationSearch store={atlasControls.stationSearch} region={region} onChoose={atlasControls.selectSearchResult}/>}
<NavigationStatus store={atlasControls?.feedback}/>
<button id="list-open" onClick={openList}>通过列表查看车站与要素</button>
<details id="keyboard-help"><summary>键盘操作</summary><p className="hint">{MAP_KEYBOARD_HELP}</p><button disabled={!atlasMap} onClick={()=>atlasMap?.getCanvas().focus({preventScroll:true})}>进入地图操作</button></details>
{atlasControls&&<RailwayControls store={atlasControls.controls} city={region?.city||''} onAction={atlasControls.changeFilters}/>}
<div className="browse-note"><strong>{ui?.browse_start||''}</strong><p>放大查看站场；点击线路或站名，了解名称、等级与来源。</p></div><MapStatus store={atlasControls?.feedback} onCurrentVersion={()=>atlasRef.current?.openCurrentVersion()}/></aside>
<div className="map-caption"><span className="live-dot"></span> 地理铁路图 <span>{region?.caption||''}</span></div><div className="map-actions"><BasemapControl map={atlasMap} /><button id="share-open" disabled={!currentSnapshot||!atlasControls} onClick={()=>setShareContext(atlasRef.current?.getShareContext()||null)}>分享</button><button id="home" disabled={!atlasControls} onClick={()=>atlasControls?.home()}>回到试验区</button><button id="panel-toggle" aria-expanded={!panelCollapsed} aria-controls="explore" onClick={()=>setPanelCollapsed(value=>!value)}>{panelCollapsed?'打开面板':'收起面板'}</button></div><MapNotice store={atlasControls?.feedback} onAction={recoverMapNotice} onDismiss={()=>atlasRef.current?.dismissNotice()}/>
{atlasControls&&<MapHover store={atlasControls.hover}/>}
{atlasControls&&<FeaturePanels store={atlasControls.featurePanels} feedback={atlasControls.feedback} onClose={atlasControls.closeDetails} onCloseCandidates={atlasControls.closeCandidates} onChoose={atlasControls.chooseCandidate} onRetry={atlasControls.retryDetails} onLayout={atlasControls.panelsLayout} onAbout={showDataAbout}/>}
</main>
{shareContext&&<ShareDialog context={shareContext} onClose={()=>setShareContext(null)}/>}{aboutRequest&&<AboutDialog manifest={aboutRequest.manifest} snapshot={aboutRequest.snapshot} region={aboutRequest.region} onClose={()=>setAboutRequest(null)}/>}

{listOpen&&<AccessibleExplorer open mapAvailable={Boolean(atlasMap)&&!mapFailure} onClose={closeList} onShowMap={showOnMap} onAbout={showDataAbout}/>}
</div>;
}
