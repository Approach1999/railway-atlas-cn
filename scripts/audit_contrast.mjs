import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createExpression} from '../apps/web/client/node_modules/@maplibre/maplibre-gl-style-spec/dist/index.mjs';
import {paletteColorExpression,resolveLinePaint} from '../apps/web/client/src/palette-colours.ts';
import {contrastRatio,badgeTextColor} from '../apps/web/client/src/contrast.ts';
import {STATUS_STYLES} from '../apps/web/shared/model.mjs';
const base=process.env.MVP_DATA_DIR||'data/processed/shenyang-mvp-20261023';
const read=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const palette=read(base+'/palette.json'),lines=read(base+'/lines.json');
const compile=value=>{const result=createExpression(value,'paint.line-color');assert.equal(result.result,'success',JSON.stringify(result.value));return result.value;};
const color=compile(paletteColorExpression(palette,lines)),halo=compile(paletteColorExpression(palette,lines,true));
let tracks=0,minimum=Infinity,worst,unchangedMetro=new Set();
const sourceRaw=read(base+'/raw.geojson'),byId=new Map(sourceRaw.features.map(f=>[f.properties.osm_id,f]));
for(const file of fs.readdirSync(base+'/details').filter(name=>name.endsWith('.json'))){
  for(const feature of Object.values(read(base+'/details/'+file))){
    const p=feature.properties;if(p.feature_kind!=='track')continue;tracks++;
    const center=STATUS_STYLES[p.status].color||color.evaluate({zoom:14},{properties:p}),casing=STATUS_STYLES[p.status].color?undefined:halo.evaluate({zoom:14},{properties:p});
    const actualCasing=casing||(['#ffffff','#1b2a32'].sort((a,b)=>contrastRatio(center,b)-contrastRatio(center,a))[0]);
    const ratio=contrastRatio(center,actualCasing);assert(ratio>=3,p.osm_id+' '+ratio);assert.equal(STATUS_STYLES[p.status].opacity,1);
    if(ratio<minimum){minimum=ratio;worst={id:p.osm_id,center,casing:actualCasing,ratio};}
    if(p.rail_mode==='subway'&&p.status==='mapped'&&p.line_complete&&!p.line_shared&&p.line_key){const line=lines.lines.find(line=>line.line_key===p.line_key);assert.equal(center,palette.operators['shenyang-metro'].lines[line.ref].color);unchangedMetro.add(line.ref);}
    assert(byId.has(p.osm_id),'only source-published identities are inspected');
  }
}
const badges=lines.lines.map(line=>{const background=resolveLinePaint(palette,line).color,foreground=badgeTextColor(background),ratio=contrastRatio(background,foreground);assert(ratio>=4.5,line.line_key);return {line:line.line_key,background,foreground,ratio};});
assert.equal(unchangedMetro.size,6);
const files=['apps/web/client/src/contrast.ts','apps/web/client/src/palette-colours.ts','apps/web/client/src/map-controller.ts','apps/web/shared/model.mjs'];
const report={date:new Date().toISOString(),snapshot:base.split('/').at(-1),tracks,minimum_center_to_opaque_casing:minimum,worst,badges,verified_metro_colors:[...unchangedMetro].sort(),source_sha256:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),scope:'Actual published track properties evaluated by MapLibre style-spec using renderer colour expressions. Authored RGB contrast, not antialiasing, all basemap pixels, physical devices or full WCAG acceptance.'};
fs.writeFileSync('docs/evidence/mvp-contrast-authored.json',JSON.stringify(report,null,2));console.log(JSON.stringify({tracks,minimum,worst,badges:badges.length,metroColors:unchangedMetro.size}));
