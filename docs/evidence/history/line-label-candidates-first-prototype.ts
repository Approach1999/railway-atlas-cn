import type {Feature,FeatureCollection,LineString,MultiLineString,Position} from 'geojson';
import type {RailProperties} from '../../shared/atlas-types';

type XY=[number,number];
type Input=Feature<LineString|MultiLineString,RailProperties>;
type LabelProperties=RailProperties&{label_id:string;label_text:string;label_identity:string};
export interface LabelView {
  zoom:number;width:number;height:number;
  project:(coordinate:Position)=>XY;
  visible?:(properties:RailProperties)=>boolean;
  previous?:ReadonlySet<string>;
}
interface Candidate {id:string;identity:string;properties:RailProperties;text:string;point:XY;line:Position[];world:XY}
const radius=304; // Reserve four CSS pixels for source quantization in the renderer.
const grid=120;
const forward=(p:Position,scale:number):XY=>{
  const lat=Math.max(-85.051129,Math.min(85.051129,p[1]))*Math.PI/180;
  return [(p[0]+180)/360*scale,(1-Math.asinh(Math.tan(lat))/Math.PI)/2*scale];
};
const reverse=(p:XY,scale:number):Position=>[p[0]/scale*360-180,Math.atan(Math.sinh(Math.PI*(1-2*p[1]/scale)))*180/Math.PI];
const distance=(a:XY,b:XY)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const interpolate=(a:XY,b:XY,t:number):XY=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const lexical=(a:string,b:string)=>a<b?-1:a>b?1:0;

export function lineLabelText(p:RailProperties):string{
  const ref=typeof p.line_ref==='string'?p.line_ref:'';
  if(['subway','light_rail','tram'].includes(p.rail_mode)&&p.line_complete===true&&p.line_shared!==true&&ref)
    return (p.rail_mode==='tram'?'有轨电车 ':p.rail_mode==='light_rail'?'轻轨 ':'')+ref+'号线';
  return p.display_name.trim();
}
export function lineLabelIdentity(p:RailProperties):string{
  return ['subway','light_rail','tram'].includes(p.rail_mode)&&p.line_complete===true&&p.line_shared!==true&&p.line_key?
    'line:'+p.line_key:'object:'+p.osm_id;
}

/** Prototype of identity-aware label candidates. The product does not use this
 * source yet. Geometry is derived only from the supplied loaded tile fragments. */
export function buildLineLabelCandidates(features:Input[],view:LabelView){
  const scale=512*2**view.zoom,candidates=new Map<string,Candidate>();let skippedShort=0;
  for(const feature of features){
    const p=feature.properties,text=lineLabelText(p);
    if(p.feature_kind!=='track'||!text||view.visible&&!view.visible(p))continue;
    const identity=lineLabelIdentity(p),parts=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    // Conservative glyph width; the renderer still rejects tight bends/collisions.
    const needed=[...text].length*12+16,half=Math.max(needed/2,100);
    for(const part of parts){
      const points=part.map(c=>forward(c,scale)).filter((point,index,array)=>index===0||distance(point,array[index-1])>1e-7);
      if(points.length<2)continue;
      const offsets=[0];for(let i=1;i<points.length;i++)offsets.push(offsets[i-1]+distance(points[i-1],points[i]));
      const total=offsets.at(-1)!;if(total<needed){skippedShort++;continue;}
      const at=(offset:number):XY=>{
        for(let i=1;i<offsets.length;i++)if(offset<=offsets[i])return interpolate(points[i-1],points[i],(offset-offsets[i-1])/(offsets[i]-offsets[i-1]));
        return points.at(-1)!;
      };
      const add=(offset:number)=>{
        const extent=Math.min(half,offset,total-offset);if(extent<needed/2)return;
        const world=at(offset),coordinate=reverse(world,scale),point=view.project(coordinate);
        if(point[0]<-64||point[1]<-64||point[0]>view.width+64||point[1]>view.height+64)return;
        const id=identity+'|'+p.osm_id+'|'+Math.round(world[0]*8)+','+Math.round(world[1]*8);
        const start=offset-extent,end=offset+extent;
        const window=[at(start),...points.filter((_,i)=>offsets[i]>start&&offsets[i]<end),at(end)];
        // Symmetric path length keeps native line-center at the accepted anchor.
        const candidate={id,identity,properties:p,text,point,line:window.map(c=>reverse(c,scale)),world};
        const prior=candidates.get(id);
        if(!prior||JSON.stringify(candidate.line)<JSON.stringify(prior.line))candidates.set(id,candidate);
      };
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],segment=offsets[i]-offsets[i-1];
        for(const axis of [0,1] as const){
          if(Math.abs(b[axis]-a[axis])<1e-7)continue;
          for(let k=Math.ceil(Math.min(a[axis],b[axis])/grid);k<=Math.floor(Math.max(a[axis],b[axis])/grid);k++){
            const fraction=(k*grid-a[axis])/(b[axis]-a[axis]);add(offsets[i-1]+segment*fraction);
          }
        }
      }
      add(total/2);
    }
  }
  const ordered=[...candidates.values()].sort((a,b)=>Number(Boolean(view.previous?.has(b.id)))-Number(Boolean(view.previous?.has(a.id)))||lexical(a.identity,b.identity)||lexical(a.id,b.id));
  const cells=new Map<string,Candidate[]>(),accepted:Candidate[]=[];
  for(const candidate of ordered){
    const [x,y]=candidate.point,cx=Math.floor(x/radius),cy=Math.floor(y/radius);let blocked=false;
    for(let dx=-1;dx<=1&&!blocked;dx++)for(let dy=-1;dy<=1&&!blocked;dy++)
      blocked=(cells.get(candidate.identity+'|'+(cx+dx)+','+(cy+dy))||[]).some(other=>distance(other.point,candidate.point)<radius);
    if(blocked)continue;
    const key=candidate.identity+'|'+cx+','+cy,list=cells.get(key)||[];list.push(candidate);cells.set(key,list);accepted.push(candidate);
  }
  const collection:FeatureCollection<LineString,LabelProperties>={type:'FeatureCollection',features:accepted.map(c=>({type:'Feature',id:c.id,geometry:{type:'LineString',coordinates:c.line},properties:{...c.properties,label_id:c.id,label_identity:c.identity,label_text:c.text}}))};
  return {collection,anchors:accepted.map(c=>({id:c.id,identity:c.identity,osm_id:c.properties.osm_id,point:c.point})),candidateCount:candidates.size,skippedShort};
}
