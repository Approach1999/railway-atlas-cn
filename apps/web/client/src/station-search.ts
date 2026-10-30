import type {StationFeature} from '../../shared/atlas-types.ts';
import {findStations} from '../../shared/model.mjs';
export interface SearchInput {readonly query:string;readonly committedQuery:string;readonly composing:boolean;readonly pending:boolean}
export interface SearchEntry {readonly feature:StationFeature;readonly hidden:boolean}
export type SearchAvailability='loading'|'ready'|'unavailable'|'blocked';
export interface SearchSnapshot extends SearchInput {readonly availability:SearchAvailability;readonly results:readonly SearchEntry[];readonly total:number;readonly activeKey:string|null}
interface Options {onCommit?:()=>void;debounce?:(callback:()=>void)=>()=>void}
export const stationOptionId=(key:string)=>'result-'+key.replace('/','-');
export function createStationSearch(initialQuery:string,{onCommit=()=>{},debounce=callback=>{const timer=setTimeout(callback,200);return ()=>clearTimeout(timer);}}:Options={}){
  let input:SearchInput={query:initialQuery,committedQuery:initialQuery,composing:false,pending:false};
  let availability:SearchAvailability='loading',features:StationFeature[]=[],isHidden:(feature:StationFeature)=>boolean=()=>false,activeKey:string|null=null;
  let generation=0,disposed=false,cancelPending:(()=>void)|null=null;
  const listeners=new Set<()=>void>();
  function build():SearchSnapshot{
    const matched=availability==='ready'&&!input.composing&&!input.pending?findStations(features,input.committedQuery):[];
    const results=matched.slice(0,20).map(feature=>Object.freeze({feature,hidden:isHidden(feature)}));
    if(!results.some(entry=>entry.feature.id===activeKey))activeKey=null;
    return Object.freeze({...input,availability,results:Object.freeze(results),total:matched.length,activeKey});
  }
  let snapshot=build();
  function publish(){if(disposed)return;snapshot=build();for(const listener of listeners)listener();}
  function cancel(){++generation;cancelPending?.();cancelPending=null;}
  function flush(){
    if(disposed||input.composing||!input.pending&&input.query===input.committedQuery)return false;
    cancel();const query=input.query.slice(0,200);input={query,committedQuery:query,pending:false,composing:false};publish();onCommit();return true;
  }
  function schedule(){const version=generation;cancelPending=debounce(()=>{if(!disposed&&version===generation)flush();});}
  function restoreInput(value:SearchInput){cancel();input=Object.freeze({...value});activeKey=null;publish();if(input.pending&&!input.composing)schedule();}
  return {
    getSnapshot:()=>snapshot,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};},
    updateSource:(next:StationFeature[],status:SearchAvailability,hidden:(feature:StationFeature)=>boolean)=>{features=next;availability=status;isHidden=hidden;publish();},
    input:(value:string,nativeComposing=false)=>{
      if(disposed)return;
      const composing=input.composing||nativeComposing,query=composing?value:value.slice(0,200);
      if(query===input.query&&!composing&&!input.pending&&query===input.committedQuery)return;
      cancel();activeKey=null;input={...input,query,composing,pending:!composing};publish();if(!composing)schedule();
    },
    beginComposition:()=>{cancel();activeKey=null;input={...input,composing:true,pending:false};publish();},
    endComposition:(value:string)=>{if(!input.composing||disposed)return;input={...input,query:value,composing:false,pending:true};flush();},
    restore:(query:string)=>restoreInput({query,committedQuery:query,composing:false,pending:false}),
    captureInput:():SearchInput=>Object.freeze({...input}),restoreInput,flush,
    clear:()=>{cancel();activeKey=null;input={...input,query:'',composing:false,pending:true};flush();},
    move:(direction:1|-1)=>{
      if(input.composing||disposed)return;flush();const results=snapshot.results;if(!results.length)return;
      const index=results.findIndex(entry=>entry.feature.id===activeKey),next=index<0?(direction===1?0:results.length-1):(index+direction+results.length)%results.length;
      activeKey=results[next].feature.id;publish();
    },
    choice:():SearchEntry|undefined=>{if(input.composing||disposed)return;flush();return snapshot.results.find(entry=>entry.feature.id===activeKey)||snapshot.results[0];},
    activate:(key:string)=>{if(snapshot.results.some(entry=>entry.feature.id===key)){activeKey=key;publish();}},
    dispose:()=>{cancel();disposed=true;listeners.clear();},
  };
}
export type StationSearchStore=ReturnType<typeof createStationSearch>;
