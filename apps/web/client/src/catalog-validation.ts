import {keyPattern} from './dataset-validation.ts';

export interface CatalogCamera {longitude:number;latitude:number;zoom:number}
export interface CatalogSnapshot {id:string;build_time?:string;retention_until?:string;object_list:boolean}
export interface CatalogRegion {id:string;name:string;default_view:CatalogCamera;current_snapshot:string;snapshots:CatalogSnapshot[]}
export interface Catalog {schema_version:1;regions:CatalogRegion[]}

const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const key=(value:unknown):value is string=>typeof value==='string'&&keyPattern.test(value);
const invalid=()=>new Error('数据目录无效或暂无可用版本');
function date(value:unknown):string|undefined{
  if(value==null)return undefined;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw invalid();
  return value;
}

// Normalize unknown transport data before React or camera operations consume it.
// No input objects are retained, so a later mutation cannot bypass this boundary.
export function parseCatalog(value:unknown):Catalog{
  if(!record(value)||value.schema_version!==1||!Array.isArray(value.regions)||!value.regions.length)throw invalid();
  const regions:CatalogRegion[]=[],regionIDs=new Set<string>();
  for(const region of value.regions){
    if(!record(region)||!key(region.id)||regionIDs.has(region.id)||typeof region.name!=='string'||!region.name.trim()
      ||!record(region.default_view)||!Array.isArray(region.snapshots)||!region.snapshots.length||!key(region.current_snapshot))throw invalid();
    const camera=region.default_view;
    if(!finite(camera.longitude)||Math.abs(camera.longitude)>180||!finite(camera.latitude)||Math.abs(camera.latitude)>85.051129
      ||!finite(camera.zoom)||camera.zoom<8||camera.zoom>18)throw invalid();
    const snapshots:CatalogSnapshot[]=[],snapshotIDs=new Set<string>();
    for(const snapshot of region.snapshots){
      if(!record(snapshot)||!key(snapshot.id)||snapshotIDs.has(snapshot.id)||typeof snapshot.object_list!=='boolean')throw invalid();
      snapshots.push({id:snapshot.id,object_list:snapshot.object_list,build_time:date(snapshot.build_time),retention_until:date(snapshot.retention_until)});
      snapshotIDs.add(snapshot.id);
    }
    if(!snapshotIDs.has(region.current_snapshot))throw invalid();
    regions.push({id:region.id,name:region.name,current_snapshot:region.current_snapshot,snapshots,
      default_view:{longitude:camera.longitude,latitude:camera.latitude,zoom:camera.zoom}});
    regionIDs.add(region.id);
  }
  return {schema_version:1,regions};
}
