import type {RailFeature} from '../../shared/atlas-types.ts';
import {validateRailFeature} from './dataset-validation.ts';
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
/** MVT attributes are scalar: the writer encodes these GeoJSON arrays as JSON
 * strings. Decode only declared array attributes at the rendered-feature edge;
 * source JSON indexes and detail shards remain strict, with no coercion. */
export function decodeTileFeature(value:unknown):RailFeature{
  if(!record(value)||!record(value.properties))throw Error('瓦片要素记录无效');
  const properties={...value.properties};
  for(const key of ['line_keys','station_links','anchor','aliases','class_warnings']){
    if(typeof properties[key]==='string')properties[key]=JSON.parse(properties[key]);
  }
  const feature={type:'Feature',geometry:value.geometry,properties};
  validateRailFeature(feature,{allowClippedMultiPolygon:true});return feature;
}
