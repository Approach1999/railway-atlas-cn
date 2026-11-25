import type {CatalogCamera} from './catalog-validation.ts';
import {JsonReadTimeoutError} from './json-request.ts';

export interface SwitchRequest {readonly snapshot:string;readonly region:string;readonly camera:CatalogCamera;readonly crossRegion:boolean}
export type SwitchStatus='idle'|'busy'|'done'|'failed'|'cancelled';
export type SwitchOutcome='aborted'|'timeout'|'error'|'history'|'user';
export interface SwitchState {readonly request:SwitchRequest|null;readonly status:SwitchStatus;readonly outcome:SwitchOutcome|null}
export const initialSwitchState:SwitchState=Object.freeze({request:null,status:'idle',outcome:null});

/** One cancellable dataset switch at a time. A superseded or late result never publishes, so the
 * status always describes the switch the user most recently asked for. */
export function createDatasetSwitch(run:(request:SwitchRequest,signal:AbortSignal)=>Promise<void>){
  let state=initialSwitchState,generation=0,controller:AbortController|null=null,disposed=false;
  const listeners=new Set<()=>void>();
  function publish(change:Partial<SwitchState>){if(disposed)return;const next=Object.freeze({...state,...change});if((Object.keys(next) as Array<keyof SwitchState>).every(key=>next[key]===state[key]))return;state=next;listeners.forEach(listener=>listener());}
  function start(request:SwitchRequest){
    if(disposed)return;
    // Any earlier switch is abandoned; its result must not report over this one.
    const token=++generation;controller?.abort();controller=new AbortController();
    publish({request,status:'busy',outcome:null});
    void run(request,controller.signal).then(()=>{
      if(!disposed&&token===generation)publish({status:'done'});
    },error=>{
      if(disposed||token!==generation)return;
      publish({status:'failed',outcome:error instanceof JsonReadTimeoutError?'timeout':error?.name==='AbortError'?'aborted':'error'});
    });
  }
  return {
    getSnapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    request:(request:SwitchRequest)=>start(request),
    retry:()=>{if(state.status==='failed'&&state.request)start(state.request);},
    cancel:(outcome:'user'|'history'='user')=>{if(state.status!=='busy')return;++generation;controller?.abort();controller=null;publish({status:'cancelled',outcome});},
    dispose(){disposed=true;++generation;controller?.abort();listeners.clear();},
  };
}
export type DatasetSwitchStore=ReturnType<typeof createDatasetSwitch>;

/** Status text of a switch. A cross-region switch says so; nothing claims the region changed until it did. */
export function switchMessage(state:SwitchState,regionName:(id:string)=>string|undefined=()=>undefined):string{
  const request=state.request,cross=Boolean(request?.crossRegion);
  switch(state.status){
    case 'busy':return cross?'正在切换地区，当前地图仍可浏览…':'正在准备所选版本，当前地图仍可浏览…';
    case 'done':return cross&&request?`已切换到${regionName(request.region)||'所选地区'}，筛选与查询已保留，选中已清除。`:'已切换数据版本，筛选与查询已保留。';
    case 'cancelled':return state.outcome==='history'?'已取消版本切换，正在恢复历史视图。':'已取消，继续浏览原版本。';
    case 'failed':
      if(state.outcome==='aborted')return '已取消，继续浏览原版本。';
      if(cross)return '地区切换失败，已保留原地图、视图和选中记录。可重试或选择其他版本。';
      return state.outcome==='timeout'?'版本读取超时，已保留原地图、视图和选中记录。可重试或选择其他版本。':'版本加载失败，已保留原地图、视图和选中记录。可重试或选择其他版本。';
    default:return '';
  }
}
