import {CLASS_LABELS} from '../../shared/model.mjs';
export type ResourceKey='manifest'|'palette'|'stations'|'lines'|'tiles'|'labels'|'font';
export interface ResourceIssue {key:ResourceKey;status:'loading'|'ready'|'error';message:string}
export const RESOURCE_LABELS:Record<ResourceKey,string>={manifest:'数据说明',palette:'轨道配色',stations:'车站搜索',lines:'线路索引',tiles:'轨道瓦片',labels:'线路名称',font:'地图字体'};
export function neutralPalette(){
  return {class_palette:Object.fromEntries(Object.entries(CLASS_LABELS).map(([key,label])=>[key,{label,color:'#697579'}])),
    fallbacks:{subway:'#697579',light_rail:'#697579',tram:'#697579',unknown:'#697579'},operators:{},overrides:[],palette_version:'temporary-neutral'};
}
