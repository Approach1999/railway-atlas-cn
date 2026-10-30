import type {RailFeature,LineRecord,DatasetManifest} from '../../shared/atlas-types.ts';
export type DetailState={status:'closed'}|{status:'loading';feature:RailFeature}|{status:'ready';feature:RailFeature}|{status:'error';feature:RailFeature;message:string};
export interface FeaturePanelsSnapshot {readonly request:number;readonly detail:DetailState;readonly candidates:readonly RailFeature[];readonly snapshot:string;readonly manifest?:DatasetManifest;readonly lines:readonly LineRecord[]}
export function createFeaturePanels(){
  let state:FeaturePanelsSnapshot=Object.freeze({request:0,detail:{status:'closed'} as DetailState,candidates:Object.freeze([]),snapshot:'',lines:Object.freeze([])}),disposed=false;
  const listeners=new Set<()=>void>();
  function publish(next:FeaturePanelsSnapshot){if(disposed)return;state=Object.freeze(next);listeners.forEach(listener=>listener());}
  return {
    getSnapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    begin(feature:RailFeature,snapshot:string,lines:readonly LineRecord[],manifest?:DatasetManifest){const request=state.request+1;publish({...state,request,detail:{status:'loading',feature},candidates:Object.freeze([]),snapshot,manifest,lines:Object.freeze([...lines])});return request;},
    complete(request:number,feature:RailFeature){if(disposed||request!==state.request||state.detail.status==='closed'||feature.properties.osm_id!==state.detail.feature.properties.osm_id)return false;publish({...state,detail:{status:'ready',feature}});return true;},
    fail(request:number,message:string){if(disposed||request!==state.request||state.detail.status==='closed')return false;publish({...state,detail:{status:'error',feature:state.detail.feature,message}});return true;},
    showCandidates(features:readonly RailFeature[]){publish({...state,candidates:Object.freeze([...features])});},
    closeCandidates(){if(state.candidates.length)publish({...state,candidates:Object.freeze([])});},
    close(){publish({...state,request:state.request+1,detail:{status:'closed'},candidates:Object.freeze([])});},
    dispose(){disposed=true;listeners.clear();}
  };
}
export type FeaturePanelsStore=ReturnType<typeof createFeaturePanels>;
