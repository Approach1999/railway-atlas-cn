/* Read-only: which quantized tile features would stop the geometry gate, and at which zooms.
 * Tiles a candidate features.geojson with the settings of build-tiles.mjs and runs the
 * normalizer on every tile feature. Writes nothing and changes no published data. */
import fs from 'node:fs/promises';
import path from 'node:path';
// The tiler is ESM-only and installed for apps/web/probe; import its declared ESM entry.
const {GeoJSONVT}=await import(new URL('../apps/web/probe/node_modules/@maplibre/geojson-vt/dist/geojson-vt.mjs',import.meta.url));
const {normalizeQuantizedFeature,normalizationStats}=await import(new URL('../apps/web/probe/quantized-geometry.mjs',import.meta.url));
const input=process.argv[2];
if(!input)throw Error('Usage: node diagnose_quantized_geometry.mjs FEATURES.geojson');
const data=JSON.parse(await fs.readFile(path.resolve(input),'utf8'));
const kinds={rail_tracks:'track',rail_facilities:'facility',rail_stations:'station_area'};
let west=180,east=-180,south=90,north=-90;
function visit(c){if(typeof c[0]==='number'){west=Math.min(west,c[0]);east=Math.max(east,c[0]);south=Math.min(south,c[1]);north=Math.max(north,c[1]);}else c.forEach(visit);}
data.features.forEach(f=>visit(f.geometry.coordinates));
const tileX=(lon,z)=>Math.floor((lon+180)/360*2**z),tileY=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
const signed=ring=>{let value=0;for(let i=1;i<ring.length;i++)value+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];return value;};
const stops=new Map(),totals={tiles:0,feature_instances:0,polygon_features:0,collapsed_polygon_rings:0,collapsed_line_parts:0,collapsed_features:0};
for(const [layer,kind] of Object.entries(kinds)){
  const features=data.features.filter(f=>f.properties.feature_kind===kind);
  totals.polygon_features+=features.filter(f=>/Polygon/.test(f.geometry.type)).length;
  const index=new GeoJSONVT({type:'FeatureCollection',features},{maxZoom:15,indexMaxZoom:8,indexMaxPoints:50000,tolerance:.5,extent:4096,buffer:128});
  for(let z=8;z<=15;z++)for(let x=tileX(west,z);x<=tileX(east,z);x++)for(let y=tileY(north,z);y<=tileY(south,z);y++){
    const tile=index.getTile(z,x,y);if(!tile||!tile.features.length)continue;totals.tiles++;
    for(const feature of tile.features){
      totals.feature_instances++;const stats=normalizationStats();
      try{
        if(!normalizeQuantizedFeature(feature,stats))totals.collapsed_features++;
        totals.collapsed_polygon_rings+=stats.collapsed_polygon_rings;totals.collapsed_line_parts+=stats.collapsed_line_parts;
      }catch(error){
        const id=feature.tags.osm_id,source=data.features.find(f=>f.properties.osm_id===id);
        const entry=stops.get(id)||{id,layer,source_type:source.geometry.type,
          source_rings:(source.geometry.type==='Polygon'?[source.geometry.coordinates]:source.geometry.coordinates).map(ring=>ring.length),
          source_ring_areas:(source.geometry.type==='Polygon'?[source.geometry.coordinates]:source.geometry.coordinates).map(signed),
          source_railway:source.properties.tags?.railway,facility_kind:source.properties.facility_kind,name:source.properties.display_name,
          message:error.message.split(': ').slice(1).join(': '),zooms:new Set(),tiles:[],tile_ring_areas:[]};
        entry.zooms.add(z);if(entry.tiles.length<8){entry.tiles.push(`${z}/${x}/${y}`);entry.tile_ring_areas.push(feature.geometry.map(signed));}
        stops.set(id,entry);
      }
    }
  }
}
console.log(JSON.stringify({input:path.resolve(input),bounds:[west,south,east,north],totals,stopping_features:stops.size,
  stops:[...stops.values()].map(({zooms,...entry})=>({...entry,zooms:[...zooms].sort((a,b)=>a-b)}))},null,1));
