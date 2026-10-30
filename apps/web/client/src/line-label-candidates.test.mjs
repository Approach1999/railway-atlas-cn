import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLineLabelCandidates,prepareLineLabelCandidates,selectLineLabelCandidates,lineLabelIdentity,lineLabelText} from './line-label-candidates.ts';
const scale=512*2**12;
const coordinate=([x,y])=>[x/scale*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/scale)))*180/Math.PI];
const project=p=>[(p[0]+180)/360*scale,(1-Math.asinh(Math.tan(p[1]*Math.PI/180))/Math.PI)/2*scale];
const view={zoom:12,width:1500,height:900,project};
const feature=(id,line,patch={})=>({type:'Feature',geometry:{type:'LineString',coordinates:line.map(coordinate)},properties:{feature_kind:'track',osm_id:id,display_name:'同名线路',rail_mode:'rail',status:'mapped',...patch}});
const checkSpacing=result=>{
  for(let i=0;i<result.anchors.length;i++)for(let j=i+1;j<result.anchors.length;j++){
    const a=result.anchors[i],b=result.anchors[j];if(a.identity===b.identity)assert(Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1])>=304-1e-7);
  }
};

test('prepared geometry filters before same-line spacing and can restore a previously hidden source',()=>{
  const line={rail_mode:'subway',line_complete:true,line_key:'metro/2',line_ref:'2'};
  const fs=[feature('way/1',[[0,200],[1400,200]],{...line,status:'mapped'}),feature('way/2',[[0,240],[1400,240]],{...line,status:'construction'})];
  const prepared=prepareLineLabelCandidates(fs,view),all=selectLineLabelCandidates(prepared,{}),before=JSON.stringify(prepared);
  for(const status of ['mapped','construction','absent']){
    const visible=p=>p.status===status,filtered=selectLineLabelCandidates(prepared,{visible,previous:new Set(all.anchors.map(a=>a.id))});
    assert.deepEqual(filtered,buildLineLabelCandidates(fs,{...view,visible,previous:new Set(all.anchors.map(a=>a.id))}));checkSpacing(filtered);
    if(status==='absent')assert.equal(filtered.anchors.length,0);
    else assert(filtered.anchors.length>=3&&filtered.anchors.every(a=>a.osm_id===(status==='mapped'?'way/1':'way/2')));
  }
  assert.equal(JSON.stringify(prepared),before);
});

test('repeat distance applies to source identity, preserving independent same-name parallel tracks',()=>{
  const fs=[feature('way/1',[[0,200],[1400,200]]),feature('way/2',[[0,240],[1400,240]])];
  const before=JSON.stringify(fs),result=buildLineLabelCandidates(fs,view);checkSpacing(result);
  assert(result.anchors.filter(a=>a.osm_id==='way/1').length>=3);
  assert(result.anchors.filter(a=>a.osm_id==='way/2').length>=3);
  assert.equal(JSON.stringify(fs),before);
});

test('curves and adjacent/buffered tile fragments cannot create near duplicate anchors for the same way',()=>{
  const fs=[feature('way/1',[[0,200],[400,200],[400,400],[800,400]]),feature('way/1',[[390,200],[400,200],[400,400],[800,400],[1200,400]])];
  const result=buildLineLabelCandidates(fs,view);assert(result.anchors.length>1);checkSpacing(result);
  assert.deepEqual(buildLineLabelCandidates([...fs].reverse(),view),result);
  assert.deepEqual(buildLineLabelCandidates([...fs,...fs],view).anchors,result.anchors);
});

test('only complete unshared city line identity groups distinct member ways',()=>{
  const p=feature('way/1',[],{rail_mode:'subway',line_complete:true,line_key:'metro/2',line_ref:'2'}).properties;
  assert.equal(lineLabelText(p),'2号线');assert.equal(lineLabelIdentity(p),'line:metro/2');
  assert.equal(lineLabelIdentity({...p,line_shared:true}),'object:way/1');
  assert.equal(lineLabelIdentity({...p,line_complete:false}),'object:way/1');
  assert.equal(lineLabelIdentity({...p,rail_mode:'rail'}),'object:way/1');
  assert.equal(lineLabelText({...p,line_shared:true}),'同名线路');
  const fs=[feature('way/1',[[0,200],[1400,200]],p),feature('way/2',[[0,240],[1400,240]],{...p,osm_id:'way/2'})];
  const result=buildLineLabelCandidates(fs,view);checkSpacing(result);assert(result.anchors.every(a=>a.identity==='line:metro/2'));
});

test('label path centers coincide with accepted anchors and retained candidates survive pan translation',()=>{
  const fs=[feature('way/1',[[0,200],[600,200],[600,700],[1300,700]])];
  const result=buildLineLabelCandidates(fs,view);checkSpacing(result);
  for(let index=0;index<result.collection.features.length;index++){
    const points=result.collection.features[index].geometry.coordinates.map(project);let length=0;
    for(let i=1;i<points.length;i++)length+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
    let remaining=length/2,center;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(remaining<=d){center=[a[0]+(b[0]-a[0])*remaining/d,a[1]+(b[1]-a[1])*remaining/d];break;}remaining-=d;
    }
    assert(Math.hypot(center[0]-result.anchors[index].point[0],center[1]-result.anchors[index].point[1])<1e-5);
  }
  const panned=buildLineLabelCandidates(fs,{...view,project:p=>{const [x,y]=project(p);return [x+10,y+15];},previous:new Set(result.anchors.map(a=>a.id))});
  assert.deepEqual(panned.anchors.map(a=>a.id),result.anchors.map(a=>a.id));
});

test('unnamed, invisible, degenerate and offscreen fragments do not invent labels',()=>{
  const fs=[feature('way/2',[[0,200],[1400,200]],{display_name:''}),feature('way/3',[[0,200],[1400,200]],{status:'disused'}),feature('way/4',[[0,200],[0,200]]),feature('way/5',[[0,5000],[1400,5000]])];
  const result=buildLineLabelCandidates(fs,{...view,visible:p=>p.status==='mapped'});
  assert.equal(result.collection.features.length,0);
});

test('short source fragments retain an upright tangent caption at their own midpoint without joining same names',()=>{
  const fs=[feature('way/1',[[100,200],[110,210]]),feature('way/2',[[110,210],[120,220]])],result=buildLineLabelCandidates(fs,view);
  assert.equal(result.collection.features.length,2);
  for(const f of result.collection.features){
    assert.equal(f.geometry.type,'Point');assert.equal(f.properties.label_kind,'short');
    assert(Math.abs(f.properties.label_angle-45)<1e-6);assert.equal(f.properties.label_text,'同名线路');
    const p=project(f.geometry.coordinates),expected=f.properties.osm_id==='way/1'?[105,205]:[115,215];
    assert(Math.hypot(p[0]-expected[0],p[1]-expected[1])<1e-6);
  }
  const reversed=buildLineLabelCandidates([feature('way/3',[[110,210],[100,200]])],view);
  assert(Math.abs(reversed.collection.features[0].properties.label_angle-45)<1e-6);
});
