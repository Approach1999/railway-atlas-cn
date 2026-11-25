import {keyPattern} from './dataset-validation.ts';

export interface CatalogCamera {longitude:number;latitude:number;zoom:number}
export interface CatalogSnapshot {id:string;build_time?:string;retention_until?:string;object_list:boolean}
export interface CatalogRegion {id:string;name:string;default_view:CatalogCamera;current_snapshot:string;snapshots:CatalogSnapshot[]}
export interface Catalog {schema_version:1;regions:CatalogRegion[]}
export interface RegionCopy {headline:string;browse_start:string;search_placeholder:string;search_example:string;about_scope:string}
export interface RegionProfile {id:string;name:string;city:string;caption:string;description:string;default_view:CatalogCamera;ui:RegionCopy}
export interface RegionConfig {default_region:string;regions:RegionProfile[]}

const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const key=(value:unknown):value is string=>typeof value==='string'&&keyPattern.test(value);
const invalid=()=>new Error('数据目录无效或暂无可用版本');
function date(value:unknown):string|undefined{
  if(value==null)return undefined;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw invalid();
  return value;
}
function camera(value:unknown,fail:()=>Error=invalid):CatalogCamera{
  if(!record(value)||!finite(value.longitude)||Math.abs(value.longitude)>180||!finite(value.latitude)||Math.abs(value.latitude)>85.051129
    ||!finite(value.zoom)||value.zoom<8||value.zoom>18)throw fail();
  return {longitude:value.longitude,latitude:value.latitude,zoom:value.zoom};
}

// Normalize unknown transport data before React or camera operations consume it.
// No input objects are retained, so a later mutation cannot bypass this boundary.
export function parseCatalog(value:unknown):Catalog{
  if(!record(value)||value.schema_version!==1||!Array.isArray(value.regions)||!value.regions.length)throw invalid();
  const regions:CatalogRegion[]=[],regionIDs=new Set<string>();
  for(const region of value.regions){
    if(!record(region)||!key(region.id)||regionIDs.has(region.id)||typeof region.name!=='string'||!region.name.trim()
      ||!record(region.default_view)||!Array.isArray(region.snapshots)||!region.snapshots.length||!key(region.current_snapshot))throw invalid();
    const view=camera(region.default_view);
    const snapshots:CatalogSnapshot[]=[],snapshotIDs=new Set<string>();
    for(const snapshot of region.snapshots){
      if(!record(snapshot)||!key(snapshot.id)||snapshotIDs.has(snapshot.id)||typeof snapshot.object_list!=='boolean')throw invalid();
      snapshots.push({id:snapshot.id,object_list:snapshot.object_list,build_time:date(snapshot.build_time),retention_until:date(snapshot.retention_until)});
      snapshotIDs.add(snapshot.id);
    }
    if(!snapshotIDs.has(region.current_snapshot))throw invalid();
    regions.push({id:region.id,name:region.name,current_snapshot:region.current_snapshot,snapshots,
      default_view:{longitude:view.longitude,latitude:view.latitude,zoom:view.zoom}});
    regionIDs.add(region.id);
  }
  return {schema_version:1,regions};
}

// The embedded region registry is the configured source of names, default views
// and interface copy. Like the directory it enters as unknown and is rebuilt.
const broken=()=>new Error('地区配置无效');
const text=(value:unknown):string=>{if(typeof value!=='string'||!value.trim())throw broken();return value;};

export function parseRegionConfig(value:unknown):RegionConfig{
  if(!record(value)||value.schema_version!==1||!Array.isArray(value.regions)||!value.regions.length)throw broken();
  const regions:RegionProfile[]=[],ids=new Set<string>();
  for(const entry of value.regions){
    if(!record(entry)||!key(entry.id)||ids.has(entry.id)||!record(entry.ui))throw broken();
    ids.add(entry.id);
    // The search example may be absent; a non-text value is a config fault, not an empty example.
    const example=entry.ui.search_example;
    if(example!==undefined&&example!==null&&typeof example!=='string')throw broken();
    regions.push({id:entry.id,name:text(entry.name),city:text(entry.city),caption:text(entry.caption),description:text(entry.description),
      default_view:camera(entry.default_view,broken),
      ui:{headline:text(entry.ui.headline),browse_start:text(entry.ui.browse_start),search_placeholder:text(entry.ui.search_placeholder),
        search_example:typeof example==='string'?example.trim():'',about_scope:text(entry.ui.about_scope)}});
  }
  if(typeof value.default_region!=='string'||!ids.has(value.default_region))throw broken();
  return {default_region:value.default_region,regions};
}
