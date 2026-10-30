import type {Feature,LineString,MultiLineString,Position} from 'geojson';
import type {RailProperties} from '../../shared/atlas-types';
type Input=Feature<LineString|MultiLineString,RailProperties>;
// Sub-millimetre geographic tolerance only for floating-point serialization.
// Tile-generalization gaps/overlaps are not bridged or snapped.
const pointKey=(p:Position)=>Math.round(p[0]*1e9)+','+Math.round(p[1]*1e9);
const pathKey=(points:Position[])=>points.map(pointKey).join(';');
const metadataEqual=(a:RailProperties,b:RailProperties)=>{
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.prototype.hasOwnProperty.call(b,key)&&
    (Object.is(a[key],b[key])||a[key]!==null&&typeof a[key]==='object'&&JSON.stringify(a[key])===JSON.stringify(b[key])));
};
export function joinOwnLineFragments(features:Input[]){
  type Group={properties:RailProperties;paths:Map<string,Position[]>};
  const groups=new Map<string,Group[]>();
  for(const f of features){
    const variants=groups.get(f.properties.osm_id)||[];
    let group=variants.find(g=>metadataEqual(g.properties,f.properties));
    if(!group){group={properties:f.properties,paths:new Map()};variants.push(group);groups.set(f.properties.osm_id,variants);}
    const parts=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
    for(const part of parts){
      if(part.length<2)continue;
      const forward=pathKey(part),reverse=pathKey([...part].reverse()),reversed=reverse<forward,id=reversed?reverse:forward;
      if(!group.paths.has(id))group.paths.set(id,reversed?[...part].reverse():[...part]);
    }
  }
  let joins=0;const result:Input[]=[];
  for(const key of [...groups.keys()].sort()){
    const raw=groups.get(key)!,variants=raw.length===1?raw:raw.map(group=>({group,key:JSON.stringify(Object.entries(group.properties).sort(([a],[b])=>a<b?-1:a>b?1:0))})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(v=>v.group);
    for(const group of variants){
    const paths=[...group.paths.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,points])=>points);
    const endpoints=new Map<string,number[]>();
    paths.forEach((points,index)=>{for(const point of [points[0],points.at(-1)!]){const k=pointKey(point),list=endpoints.get(k)||[];list.push(index);endpoints.set(k,list);}});
    const used=new Set<number>(),assembled:Position[][]=[];
    for(let index=0;index<paths.length;index++){
      if(used.has(index))continue;used.add(index);let chain=[...paths[index]];
      for(const start of [false,true]){
        while(true){
          const end=pointKey(start?chain[0]:chain.at(-1)!),adjacent=endpoints.get(end)!;
          if(adjacent.length!==2)break;
          const next=adjacent.find(i=>!used.has(i));if(next===undefined)break;
          let points=paths[next];used.add(next);
          if(start){if(pointKey(points.at(-1)!)!==end)points=[...points].reverse();chain=[...points.slice(0,-1),...chain];}
          else{if(pointKey(points[0])!==end)points=[...points].reverse();chain=[...chain,...points.slice(1)];}
          joins++;
        }
      }
      assembled.push(chain);
    }
    if(assembled.length)result.push({type:'Feature',properties:group.properties,geometry:assembled.length===1?{type:'LineString',coordinates:assembled[0]}:{type:'MultiLineString',coordinates:assembled}});
    }
  }
  return {features:result,joins};
}
