import type {Feature,FeatureCollection,Point,LineString,MultiLineString,Polygon,MultiPolygon,Position} from 'geojson';
export type RailMode='rail'|'subway'|'light_rail'|'tram'|'other'|'unknown';
export type LineClass='high_speed'|'conventional_main'|'conventional_other'|'branch'|'industrial'|'metro'|'light_rail'|'tram'|'other'|'unknown';
export type Lifecycle='mapped'|'construction'|'proposed'|'disused'|'abandoned'|'razed'|'unknown'|'conflict';
export type Preset='overview'|'highspeed'|'conventional'|'urban'|'custom';
export interface FilterState {
  preset:Preset;types:string[];classes:string[];states:string[];lineKeys:string[]|null;
  history:boolean;sidings:boolean;lineNames:boolean;stationNames:boolean;facilities:boolean;
}
export interface TrackSpec {minor?:boolean;lifecycle?:Lifecycle}
export interface TrackLayerSpec extends TrackSpec {id:string;lifecycle:Lifecycle;minor:boolean}
export type RailGeometry=Point|LineString|MultiLineString|Polygon|MultiPolygon;
export interface RailProperties {
  osm_id:string;display_name:string;rail_mode:RailMode;status:Lifecycle;
  feature_kind?:'track'|'station'|'station_area'|'facility'|'unknown';
  line_class?:LineClass;facility_kind?:string;aliases?:string[];line_keys?:string[];
  line_tokens?:string;line_key?:string;line_complete?:boolean;line_shared?:boolean;
  anchor?:Position;label_priority?:number;tags?:Record<string,string>;
  name?:string|null;name_source?:string;class_rule_id?:string;class_warnings?:string[];
  station_links?:string[];link_status?:string;usage?:string|null;service?:string|null;
  highspeed?:string|null;maxspeed?:string|null;electrified?:string|null;
  colour_source?:string;colour_confidence?:string;line_membership_source?:string;line_identity_source?:string;
  osm_version?:number;osm_timestamp?:string;osm_changeset?:number;anchor_method?:string;mode_evidence?:string;
  [field:string]:unknown;
}
export type RailFeature=Feature<RailGeometry,RailProperties>;
export type StationFeature=Feature<Point,RailProperties> & {id:string};
export type Stations=FeatureCollection<Point,RailProperties> & {features:StationFeature[]};
export interface Palette {
  class_palette:Record<string,{label:string;color:string}>;
  fallbacks:Record<string,string>;
  operators:Record<string,{name?:string;source?:string;source_url?:string;operator_url?:string;verified_at?:string;confidence?:string;lines:Record<string,{color:string;verified_at?:string}>}>;
  overrides?:Array<{color:string;line_key?:string;relation_id?:string|number;source?:string;verified_at?:string}>;
  palette_version?:string;
}
export interface LineRecord {
  line_key:string;name:string;ref:string;mode:'subway'|'light_rail'|'tram';
  operator_key?:string|null;relation_ids:string[];master_ids?:string[];source_tags:Record<string,string>[];
}
export interface LineIndex {snapshot_id?:string;lines:LineRecord[]}
export interface SourceMetadata {
  osm_base?:string|{osm_base?:string};osm_timestamp?:string;source_time?:string;
  provider?:string;endpoint?:string;source_url?:string;sha256?:string;source_pbf_sha256?:string;
  [field:string]:unknown;
}
export interface DatasetManifest {
  snapshot_id:string;region?:string;schema_version:number;bbox:number[];
  tiles:{maxzoom:number;minzoom:number;bounds:number[]};source?:SourceMetadata;
  class_counts?:Record<string,number>;classification_version?:string;palette_version?:string;
  relation_version?:string;build_time?:string;retention_until?:string;input_sha256?:string;
  [field:string]:unknown;
}
export interface DatasetBundle {root:string;manifest:DatasetManifest;palette:Palette;stations:Stations;lines:LineIndex}
