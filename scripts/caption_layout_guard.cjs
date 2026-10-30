const assert=require('node:assert/strict');
module.exports=function captionLayoutGuard(anchors){
  const captions=anchors.filter(a=>a.kind==='short'&&(a.text.match(/[\u3400-\u9fff]/g)||[]).length>=3);
  for(const caption of captions){
    const box=caption.collision_box;
    assert(box&&Number.isFinite(box.width)&&Number.isFinite(box.height)&&box.height>0,'native caption collision box required');
    assert(box.width>box.height,'caption collapsed into a vertical column: '+caption.text);
  }
  return {captions_checked:captions.length};
};
