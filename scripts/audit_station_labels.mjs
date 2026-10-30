import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createStationLabeler,pointLabel} from '../apps/web/client/src/station-labels.ts';
const source=process.argv[2]||'data/processed/shenyang-mvp-20261023/stations.geojson';
const output=process.argv[3]||'data/manifests/local/station-labels/audit.json';
const bytes=await fs.readFile(source),dataset=JSON.parse(bytes),before=JSON.stringify(dataset);
const labeled=createStationLabeler()(dataset,dataset.features,null);
assert.equal(JSON.stringify(dataset),before);
assert.deepEqual(labeled.map(f=>f.properties.osm_id).sort(),dataset.features.map(f=>f.properties.osm_id).sort());
const reversed={...dataset,features:[...dataset.features].reverse()};
assert.deepEqual(createStationLabeler()(reversed,reversed.features,null),labeled);
const suppressed=labeled.filter(f=>pointLabel(f.properties)&&!f.properties.label_name);
// Independently walk the source relation graph for each removed name.
const named=new Set(labeled.filter(f=>f.properties.label_name).map(f=>f.properties.osm_id));
const originals=new Map(dataset.features.map(f=>[f.properties.osm_id,f.properties]));
const witnesses=[];
for(const f of suppressed){
  const p=f.properties,queue=[p.osm_id],seen=new Set(queue);let winner;
  assert.equal(p.link_status,'confirmed');assert(p.link_evidence.length);
  while(queue.length&&!winner){
    const id=queue.shift(),record=originals.get(id);
    for(const next of record.station_links||[]){
      const other=originals.get(next);if(!other||seen.has(next))continue;
      if(other.link_status!=='confirmed'||!other.station_links.includes(id)||other.rail_mode!==p.rail_mode||other.display_name.trim()!==p.display_name.trim())continue;
      if(JSON.stringify([...other.link_evidence].sort())!==JSON.stringify([...p.link_evidence].sort()))continue;
      seen.add(next);if(named.has(next)){winner=next;break;}queue.push(next);
    }
  }
  assert(winner,'removed name must have a surviving name reachable through actual reciprocal source evidence');
  witnesses.push({suppressed:p.osm_id,label_at:winner,display_name:p.display_name,rail_mode:p.rail_mode,evidence:p.link_evidence});
}
const unnamed=labeled.filter(f=>!f.properties.display_name.trim());assert(unnamed.every(f=>f.properties.label_name===''));
const report={date:new Date().toISOString(),source,input_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
  station_records:dataset.features.length,point_symbols_preserved:labeled.length,
  old_submitted_names:dataset.features.filter(f=>f.properties.display_name+(f.properties.rail_mode==='subway'?' · 地铁':'')).length,
  new_submitted_names:labeled.filter(f=>f.properties.label_name).length,
  unnamed_ids:unnamed.map(f=>f.properties.osm_id),suppressed_confirmed_names:witnesses,
  source_order_invariant:true,source_document_unchanged:true,
  limits:'Name submission counts, not simultaneous rendered label counts. Source evidence replay is not independent human validation of real station equivalence; line-label repeat spacing, full R17 and device/browser acceptance remain open.'};
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({records:report.station_records,old_names:report.old_submitted_names,new_names:report.new_submitted_names,suppressed:witnesses.length,unnamed:unnamed.length}));
