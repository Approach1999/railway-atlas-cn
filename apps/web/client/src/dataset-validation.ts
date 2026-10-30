import type {DatasetBundle,RailProperties,RailFeature} from '../../shared/atlas-types.ts';
export type {DatasetBundle} from '../../shared/atlas-types.ts';
export const keyPattern=/^[A-Za-z0-9_-]{1,80}$/;
const linePattern=/^[A-Za-z0-9_/-]{1,120}$/;
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==='string');
const hex=(value:unknown)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
function bounds(value:unknown):value is number[]{
  return Array.isArray(value)&&value.length===4&&value.every(Number.isFinite)&&value[0]>=-180&&value[2]<=180&&value[1]>=-90&&value[3]<=90&&value[0]<value[2]&&value[1]<value[3];
}
export function validateManifest(value:unknown,snapshot?:string):asserts value is DatasetBundle['manifest']{
  if(!record(value)||typeof value.snapshot_id!=='string'||!keyPattern.test(value.snapshot_id)||(snapshot&&value.snapshot_id!==snapshot)||typeof value.schema_version!=='number'||![1,2].includes(value.schema_version)||(value.region!==undefined&&value.region!=='shenyang')||!bounds(value.bbox)||!record(value.tiles)||!bounds(value.tiles.bounds)||value.tiles.minzoom!==8||!Number.isInteger(value.tiles.maxzoom)||Number(value.tiles.maxzoom)<8||Number(value.tiles.maxzoom)>22)throw Error('数据版本说明无效');
  if(value.source!==undefined&&!record(value.source)||value.class_counts!==undefined&&!record(value.class_counts))throw Error('数据来源或分类统计无效');
  for(const key of ['classification_version','palette_version','relation_version','build_time','retention_until','input_sha256'])if(value[key]!==undefined&&typeof value[key]!=='string')throw Error('数据版本字段无效');
  if(record(value.source)){
    for(const key of ['osm_timestamp','source_time','provider','endpoint','source_url','sha256','source_pbf_sha256'])if(value.source[key]!==undefined&&typeof value.source[key]!=='string')throw Error('数据来源字段无效');
    const base=value.source.osm_base;if(base!==undefined&&typeof base!=='string'&&(!record(base)||base.osm_base!==undefined&&typeof base.osm_base!=='string'))throw Error('数据时间字段无效');
  }
  if(record(value.class_counts)&&Object.values(value.class_counts).some(count=>typeof count!=='number'||!Number.isInteger(count)||count<0))throw Error('分类统计无效');
}
export function validatePalette(value:unknown):asserts value is DatasetBundle['palette']{
  if(!record(value)||!record(value.class_palette)||!record(value.fallbacks)||!record(value.operators))throw Error('配色配置不完整');
  if(value.overrides!==undefined&&(!Array.isArray(value.overrides)||value.overrides.some(entry=>!record(entry)||!hex(entry.color))))throw Error('配色覆盖配置无效');
  for(const key of ['subway','light_rail','tram','unknown'])if(!hex(value.fallbacks[key]))throw Error('回退配色无效');
  if(Object.values(value.fallbacks).some(color=>!hex(color)))throw Error('回退配色无效');
  for(const key of ['high_speed','conventional_main','conventional_other','branch','industrial','unknown','metro','light_rail','tram']){
    const entry=value.class_palette[key];if(!record(entry)||typeof entry.label!=='string'||!hex(entry.color))throw Error('配色配置无效');
  }
  for(const entry of Object.values(value.class_palette))if(!record(entry)||typeof entry.label!=='string'||!hex(entry.color))throw Error('额外轨道类型配色无效');
  for(const operator of Object.values(value.operators)){
    if(!record(operator)||!record(operator.lines))throw Error('运营方配色配置无效');
    if(operator.source!==undefined&&typeof operator.source!=='string'||operator.confidence!==undefined&&typeof operator.confidence!=='string')throw Error('运营方配色来源无效');
    for(const key of ['verified_at','source_url','operator_url'])if(operator[key]!==undefined&&typeof operator[key]!=='string')throw Error('运营方配色核对记录无效');
    if(operator.name!==undefined&&typeof operator.name!=='string')throw Error('运营方名称无效');
    for(const line of Object.values(operator.lines))if(!record(line)||!hex(line.color)||line.verified_at!==undefined&&typeof line.verified_at!=='string')throw Error('线路配色配置无效');
  }
  if(value.palette_version!==undefined&&typeof value.palette_version!=='string')throw Error('配色版本无效');
  for(const entry of (value.overrides||[]) as Record<string,unknown>[]){
    for(const key of ['line_key','source','verified_at'])if(entry[key]!==undefined&&typeof entry[key]!=='string')throw Error('配色覆盖来源无效');
    if(entry.relation_id!==undefined&&!['string','number'].includes(typeof entry.relation_id))throw Error('配色覆盖关系无效');
  }
}
export function validateRailProperties(value:unknown):asserts value is RailProperties{
  if(!record(value)||typeof value.osm_id!=='string'||!/^(node|way)\/\d+$/.test(value.osm_id)||typeof value.display_name!=='string'||typeof value.rail_mode!=='string'||!['rail','subway','light_rail','tram','other','unknown'].includes(value.rail_mode)||typeof value.status!=='string'||!['mapped','construction','proposed','disused','abandoned','razed','unknown','conflict'].includes(value.status))throw Error('要素身份、制式或状态无效');
  if(value.feature_kind!==undefined&&(typeof value.feature_kind!=='string'||!['track','station','station_area','facility','unknown'].includes(value.feature_kind)))throw Error('要素类别无效');
  if(value.line_class!==undefined&&(typeof value.line_class!=='string'||!['high_speed','conventional_main','conventional_other','branch','industrial','metro','light_rail','tram','other','unknown'].includes(value.line_class)))throw Error('要素等级无效');
  for(const key of ['facility_kind','line_tokens','line_key','name_source','class_rule_id','link_status','colour_source','colour_confidence','line_membership_source','line_identity_source','osm_timestamp','anchor_method','mode_evidence'])if(value[key]!==undefined&&typeof value[key]!=='string')throw Error('要素文本字段无效');
  for(const key of ['name','usage','service','highspeed','maxspeed','electrified'])if(value[key]!=null&&typeof value[key]!=='string')throw Error('要素原标注字段无效');
  for(const key of ['aliases','line_keys','class_warnings','station_links'])if(value[key]!==undefined&&!strings(value[key]))throw Error('要素列表字段无效');
  for(const key of ['line_complete','line_shared'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error('线路完整性字段无效');
  for(const key of ['osm_version','osm_changeset','label_priority'])if(value[key]!==undefined&&(typeof value[key]!=='number'||!Number.isFinite(value[key])))throw Error('要素元数据无效');
  if(value.anchor!==undefined&&!position(value.anchor))throw Error('要素代表点无效');
  if(value.tags!==undefined&&(!record(value.tags)||Object.values(value.tags).some(tag=>typeof tag!=='string')))throw Error('要素原标签无效');
}
function position(value:unknown):value is number[]{return Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;}
export function validateRailFeature(value:unknown,{allowClippedMultiPolygon=false}:{allowClippedMultiPolygon?:boolean}={}):asserts value is RailFeature{
  if(!record(value)||value.type!=='Feature'||!record(value.geometry)||typeof value.geometry.type!=='string')throw Error('要素记录无效');
  validateRailProperties(value.properties);
  const {type,coordinates}=value.geometry;
  const line=(v:unknown)=>Array.isArray(v)&&v.length>=2&&v.every(position);
  const ring=(v:unknown)=>{if(!Array.isArray(v)||v.length<4||!v.every(position))return false;const last=v.at(-1);return Boolean(last&&v[0][0]===last[0]&&v[0][1]===last[1]);};
  const polygon=(v:unknown)=>Array.isArray(v)&&v.length>0&&v.every(ring);
  const valid=type==='Point'?position(coordinates):type==='LineString'?line(coordinates):type==='Polygon'?polygon(coordinates):type==='MultiLineString'?Array.isArray(coordinates)&&coordinates.length>0&&coordinates.every(line):type==='MultiPolygon'&&allowClippedMultiPolygon&&Array.isArray(coordinates)&&coordinates.length>0&&coordinates.every(polygon);
  if(!valid)throw Error('要素几何无效');
  if(value.id!==undefined&&typeof value.id!=='string'&&typeof value.id!=='number')throw Error('要素标识无效');
}
export function validateObjectIndex(value:unknown,snapshot:string):asserts value is {snapshot_id:string;records:RailProperties[]}{
  if(!record(value)||value.snapshot_id!==snapshot||!Array.isArray(value.records))throw Error('列表与数据快照不一致');
  const seen=new Set<string>();
  for(const entry of value.records){validateRailProperties(entry);if(seen.has(entry.osm_id))throw Error('列表来源身份重复');seen.add(entry.osm_id);}
}
export function validateStations(value:unknown):asserts value is DatasetBundle['stations']{
  if(!record(value)||value.type!=='FeatureCollection'||!Array.isArray(value.features))throw Error('车站索引无效');
  const seen=new Set<string>();
  for(const feature of value.features){
    if(!record(feature)||feature.type!=='Feature'||typeof feature.id!=='string'||!record(feature.properties)||!record(feature.geometry)||feature.geometry.type!=='Point'||!Array.isArray(feature.geometry.coordinates)||feature.geometry.coordinates.length!==2||!feature.geometry.coordinates.every(Number.isFinite))throw Error('车站索引无效');
    const p=feature.properties,[longitude,latitude]=feature.geometry.coordinates;
    validateRailProperties(p);
    if(feature.id!==p.osm_id||!/^(node|way)\/\d+$/.test(feature.id)||typeof p.display_name!=='string'||typeof p.status!=='string'||typeof p.rail_mode!=='string'||Math.abs(longitude)>180||Math.abs(latitude)>90||(p.aliases!==undefined&&!strings(p.aliases))||(p.line_keys!==undefined&&!strings(p.line_keys))||(p.line_tokens!==undefined&&typeof p.line_tokens!=='string'))throw Error('车站记录无效');
    if(seen.has(feature.id))throw Error('车站来源身份重复');seen.add(feature.id);
  }
}
export function validateLines(value:unknown,snapshot:string):asserts value is DatasetBundle['lines']{
  if(!record(value)||value.snapshot_id!==snapshot||!Array.isArray(value.lines))throw Error('线路索引与版本不一致');
  const seen=new Set<string>();
  for(const line of value.lines){
    if(!record(line)||typeof line.line_key!=='string'||!linePattern.test(line.line_key)||seen.has(line.line_key)||typeof line.name!=='string'||typeof line.ref!=='string'||typeof line.mode!=='string'||!['subway','light_rail','tram'].includes(line.mode)||!strings(line.relation_ids)||line.relation_ids.some(key=>!/^relation\/\d+$/.test(key))||!Array.isArray(line.source_tags)||line.source_tags.some(tags=>!record(tags)))throw Error('线路索引无效');
    if(line.master_ids!==undefined&&(!strings(line.master_ids)||line.master_ids.some(key=>!/^relation\/\d+$/.test(key))))throw Error('线路父关系索引无效');
    if(line.operator_key!=null&&typeof line.operator_key!=='string'||line.source_tags.some(tags=>Object.values(tags).some(tag=>typeof tag!=='string')))throw Error('线路来源字段无效');
    seen.add(line.line_key);
  }
}
