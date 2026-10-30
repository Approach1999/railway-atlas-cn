import type {GeoJSONSource} from 'maplibre-gl';
import type {Feature,Point} from 'geojson';
import type {Stations,RailProperties} from '../../shared/atlas-types.ts';

// Station documents are replaced, never mutated in place. Within one document,
// Source properties are stable; visible identities and presentation labels change.
// Include the source identity so a rebuilt map always receives its data.
export function createStationSourceUpdater(){
  let previousSource:Pick<GeoJSONSource,'setData'>|undefined,previousDataset:Stations|undefined;
  let previousIDs:string[]=[];
  let previousLabels:unknown[]=[];
  return (source:Pick<GeoJSONSource,'setData'>,dataset:Stations,features:Array<Feature<Point,RailProperties>>):boolean=>{
    const ids=features.map(feature=>feature.properties.osm_id);
    const labels=features.map(feature=>feature.properties.label_name);
    if(source===previousSource&&dataset===previousDataset&&ids.length===previousIDs.length&&ids.every((id,index)=>id===previousIDs[index]&&labels[index]===previousLabels[index]))return false;
    source.setData({type:'FeatureCollection',features});
    previousSource=source;previousDataset=dataset;previousIDs=ids;previousLabels=labels;
    return true;
  };
}
