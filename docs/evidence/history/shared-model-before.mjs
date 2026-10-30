export const DEFAULTS = {preset:'overview',history:false,sidings:true,lineNames:true,stationNames:true,facilities:false,lineKeys:null};
export const FACILITY_LABELS={platform:'站台',stop_position:'停车位置',entrance:'出入口',signal:'信号机',switch:'道岔',level_crossing:'平交道口',buffer_stop:'车挡',depot:'机务段 / 车辆段',yard:'站场',works:'工厂 / 检修设施',maintenance:'维护设施',water_tower:'水塔',turntable:'转车盘',roundhouse:'扇形库',wash:'洗车设施',fuel:'加油设施',loading_ramp:'装卸坡道'};
export const CLASS_LABELS = {high_speed:'高速铁路',conventional_main:'普速干线',conventional_other:'普速 / 未标注',branch:'支线 / 站场线',industrial:'专用线',metro:'地铁',light_rail:'轻轨',tram:'有轨电车',other:'其他轨道',unknown:'等级未标注'};
export const MODE_LABELS = {rail:'铁路',subway:'地铁',light_rail:'轻轨',tram:'有轨电车',unknown:'制式未标注'};
export const STATUS_LABELS = {mapped:'当前标注',construction:'建设',proposed:'规划',disused:'停用',abandoned:'废弃',razed:'拆除',conflict:'状态冲突',unknown:'状态未标注'};
export const STATUS_STYLES={
  mapped:{opacity:1},construction:{dash:[3,2],opacity:1},proposed:{dash:[.5,2],opacity:1},
  disused:{color:'#6b7573',dash:[6,3],opacity:1},abandoned:{color:'#817263',dash:[5,2,1,2],opacity:1},
  razed:{color:'#817263',dash:[.5,3],opacity:1},unknown:{color:'#6b7079',dash:[2,2],opacity:1,warning:'?'},
  conflict:{color:'#6b7079',dash:[1,1,4,1],opacity:1,warning:'!'}
};
export const PRESET_LABELS = {overview:'铁路概览',highspeed:'仅高速',conventional:'仅普速',urban:'城市轨道',custom:'自定义图层'};
export function normalize(value='') { return value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase(); }
export function findStations(features,term) {
  const query=normalize(term); if(!query)return [];
  return features.map(f=>{
    const name=normalize(f.properties.display_name), aliases=(f.properties.aliases||[]).map(normalize);
    const rank=name===query?0:aliases.includes(query)?1:name.startsWith(query)?2:aliases.some(v=>v.startsWith(query))?3:[name,...aliases].some(v=>v.includes(query))?4:99;
    return {f,rank};
  }).filter(v=>v.rank<99).sort((a,b)=>a.rank-b.rank||a.f.properties.display_name.length-b.f.properties.display_name.length||a.f.id.localeCompare(b.f.id)).map(v=>v.f);
}
export const FILTER_MODES=['rail','subway','light_rail','tram','other','unknown'];
export const FILTER_CLASSES=Object.keys(CLASS_LABELS);
export const FILTER_STATES=Object.keys(STATUS_LABELS);
export function expandedState(state){
  if(state.preset==='custom')return {...state,types:[...(state.types||[])],classes:[...(state.classes||[])],states:[...(state.states||[])],lineKeys:state.lineKeys===null?null:[...(state.lineKeys||[])]};
  return {...state,types:state.preset==='urban'?['subway','light_rail','tram']:['rail','other','unknown'],
    classes:state.preset==='highspeed'?['high_speed']:state.preset==='conventional'?['conventional_main','conventional_other']:[...FILTER_CLASSES],
    states:state.history?[...FILTER_STATES]:['mapped'],lineKeys:state.lineKeys===null?null:[...(state.lineKeys||[])]};
}
const groupedMode=mode=>FILTER_MODES.includes(mode)?mode:'other';
// Stations and facilities follow mode/status/line filters, not track grades.
export function overlayVisible(p,state,lineKeys=state.lineKeys){
  const active=expandedState(state);
  return active.types.includes(groupedMode(p.rail_mode))&&active.states.includes(p.status)&&
    (lineKeys==null||lineKeys.some(key=>(p.line_keys||[]).includes(key)||(p.line_tokens||'').includes('|'+key+'|')));
}
export function overlayFilter(state,lineKeys=state.lineKeys){
  const active=expandedState(state);
  const mode=['match',['get','rail_mode'],'rail','rail','subway','subway','light_rail','light_rail','tram','tram','unknown','unknown','other'];
  return ['all',['in',mode,['literal',active.types]],['in',['get','status'],['literal',active.states]],
    lineKeys==null?['==',1,1]:lineKeys.length?['any',...lineKeys.map(key=>['in','|'+key+'|',['coalesce',['get','line_tokens'],'']])]:['==',1,0]];
}
export function trackVisible(p,state,zoom=14) {
  if(state.preset==='custom'){
    if(!state.states.includes(p.status)||!state.types.includes(groupedMode(p.rail_mode)))return false;
    if(!['subway','light_rail','tram'].includes(p.rail_mode)&&!state.classes.includes(p.line_class))return false;
    return !['branch','industrial'].includes(p.line_class)||(state.sidings&&zoom>=12);
  }
  if(!state.history&&p.status!=='mapped')return false;
  const urban=['subway','light_rail','tram'].includes(p.rail_mode);
  if(state.preset==='urban')return urban;
  if(urban)return false;
  if(state.preset==='highspeed'&&p.line_class!=='high_speed')return false;
  if(state.preset==='conventional'&&!['conventional_main','conventional_other'].includes(p.line_class))return false;
  if(['branch','industrial'].includes(p.line_class)&&(!state.sidings||zoom<12))return false;
  return true;
}
export function stationVisible(p,state) {
  if(state.preset==='custom')return state.states.includes(p.status)&&state.types.includes(groupedMode(p.rail_mode));
  if(!state.history&&p.status!=='mapped')return false;
  const urban=['subway','light_rail','tram'].includes(p.rail_mode);
  return state.preset==='urban'?urban:!urban;
}
// Build the equivalent MapLibre filter without downloading the track collection.
export function trackFilter(state,{minor=false,lifecycle=null}={}) {
  const filters=['all',['==',['get','feature_kind'],'track']];
  const urban=['in',['get','rail_mode'],['literal',['subway','light_rail','tram']]];
  if(state.preset==='custom'){
    const mode=['match',['get','rail_mode'],'rail','rail','subway','subway','light_rail','light_rail','tram','tram','unknown','unknown','other'];
    filters.push(['in',mode,['literal',state.types]],['in',['get','status'],['literal',state.states]],['any',urban,['in',['get','line_class'],['literal',state.classes]]]);
  }else filters.push(state.preset==='urban'?urban:['!',urban]);
  if(state.preset==='highspeed')filters.push(['==',['get','line_class'],'high_speed']);
  if(state.preset==='conventional')filters.push(['in',['get','line_class'],['literal',['conventional_main','conventional_other']]]);
  const minorMatch=['in',['get','line_class'],['literal',['branch','industrial']]];
  filters.push(minor?minorMatch:['!',minorMatch]);
  if(minor&&!state.sidings)filters.push(['==',1,0]);
  if(lifecycle)filters.push(lifecycle==='other'?['!=',['get','status'],'mapped']:['==',['get','status'],lifecycle]);
  if(state.preset!=='custom'&&!state.history)filters.push(['==',['get','status'],'mapped']);
  return filters;
}
