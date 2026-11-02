import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {detailShard} from './detail-shard.ts';
const expected=value=>createHash('sha256').update(value).digest('hex').slice(0,2);
test('detail routing matches independent SHA-256 for OSM IDs without any Web Crypto calls',()=>{
  for(const kind of ['node','way','relation'])for(let i=1;i<=1000;i++){
    const id=kind+'/'+(i*676578837);assert.equal(detailShard(id),expected(id));
  }
  for(const id of ['node/676578837','node/6179162407','relation/1'])assert.equal(detailShard(id),expected(id));
});
test('SHA-256 routing preserves UTF-8 and padding boundaries across blocks',()=>{
  for(const size of [0,1,55,56,63,64,65,119,120,127,128,1000])for(const text of ['x','铁路🚆']){
    const value=text.repeat(size);assert.equal(detailShard(value),expected(value));
  }
});
