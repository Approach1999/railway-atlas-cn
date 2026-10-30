import type {ExpressionSpecification} from 'maplibre-gl';
import type {Palette,LineIndex,LineRecord} from '../../shared/atlas-types.ts';
import {contrastingCasing} from './contrast.ts';
export function resolveLinePaint(palette:Palette,line:LineRecord,available=true){
  if(!available)return {color:'#697579',source:'配色暂不可用',confidence:'fallback'};
  if(line.mode!=='subway')return {color:palette.fallbacks[line.mode]||palette.fallbacks.unknown,source:'制式色（轻轨 / 有轨电车）',confidence:'fallback'};
  for(const override of palette.overrides||[])if(override.line_key===line.line_key||[...line.relation_ids,...(line.master_ids||[])].includes(String(override.relation_id).startsWith('relation/')?String(override.relation_id):'relation/'+override.relation_id))return {color:override.color,source:override.source||'手工配置',confidence:'manual',verifiedAt:override.verified_at};
  const operator=line.operator_key?palette.operators[line.operator_key]:undefined,configured=operator?.lines?.[line.ref];
  if(configured)return {color:configured.color,source:operator.source,confidence:operator.confidence,verifiedAt:configured.verified_at||operator.verified_at};
  const colors=[...new Set((line.source_tags||[]).map(tags=>tags.colour).filter(value=>/^#[0-9a-f]{6}$/i.test(value||'')))];
  if(colors.length===1)return {color:colors[0],source:'OSM colour 标注',confidence:'osm'};
  return {color:palette.fallbacks[line.mode]||palette.fallbacks.unknown,source:'制式回退色',confidence:'fallback'};
}
function matchColor(input:ExpressionSpecification,entries:Array<[string,string]>,fallback:string|ExpressionSpecification):string|ExpressionSpecification{
  const [first,...rest]=entries;if(!first)return fallback;
  return ['match',input,first[0],first[1],...rest.flatMap(([key,color])=>[key,color]),fallback];
}
export function paletteColorExpression(palette:Palette,lineCatalog:LineIndex,casing=false,available=true):string|ExpressionSpecification{
  const transform=(color:string)=>casing?contrastingCasing(color):color;
  const classes=matchColor(['get','line_class'],Object.entries(palette.class_palette).map(([k,v])=>[k,transform(v.color)]),transform('#8a8f98'));
  const fallback:ExpressionSpecification=['match',['get','rail_mode'],'subway',transform(palette.fallbacks.subway),'light_rail',transform(palette.fallbacks.light_rail),'tram',transform(palette.fallbacks.tram),classes];
  if(!lineCatalog.lines.length)return fallback;
  const lines=matchColor(['coalesce',['get','line_key'],''],lineCatalog.lines.map(line=>[line.line_key,transform(resolveLinePaint(palette,line,available).color)]),fallback);
  return ['case',['all',['==',['get','line_complete'],true],['!=',['get','line_shared'],true]],lines,fallback];
}
