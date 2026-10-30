export interface ShareFilters {
  preset: 'custom'; types: string[]; classes: string[]; states: string[];
  lineKeys: string[] | null; history: boolean; sidings: boolean;
  facilities: boolean; lineNames: boolean; stationNames: boolean;
}
export interface ShareView {
  region: string; snapshot: string; feature: string | null; query: string;
  zoom: number; latitude: number; longitude: number; filters: ShareFilters;
}
const modes = ['rail','subway','light_rail','tram','other','unknown'];
const classes = ['high_speed','conventional_main','conventional_other','branch','industrial','metro','light_rail','tram','other','unknown'];
const states = ['mapped','construction','proposed','disused','abandoned','razed','unknown','conflict'];
const keyPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const linePattern = /^[a-zA-Z0-9_/-]{1,120}$/;
const featurePattern = /^(node|way|relation)\/\d+$/;
const known = new Set(['region','snapshot','feature','q','types','classes','states','lines','labels','facilities','sidings']);

export function defaultView(): ShareView {
  return {region:'shenyang',snapshot:'',feature:null,query:'',zoom:10.5,latitude:41.8,longitude:123.42,
    filters:{preset:'custom',types:['rail','other','unknown'],classes:[...classes],states:['mapped'],lineKeys:null,
      history:false,sidings:true,facilities:false,lineNames:true,stationNames:true}};
}

export function decodeView(address: string): {view: ShareView; warnings: string[]} {
  const view = defaultView(), warnings: string[] = [];
  if(address.length>8192)return {view,warnings:['分享地址过长，已恢复默认视图。']};
  const url = new URL(address,'http://local.invalid');
  for(const key of url.searchParams.keys()) {
    if(!known.has(key))warnings.push('已忽略未知参数：'+key);
    if(url.searchParams.getAll(key).length>1)warnings.push('重复参数已取第一项：'+key);
  }
  const region=url.searchParams.get('region');
  if(region && region!=='shenyang')warnings.push('此地区暂无已发布数据，已回到沈阳试验区。');
  const snapshot=url.searchParams.get('snapshot');
  if(snapshot){if(keyPattern.test(snapshot))view.snapshot=snapshot;else warnings.push('快照标识无效，已使用当前版本。');}
  const feature=url.searchParams.get('feature');
  if(feature){if(featurePattern.test(feature))view.feature=feature;else warnings.push('要素标识无效，已保留地图视图。');}
  view.query=(url.searchParams.get('q')||'').trim().slice(0,200);
  function list(name:string, allowed:string[], fallback:string[]): string[] {
    const value=url.searchParams.get(name);if(value===null)return fallback;
    const items=value?value.split(','):[];
    if(items.some(item=>!allowed.includes(item)))warnings.push('已忽略无效筛选：'+name);
    return [...new Set(items.filter(item=>allowed.includes(item)))];
  }
  view.filters.types=list('types',modes,view.filters.types);
  view.filters.classes=list('classes',classes,view.filters.classes);
  view.filters.states=list('states',states,view.filters.states);
  view.filters.history=view.filters.states.some(state=>state!=='mapped');
  const lines=url.searchParams.get('lines');
  if(lines!==null){view.filters.lineKeys=[...new Set((lines?lines.split(','):[]).filter(key=>linePattern.test(key)))];
    if(view.filters.lineKeys.length!==(lines?new Set(lines.split(',')).size:0))warnings.push('线路标识无效项已忽略。');}
  const labels=list('labels',['lines','stations'],['lines','stations']);
  view.filters.lineNames=labels.includes('lines');view.filters.stationNames=labels.includes('stations');
  for(const key of ['facilities','sidings'] as const){
    const value=url.searchParams.get(key);
    if(value!==null){if(value==='0'||value==='1')view.filters[key]=value==='1';else warnings.push('开关值无效：'+key);}
  }
  if(url.hash){
    const parts=/^#map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)$/.exec(url.hash);
    if(parts){const [zoom,latitude,longitude]=parts.slice(1).map(Number);
      if(Number.isFinite(zoom)&&zoom>=8&&zoom<=18&&Number.isFinite(latitude)&&Math.abs(latitude)<=85.051129&&Number.isFinite(longitude)&&Math.abs(longitude)<=180){Object.assign(view,{zoom,latitude,longitude});}
      else warnings.push('地图视图参数越界，已恢复默认位置。');
    }else warnings.push('地图视图参数无效，已恢复默认位置。');
  }
  return {view,warnings};
}

export function encodeView(view: ShareView): string {
  const parameters=new URLSearchParams();
  parameters.set('region',view.region);
  if(view.snapshot)parameters.set('snapshot',view.snapshot);
  if(view.feature&&featurePattern.test(view.feature))parameters.set('feature',view.feature);
  if(view.query)parameters.set('q',view.query.slice(0,200));
  parameters.set('types',[...new Set(view.filters.types)].sort().join(','));
  parameters.set('classes',[...new Set(view.filters.classes)].sort().join(','));
  parameters.set('states',[...new Set(view.filters.states)].sort().join(','));
  if(view.filters.lineKeys!==null)parameters.set('lines',[...new Set(view.filters.lineKeys)].sort().join(','));
  parameters.set('labels',[...(view.filters.lineNames?['lines']:[]),...(view.filters.stationNames?['stations']:[])].join(','));
  parameters.set('facilities',view.filters.facilities?'1':'0');parameters.set('sidings',view.filters.sidings?'1':'0');
  return '/?'+parameters+'#map='+view.zoom.toFixed(2)+'/'+view.latitude.toFixed(5)+'/'+view.longitude.toFixed(5);
}
