import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {Map as MapLibreMap} from 'maplibre-gl';
import {mountAtlas} from './map-controller.ts';
import {BasemapControl} from './BasemapControl';
import RailwayControls from './RailwayControls';
import StationSearch from './StationSearch';
import FeaturePanels from './FeaturePanels';
import ShareDialog from './ShareDialog';
import AboutDialog from './AboutDialog';
import type {DatasetManifest} from '../../shared/atlas-types';
import {decodeView} from './view-state';
import MapHover from './MapHover';
import type {ShareContext} from './share-session';
import AccessibleExplorer from './AccessibleExplorer';
import DatasetPicker from './DatasetPicker';
import type {ShareView} from './view-state';
import ResourceStatus from './ResourceStatus';
import type {ResourceIssue,ResourceKey} from './resources';
import {SourceDate,NavigationStatus,MapStatus,MapNotice} from './MapFeedback';

export default function App(){
  const rootRef=useRef<HTMLDivElement>(null);
  const [atlasMap,setAtlasMap]=useState<MapLibreMap|null>(null);
  const atlasRef=useRef<ReturnType<typeof mountAtlas>|null>(null);
  const [atlasControls,setAtlasControls]=useState<Pick<ReturnType<typeof mountAtlas>,'controls'|'changeFilters'|'stationSearch'|'selectSearchResult'|'featurePanels'|'closeDetails'|'closeCandidates'|'chooseCandidate'|'retryDetails'|'panelsLayout'|'hover'|'feedback'|'home'>|null>(null);
  const [aboutRequest,setAboutRequest]=useState<{manifest?:DatasetManifest;snapshot:string}|null>(null);
  const [shareContext,setShareContext]=useState<ShareContext|null>(null);
  const mapFocusPending=useRef(false);
  const [listOpen,setListOpen]=useState(false),[mapFailure,setMapFailure]=useState('');
  const [currentSnapshot,setCurrentSnapshot]=useState('');
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
  useEffect(()=>{
    if(!rootRef.current)return;
    try{
      const atlas=mountAtlas(rootRef.current,{onResourceIssue:(issue:ResourceIssue)=>setResourceIssues(previous=>({...previous,[issue.key]:issue})),onMapFailure:(message: string)=>{setMapFailure(message);setAtlasMap(null);openList();},onDatasetChanged:(snapshot:string)=>setCurrentSnapshot(snapshot)});
      atlasRef.current=atlas;setAtlasMap(atlas.map);setAtlasControls(atlas);
      return ()=>{atlasRef.current=null;atlas.destroy();};
    }catch{
      rootRef.current.querySelector('#map')?.replaceChildren();
      setMapFailure('此设备暂时无法显示地图。');setListOpen(true);
    }
  },[]);
  function showDataAbout(provided?:DatasetManifest){const manifest=provided||atlasRef.current?.getAboutManifest();setAboutRequest({manifest,snapshot:manifest?.snapshot_id||decodeView(location.href).view.snapshot});}
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
  async function switchDataset(snapshot:string,signal:AbortSignal,camera:{longitude:number;latitude:number;zoom:number}){
    if(!atlasRef.current)throw Error('地图尚未就绪');
    atlasRef.current.stationSearch.flush();
    await atlasRef.current.switchSnapshot(snapshot,signal,{defaultView:camera});
  }
  // Map canvas is owned by the renderer; React owns the surrounding panels.
  return <div ref={rootRef} className={[mapFailure?'map-unavailable':'',panelCollapsed?'atlas-panel-collapsed':''].filter(Boolean).join(' ')||undefined}>
<header><a className="brand" href="/" aria-label="铁路图集首页"><span className="brand-icon">╫</span><span>铁路图集 <small>RAILWAY ATLAS</small></span></a><div className="region">沈阳试验区 <SourceDate store={atlasControls?.feedback}/></div><button id="about-open" className="quiet" onClick={()=>showDataAbout()}>关于数据 ↗</button></header>
<main><section id="map" aria-label="沈阳铁路地图"></section>
{!mapFailure&&<ResourceStatus issues={resourceIssues} onRetry={key=>{void atlasRef.current?.retryResource(key);}}/>}
{mapFailure&&<section className="map-fallback" aria-label="地图暂不可用"><h1>仍可通过列表探索铁路。</h1><p role="status">{mapFailure}</p><button onClick={openList}>打开要素列表</button><button onClick={()=>location.reload()}>重试地图</button><p>地图数据 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · ODbL</p></section>}
<aside id="explore"><div className="eyebrow">从一座城市，读懂铁路</div><h1>沿着铁路线<br />看见沈阳。</h1><p className="intro">线路、车站与它们之间的真实地理关系。</p>
<DatasetPicker current={currentSnapshot} onSwitch={switchDataset}/>
{atlasControls&&<StationSearch store={atlasControls.stationSearch} onChoose={atlasControls.selectSearchResult}/>}
<NavigationStatus store={atlasControls?.feedback}/>
<button id="list-open" onClick={openList}>通过列表查看车站与要素</button>
<details id="keyboard-help"><summary>键盘操作</summary><p id="map-keyboard-help" className="hint">地图获得焦点后，用方向键平移，+ / − 缩放；Tab 离开地图。搜索中用上下键选择结果，Enter 查看，Escape 关闭详情。也可以通过要素列表浏览。</p><button disabled={!atlasMap} onClick={()=>atlasMap?.getCanvas().focus({preventScroll:true})}>进入地图操作</button></details>
{atlasControls&&<RailwayControls store={atlasControls.controls} onAction={atlasControls.changeFilters}/>}
<div className="browse-note"><strong>试着从沈阳北站开始</strong><p>放大查看站场；点击线路或站名，了解名称、等级与来源。</p></div><MapStatus store={atlasControls?.feedback} onCurrentVersion={()=>atlasRef.current?.openCurrentVersion()}/></aside>
<div className="map-caption"><span className="live-dot"></span> 地理铁路图 <span>SHENYANG / 01</span></div><div className="map-actions"><BasemapControl map={atlasMap} /><button id="share-open" disabled={!currentSnapshot||!atlasControls} onClick={()=>setShareContext(atlasRef.current?.getShareContext()||null)}>分享</button><button id="home" disabled={!atlasControls} onClick={()=>atlasControls?.home()}>回到试验区</button><button id="panel-toggle" aria-expanded={!panelCollapsed} aria-controls="explore" onClick={()=>setPanelCollapsed(value=>!value)}>{panelCollapsed?'打开面板':'收起面板'}</button></div><MapNotice store={atlasControls?.feedback}/>
{atlasControls&&<MapHover store={atlasControls.hover}/>}
{atlasControls&&<FeaturePanels store={atlasControls.featurePanels} feedback={atlasControls.feedback} onClose={atlasControls.closeDetails} onCloseCandidates={atlasControls.closeCandidates} onChoose={atlasControls.chooseCandidate} onRetry={atlasControls.retryDetails} onLayout={atlasControls.panelsLayout} onAbout={showDataAbout}/>}
</main>
{shareContext&&<ShareDialog context={shareContext} onClose={()=>setShareContext(null)}/>}{aboutRequest&&<AboutDialog manifest={aboutRequest.manifest} snapshot={aboutRequest.snapshot} onClose={()=>setAboutRequest(null)}/>}

{listOpen&&<AccessibleExplorer open mapAvailable={Boolean(atlasMap)&&!mapFailure} onClose={closeList} onShowMap={showOnMap} onAbout={showDataAbout}/>}
</div>;
}
