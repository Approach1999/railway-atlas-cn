const assert=require('node:assert/strict');

// Runtime installation evidence, rather than authored colors or valid source alone.
module.exports=function requireCompleteStyle(style,nameLabels,mapFont){
  assert.equal(style?.expected?.filter(id=>id.startsWith('casing-')).length,16,'all 16 casing layers must be expected');
  assert(style.expected.includes('urban-boundary'),'urban boundary must be expected');
    for(const id of ['line-names','line-captions','minor-line-names','minor-line-captions'])assert(style.expected.includes(id),'current name layer must be expected: '+id);
  assert.deepEqual(style.missing,[],'missing actual style layers invalidate performance results');
  if(arguments.length>=3)assert.equal(mapFont,'ready','failed or pending map font invalidates performance results');
    if(nameLabels?.enabled){assert.equal(nameLabels.status,'ready','failed or pending names invalidate performance results');assert.equal(nameLabels.source_loaded,true,'name source must be loaded');}
  return style;
};
