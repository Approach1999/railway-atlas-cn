import type {RailProperties,LineRecord,DatasetManifest} from '../../shared/atlas-types.ts';
import {recordRows,provenanceRows} from './record-fields.ts';
export function RecordFields({properties,lines=[]}:{properties:RailProperties;lines?:readonly LineRecord[]}){
  return <dl className="record-fields">{recordRows(properties,lines).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
export function RecordProvenance({properties:p,snapshot,manifest,onAbout,summary='数据来源与原始标注'}:{properties:RailProperties;snapshot:string;manifest?:DatasetManifest;onAbout?:(manifest?:DatasetManifest)=>void;summary?:string}){
  return <><details className="record-provenance"><summary>{summary}</summary>
    <p className="feature-note">源对象 {p.osm_id} · {snapshot}</p>
    <p className="feature-note">对象版本：{p.osm_version||'未标注'} · 对象更新时间：{p.osm_timestamp||'未标注'} · changeset：{p.osm_changeset||'未标注'}</p>
    <dl>{provenanceRows(manifest).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {p.anchor_method&&<p className="feature-note">代表点算法：{p.anchor_method}；关联仅依据明确关系，不按同名合并。</p>}
    {p.mode_evidence&&<p className="feature-note">制式核对：{p.mode_evidence}</p>}
    {/^(node|way)\/\d+$/.test(p.osm_id)&&<a href={'https://www.openstreetmap.org/'+p.osm_id} target="_blank" rel="noopener noreferrer">在 OpenStreetMap 查看记录 ↗</a>}
    <pre>{JSON.stringify(p.tags||{},null,2)}</pre>
  </details>{onAbout&&<button className="record-about" onClick={()=>onAbout(manifest)}>数据、许可与免责声明</button>}</>;
}
