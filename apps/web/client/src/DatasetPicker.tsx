import {useEffect, useRef, useState} from 'react';
import {parseCatalog,type Catalog,type CatalogCamera} from './catalog-validation';
import {requestJson,JsonReadTimeoutError} from './json-request';

interface Props {current:string;onSwitch:(snapshot:string,signal:AbortSignal,camera:CatalogCamera)=>Promise<void>}
const dateLabel=(value?:string)=>{if(!value)return '未标注';const date=new Date(value);return Number.isNaN(date.valueOf())?'未标注':date.toLocaleString('zh-CN',{hour12:false});};

export default function DatasetPicker({current,onSwitch}: Props){
  const [catalog,setCatalog]=useState<Catalog|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [region,setRegion]=useState('shenyang'),[target,setTarget]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const pending=useRef<AbortController|null>(null),generation=useRef(0);
  useEffect(()=>{
    const abort=new AbortController();setError('');
    requestJson('/catalog.json',abort.signal,()=>Error('数据目录加载失败')).then(parseCatalog).then(value=>{
      if(!abort.signal.aborted)setCatalog(value);
    }).catch(error=>{if(!abort.signal.aborted)setError(error instanceof JsonReadTimeoutError?'数据目录读取超时，请检查网络后重试。':'数据目录暂时无法读取或格式无效');});
    return ()=>abort.abort();
  },[attempt]);
  useEffect(()=>{setTarget(current);},[current]);
  useEffect(()=>()=>{pending.current?.abort();++generation.current;},[]);
  useEffect(()=>{const cancel=()=>{setTarget(current);if(pending.current){pending.current.abort();pending.current=null;++generation.current;setBusy(false);setMessage('已取消版本切换，正在恢复历史视图。');}};window.addEventListener('popstate',cancel);return()=>window.removeEventListener('popstate',cancel);},[current]);
  const selectedRegion=catalog?.regions.find(r=>r.id===region)||catalog?.regions[0];
  const entry=selectedRegion?.snapshots.find(s=>s.id===target);
  async function changeVersion(){
    if(!selectedRegion||!entry)return;
    pending.current?.abort();const abort=new AbortController(),token=++generation.current;pending.current=abort;setBusy(true);setMessage('正在准备所选版本，当前地图仍可浏览…');
    try{await onSwitch(entry.id,abort.signal,selectedRegion.default_view);if(token===generation.current)setMessage('已切换数据版本，筛选与查询已保留。');}
    catch(error){if(token===generation.current)setMessage(abort.signal.aborted?'已取消，继续浏览原版本。':error instanceof JsonReadTimeoutError?'版本读取超时，已保留原地图、视图和选中记录。可重试或选择其他版本。':'版本加载失败，已保留原地图、视图和选中记录。可重试或选择其他版本。');}
    finally{if(token===generation.current){pending.current=null;setBusy(false);}}
  }
  function cancel(){pending.current?.abort();pending.current=null;++generation.current;setBusy(false);setMessage('已取消，继续浏览原版本。');}
  return <details id="dataset-picker"><summary>地区与数据版本</summary>
    {!catalog&&!error&&<p role="status">正在读取数据目录…</p>}
    {error&&<p role="alert">{error}；当前地图仍可浏览。<button onClick={()=>setAttempt(v=>v+1)}>重试数据目录</button></p>}
    {catalog&&selectedRegion&&<><label htmlFor="dataset-region">可用地区</label><select id="dataset-region" value={selectedRegion.id} onChange={event=>{cancel();setRegion(event.target.value);setTarget(catalog.regions.find(r=>r.id===event.target.value)?.current_snapshot||'');}}>{catalog.regions.map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select>
      <p className="hint">仅列出已有数据的地区。沈阳范围为试验矩形，其他地区尚未提供。</p>
      <label htmlFor="dataset-version">数据版本</label><select id="dataset-version" value={target} onChange={event=>{cancel();setTarget(event.target.value);setMessage('');}}>
        {!selectedRegion.snapshots.some(s=>s.id===target)&&<option value={target}>{target||'当前版本正在读取'}</option>}
        {selectedRegion.snapshots.map(s=><option key={s.id} value={s.id}>{dateLabel(s.build_time)}{s.id===selectedRegion.current_snapshot?' · 当前推荐':''}{s.object_list?' · 完整要素列表':' · 车站列表'}</option>)}
      </select>
      {entry&&<p className="hint">构建于 {dateLabel(entry.build_time)}。此版本保留至 {dateLabel(entry.retention_until)}。</p>}
      <button disabled={busy||!entry||target===current} onClick={changeVersion}>使用此版本</button>{busy&&<button onClick={cancel}>取消切换</button>}
      <p className="hint">版本切换会清除选中对象、回到地区默认视图，并保留筛选、查询和底图偏好。</p>
    </>}
    <p id="dataset-switch-status" role="status">{message}</p>
  </details>;
}
