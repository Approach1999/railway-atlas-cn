interface CameraMove {center:[number,number];zoom:number;offset?:[number,number];duration:number}
interface MotionMap {
  easeTo(options:CameraMove):unknown;
  stop():unknown;
  on(type:'moveend',listener:()=>void):unknown;
  off(type:'moveend',listener:()=>void):unknown;
}

/** Apply the current preference, including changes while an owned camera move is active. */
export function createMapMotion(map:MotionMap,query:MediaQueryList){
  let pending:CameraMove|null=null,disposed=false;
  const finish=()=>{pending=null;};
  const changed=()=>{
    if(disposed||!query.matches)return;
    const target=pending;
    // Complete a requested station/home move; merely stopping could leave its target offscreen.
    if(target)map.easeTo({...target,duration:0});else map.stop();
  };
  map.on('moveend',finish);query.addEventListener('change',changed);
  return {
    easeTo(options:CameraMove){
      if(disposed)return;
      map.stop();pending={...options};
      map.easeTo({...options,duration:query.matches?0:options.duration});
    },
    dispose(){disposed=true;pending=null;map.off('moveend',finish);query.removeEventListener('change',changed);},
  };
}
