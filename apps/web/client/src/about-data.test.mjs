import test from 'node:test';
import assert from 'node:assert/strict';
import {safeSourceLink,datasetSourceTime,coverageDescription} from './about-data.ts';
import {validatePalette} from './dataset-validation.ts';
import {neutralPalette} from './resources.ts';
test('about source links never execute script/data schemes and source time is not a build date',()=>{
  assert.equal(safeSourceLink('javascript:alert(1)'),undefined);assert.equal(safeSourceLink('data:text/html,hello'),undefined);assert.equal(safeSourceLink('not a URL'),undefined);assert.equal(safeSourceLink('https://example.org/source'),'https://example.org/source');
  assert.equal(datasetSourceTime({build_time:'2026-10-24',source:{source_time:'2026-10-20'}}),'2026-10-20');assert.equal(datasetSourceTime({build_time:'2026-10-24'}),'未标注');assert.match(coverageDescription({schema_version:1,line_count:0}),/不能据此判断没有地铁/);assert.match(coverageDescription({schema_version:2,line_count:12}),/12 条/);
});
test('palette verification evidence rejects non-text metadata instead of publishing coerced dates',()=>{
  for(const [field,bad] of [['verified_at',20261022],['source_url',{}],['operator_url',[]]]){const palette=neutralPalette();palette.operators.operator={lines:{},[field]:bad};assert.throws(()=>validatePalette(palette));}
  const palette=neutralPalette();palette.operators.operator={lines:{'1':{color:'#123456',verified_at:false}}};assert.throws(()=>validatePalette(palette));
});
