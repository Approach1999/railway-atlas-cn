import {keyPattern,validateManifest,validatePalette,validateStations,validateLines,type DatasetBundle} from './dataset-validation.ts';
export {validateManifest,validatePalette,validateStations,validateLines} from './dataset-validation.ts';
export type {DatasetBundle} from './dataset-validation.ts';
export class DatasetLoadError extends Error {
  status:number;
  constructor(status:number){super(status===410?'分享快照已超过保留期。':`数据读取失败（${status}）`);this.status=status;}
}
export async function loadDataset(snapshot:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<DatasetBundle>{
  if(!keyPattern.test(snapshot))throw Error('数据版本标识无效');
  const root='/snapshots/'+snapshot;
  async function json(path:string):Promise<unknown>{const response=await fetcher(root+path,{signal});if(!response.ok)throw new DatasetLoadError(response.status);return response.json();}
  const [manifest,palette,stations]=await Promise.all([json('/dataset.json'),json('/palette.json'),json('/stations.geojson')]);
  validateManifest(manifest,snapshot);validatePalette(palette);validateStations(stations);
  const lines=manifest.schema_version>=2?await json('/lines.json'):{lines:[]};
  if(manifest.schema_version>=2)validateLines(lines,snapshot);
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  return {root,manifest,palette,stations,lines:lines as DatasetBundle['lines']};
}
