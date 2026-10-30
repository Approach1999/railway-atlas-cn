import type {DatasetManifest} from '../../shared/atlas-types.ts';
export function safeSourceLink(raw:string|undefined):string|undefined{
  if(!raw)return;try{const url=new URL(raw);if(url.protocol==='https:'||url.protocol==='http:')return url.href;}catch{ /* Missing or malformed source stays plain metadata. */ }
}
export function datasetSourceTime(manifest:DatasetManifest):string{
  const source=manifest.source||{},time=(typeof source.osm_base==='object'?source.osm_base.osm_base:source.osm_base)||source.osm_timestamp||source.source_time;return time||'未标注';
}
export function coverageDescription(manifest:DatasetManifest):string{
  const facilities=manifest.schema_version>=2?'此快照可查看站区与已标注的站场设施，放大后按需显示。':'此快照尚未发布站区与设施图层。';
  return facilities+(typeof manifest.line_count==='number'?manifest.line_count>0?`版本记录 ${manifest.line_count} 条城市轨道线路关联，完整性与来源见具体记录。`:'此快照没有城市轨道线路关系，按制式回退色显示，不能据此判断没有地铁。':'线路关系覆盖未标注。');
}
