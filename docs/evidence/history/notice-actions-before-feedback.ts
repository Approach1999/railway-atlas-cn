import type {DatasetManifest} from '../../shared/atlas-types.ts';

export interface MapFeedbackSnapshot {
  readonly status:string;
  readonly navigation:string;
  readonly notice:string;
  readonly sourceDate:string;
  readonly currentVersionRecovery:boolean;
}
export const initialMapFeedback:MapFeedbackSnapshot=Object.freeze({
  status:'正在加载铁路地图…',navigation:'',notice:'',sourceDate:'正在读取数据',currentVersionRecovery:false,
});
export function sourceDateLabel(source:DatasetManifest['source']):string {
  const raw=(typeof source?.osm_base==='object'?source.osm_base?.osm_base:source?.osm_base)||source?.osm_timestamp||source?.source_time;
  return typeof raw==='string'&&raw?`铁路数据 ${raw.slice(0,10)}`:'源数据时间见关于数据';
}
export function createMapFeedback(){
  let state=initialMapFeedback,disposed=false;
  const listeners=new Set<()=>void>();
  return {
    getSnapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    update(change:Partial<MapFeedbackSnapshot>){
      if(disposed)return;
      const next={...state,...change};
      // Camera movement often produces the same hint: keep its snapshot stable.
      if((Object.keys(next) as Array<keyof MapFeedbackSnapshot>).every(key=>next[key]===state[key]))return;
      state=Object.freeze(next);listeners.forEach(listener=>listener());
    },
    dispose(){disposed=true;listeners.clear();},
  };
}
export type MapFeedbackStore=ReturnType<typeof createMapFeedback>;
