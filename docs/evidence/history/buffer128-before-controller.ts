import type {Map as MapLibreMap,GeoJSONSource,ExpressionSpecification} from 'maplibre-gl';
import type {FilterState,RailFeature} from '../../shared/atlas-types';
import {trackVisible} from '../../shared/model.mjs';
import {prepareLineLabelCandidates,selectLineLabelCandidates} from './line-label-candidates.ts';
import {decodeTileFeature} from './tile-feature.ts';
import {CAPTION_TICK,createCaptionTick,shortLineLabelLayout} from './line-label-presentation.ts';
import {MAP_FONT_STACK} from './map-font.ts';

export const LINE_LABEL_SOURCE='rail-line-labels';
export const LINE_LABEL_LAYERS=[
  {id:'minor-line-captions',minor:true,short:true,minzoom:12},
  {id:'minor-line-names',minor:true,short:false,minzoom:12},
  {id:'line-captions',minor:false,short:true,minzoom:8},
  {id:'line-names',minor:false,short:false,minzoom:8},
] as const;
type Status='loading'|'ready'|'error';
interface Options {
  filters:()=>FilterState;lineKeys:()=>string[]|null;
  filter:(minor:boolean)=>ExpressionSpecification;
  status:(status:Status,message?:string)=>void;
}
const empty=()=>({type:'FeatureCollection' as const,features:[]});
type MapAPI=Pick<MapLibreMap,'addSource'|'getSource'|'addLayer'|'getLayer'|'hasImage'|'addImage'|'setLayoutProperty'|'setFilter'|'getCanvas'|'getZoom'|'project'|'isMoving'|'isSourceLoaded'|'querySourceFeatures'|'triggerRepaint'>;

/** Names use a separate, replaceable source; track geometry never changes.
 * All source data and layout operations use public MapLibre APIs. */
export class LineLabelController {
  private snapshot='';private installed=false;private dirty=true;private pending=false;private failed=false;
  private signature:string|null=null;private timer:ReturnType<typeof setTimeout>|undefined;
  private source:GeoJSONSource|undefined;
  private zooming=false;private zoomReplacement=false;private cameraPending=false;
  private prepared:ReturnType<typeof prepareLineLabelCandidates>|undefined;
  private current=new Map<string,RailFeature>();private previous=new Map<string,RailFeature>();
  private map:MapAPI;private options:Options;
  constructor(map:MapAPI,options:Options){this.map=map;this.options=options;}
  install(snapshot:string){
    this.reset();this.snapshot=snapshot;this.installed=true;
    this.map.addSource(LINE_LABEL_SOURCE,{type:'geojson',data:empty(),promoteId:'label_id',maxzoom:18,buffer:512});
    this.source=this.map.getSource(LINE_LABEL_SOURCE) as GeoJSONSource;
    if(!this.map.hasImage(CAPTION_TICK))this.map.addImage(CAPTION_TICK,createCaptionTick());
    const paint={'text-color':'#506975','text-halo-color':'#f9fbf6','text-halo-width':1.8};
    for(const {id,minor,short,minzoom} of LINE_LABEL_LAYERS)this.map.addLayer({
      id,type:'symbol',source:LINE_LABEL_SOURCE,minzoom,
      filter:['all',this.options.filter(minor),['==',['get','label_kind'],short?'short':'along']],
      layout:short?shortLineLabelLayout:{'symbol-placement':'line-center','text-field':['get','label_text'],
        'text-font':MAP_FONT_STACK,'text-size':12,'text-max-angle':30,'text-padding':5,'text-keep-upright':true},paint,
    });
  }
  get ready(){return !this.installed||this.failed||!this.options.filters().lineNames||!this.dirty&&!this.pending&&this.map.isSourceLoaded(LINE_LABEL_SOURCE);}
  diagnostic(){return {status:this.failed?'error':this.ready?'ready':'loading',enabled:this.options.filters().lineNames,source_loaded:this.installed&&this.map.isSourceLoaded(LINE_LABEL_SOURCE)};}
  private visibility(show:boolean){for(const {id} of LINE_LABEL_LAYERS)if(this.map.getLayer(id))this.map.setLayoutProperty(id,'visibility',show&&!this.zooming&&!this.zoomReplacement?'visible':'none');}
  request(){
    if(!this.installed)return;this.dirty=true;
    for(const {id,minor,short} of LINE_LABEL_LAYERS)this.map.setFilter(id,['all',this.options.filter(minor),['==',['get','label_kind'],short?'short':'along']]);
    this.visibility(this.options.filters().lineNames);
    if(!this.options.filters().lineNames){clearTimeout(this.timer);this.pending=false;this.failed=false;this.signature=null;this.prepared=undefined;this.options.status('ready');return;}
    this.refresh();
  }
  zoomStart(){if(this.installed){this.prepared=undefined;this.zooming=true;this.zoomReplacement=true;this.dirty=true;this.visibility(false);}}
  cameraChanged(){if(this.installed){this.prepared=undefined;this.zooming=false;this.dirty=true;this.cameraPending=true;}}
  sourceData(event:{sourceId?:string;sourceDataType?:string}){
    if(!this.installed)return;
    if(event.sourceId==='tracks'&&event.sourceDataType==='content'){this.prepared=undefined;this.dirty=true;}
    if(event.sourceId===LINE_LABEL_SOURCE)this.finish();
  }
  idle(){if(!this.map.isMoving()&&this.map.isSourceLoaded('tracks'))this.cameraPending=false;this.refresh();this.finish();}
  private finish(){
    if(!this.installed||this.dirty||!this.pending||this.map.getSource(LINE_LABEL_SOURCE)!==this.source||!this.map.isSourceLoaded(LINE_LABEL_SOURCE))return;
    this.pending=false;this.zoomReplacement=false;clearTimeout(this.timer);this.options.status('ready');
    this.visibility(this.options.filters().lineNames);this.map.triggerRepaint();
  }
  refresh(){
    if(!this.installed||!this.dirty||this.failed||this.cameraPending||this.map.isMoving()||!this.options.filters().lineNames||!this.map.isSourceLoaded('tracks'))return;
    try{
      const filters=this.options.filters(),keys=this.options.lineKeys(),zoom=this.map.getZoom(),bounds=this.map.getCanvas().getBoundingClientRect();
      if(!this.prepared){
        const features=this.map.querySourceFeatures('tracks',{sourceLayer:'rail_tracks'}).filter(f=>f.properties.feature_kind==='track').map(f=>{
          const value=decodeTileFeature({type:'Feature',geometry:f.geometry,properties:f.properties});
          if(value.properties.snapshot_id!==undefined&&value.properties.snapshot_id!==this.snapshot)throw Error('轨道名称版本不一致');
          if(value.geometry.type!=='LineString'&&value.geometry.type!=='MultiLineString')throw Error('轨道名称几何无效');
          return {...value,geometry:value.geometry};
        });
        this.prepared=prepareLineLabelCandidates(features,{zoom,width:bounds.width,height:bounds.height,
          project:coordinate=>{const p=this.map.project([coordinate[0],coordinate[1]]);return [p.x,p.y];},
        });
      }
      const generated=selectLineLabelCandidates(this.prepared,{
        previous:new Set(this.current.keys()),visible:p=>trackVisible(p,filters,zoom)&&(keys===null||keys.some(key=>(p.line_tokens||'').includes('|'+key+'|'))),
      });
      const signature=JSON.stringify(generated.collection.features.map(f=>[f.id,f.geometry,f.properties.label_text]));
      this.dirty=false;
      if(signature===this.signature){if(!this.pending){this.zoomReplacement=false;this.visibility(true);}this.finish();return;}
      this.signature=signature;this.previous=this.current;this.current=generated.targets;this.pending=true;
      this.options.status('loading');clearTimeout(this.timer);
      this.timer=setTimeout(()=>this.error('线路名称绘制超时，轨道和已加载详情仍可使用。'),15000);
      // The worker only needs drawing/filter fields. Full provenance and real
      // line geometry stay in the bounded target maps used by selection.
      this.source!.setData({...generated.collection,features:generated.collection.features.map(f=>{
        const p=f.properties;
        return {...f,properties:{label_id:p.label_id,label_text:p.label_text,label_identity:p.label_identity,label_kind:p.label_kind,
          osm_id:p.osm_id,display_name:p.display_name,feature_kind:p.feature_kind,rail_mode:p.rail_mode,line_class:p.line_class,status:p.status,line_tokens:p.line_tokens}};
      })});
    }catch(error){this.error('线路名称暂不可用，轨道和详情仍可浏览。'+(error instanceof Error?error.message:''));}
  }
  resolve(properties:Record<string,unknown>):RailFeature|null{
    if(!this.installed||typeof properties.label_id!=='string')return null;
    const target=this.current.get(properties.label_id)||this.previous.get(properties.label_id);
    if(!target||target.properties.osm_id!==properties.osm_id)return null;
    return target;
  }
  error(message='线路名称暂不可用，轨道和详情仍可浏览。'){
    if(!this.installed||!this.options.filters().lineNames)return;this.failed=true;this.pending=false;this.dirty=false;clearTimeout(this.timer);this.options.status('error',message);this.map.triggerRepaint();
  }
  retry(){if(this.installed){this.prepared=undefined;this.failed=false;this.signature=null;this.dirty=true;if(!this.options.filters().lineNames){this.options.status('ready');return;}this.options.status('loading','正在恢复线路名称，轨道和详情仍可浏览。');this.refresh();}}
  reset(){
    clearTimeout(this.timer);this.installed=false;this.source=undefined;this.dirty=true;this.pending=false;this.failed=false;this.signature=null;
    this.current.clear();this.previous.clear();this.prepared=undefined;this.snapshot='';this.zooming=false;this.zoomReplacement=false;this.cameraPending=false;
  }
}
