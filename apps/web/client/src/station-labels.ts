import type {Feature,Point} from 'geojson';
import type {RailProperties,Stations} from '../../shared/atlas-types';

const modeNames={rail:'铁路',subway:'地铁',light_rail:'轻轨',tram:'有轨电车',other:'其他轨道',unknown:'制式未标注'};
export function pointLabel(p:RailProperties):string{
  const name=p.display_name.trim();
  if(!name)return '';
  return p.feature_kind==='station'||p.feature_kind==='station_area'?name+' · '+modeNames[p.rail_mode]:name;
}
type Station=Feature<Point,RailProperties>;
const compare=(a:Station,b:Station)=>(a.properties.label_priority??1)-(b.properties.label_priority??1)||
  (a.properties.osm_id<b.properties.osm_id?-1:a.properties.osm_id>b.properties.osm_id?1:0);
function evidence(p:RailProperties):string{
  return p.link_status==='confirmed'&&Array.isArray(p.link_evidence)?
    [...new Set(p.link_evidence.filter((id):id is string=>typeof id==='string'&&/^relation\/\d+$/.test(id)))].sort().join('|'):'';
}

/** Suppress only duplicate names with reciprocal, confirmed source relations.
 * Source records and all station symbols remain distinct and selectable. */
export function createStationLabeler(){
  const cache=new WeakMap<Stations,Map<string,string>>();
  function groups(dataset:Stations){
    const existing=cache.get(dataset);if(existing)return existing;
    const records=new Map(dataset.features.map(f=>[f.properties.osm_id,f.properties]));
    const parents=new Map([...records.keys()].map(id=>[id,id]));
    const find=(id:string):string=>{const parent=parents.get(id)!;if(parent===id)return id;const root=find(parent);parents.set(id,root);return root;};
    for(const [id,p] of records){
      const proof=evidence(p);if(!proof||!p.display_name.trim())continue;
      for(const linked of p.station_links||[]){
        const other=records.get(linked);
        if(!other||other.rail_mode!==p.rail_mode||other.display_name.trim()!==p.display_name.trim()||
          evidence(other)!==proof||!other.station_links?.includes(id))continue;
        const a=find(id),b=find(linked);if(a!==b)parents.set(a<b?b:a,a<b?a:b);
      }
    }
    const result=new Map([...records.keys()].map(id=>[id,find(id)]));cache.set(dataset,result);return result;
  }
  return (dataset:Stations,visible:Station[],selected:RailProperties|null):Station[]=>{
    const group=groups(dataset),ordered=[...visible].sort(compare),used=new Set<string>();
    if(selected&&pointLabel(selected)){const key=group.get(selected.osm_id);if(key)used.add(key);}
    return ordered.map(f=>{
      const label=pointLabel(f.properties),key=group.get(f.properties.osm_id)||f.properties.osm_id;
      const shown=label&&!used.has(key)?label:'';if(shown)used.add(key);
      return {...f,properties:{...f.properties,label_name:shown}};
    });
  };
}
