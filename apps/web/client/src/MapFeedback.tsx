import {useSyncExternalStore} from 'react';
import {initialMapFeedback,type MapFeedbackStore,type MapNoticeAction} from './map-feedback';

const emptySubscribe=()=>()=>{};
const initialSnapshot=()=>initialMapFeedback;
function useFeedback(store?:MapFeedbackStore){return useSyncExternalStore(store?.subscribe||emptySubscribe,store?.getSnapshot||initialSnapshot);}
export function SourceDate({store}:{store?:MapFeedbackStore}){
  return <span id="source-date">{useFeedback(store).sourceDate}</span>;
}
export function NavigationStatus({store}:{store?:MapFeedbackStore}){
  return <p id="navigation-status" className="hint" role="status">{useFeedback(store).navigation}</p>;
}
export function MapStatus({store,onCurrentVersion}:{store?:MapFeedbackStore;onCurrentVersion:()=>void}){
  const state=useFeedback(store);
  return <><p id="status" role="status" aria-live="polite" tabIndex={-1}>{state.status}</p>
    {state.currentVersionRecovery&&<button data-latest-recovery="true" onClick={onCurrentVersion}>打开当前版本</button>}</>;
}
export function MapNotice({store,onAction}:{store?:MapFeedbackStore;onAction?:(action:MapNoticeAction)=>void}){
  const {notice,noticeAction}=useFeedback(store);
  const actionLabels:Record<MapNoticeAction,string>={'reset-filters':'恢复默认图层','all-lines':'恢复全部线路',home:'回到试验区'};
  return <div id="map-notice" role="status" hidden={!notice}>{notice}
    {notice&&noticeAction&&onAction&&<button onClick={()=>onAction(noticeAction)}>{actionLabels[noticeAction]}</button>}
  </div>;
}
export function DetailMapNotice({store}:{store:MapFeedbackStore}){
  const {notice}=useFeedback(store);
  return <p id="detail-map-notice" className="feature-note detail-map-notice" role="status" hidden={!notice}>{notice}</p>;
}
