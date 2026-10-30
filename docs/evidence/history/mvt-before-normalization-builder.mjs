// Portable bounded-pilot MVT builder; production PMTiles remains a separate pipeline.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {GeoJSONVT} from '@maplibre/geojson-vt';
import {fromGeojsonVt} from '@maplibre/vt-pbf';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node build-tiles.mjs INPUT.geojson OUTPUT_DIRECTORY');
const data=JSON.parse(await fs.readFile(input,'utf8'));
const mvp=process.argv.includes('--mvp');
const maxZoom=mvp?15:14;
const groups=mvp?{
  rail_tracks:data.features.filter(f=>f.properties.feature_kind==='track'),
  rail_facilities:data.features.filter(f=>f.properties.feature_kind==='facility'),
  rail_stations:data.features.filter(f=>f.properties.feature_kind==='station_area'),
}:{rail_tracks:data.features};
const indexes=Object.fromEntries(Object.entries(groups).map(([key,features])=>[key,new GeoJSONVT({type:'FeatureCollection',features},{maxZoom,indexMaxZoom:8,indexMaxPoints:50000,tolerance:mvp ? 0.5 : 1.5,extent:4096,buffer:128})]));
let west=180,east=-180,south=90,north=-90;
function visit(c){if(typeof c[0]==='number'){const [lon,lat]=c;west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,lat);north=Math.max(north,lat);}else c.forEach(visit);}
data.features.forEach(f=>visit(f.geometry.coordinates));
const tileX=(lon,z)=>Math.floor((lon+180)/360*2**z);
const tileY=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
await fs.mkdir(output,{recursive:false});
const files=[];
for(let z=8;z<=maxZoom;z++){
  for(let x=tileX(west,z);x<=tileX(east,z);x++){
    await fs.mkdir(path.join(output,String(z),String(x)),{recursive:true});
    for(let y=tileY(north,z);y<=tileY(south,z);y++){
      const layers=Object.fromEntries(Object.entries(indexes).map(([key,index])=>[key,index.getTile(z,x,y)||{features:[]}]));
      // String identities stay in osm_id; MVT's numeric feature id is unused.
      Object.values(layers).forEach(tile=>tile.features.forEach(f=>{delete f.id;}));
      if(mvp&&!Object.values(layers).some(tile=>tile.features.length))continue;
      const bytes=fromGeojsonVt(layers, {version:2,extent:4096});
      const relative=`${z}/${x}/${y}.pbf`;
      await fs.writeFile(path.join(output,relative),bytes);
      files.push({path:relative,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
    }
  }
}
const report={builder:'geojson-vt 6.3.0 / vt-pbf 4.3.2',minzoom:8,maxzoom:maxZoom,source_layers:Object.keys(groups),bounds:[west,south,east,north],tile_count:files.length,total_bytes:files.reduce((s,f)=>s+f.bytes,0),files};
await fs.writeFile(path.join(output,'build.json'),JSON.stringify(report));
console.log(`${files.length} MVT tiles; ${report.total_bytes} bytes`);
