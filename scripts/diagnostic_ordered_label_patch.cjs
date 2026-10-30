/* Isolated browser response patch, never imported by the product.
 * Retain the identical prefix and replace the suffix so insertion order survives.
 * SDK public getData() and rendered symbol positions must be checked separately.
 */
const assert=require('node:assert/strict');
module.exports=function patchOrderedLabels(original){
 const needle='setData(e){return this._data=typeof e==`string`?{url:e}:{geojson:e},this._workerUpdates.replace({data:e}),this._workerUpdates.flush()}';
 assert.equal(original.split(needle).length-1,1,'pinned SDK setData implementation');
 const replacement=`setData(e){
  if(this.id==='rail-line-labels'&&e&&e.type==='FeatureCollection'){
   const old=this.__orderedLabelExpected;
   this.__orderedLabelExpected=e;
   if(old){
    let prefix=0;
    while(prefix<old.features.length&&prefix<e.features.length&&JSON.stringify(old.features[prefix])===JSON.stringify(e.features[prefix]))prefix++;
    const remove=old.features.slice(prefix).map(f=>f.properties.label_id),add=e.features.slice(prefix);
    (globalThis.__orderedLabelUpdates??=[]).push({before:old.features.length,after:e.features.length,prefix,removed:remove.length,added:add.length});
    return this.updateData({remove,add});
   }
  }
  return this._data=typeof e==='string'?{url:e}:{geojson:e},this._workerUpdates.replace({data:e}),this._workerUpdates.flush()
 }`;
 return original.replace(needle,replacement);
};
