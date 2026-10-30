import test from 'node:test';
import assert from 'node:assert/strict';
import {contrastRatio,contrastingCasing,badgeTextColor} from './contrast.ts';
import {STATUS_STYLES} from '../../shared/model.mjs';
test('luminance uses unrounded WCAG ratios, rejects invalid colours and handles primary extremes',()=>{
  assert.equal(contrastRatio('#000000','#ffffff'),21);assert.equal(contrastRatio('#abcdef','#abcdef'),1);assert.equal(contrastRatio('#ffffff','#000000'),21);assert.throws(()=>contrastRatio('#fff','#000000'));assert.throws(()=>badgeTextColor('red'));
});
test('casing and route badge labels retain sufficient contrast across a sampled RGB cube',()=>{
  for(let r=0;r<=255;r+=17)for(let g=0;g<=255;g+=17)for(let b=0;b<=255;b+=17){const color='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');assert(contrastRatio(color,contrastingCasing(color))>=3,color);assert(contrastRatio(color,badgeTextColor(color))>=4.5,color);}
});
test('lifecycle visibility is opaque while distinct dash/warning cues survive',()=>{
  for(const [state,style] of Object.entries(STATUS_STYLES)){assert.equal(style.opacity,1,state);if(state!=='mapped')assert(style.dash.length>0,state);}
  assert.notDeepEqual(STATUS_STYLES.construction.dash,STATUS_STYLES.proposed.dash);assert.equal(STATUS_STYLES.unknown.warning,'?');assert.equal(STATUS_STYLES.conflict.warning,'!');
});
