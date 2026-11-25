import {useSyncExternalStore,type ReactNode} from 'react';
import type {RegionProfile} from './catalog-validation';
import type {CatalogStore} from './catalog-store';
import type {DatasetSwitchStore} from './dataset-switch';
import {REGION_CONFIG} from './region-config.ts';

interface Props {region:RegionProfile|null;directory:CatalogStore;switcher:DatasetSwitchStore;children?:ReactNode}

/** The region block in the header. Where more than one region has data here the region name is a
 * switch; until a switch completes it keeps showing the region that is actually loaded. */
export default function RegionSwitch({region,directory,switcher,children}:Props){
  const {status,catalog}=useSyncExternalStore(directory.subscribe,directory.getSnapshot);
  // Before the directory answers only the shown region is known to exist, so nothing can be offered.
  const options=status==='ready'&&catalog
    ?catalog.regions.map(item=>({id:item.id,name:item.name,snapshot:item.current_snapshot,camera:item.default_view}))
    :region?[{id:region.id,name:region.name,snapshot:'',camera:region.default_view}]:[];
  const current=region?.id||options[0]?.id||'';
  const choose=(id:string)=>{
    const target=options.find(option=>option.id===id);
    if(!target||target.id===current||!target.snapshot)return;
    switcher.request({snapshot:target.snapshot,region:target.id,camera:target.camera,crossRegion:target.id!==current});
  };
  return <div className="region">
    {options.length>1
      ?<div className="region-switch"><select id="region-switch" aria-label="切换地区" value={current} onChange={event=>choose(event.target.value)}>
        {options.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
      </select></div>
      :<div className="region-name">{region?.name||REGION_CONFIG.regions.find(profile=>profile.id===current)?.name||''}</div>}
    {children}
  </div>;
}
