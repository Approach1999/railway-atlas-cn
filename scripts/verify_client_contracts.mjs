/* Validate published files with the actual browser boundary validators.
 * Does not replace independent source-data or classification audits. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateManifest,validatePalette,validateStations,validateLines,validateObjectIndex,validateRailFeature} from '../apps/web/client/src/dataset-validation.ts';
const folders=process.argv.slice(2);
if(!folders.length)throw Error('Pass one or more immutable snapshot directories');
const reports=[];
for(const folder of folders){
  let files=0,detailRecords=0;
  async function json(name){files++;return JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));}
  const manifest=await json('dataset.json');validateManifest(manifest);
  validatePalette(await json('palette.json'));
  const stations=await json('stations.geojson');validateStations(stations);
  const lines=manifest.schema_version>=2?await json('lines.json'):{lines:[]};if(manifest.schema_version>=2)validateLines(lines,manifest.snapshot_id);
  let index=null;if(manifest.object_index==='objects.json'){index=await json('objects.json');validateObjectIndex(index,manifest.snapshot_id);}
  const objects=new Set();
  for(const name of (await fs.readdir(path.join(folder,'details'))).filter(name=>/^[0-9a-f]{2}\.json$/.test(name))){
    const shard=await json('details/'+name);
    if(!shard||typeof shard!=='object'||Array.isArray(shard))throw Error('Invalid shard '+name);
    for(const [key,feature] of Object.entries(shard)){
      validateRailFeature(feature);
      if(feature.properties.osm_id!==key||objects.has(key))throw Error('Duplicate/mismatched detail identity '+key);
      const expected=createHash('sha256').update(key).digest('hex').slice(0,2)+'.json';if(name!==expected)throw Error('Wrong detail partition '+key);
      objects.add(key);detailRecords++;
    }
  }
  if(index&&(index.records.length!==objects.size||index.records.some(record=>!objects.has(record.osm_id))))throw Error('List/detail identities differ');
  if(stations.features.some(feature=>!objects.has(feature.properties.osm_id)))throw Error('Station detail missing');
  reports.push({snapshot:manifest.snapshot_id,files_checked:files,station_records:stations.features.length,line_records:lines.lines.length,detail_records:detailRecords,object_records:index?.records.length??null,manifest_sha256:createHash('sha256').update(await fs.readFile(path.join(folder,'dataset.json'))).digest('hex')});
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'Actual browser schema and detail partition contracts; not classification, source authenticity or real-device acceptance',snapshots:reports},null,2));
