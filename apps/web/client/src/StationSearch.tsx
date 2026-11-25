import {useEffect,useRef,useSyncExternalStore} from 'react';
import {MODE_LABELS} from '../../shared/model.mjs';
import type {RegionProfile} from './catalog-validation';
import {stationOptionId,type StationSearchStore} from './station-search';
interface Props {store:StationSearchStore;region:RegionProfile|null;onChoose:(key:string,trigger:HTMLElement)=>void}
export default function StationSearch({store,region,onChoose}:Props){
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(state.activeKey)document.getElementById(stationOptionId(state.activeKey))?.scrollIntoView({block:'nearest'});},[state.activeKey]);
  // Region names and examples come from the region shown, so search never names another region's stations.
  const regionName=region?.name||'当前地区',example=region?.ui.search_example||'';
  const message=!state.query.trim()?'':state.composing?'输入中，确认后查找。':state.pending?'正在查找车站…':state.availability==='blocked'?'数据说明暂不可用，请先重试数据说明。':state.availability==='unavailable'?'车站索引暂不可用，请重试车站搜索。':state.availability==='loading'?'正在读取车站索引…':!state.total?(example?`当前区域没有匹配记录，请试试“${example}”或检查名称。`:'当前区域没有匹配记录，请检查名称。'):state.total>20?'匹配超过 20 条，请补充名称。':`匹配 ${state.total} 条站点 / 站区记录。`;
  return <>
    <label className="search-label" htmlFor="search">查找车站</label>
    <div className="search-box"><span aria-hidden="true">⌕</span><input ref={input} id="search" placeholder={region?.ui.search_placeholder||'输入车站名称'} autoComplete="off" maxLength={200} role="combobox" aria-autocomplete="list" aria-controls="station-options" aria-describedby="search-status" aria-expanded={state.results.length>0} aria-activedescendant={state.activeKey?stationOptionId(state.activeKey):undefined} value={state.query}
      onChange={event=>store.input(event.target.value,'isComposing' in event.nativeEvent&&event.nativeEvent.isComposing===true)}
      onCompositionStart={()=>store.beginComposition()} onCompositionEnd={event=>store.endComposition(event.currentTarget.value)}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||store.getSnapshot().composing)return;
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();store.move(event.key==='ArrowDown'?1:-1);}
        if(event.key==='Enter'){const entry=store.choice();if(entry){event.preventDefault();onChoose(entry.feature.id,event.currentTarget);}}
      }}/><button id="search-clear" aria-label="清空搜索" onClick={()=>{store.clear();input.current?.focus();}}>×</button></div>
    <p className="hint">搜索{regionName} · 铁路和地铁分别显示</p>
    <div id="results"><div id="station-options" role="listbox" aria-label="车站搜索结果" aria-busy={state.pending||state.availability==='loading'}>
      {state.results.map(({feature,hidden})=><button type="button" key={feature.id} id={stationOptionId(feature.id)} role="option" aria-selected={state.activeKey===feature.id} tabIndex={-1} onClick={event=>onChoose(feature.id,event.currentTarget)}><span>{feature.properties.display_name||'未命名车站'}</span><small>{MODE_LABELS[feature.properties.rail_mode]||'制式未标注'} · {feature.properties.feature_kind==='station_area'?'站区':'站点'} · {hidden?'当前筛选已隐藏 · 点击临时显示':regionName}</small></button>)}
    </div><p id="search-status" className="hint" role="status" aria-live="polite">{message}</p></div>
  </>;
}
