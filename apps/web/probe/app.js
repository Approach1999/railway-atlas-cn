/* Bounded local feasibility only. Production must not fetch a country GeoJSON. */
import * as maplibregl from '/vendor/maplibre-gl.mjs';
const statusEl = document.querySelector('#status');
const details = document.querySelector('#details');
const map = new maplibregl.Map({container:'map',center:[123.42,41.80],zoom:10.5,
  style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eaf0ef'}}]}});
map.addControl(new maplibregl.NavigationControl(),'top-right');
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles',protocol.tile);
let data;
const started = performance.now();
map.on('error',e=>{statusEl.textContent='加载失败：'+(e.error?.message||'未知错误');});
function selectFeature(feature) {
  const p=feature.properties, raw=typeof p.tags==='string'?JSON.parse(p.tags):p.tags||{};
  details.textContent=`${p.name||'未命名要素'}\n${p.osm_id}\n类型：${p.railway}\n状态：${p.status==='mapped'?'OSM 当前标注（未核验运营状态）':p.status}\n限速：${p.maxspeed||'未标注'}\n电气化：${p.electrified||'未标注'}\n\n${JSON.stringify(raw,null,2)}`;
  if(feature.geometry.type==='Point')map.flyTo({center:feature.geometry.coordinates,zoom:14,duration:400});
}
function search() {
  const results=document.querySelector('#results');results.replaceChildren();
  const term=document.querySelector('#search').value.trim(); if(!term||!data)return;
  const found=data.features.filter(f=>f.geometry.type==='Point'&&f.properties.railway==='station'&&
    [f.properties.name,f.properties.tags.alt_name].some(n=>n?.includes(term))).slice(0,20);
  found.forEach(f=>{const b=document.createElement('button');
    b.textContent=`${f.properties.name||'未命名'} · ${f.properties.station==='subway'?'地铁':'铁路 / 制式待核验'} · ${f.id}`;
    b.onclick=()=>selectFeature(f);results.append(b);});
  if(!found.length)results.textContent='当前试验区未找到匹配车站';
}
const trackTypes=['rail','subway','tram','light_rail','narrow_gauge','miniature','abandoned','disused','construction','razed','proposed'];
function addLayers(source,vector=false) {
  ['tracks','stations'].forEach(id=>{if(map.getLayer(id))map.removeLayer(id);});
  const common={source,...(vector?{'source-layer':'railway'}:{})};
  map.addLayer({id:'tracks',type:'line',...common,
    filter:['all',['==',['geometry-type'],'LineString'],['in',['get','railway'],['literal',trackTypes]]],
    paint:{'line-color':['case',['!=',['get','status'],'mapped'],'#bf7831',['in',['get','railway'],['literal',['subway','tram','light_rail']]],'#a16bc2','#147c74'],'line-width':['interpolate',['linear'],['zoom'],8,1,14,3]}});
  map.addLayer({id:'stations',type:'circle',...common,filter:['all',['==',['geometry-type'],'Point'],['==',['get','railway'],'station']],paint:{'circle-radius':4,'circle-color':'#fff','circle-stroke-width':2,'circle-stroke-color':'#147c74'}});
  document.querySelector('#mode').dispatchEvent(new Event('change'));
}
map.on('load',async()=>{try{
  const response=await fetch('/railway.geojson');if(!response.ok)throw Error(response.status);
  data=await response.json();
  map.addSource('pilot',{type:'geojson',data});addLayers('pilot');search();
  map.once('idle',()=>{statusEl.textContent=`已加载 ${data.features.length} 个要素 · GeoJSON 到空闲 ${Math.round(performance.now()-started)} ms（本机单次）`;});
}catch(e){statusEl.textContent='加载失败：'+e.message;}});
document.querySelector('#search').addEventListener('input',search);
document.querySelector('#mode').onchange=()=>{
  const m=document.querySelector('#mode').value;
  const base=['all',['==',['geometry-type'],'LineString'],['in',['get','railway'],['literal',trackTypes]]];
  if(m==='rail')base.push(['in',['get','railway'],['literal',['rail','narrow_gauge','abandoned','disused','construction','razed','proposed']]]);
  if(m==='urban')base.push(['in',['get','railway'],['literal',['subway','tram','light_rail']]]);
  if(map.getLayer('tracks'))map.setFilter('tracks',base);
};
document.querySelector('#source').onchange=()=>{
  const vector=document.querySelector('#source').value==='vector', start=performance.now();
  if(vector&&!map.getSource('tiles'))map.addSource('tiles',{type:'vector',url:'pmtiles://'+location.origin+'/railway.pmtiles',promoteId:'osm_id'});
  addLayers(vector?'tiles':'pilot',vector);
  map.once('idle',()=>{statusEl.textContent=`${vector?'PMTiles':'GeoJSON'} 已显示 · 切换到空闲 ${Math.round(performance.now()-start)} ms（本机单次；含缓存）`;});
};
map.on('click',e=>{const f=map.queryRenderedFeatures(e.point,{layers:['stations','tracks']})[0];
  if(f){const original=data.features.find(v=>v.id===f.properties.osm_id);selectFeature(original||f);}});
