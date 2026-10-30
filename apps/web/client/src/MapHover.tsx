import {useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {MapHoverStore} from './map-hover.ts';
export default function MapHover({store}:{store:MapHoverStore}){
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot),ref=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({left:0,top:0});
  useLayoutEffect(()=>{
    if(!state||!ref.current)return;const box=ref.current.getBoundingClientRect(),gap=14;
    const left=Math.max(8,Math.min(state.x+gap,innerWidth-box.width-8));
    const top=state.y+gap+box.height<=innerHeight-8?state.y+gap:Math.max(8,state.y-box.height-gap);
    setPosition({left,top});
  },[state]);
  if(!state)return null;
  return <div ref={ref} id="map-hover" role="tooltip" style={position} onPointerEnter={store.hold} onPointerLeave={store.leave}>
    {state.items.map(item=><div className="hover-item" key={item.id}><strong>{item.name}</strong><span>{item.kind} · {item.status}</span>{item.lines&&<span>{item.lines}</span>}<small>{item.id}</small></div>)}
    <p>{state.total>1?`此处有 ${state.total} 项，点击选择查看。`:'点击查看来源与原始标注。'}<span>Esc 关闭提示</span></p>
  </div>;
}
