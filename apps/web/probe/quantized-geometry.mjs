/* Work only on integer tile coordinates; retained vertices and properties never move. */
export const normalizationStats=()=>({duplicate_vertices_removed:0,collapsed_line_parts:0,collapsed_polygon_rings:0,collapsed_features:0});
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
function area2(ring){let value=0;for(let i=1;i<ring.length;i++)value+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];return value;}
export function normalizeQuantizedFeature(feature,stats=normalizationStats()){
  const key=feature.tags?.osm_id||'feature';
  const check=point=>{if(!Array.isArray(point)||point.length!==2||!point.every(Number.isSafeInteger))throw Error(key+': non-integer tile coordinate');return [...point];};
  if(feature.type===1){if(!feature.geometry.length)throw Error(key+': empty point geometry');return {...feature,geometry:feature.geometry.map(check)};}
  if(![2,3].includes(feature.type))throw Error(key+': unsupported tile geometry');
  const parts=[];let exterior=false,ambiguous=false;
  for(const input of feature.geometry){
    const part=[];for(const raw of input){const p=check(raw);if(part.length&&same(part.at(-1),p))stats.duplicate_vertices_removed++;else part.push(p);}
    if(feature.type===2){if(part.length<2){stats.collapsed_line_parts++;continue;}parts.push(part);continue;}
    if(part.length>1&&!same(part[0],part.at(-1)))throw Error(key+': unclosed quantized polygon');
    const area=part.length>=4?area2(part):0;
    if(area===0){stats.collapsed_polygon_rings++;ambiguous=true;continue;}
    if(area>0){exterior=true;ambiguous=false;}
    else if(!exterior||ambiguous)throw Error(key+': ambiguous collapsed exterior/hole sequence; review before publishing');
    parts.push(part);
  }
  if(!parts.length){stats.collapsed_features++;return null;}
  return {...feature,geometry:parts};
}
