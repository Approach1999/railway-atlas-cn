import type {RailProperties,LineRecord,DatasetManifest} from '../../shared/atlas-types.ts';
import {FACILITY_LABELS,MODE_LABELS,CLASS_LABELS} from '../../shared/model.mjs';
export type RecordRow=readonly [string,string];
const value=(text:string|null|undefined)=>text||'未标注';
const rules:Record<string,string>={'service-v1':'站场功能优先','industrial-v1':'显式工业用途','explicit-highspeed-v1':'显式高速标注','branch-v1':'显式支线用途','main-v1':'显式干线用途','rail-fallback-v1':'铁路标签，等级未标注','mode-v1':'显式轨道制式','ambiguous-values-v1':'标签多值，待复核'};
export function recordRows(p:RailProperties,lines:readonly LineRecord[]=[]):RecordRow[]{
  const tags=p.tags||{},rows:RecordRow[]=[];
  const add=(label:string,text:string|null|undefined)=>rows.push([label,value(text)]);
  if(p.feature_kind==='facility'){
    add('设施类别',FACILITY_LABELS[p.facility_kind||'']);add('制式',MODE_LABELS[p.rail_mode]);add('关联状态',p.link_status==='confirmed'?'明确关系成员已确认':'未确认');add('关联车站',p.station_links?.join(' / '));
    for(const [label,key] of [['设施编号','ref'],['运营方标注','operator'],['容量标注','capacity'],['用途标注','usage']] as const)if(tags[key])add(label,tags[key]);
  }else if(p.feature_kind==='station'||p.feature_kind==='station_area'){
    add('记录类别',p.feature_kind==='station_area'?'站区':tags.railway==='halt'?'乘降所':tags.railway==='tram_stop'?'电车站点':'车站点');add('制式',MODE_LABELS[p.rail_mode]);add('别名',p.aliases?.join(' / '));add('车站编码',tags['railway:ref']);add('运营方标注',tags.operator);
    if(p.station_links?.length){add('关联对象',p.station_links.join(' / '));add('关联依据',p.link_status==='confirmed'?'明确关系成员已确认':'未确认');}
  }else{
    add('线路等级',CLASS_LABELS[p.line_class||'']);add('制式',MODE_LABELS[p.rail_mode]);add('名称来源',({'name:zh':'源中文名称',name:'源名称',missing:'未标注'} as Record<string,string>)[p.name_source||'']||p.name_source);
    add('分类依据',rules[p.class_rule_id||'']||'待复核');add('分类规则',p.class_rule_id);add('运营方标注',tags.operator);
    add('用途',({main:'干线',branch:'支线',industrial:'工业用途'} as Record<string,string>)[p.usage||'']||p.usage||tags.usage);
    add('站场功能',({siding:'侧线',spur:'岔线',crossover:'渡线',yard:'站场线'} as Record<string,string>)[p.service||'']||p.service||tags.service);
    for(const [label,key,normalized] of [['显式高速','highspeed',p.highspeed],['限速标注','maxspeed',p.maxspeed],['电气化','electrified',p.electrified],['轨距标注','gauge',null],['桥梁标注','bridge',null],['隧道标注','tunnel',null]] as const)add(label,normalized||tags[key]);
  }
  add('线路归属',p.line_keys?.length?p.line_keys.map(key=>lines.find(line=>line.line_key===key)?.name||key).join(' / '):'尚未建立完整线路关联');
  if(p.line_keys?.length){
    add('共线状态',p.line_shared?'多条线路共享，使用回退色':p.line_complete===true?'单一线路关联':'关联完整性未确认');
    add('关系完整性',p.line_complete===true?'源关系成员齐备；不代表运营线路完整':p.line_complete===false?'源关系成员不完整':'未确认');
    add('配色来源',p.colour_source||'未标注');
    add('配色置信度',({'operator-map':'运营方线路图取色',official:'官方公布值',manual:'人工配置',osm:'OSM 源标注',fallback:'制式 / 共享段回退'} as Record<string,string>)[p.colour_confidence||'']||p.colour_confidence);
    add('线路身份依据',p.line_membership_source==='stop_area relation'?'明确站区与停靠位置关系':p.line_identity_source==='route_master relation'?'源线路父关系与方向成员':p.line_identity_source||p.line_membership_source||'未标注');
  }
  return rows;
}
export function provenanceRows(manifest:DatasetManifest|undefined):RecordRow[]{
  const source=manifest?.source||{},raw=typeof source.osm_base==='object'?source.osm_base.osm_base:source.osm_base;
  const sourceTime=raw||source.source_time||source.osm_timestamp;
  return [['数据构建时间',value(manifest?.build_time)],['源快照时间',value(sourceTime)],['分类规则版本',value(manifest?.classification_version)],['配色版本',value(manifest?.palette_version)],['数据提供方',value(source.provider)],['当前覆盖范围',manifest?.bbox?manifest.bbox.join(' / ')+'（经度/纬度矩形，非行政边界）':'未标注']];
}
