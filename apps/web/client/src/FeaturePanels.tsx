import {useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import type {RailFeature,LineRecord,DatasetManifest} from '../../shared/atlas-types.ts';
import {FACILITY_LABELS,MODE_LABELS,CLASS_LABELS,STATUS_LABELS} from '../../shared/model.mjs';
import {RecordFields,RecordProvenance} from './RecordFields';
import type {FeaturePanelsStore} from './feature-details.ts';
import {DetailMapNotice} from './MapFeedback';
import type {MapFeedbackStore} from './map-feedback';
const lookup=(labels:Record<string,string>,key:unknown)=>labels[String(key)];
const title=(p:RailFeature['properties'])=>p.display_name||p.name||lookup(FACILITY_LABELS,p.facility_kind)||'未命名要素';
const kind=(p:RailFeature['properties'])=>['station','station_area'].includes(p.feature_kind||'')?(MODE_LABELS[p.rail_mode]||'制式未标注'):(p.feature_kind==='facility'?lookup(FACILITY_LABELS,p.facility_kind):(lookup(CLASS_LABELS,p.line_class)||'等级未标注'));
function Details({feature,snapshot,lines,manifest,onAbout}:{feature:RailFeature;snapshot:string;lines:readonly LineRecord[];manifest?:DatasetManifest;onAbout:(manifest?:DatasetManifest)=>void}){
  const p=feature.properties;
  return <><h2 className="feature-title" tabIndex={-1}>{title(p)}</h2>
    <div className="badges"><span className="badge">{kind(p)}</span><span className="badge">{STATUS_LABELS[p.status]||p.status}</span></div>
    <p className="feature-note">{p.feature_kind==='facility'?'设施来自源标签；未确认的车站关联保持独立。':['station','station_area'].includes(p.feature_kind||'')?'车站记录不按附近轨道推断高铁站或运营状态。':'轨道片段的名称与等级来自源标签，不等同于整条运营线路。'}</p>
    <RecordFields properties={p} lines={lines}/>
    {Boolean(p.class_warnings?.length)&&<p className="feature-note">{p.class_warnings?.join('；')}</p>}
    <RecordProvenance properties={p} snapshot={snapshot} manifest={manifest} onAbout={onAbout}/><p className="feature-note">地图数据 © OpenStreetMap contributors · 当前标注不保证运营。</p></>;
}
interface Props {store:FeaturePanelsStore;feedback:MapFeedbackStore;onClose:()=>void;onCloseCandidates:()=>void;onChoose:(feature:RailFeature)=>void;onRetry:()=>void;onLayout:()=>void;onAbout:(manifest?:DatasetManifest)=>void}
export default function FeaturePanels({store,feedback,onClose,onCloseCandidates,onChoose,onRetry,onLayout,onAbout}:Props){
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot),panel=useRef<HTMLElement>(null),candidates=useRef<HTMLElement>(null);
  const retryFocus=useRef(false),interaction=useRef(0),retryInteraction=useRef(0);
  const open=state.detail.status!=='closed',candidateOpen=state.candidates.length>0;
  useLayoutEffect(()=>{onLayout();},[open,candidateOpen,onLayout]);
  useLayoutEffect(()=>{if(candidateOpen)candidates.current?.querySelector<HTMLButtonElement>('#candidate-list button')?.focus();},[state.candidates,candidateOpen]);
  useLayoutEffect(()=>{
    if(!retryFocus.current)return;
    if(state.detail.status==='loading')panel.current?.querySelector<HTMLElement>('[data-loading]')?.focus({preventScroll:true});
    else {
      if(open&&interaction.current===retryInteraction.current&&(panel.current?.contains(document.activeElement)||document.activeElement===document.body))panel.current?.querySelector<HTMLElement>('.feature-title,#detail-retry')?.focus({preventScroll:true});
      retryFocus.current=false;
    }
  },[state.detail,open]);
  function retry(){retryFocus.current=true;retryInteraction.current=interaction.current;onRetry();}
  return <><section ref={panel} id="feature-panel" aria-label="要素详情" hidden={!open} onPointerDownCapture={()=>{interaction.current++;}} onKeyDownCapture={()=>{interaction.current++;}}>
    <div className="detail-top"><span className="eyebrow">地图记录</span><button id="detail-close" aria-label="关闭详情" onClick={onClose}>×</button></div>
    <DetailMapNotice store={feedback}/>
    <div id="detail-body" aria-busy={state.detail.status==='loading'}>
      {state.detail.status==='loading'&&<p data-loading tabIndex={-1} role="status" className="feature-note">正在读取来源记录…</p>}
      {state.detail.status==='ready'&&<Details key={state.detail.feature.properties.osm_id+state.snapshot} feature={state.detail.feature} snapshot={state.snapshot} lines={state.lines} manifest={state.manifest} onAbout={onAbout}/>}
      {state.detail.status==='error'&&<><p role="alert" className="feature-note">{state.detail.message}</p><button id="detail-retry" onClick={retry}>重试详情</button></>}
    </div>
  </section><section ref={candidates} id="candidates" aria-label="选择重叠对象" hidden={!candidateOpen}>
    <div className="section-heading"><h2>你想查看哪一项？</h2><button id="candidate-close" aria-label="关闭候选" onClick={onCloseCandidates}>×</button></div>
    <div id="candidate-list">{state.candidates.map(feature=><button key={feature.properties.osm_id} onClick={()=>onChoose(feature)}>{title(feature.properties)} · {kind(feature.properties)} · {feature.properties.osm_id}</button>)}</div>
  </section></>;
}
