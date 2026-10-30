import type {RailFeature,LineRecord} from '../../shared/atlas-types.ts';
import {FACILITY_LABELS,CLASS_LABELS,MODE_LABELS,STATUS_LABELS} from '../../shared/model.mjs';
export interface HoverItem {readonly id:string;readonly name:string;readonly kind:string;readonly status:string;readonly lines:string}
export interface HoverSnapshot {readonly x:number;readonly y:number;readonly items:readonly HoverItem[];readonly total:number}
export function hoverItems(features:readonly RailFeature[],lines:readonly LineRecord[]):HoverItem[]{
  return features.slice(0,3).map(({properties:p})=>({id:p.osm_id,name:p.display_name||p.name||FACILITY_LABELS[p.facility_kind||'']||'未命名轨道',kind:p.feature_kind==='facility'?(FACILITY_LABELS[p.facility_kind||'']||'设施类别未标注'):['station','station_area'].includes(p.feature_kind||'')?`${MODE_LABELS[p.rail_mode]||'制式未标注'} · ${p.feature_kind==='station_area'?'站区':'车站'}`:(CLASS_LABELS[p.line_class||'']||MODE_LABELS[p.rail_mode]||'等级未标注'),status:STATUS_LABELS[p.status]||'状态未标注',lines:(p.line_keys||[]).map(key=>lines.find(line=>line.line_key===key)?.name||key).join(' / ')}));
}
export function createMapHover(){
  let state:HoverSnapshot|null=null,blocked:string|null=null,disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const listeners=new Set<()=>void>();
  function cancel(){clearTimeout(timer);timer=undefined;}
  function publish(next:HoverSnapshot|null){if(disposed)return;state=next;listeners.forEach(listener=>listener());}
  function clear(){cancel();blocked=null;if(state)publish(null);}
  return {
    getSnapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    show(items:readonly HoverItem[],total:number,x:number,y:number){
      if(disposed)return;cancel();const key=items.map(item=>item.id).join(',');
      if(!items.length){clear();return;}
      if(blocked===key)return;blocked=null;
      if(state&&state.x===x&&state.y===y&&state.total===total&&JSON.stringify(state.items)===JSON.stringify(items))return;
      publish(Object.freeze({x,y,total,items:Object.freeze(items.map(item=>Object.freeze({...item})))}));
    },
    clear,
    dismiss(){cancel();blocked=state?.items.map(item=>item.id).join(',')||null;if(state)publish(null);},
    hold:cancel,
    leave(){cancel();timer=setTimeout(clear,180);},
    dispose(){disposed=true;cancel();listeners.clear();}
  };
}
export type MapHoverStore=ReturnType<typeof createMapHover>;
