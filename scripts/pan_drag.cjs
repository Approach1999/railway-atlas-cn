const assert=require('node:assert/strict');

// Test-only DOM input driver, not an app API or physical device simulation.
// The screen path follows elapsed time rather than keyboard easing progress.
module.exports=async function runDragPath(page,{durationMs=30000,points=[[0,0],[-240,0],[-240,-180],[0,-180],[0,0],[240,0],[0,0]]}={}){
  assert(Number.isFinite(durationMs)&&durationMs>0);assert(points.length>=2);
  assert(points.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)));
  assert.deepEqual(points[0],[0,0]);
  const box=await page.locator('.maplibregl-canvas').boundingBox();assert(box);
  const origin={x:box.x+box.width*.6,y:box.y+box.height*.5};
  assert(points.every(([x,y])=>origin.x+x>box.x&&origin.x+x<box.x+box.width&&origin.y+y>box.y&&origin.y+y<box.y+box.height));
  await page.mouse.move(origin.x,origin.y);await page.mouse.down();
  const path=await page.evaluate(({origin,points,durationMs})=>new Promise(resolve=>{
    const start=performance.now(),path=[],segments=points.length-1,legDuration=durationMs/segments;
    const move=now=>{
      const elapsed=Math.max(0,Math.min(durationMs,now-start)),leg=Math.min(segments-1,Math.floor(elapsed/legDuration)),fraction=(elapsed-leg*legDuration)/legDuration;
      const x=origin.x+points[leg][0]+(points[leg+1][0]-points[leg][0])*fraction;
      const y=origin.y+points[leg][1]+(points[leg+1][1]-points[leg][1])*fraction;
      document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,view:window,clientX:x,clientY:y,button:0,buttons:1}));
      path.push({elapsed_ms:elapsed,x,y});
      if(elapsed<durationMs)requestAnimationFrame(move);else resolve(path);
    };requestAnimationFrame(move);
  }),{origin,points,durationMs});
  // Keep the native mouse held so the caller can end measurement before release.
  return {origin,path};
};
