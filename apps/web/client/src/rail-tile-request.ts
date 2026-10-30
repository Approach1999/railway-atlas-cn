import type {AddProtocolAction} from 'maplibre-gl';

export const RAIL_TILE_PROTOCOL='atlas-rail-tile';
const prefix=RAIL_TILE_PROTOCOL+'://';
export const railTileURL=(url:string)=>prefix+url;
export class TileReadTimeoutError extends Error {
  constructor(){super('轨道瓦片读取超时');this.name='TimeoutError';}
}

export function createRailTileLoader(origin:string,fetcher:typeof fetch=fetch,timeoutMs=15000):AddProtocolAction{
  const allowedOrigin=new URL(origin).origin;
  return async(params,parent)=>{
    let target:URL;
    try{if(!params.url.startsWith(prefix))throw Error();target=new URL(params.url.slice(prefix.length));}catch{throw Error('轨道瓦片地址无效');}
    const match=target.pathname.match(/^\/snapshots\/[A-Za-z0-9_-]{1,80}\/tiles\/(\d{1,2})\/(\d{1,10})\/(\d{1,10})\.pbf$/);
    if(!match||!['http:','https:'].includes(target.protocol)||target.origin!==allowedOrigin||target.username||target.password||target.hash)throw Error('轨道瓦片地址无效');
    const [z,x,y]=match.slice(1).map(Number);
    if(z>22||x>=2**z||y>=2**z||params.method&&params.method!=='GET'||params.type&&params.type!=='arrayBuffer')throw Error('轨道瓦片请求无效');
    const controller=new AbortController(),cancel=()=>controller.abort(parent.signal.reason);
    if(parent.signal.aborted)cancel();else parent.signal.addEventListener('abort',cancel,{once:true});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    try{
      controller.signal.throwIfAborted();
      const response=await fetcher(target.href,{signal:controller.signal,headers:params.headers,cache:params.cache,
        credentials:params.credentials||'same-origin',referrerPolicy:params.referrerPolicy});
      if(!response.ok)throw Object.assign(Error('轨道瓦片读取失败（'+response.status+'）'),{status:response.status});
      const data=await response.arrayBuffer();controller.signal.throwIfAborted();
      return {data,cacheControl:response.headers.get('cache-control')||undefined,expires:response.headers.get('expires')||undefined};
    }catch(error){
      controller.abort();
      if(parent.signal.aborted)throw parent.signal.reason;
      if(timedOut)throw new TileReadTimeoutError();
      throw error;
    }finally{clearTimeout(timer);parent.signal.removeEventListener('abort',cancel);}
  };
}
