import type {FilterState,Palette,LineRecord,Preset} from '../../shared/atlas-types.ts';
import {DEFAULTS,FILTER_STATES,expandedState} from '../../shared/model.mjs';
import {neutralPalette} from './resources.ts';
export type FilterOption='history'|'sidings'|'lineNames'|'stationNames'|'facilities';
export type FilterAction=
  |{type:'preset';preset:Exclude<Preset,'custom'>}|{type:'undo'}
  |{type:'dimension';field:'types'|'classes'|'states';value:string;enabled:boolean}
  |{type:'option';key:FilterOption;enabled:boolean}
  |{type:'line';key:string;enabled:boolean;available:string[]}
  |{type:'isolate';key:string|null}|{type:'all-lines'}
  |{type:'restore';filters:FilterState}|{type:'discard-undo'};
export interface FilterSession {readonly filters:Readonly<FilterState>;readonly previous:Readonly<FilterState>|null;readonly isolatedLine:string|null}
export interface ControlsData {ready:boolean;palette:Palette;lines:LineRecord[];lineColors:Record<string,string>;lineSources:Record<string,{source?:string;confidence?:string;verifiedAt?:string}>;linesUnavailable:boolean;schemaVersion:number;zoom:number}
export interface ControlsSnapshot {readonly session:FilterSession;readonly data:Readonly<ControlsData>}
function copy(filters:Readonly<FilterState>):FilterState{
  return {...filters,types:[...filters.types],classes:[...filters.classes],states:[...filters.states],lineKeys:filters.lineKeys===null?null:[...filters.lineKeys]};
}
function freezeFilters(filters:Readonly<FilterState>):Readonly<FilterState>{
  const value=copy(filters);Object.freeze(value.types);Object.freeze(value.classes);Object.freeze(value.states);if(value.lineKeys)Object.freeze(value.lineKeys);return Object.freeze(value);
}
function freezeSession(session:FilterSession):FilterSession{return Object.freeze({filters:freezeFilters(session.filters),previous:session.previous?freezeFilters(session.previous):null,isolatedLine:session.isolatedLine});}
export function initialFilterSession(filters:FilterState):FilterSession{return freezeSession({filters,previous:null,isolatedLine:null});}
export function reduceFilters(session:FilterSession,action:FilterAction):FilterSession{
  const filters=copy(session.filters);let previous=session.previous,isolatedLine=session.isolatedLine;
  switch(action.type){
    case 'preset':return freezeSession({filters:expandedState({...DEFAULTS,preset:action.preset}),previous:filters,isolatedLine:null});
    case 'undo':return previous?freezeSession({filters:previous,previous:null,isolatedLine:null}):session;
    case 'restore':return freezeSession({filters:action.filters,previous,isolatedLine:null});
    case 'discard-undo':return freezeSession({filters,previous:null,isolatedLine});
    case 'dimension':{
      const values=new Set(filters[action.field]);action.enabled?values.add(action.value):values.delete(action.value);
      filters[action.field]=[...values];filters.preset='custom';filters.history=filters.states.some(value=>value!=='mapped');isolatedLine=null;break;
    }
    case 'option':filters[action.key]=action.enabled;if(action.key==='history'&&filters.preset==='custom')filters.states=action.enabled?[...FILTER_STATES]:['mapped'];break;
    case 'line':{
      const values=new Set(filters.lineKeys===null?action.available:filters.lineKeys);action.enabled?values.add(action.key):values.delete(action.key);filters.lineKeys=[...values];isolatedLine=null;break;
    }
    case 'isolate':isolatedLine=action.key;break;
    case 'all-lines':filters.lineKeys=null;isolatedLine=null;break;
  }
  return freezeSession({filters:expandedState(filters),previous,isolatedLine});
}
export function createRailwayControls(filters:FilterState,zoom:number){
  let snapshot:ControlsSnapshot={session:initialFilterSession(filters),data:{ready:false,palette:neutralPalette(),lines:[],lineColors:{},lineSources:{},linesUnavailable:false,schemaVersion:0,zoom}};
  const listeners=new Set<()=>void>();
  function publish(next:ControlsSnapshot){snapshot=Object.freeze(next);for(const listener of listeners)listener();}
  return {
    getSnapshot:()=>snapshot,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};},
    dispatch:(action:FilterAction)=>{const session=reduceFilters(snapshot.session,action);if(session!==snapshot.session)publish({...snapshot,session});},
    restoreSession:(session:FilterSession)=>publish({...snapshot,session:freezeSession(session)}),
    updateData:(data:Partial<ControlsData>)=>{
      if(!(Object.keys(data) as Array<keyof ControlsData>).some(key=>!Object.is(snapshot.data[key],data[key])))return;
      publish({...snapshot,data:Object.freeze({...snapshot.data,...data})});
    },
    dispose:()=>listeners.clear(),
  };
}
export type RailwayControlsStore=ReturnType<typeof createRailwayControls>;
