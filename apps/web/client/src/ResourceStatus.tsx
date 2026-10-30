import {RESOURCE_LABELS,type ResourceIssue,type ResourceKey} from './resources';
import {useEffect,useRef} from 'react';
interface Props {issues:Partial<Record<ResourceKey,ResourceIssue>>;onRetry:(key:ResourceKey)=>void}
export default function ResourceStatus({issues,onRetry}:Props){
  const panel=useRef<HTMLElement>(null),retryFocus=useRef<ResourceKey|null>(null);
  useEffect(()=>{
    const key=retryFocus.current,issue=key&&issues[key];
    if(!key||!issue||issue.status==='loading')return;
    // Keep the keyboard position meaningful when a successful retry removes
    // its button, without stealing focus from another control used meanwhile.
    if(document.activeElement===document.body||panel.current?.contains(document.activeElement)){
      if(issue.status==='ready')document.getElementById('status')?.focus({preventScroll:true});
      else panel.current?.querySelector<HTMLButtonElement>(`[data-resource="${key}"] button`)?.focus();
    }
    retryFocus.current=null;
  },[issues]);
  const active=Object.values(issues).filter(issue=>issue.status==='error'||issue.status==='loading'&&issue.message);
  if(!active.length)return null;
  return <section ref={panel} className="resource-status" aria-label="数据加载状态">
    {active.map(issue=><div className="resource-issue" key={issue.key} data-resource={issue.key}>
      <p role={issue.status==='error'?'alert':'status'}>{issue.message}</p>
      <button disabled={issue.status==='loading'} onClick={()=>{retryFocus.current=issue.key;onRetry(issue.key);}}>{issue.status==='loading'?'正在重试'+RESOURCE_LABELS[issue.key]:'重试'+RESOURCE_LABELS[issue.key]}</button>
    </div>)}
  </section>;
}
