import {keyPattern,validateManifest,validatePalette,validateStations,validateLines,type DatasetBundle} from './dataset-validation.ts';
import {requestJson,JsonReadTimeoutError} from './json-request.ts';
export {validateManifest,validatePalette,validateStations,validateLines} from './dataset-validation.ts';
export type {DatasetBundle} from './dataset-validation.ts';
export class DatasetLoadError extends Error {
  status:number;
  constructor(status:number){super(status===410?'分享快照已超过保留期。':`数据读取失败（${status}）`);this.status=status;}
}
export async function loadDataset(snapshot:string,signal:AbortSignal,fetcher:typeof fetch=fetch,timeoutMs=15000):Promise<DatasetBundle>{
  if(!keyPattern.test(snapshot))throw Error('数据版本标识无效');
  const root='/snapshots/'+snapshot;
  const stage=new AbortController(),cancel=()=>stage.abort(signal.reason);
  if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
  // One budget for all staged assets, including the subsequent route index.
  const timer=setTimeout(()=>stage.abort(new JsonReadTimeoutError()),timeoutMs);
  const json=(path:string)=>requestJson(root+path,stage.signal,status=>new DatasetLoadError(status),timeoutMs,fetcher);
  try{
    const [manifest,palette,stations]=await Promise.all([json('/dataset.json'),json('/palette.json'),json('/stations.geojson')]);
    validateManifest(manifest,snapshot);validatePalette(palette);validateStations(stations);
    const lines=manifest.schema_version>=2?await json('/lines.json'):{lines:[]};
    if(manifest.schema_version>=2)validateLines(lines,snapshot);
    stage.signal.throwIfAborted();
    return {root,manifest,palette,stations,lines:lines as DatasetBundle['lines']};
  }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);stage.abort();}
}
