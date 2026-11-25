import {parseCatalog,type Catalog} from './catalog-validation.ts';
import {requestJson,JsonReadTimeoutError} from './json-request.ts';

export type CatalogStatus='loading'|'ready'|'error';
export interface CatalogState {readonly status:CatalogStatus;readonly catalog:Catalog|null;readonly message:string}
export const initialCatalogState:CatalogState=Object.freeze({status:'loading',catalog:null,message:''});

/** The served version directory: which regions and versions exist on disk. One request at a time; a late
 * response from an earlier attempt or after disposal never replaces the current state. */
export function createCatalogStore(fetcher:typeof fetch=fetch,timeoutMs=15000){
  let state=initialCatalogState,generation=0,pending:Promise<Catalog>|null=null,controller:AbortController|null=null,disposed=false;
  const listeners=new Set<()=>void>();
  function publish(change:Partial<CatalogState>){if(disposed)return;const next=Object.freeze({...state,...change});if((Object.keys(next) as Array<keyof CatalogState>).every(key=>next[key]===state[key]))return;state=next;listeners.forEach(listener=>listener());}
  function load():Promise<Catalog>{
    if(disposed)return Promise.reject(new DOMException('Aborted','AbortError'));
    if(pending)return pending;
    const token=++generation;controller=new AbortController();publish({status:'loading',message:''});
    const request=requestJson('/catalog.json',controller.signal,()=>Error('数据目录加载失败'),timeoutMs,fetcher)
      .then(parseCatalog)
      .then(catalog=>{if(disposed||token!==generation)throw new DOMException('Aborted','AbortError');publish({status:'ready',catalog,message:''});return catalog;})
      .catch(error=>{if(!disposed&&token===generation)publish({status:'error',message:error instanceof JsonReadTimeoutError?'数据目录读取超时，请检查网络后重试。':'数据目录暂时无法读取或格式无效'});throw error;})
      .finally(()=>{if(pending===request)pending=null;});
    pending=request;return request;
  }
  return {
    getSnapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    load,
    dispose(){disposed=true;++generation;controller?.abort();listeners.clear();},
  };
}
export type CatalogStore=ReturnType<typeof createCatalogStore>;
