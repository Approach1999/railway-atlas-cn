import test from 'node:test';
import assert from 'node:assert/strict';
import {createPropertyExpression,validateStyleMin,latest,featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {trackWidth} from './track-width.ts';
import {DEFAULTS,expandedState,overlayFilter,overlayVisible,trackFilter,trackVisible} from '../../shared/model.mjs';

test('track, casing and city-boundary widths are valid camera expressions with the intended interpolated thickness',()=>{
  for(const extra of [0,2.2,4.4]){
    const expression=trackWidth(extra);
    const errors=validateStyleMin({version:8,sources:{tracks:{type:'vector',tiles:['https://example.invalid/{z}/{x}/{y}.pbf']}},layers:[{id:'test',type:'line',source:'tracks','source-layer':'rail_tracks',paint:{'line-width':expression}}]});
    assert.deepEqual(errors,[]);
    const compiled=createPropertyExpression(expression,'paint.line-width',latest.paint_line['line-width']);
    assert.equal(compiled.result,'success',JSON.stringify(compiled.value));
    for(const line_class of ['high_speed','conventional_main','conventional_other','branch','industrial','unknown'])for(const zoom of [8,9.25,11.5,12,14,15.25,17.5,18]){
      const low=line_class==='high_speed'?1.8:line_class==='conventional_main'?1.4:1;
      const middle=({high_speed:4,conventional_main:3.2,branch:1.6,industrial:1.4})[line_class]??2.4;
      const expected=zoom<=14?low+(middle-low)*(zoom-8)/6:middle+(5-middle)*(zoom-14)/4;
      const actual=compiled.value.evaluate({zoom},{type:2,properties:{line_class}});
      assert(Math.abs(actual-expected-extra)<1e-12,JSON.stringify({extra,line_class,zoom,actual,expected}));
    }
  }
});

test('constant line selections and disabled sidings compile without deprecated mixed-filter warnings',()=>{
  const warnings=[],original=console.warn;console.warn=(...args)=>warnings.push(args.map(String).join(' '));
  try{
    for(const lineKeys of [null,[],['metro/1'],['metro/10']])for(const sidings of [false,true]){
      const state={...expandedState(DEFAULTS),preset:'custom',lineKeys,sidings,types:['rail','subway'],classes:['branch','high_speed']};
      const overlay=featureFilter(overlayFilter(state),'filter');
      const track=featureFilter(trackFilter(state,{minor:true,lifecycle:'mapped'}),'filter');
      for(const key of ['', 'metro/1','metro/10']){
        const p={feature_kind:'track',rail_mode:'rail',status:'mapped',line_class:'branch',line_tokens:key?'|'+key+'|':'',line_keys:key?[key]:[]};
        assert.equal(overlay.filter({zoom:14},{type:2,properties:p}),overlayVisible(p,state));
        // Exact line selection is applied by the controller around trackFilter.
        assert.equal(track.filter({zoom:14},{type:2,properties:p}),trackVisible(p,state,14));
      }
    }
  }finally{console.warn=original;}
  assert.deepEqual(warnings,[]);
});
