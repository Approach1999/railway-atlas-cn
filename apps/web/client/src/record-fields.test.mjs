import test from 'node:test';
import assert from 'node:assert/strict';
import {recordRows,provenanceRows} from './record-fields.ts';
const base={osm_id:'way/1',display_name:'sample',rail_mode:'rail',status:'mapped'};
test('track attributes preserve raw gauge, bridge/tunnel values and never infer operator or high-speed status',()=>{
  const p={...base,feature_kind:'track',line_class:'conventional_other',class_rule_id:'rail-fallback-v1',tags:{gauge:'1435;1520',bridge:'viaduct',tunnel:'no',maxspeed:'300'}};
  const rows=Object.fromEntries(recordRows(p));assert.equal(rows['轨距标注'],'1435;1520');assert.equal(rows['桥梁标注'],'viaduct');assert.equal(rows['隧道标注'],'no');assert.equal(rows['显式高速'],'未标注');assert.equal(rows['运营方标注'],'未标注');assert.equal(rows['限速标注'],'300');assert.equal(rows['线路归属'],'尚未建立完整线路关联');
});
test('station identity and facility fields stay distinct from track-only properties',()=>{
  const station=Object.fromEntries(recordRows({...base,feature_kind:'station_area',aliases:['alias'],tags:{gauge:'1435'},station_links:['node/2'],link_status:'unconfirmed'}));assert.equal(station['记录类别'],'站区');assert.equal(station['别名'],'alias');assert.equal(station['关联依据'],'未确认');assert.equal(station['轨距标注'],undefined);
  const facility=Object.fromEntries(recordRows({...base,feature_kind:'facility',facility_kind:'switch',station_links:['node/2'],link_status:'confirmed',tags:{ref:'S1'}}));assert.equal(facility['关联状态'],'明确关系成员已确认');assert.equal(facility['设施编号'],'S1');assert.equal(facility['桥梁标注'],undefined);
});
test('incomplete relation does not claim single-line completeness, shared segments retain every identity',()=>{
  const p={...base,feature_kind:'track',line_keys:['line-a','line-b'],line_complete:false,line_shared:true,colour_confidence:'fallback'};
  const rows=Object.fromEntries(recordRows(p,[{line_key:'line-a',name:'A线'}]));assert.equal(rows['线路归属'],'A线 / line-b');assert.equal(rows['关系完整性'],'源关系成员不完整');assert.match(rows['共线状态'],/多条线路/);assert.match(rows['配色置信度'],/回退/);
  const incomplete=Object.fromEntries(recordRows({...p,line_shared:false}));assert.equal(incomplete['共线状态'],'关联完整性未确认');assert.equal(incomplete['线路身份依据'],'未标注');
});
test('dataset build time and source date remain separate from object metadata; missing context stays explicit',()=>{
  const rows=Object.fromEntries(provenanceRows({build_time:'2026-10-23',classification_version:'v1',palette_version:'p1',bbox:[123,41,124,42],source:{source_time:'2026-10-20',provider:'Geofabrik'}}));assert.equal(rows['数据构建时间'],'2026-10-23');assert.equal(rows['源快照时间'],'2026-10-20');assert.match(rows['当前覆盖范围'],/非行政边界/);assert.equal(Object.fromEntries(provenanceRows(undefined))['数据构建时间'],'未标注');
});
