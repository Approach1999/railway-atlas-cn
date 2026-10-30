import {MAP_FONT_FAMILY,MAP_FONT_INTEGRITY} from './map-font-data.ts';
export const MAP_FONT_STACK=[MAP_FONT_FAMILY,'Microsoft YaHei','PingFang SC','sans-serif'];
export const MAP_FONT_URL=new URL('./assets/map-cjk.woff2',import.meta.url).href;
interface FontDependencies {
  fetcher:typeof fetch;createFace:(bytes:ArrayBuffer)=>FontFace;addFace:(face:FontFace)=>void;
}
/** One deadline covers headers, body and decoding; only a decoded face is
 * registered. Fetch integrity pins its content, without an external font host. */
export async function loadMapFont(signal:AbortSignal,dependencies:Partial<FontDependencies>={},timeoutMs=15000):Promise<FontFace>{
  const controller=new AbortController(),fetcher=dependencies.fetcher||fetch;
  const createFace=dependencies.createFace||((bytes:ArrayBuffer)=>new FontFace(MAP_FONT_FAMILY,bytes));
  const addFace=dependencies.addFace||((face:FontFace)=>{document.fonts.add(face);});
  let timedOut=false;
  const cancel=()=>controller.abort(signal.reason);
  if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort(new Error('地图字体读取超时'));},timeoutMs);
  let onAbort:()=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{
    onAbort=()=>reject(controller.signal.reason);
    if(controller.signal.aborted)onAbort();else controller.signal.addEventListener('abort',onAbort,{once:true});
  });
  try{
    const work=(async()=>{
      controller.signal.throwIfAborted();
      const response=await fetcher(MAP_FONT_URL,{signal:controller.signal,integrity:MAP_FONT_INTEGRITY});
      if(!response.ok)throw Error('字体读取失败（'+response.status+'）');
      const bytes=await response.arrayBuffer();controller.signal.throwIfAborted();
      const face=await createFace(bytes).load();controller.signal.throwIfAborted();
      addFace(face);return face;
    })();
    return await Promise.race([work,cancelled]);
  }catch(error){
    controller.abort();
    if(signal.aborted)throw signal.reason;
    if(timedOut)throw Error('地图字体读取超时');
    throw error;
  }finally{
    clearTimeout(timer);signal.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);
  }
}
