export class JsonReadTimeoutError extends Error {
  constructor(){super('读取超时，请检查网络后重试。');this.name='TimeoutError';}
}

/** Deadline covers response headers and the entire JSON body. */
export async function requestJson(url:string,signal:AbortSignal,statusError:(status:number)=>Error,timeoutMs=15000,fetcher:typeof fetch=fetch):Promise<unknown>{
  const controller=new AbortController();
  const cancel=()=>controller.abort(signal.reason);
  if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try{
    controller.signal.throwIfAborted();
    const response=await fetcher(url,{signal:controller.signal});
    if(!response.ok)throw statusError(response.status);
    const value:unknown=await response.json();
    controller.signal.throwIfAborted();
    return value;
  }catch(error){
    // Rejecting HTTP headers must also stop any unread streaming error body.
    controller.abort();
    if(signal.aborted)throw signal.reason;
    if(timedOut)throw new JsonReadTimeoutError();
    throw error;
  }finally{
    clearTimeout(timer);signal.removeEventListener('abort',cancel);
  }
}
