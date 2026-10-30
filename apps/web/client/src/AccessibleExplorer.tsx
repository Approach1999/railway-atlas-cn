import {useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {decodeView, encodeView, type ShareView} from './view-state';
import {CLASS_LABELS, MODE_LABELS, STATUS_LABELS, FACILITY_LABELS, FILTER_MODES, FILTER_RAIL_CLASSES, FILTER_STATES, normalize, overlayVisible, trackVisible} from '../../shared/model.mjs';
import type {RailProperties,RailFeature,DatasetManifest,LineRecord} from '../../shared/atlas-types';
import {validateManifest,validateStations,validateRailFeature,validateObjectIndex,validateLines} from './dataset-validation';
import {RecordFields,RecordProvenance} from './RecordFields';
import {listJson} from './list-request';
type RecordIndex=RailProperties;
type SourceRecord=RailFeature;
interface Props {
  open: boolean; mapAvailable: boolean; onClose: ()=>void;onAbout:(manifest?:DatasetManifest)=>void;
  onShowMap: (view: ShareView)=>Promise<void>;
}
const label=(labels: Record<string,string>,key: unknown)=>labels[String(key)]||'未标注';
const title=(record: RecordIndex)=>record.display_name||label(FACILITY_LABELS,record.facility_kind||'')+' · '+record.osm_id;

export default function AccessibleExplorer({open,mapAvailable,onClose,onShowMap,onAbout}: Props){
  const dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const [view,setView]=useState(()=>decodeView(location.href).view);
  const [records,setRecords]=useState<RecordIndex[]>([]),[snapshot,setSnapshot]=useState('');
  const [sourceTime,setSourceTime]=useState('');
  const [dataset,setDataset]=useState<DatasetManifest>();
  const [lineCatalog,setLineCatalog]=useState<LineRecord[]>([]),[lineError,setLineError]=useState(''),[lineLoading,setLineLoading]=useState(false),[lineRetry,setLineRetry]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[warning,setWarning]=useState('');
  const [unavailable,setUnavailable]=useState(false);
  const [retry,setRetry]=useState(0),[kind,setKind]=useState('all'),[page,setPage]=useState(0);
  const [selected,setSelected]=useState(''),[detail,setDetail]=useState<SourceRecord|null>(null);
  const [detailError,setDetailError]=useState(''),[detailRetry,setDetailRetry]=useState(0),[detailLoading,setDetailLoading]=useState(false);
  const [share,setShare]=useState(''),[shareStatus,setShareStatus]=useState('');
  const [mapActionError,setMapActionError]=useState('');
  const detailRef=useRef<HTMLElement>(null),lastRecordButton=useRef<HTMLButtonElement|null>(null);
  const lineFocus=useRef<number|null>(null);
  const interaction=useRef(0),detailFocus=useRef<{key:string;origin:Element|null;interaction:number}|null>(null);
  const shareRequest=useRef(0);
  const shareUrl=new URL(encodeView({...view,snapshot,feature:selected||null}),location.origin).href;
  useLayoutEffect(()=>{
    ++shareRequest.current;setShare('');setShareStatus('');
    return ()=>{++shareRequest.current;};
  },[open,shareUrl]);
  useLayoutEffect(()=>{
    const request=detailFocus.current;
    if(!open||!request||detail?.properties.osm_id!==selected||request.key!==selected)return;
    if(request.interaction===interaction.current&&(document.activeElement===request.origin||document.activeElement===document.body)){
      detailRef.current?.focus({preventScroll:true});
      detailRef.current?.scrollIntoView({block:'start'});
    }
    detailFocus.current=null;
  },[open,selected,detail]);
  useLayoutEffect(()=>{
    if(lineFocus.current===null||lineLoading)return;
    if(lineFocus.current===interaction.current&&(document.activeElement===document.body||document.activeElement?.getAttribute('data-line-retry')==='true')){
      if(lineError)dialog.current?.querySelector<HTMLElement>('[data-line-retry]')?.focus({preventScroll:true});
      else detailRef.current?.focus({preventScroll:true});
    }
    lineFocus.current=null;
  },[lineLoading,lineError]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null;
    setView(decodeView(location.href).view);setSelected(decodeView(location.href).view.feature||'');
    setPage(0);setKind('all');setShare('');setShareStatus('');setMapActionError('');
    dialog.current?.showModal();heading.current?.focus();
    return ()=>{dialog.current?.close();if(previous?.isConnected)previous.focus();};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const abort=new AbortController(),decoded=decodeView(location.href).view;
    let prefix=decoded.snapshot?'/snapshots/'+decoded.snapshot:'';
    function json(path: string):Promise<unknown>{return listJson(prefix+path,abort.signal,status=>{if(path==='/dataset.json'&&decoded.snapshot&&!abort.signal.aborted)setUnavailable([404,410].includes(status));return Error(status===410?'此数据版本已超过保留期。':'读取失败（'+status+'）');});}
    setLoading(true);setError('');setWarning('');setRecords([]);setSnapshot('');setDataset(undefined);setUnavailable(false);
    (async()=>{
      const manifest=await json('/dataset.json');
      validateManifest(manifest,decoded.snapshot||undefined);
      if(abort.signal.aborted)return;
      if(!/^[A-Za-z0-9_-]{1,80}$/.test(manifest.snapshot_id))throw Error('数据版本标识无效');
      prefix='/snapshots/'+manifest.snapshot_id;
      setSnapshot(manifest.snapshot_id);setDataset(manifest);
      const source=manifest.source||{},time=(typeof source.osm_base==='object'?source.osm_base.osm_base:source.osm_base)||source.osm_timestamp||source.source_time;
      setSourceTime(typeof time==='string'?time:'未标注');
      if(manifest.object_index==='objects.json'){
        const index=await json('/objects.json');
        validateObjectIndex(index,manifest.snapshot_id);
        if(!abort.signal.aborted)setRecords(index.records);
      }else{
        const stations=await json('/stations.geojson');
        validateStations(stations);
        if(!abort.signal.aborted){setRecords(stations.features.map(f=>f.properties));setWarning('此旧快照仅提供车站列表；完整轨道和设施列表需使用当前数据版本。');}
      }
    })().catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return ()=>abort.abort();
  },[open,retry]);
  useEffect(()=>{
    if(!open||!snapshot||!dataset||dataset.schema_version<2){setLineCatalog([]);setLineError('');setLineLoading(false);return;}
    const abort=new AbortController();let active=true;
    setLineLoading(true);
    (async()=>{
      const value=await listJson('/snapshots/'+snapshot+'/lines.json',abort.signal,status=>Error('线路名称读取失败（'+status+'）'));
      validateLines(value,snapshot);
      if(active){setLineCatalog(value.lines);setLineError('');}
    })().catch(()=>{if(active)setLineError('线路名称暂不可用，详情保留源线路编号。');}).finally(()=>{if(active)setLineLoading(false);});
    return ()=>{active=false;abort.abort();};
  },[open,snapshot,dataset,lineRetry]);
  useEffect(()=>{
    if(!open||!selected||!snapshot){setDetail(null);return;}
    const abort=new AbortController();setDetail(null);setDetailError('');setDetailLoading(true);
    detailFocus.current={key:selected,origin:document.activeElement,interaction:interaction.current};
    (async()=>{
      const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(selected)))[0].toString(16).padStart(2,'0');
      abort.signal.throwIfAborted();
      const shard=await listJson('/snapshots/'+snapshot+'/details/'+hash+'.json',abort.signal,status=>Error('详情读取失败（'+status+'）'));
      if(!shard||typeof shard!=='object'||Array.isArray(shard))throw Error('详情分片无效');
      const source=(shard as Record<string,unknown>)[selected];
      if(!source)throw Error('此快照没有该记录');
      validateRailFeature(source);if(source.properties.osm_id!==selected)throw Error('详情身份与当前记录不一致');
      if(!abort.signal.aborted)setDetail(source);
    })().catch(e=>{if(!abort.signal.aborted)setDetailError(e.message);}).finally(()=>{if(!abort.signal.aborted)setDetailLoading(false);});
    return ()=>abort.abort();
  },[open,selected,snapshot,detailRetry]);
  const matched=useMemo(()=>{
    const query=normalize(view.query);
    return records.filter(record=>{
      if(kind==='stations'&&!['station','station_area'].includes(record.feature_kind||''))return false;
      if(kind==='tracks'&&record.feature_kind!=='track')return false;
      if(kind==='facilities'&&record.feature_kind!=='facility')return false;
      if(record.feature_kind==='facility'&&!view.filters.facilities)return false;
      if(record.feature_kind==='track'){
        if(!trackVisible(record,view.filters,18))return false;
        if(view.filters.lineKeys!==null&&!view.filters.lineKeys.some(key=>(record.line_keys||[]).includes(key)))return false;
      }else if(!overlayVisible(record,view.filters))return false;
      return !query||[record.display_name,record.osm_id,label(FACILITY_LABELS,record.facility_kind||''),...(record.aliases||[])].some(text=>normalize(text).includes(query));
    }).sort((a,b)=>title(a).localeCompare(title(b),'zh-CN')||a.osm_id.localeCompare(b.osm_id));
  },[records,view,kind]);
  function change(next: ShareView){setView(next);setPage(0);setShare('');}
  function toggle(field:'types'|'states'|'classes',value:string){
    const values=new Set(view.filters[field]);values.has(value)?values.delete(value):values.add(value);
    const filters={...view.filters,preset:'custom' as const,[field]:[...values]};filters.history=filters.states.some(state=>state!=='mapped');
    change({...view,filters});
  }
  function closeDetail(){setSelected('');setDetail(null);lastRecordButton.current?.focus();}
  async function shareView(){
    const request=++shareRequest.current;setShare(shareUrl);setShareStatus('正在复制链接…');
    try{await navigator.clipboard.writeText(shareUrl);if(request===shareRequest.current)setShareStatus('链接已复制。');}
    catch{if(request===shareRequest.current)setShareStatus('请复制下方链接。');}
  }
  function containFocus(event: KeyboardEvent<HTMLDialogElement>){
    if(event.key!=='Tab')return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,a[href],[tabindex="0"]')].filter(element=>element.getClientRects().length>0);
    if(!controls.length){event.preventDefault();heading.current?.focus();return;}
    const index=controls.indexOf(document.activeElement as HTMLElement);
    if(event.shiftKey&&index<=0){event.preventDefault();controls.at(-1)?.focus();}
    else if(!event.shiftKey&&(index<0||index===controls.length-1)){event.preventDefault();controls[0].focus();}
  }
  const p=detail?.properties.osm_id===selected?detail.properties:undefined,start=page*40,totalPages=Math.max(1,Math.ceil(matched.length/40));
  return <dialog id="accessible-explorer" ref={dialog} aria-labelledby="list-title" onKeyDown={containFocus} onKeyDownCapture={event=>{if(event.key==='Tab'||event.key==='Escape')++interaction.current;}} onInputCapture={()=>{++interaction.current;}} onPointerDownCapture={()=>{++interaction.current;}} onWheelCapture={()=>{++interaction.current;}} onCancel={event=>{event.preventDefault();onClose();}}>
    <button className="dialog-close" aria-label="关闭要素列表" onClick={onClose}>×</button>
    <h2 id="list-title" ref={heading} tabIndex={-1}>车站与要素列表</h2>
    <p>通过文字查看轨道、车站和设施。列表遵守类型、线路与状态筛选；等级仅筛选铁路轨道，不推断车站或设施等级。列表不受地图缩放限制。</p>
    {!mapAvailable&&<p role="status">地图暂不可用，可以继续搜索、筛选、查看来源和分享记录。</p>}
    <p className="hint">地图数据 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> · ODbL · 快照 {snapshot||'正在读取'} · 数据时间 {sourceTime||'正在读取'}</p>
    <label htmlFor="list-query">搜索名称、别名、设施类别或来源编号</label>
    <input id="list-query" value={view.query} onChange={event=>change({...view,query:event.target.value.slice(0,200)})}/>
    <label htmlFor="list-kind">记录类别</label><select id="list-kind" value={kind} onChange={event=>{setKind(event.target.value);setPage(0);}}>
      <option value="all">全部记录</option><option value="stations">车站与站区</option><option value="tracks">轨道片段</option><option value="facilities">站场与设施</option>
    </select>
    <label className="check"><input type="checkbox" checked={view.filters.facilities} onChange={event=>change({...view,filters:{...view.filters,facilities:event.target.checked}})}/>包含设施记录</label>
    <details><summary>列表筛选</summary>
      {([['types','轨道类型',FILTER_MODES,MODE_LABELS],['states','数据状态',FILTER_STATES,STATUS_LABELS],['classes','铁路等级',FILTER_RAIL_CLASSES,CLASS_LABELS]] as const).map(([field,title,values,labels])=><fieldset key={field}><legend>{title}</legend>{values.map(value=><label className="check" key={value}><input type="checkbox" aria-label={'列表'+title+'：'+label(labels,value)} checked={view.filters[field].includes(value)} onChange={()=>toggle(field,value)}/>{label(labels,value)}</label>)}</fieldset>)}
      <label className="check"><input type="checkbox" checked={view.filters.sidings} onChange={event=>change({...view,filters:{...view.filters,sidings:event.target.checked}})}/>包含支线与站场线</label>
      {view.filters.lineKeys!==null&&<p>当前限制到 {view.filters.lineKeys.join('、')||'零条线路'}。<button onClick={()=>change({...view,filters:{...view.filters,lineKeys:null}})}>恢复全部线路</button></p>}
    </details>
    {loading&&<p role="status">正在读取要素列表…</p>}{warning&&<p role="status">{warning}</p>}
    {error&&<p role="alert">{error} <button onClick={()=>setRetry(value=>value+1)}>重试列表</button>{unavailable&&<button onClick={()=>location.assign(encodeView({...view,snapshot:'',feature:selected||null}))}>打开当前数据列表</button>}</p>}
    {!loading&&!error&&<><p role="status">找到 {matched.length} 条记录，第 {page+1} / {totalPages} 页。</p>
      {!matched.length&&<p>没有符合当前搜索与筛选的记录。<button onClick={()=>{setKind('all');change({...view,query:'',filters:decodeView('/').view.filters});}}>恢复默认列表</button></p>}
      <ul className="object-list">{matched.slice(start,start+40).map(record=><li key={record.osm_id}><button onClick={event=>{lastRecordButton.current=event.currentTarget;setSelected(record.osm_id);}}>
        <strong>{title(record)}</strong><span>{label(MODE_LABELS,record.rail_mode)} · {record.feature_kind==='track'?'轨道片段':record.feature_kind==='station_area'?'站区':record.feature_kind==='station'?'站点':label(FACILITY_LABELS,record.facility_kind||'')} · {label(STATUS_LABELS,record.status)}</span><small>{record.osm_id}</small>
      </button></li>)}</ul>
      <nav aria-label="要素列表分页"><button disabled={page===0} onClick={()=>setPage(value=>value-1)}>上一页</button><button disabled={page+1>=totalPages} onClick={()=>setPage(value=>value+1)}>下一页</button></nav></>}
    {selected&&<section ref={detailRef} tabIndex={-1} className="list-record" aria-label="列表记录详情">
      <button onClick={closeDetail}>关闭记录详情</button>
      {detailLoading&&<p role="status">正在读取记录详情…</p>}
      {detailError&&<p role="alert">{detailError} <button onClick={()=>setDetailRetry(value=>value+1)}>重试记录详情</button></p>}
      {p&&<><h3>{title(p)}</h3><p>{label(MODE_LABELS,p.rail_mode)} · {label(STATUS_LABELS,p.status)} · {p.osm_id}</p>
        {lineError&&<p role="status">{lineError} <button data-line-retry="true" disabled={lineLoading} onClick={()=>{lineFocus.current=interaction.current;setLineRetry(value=>value+1);}}>{lineLoading?'正在重试线路名称…':'重试列表线路名称'}</button></p>}
        <RecordFields properties={p} lines={lineCatalog}/>
        {!!p.class_warnings?.length&&<p role="status">{p.class_warnings.join('；')}</p>}
        {!matched.some(record=>record.osm_id===selected)&&<p role="status">此记录不在当前列表结果中，详情仍保留。</p>}
        <p>源标签不保证实际运营；未确认的关联保持独立。</p>
        <RecordProvenance properties={p} snapshot={snapshot} manifest={dataset} summary="原始标注" onAbout={onAbout}/>
        {mapAvailable&&<button onClick={async()=>{try{setMapActionError('');await onShowMap({...view,snapshot,feature:selected});onClose();}catch{setMapActionError('地图尚未就绪，可以继续阅读此记录，稍后重试。');}}}>在地图中查看</button>}
        {mapActionError&&<p role="alert">{mapActionError}</p>}</>}
    </section>}
    <button disabled={!snapshot} onClick={shareView}>复制当前视图与记录链接</button>
    {share&&<><label htmlFor="list-share">分享链接（需可访问此服务）</label><input id="list-share" value={share} readOnly onFocus={event=>event.target.select()}/></>}
    <p role="status">{shareStatus}</p>
  </dialog>;
}
