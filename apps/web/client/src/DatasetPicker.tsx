import {useEffect,useState,useSyncExternalStore} from 'react';
import type {CatalogStore} from './catalog-store';
import {switchMessage,type DatasetSwitchStore} from './dataset-switch';
import {REGION_CONFIG} from './region-config.ts';

interface Props {current:string;currentRegion:string|null;directory:CatalogStore;switcher:DatasetSwitchStore}
const dateLabel=(value?:string)=>{if(!value)return '未标注';const date=new Date(value);return Number.isNaN(date.valueOf())?'未标注':date.toLocaleString('zh-CN',{hour12:false});};

export default function DatasetPicker({current,currentRegion,directory,switcher}: Props){
  const {status,catalog,message:directoryMessage}=useSyncExternalStore(directory.subscribe,directory.getSnapshot);
  const switching=useSyncExternalStore(switcher.subscribe,switcher.getSnapshot),busy=switching.status==='busy';
  // A null choice follows the loaded region; a value is a region chosen here but not used yet.
  const [region,setRegion]=useState<string|null>(null),[target,setTarget]=useState('');
  useEffect(()=>{setTarget(current);setRegion(null);},[current]);
  useEffect(()=>{const cancel=()=>{setTarget(current);switcher.cancel('history');};window.addEventListener('popstate',cancel);return ()=>window.removeEventListener('popstate',cancel);},[current,switcher]);
  const entryOf=(id:string|null|undefined)=>catalog?.regions.find(item=>item.id===id);
  const selectedRegion=entryOf(region)||entryOf(currentRegion)||catalog?.regions[0];
  const entry=selectedRegion?.snapshots.find(snapshot=>snapshot.id===target);
  const description=REGION_CONFIG.regions.find(profile=>profile.id===selectedRegion?.id)?.description||'';
  const name=(id:string)=>entryOf(id)?.name||REGION_CONFIG.regions.find(profile=>profile.id===id)?.name;
  function changeVersion(){
    if(!selectedRegion||!entry)return;
    switcher.request({snapshot:entry.id,region:selectedRegion.id,camera:selectedRegion.default_view,crossRegion:selectedRegion.id!==currentRegion});
  }
  function chooseRegion(id:string){
    switcher.cancel();
    setRegion(id===currentRegion?null:id);
    setTarget(catalog?.regions.find(item=>item.id===id)?.current_snapshot||'');
  }
  function cancel(){switcher.cancel();}
  return <details id="dataset-picker"><summary>地区与数据版本</summary>
    {status==='loading'&&!catalog&&<p role="status">正在读取数据目录…</p>}
    {status==='error'&&<p role="alert">{directoryMessage}；当前地图仍可浏览。<button onClick={()=>{void directory.load().catch(()=>{});}}>重试数据目录</button></p>}
    {catalog&&selectedRegion&&<><label htmlFor="dataset-region">可用地区</label><select id="dataset-region" value={selectedRegion.id} onChange={event=>chooseRegion(event.target.value)}>{catalog.regions.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <p className="hint">仅列出已有数据的地区。{description}</p>
      <label htmlFor="dataset-version">数据版本</label><select id="dataset-version" value={target} onChange={event=>{switcher.cancel();setTarget(event.target.value);}}>
        {!selectedRegion.snapshots.some(snapshot=>snapshot.id===target)&&<option value={target}>{target||'当前版本正在读取'}</option>}
        {selectedRegion.snapshots.map(snapshot=><option key={snapshot.id} value={snapshot.id}>{dateLabel(snapshot.build_time)}{snapshot.id===selectedRegion.current_snapshot?' · 当前推荐':''}{snapshot.object_list?' · 完整要素列表':' · 车站列表'}</option>)}
      </select>
      {entry&&<p className="hint">构建于 {dateLabel(entry.build_time)}。此版本保留至 {dateLabel(entry.retention_until)}。</p>}
      <button disabled={busy||!entry||target===current} onClick={changeVersion}>使用此版本</button>{busy&&<button onClick={cancel}>取消切换</button>}
      <p className="hint">版本切换会清除选中对象、回到地区默认视图，并保留筛选、查询和底图偏好。</p>
    </>}
    <p id="dataset-switch-status" role="status">{switchMessage(switching,name)}</p>
  </details>;
}
