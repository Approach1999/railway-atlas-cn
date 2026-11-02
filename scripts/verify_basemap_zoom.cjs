/* Fault-injected zoom regression. Every raster request uses a local fixture. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib');
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const kind=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([kind,data])));return Buffer.concat([length,kind,data,checksum]);}
const header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.alloc(256*769))),chunk('IEND',Buffer.alloc(0))]);

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 let fail=false,failed=0,ok=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
 await page.route('**/preview-basemap/*/*/*.png',r=>{if(fail){failed++;return r.fulfill({status:502,body:'Injected upstream outage'});}ok++;return r.fulfill({contentType:'image/png',body:png});});
 await page.addInitScript(()=>localStorage.setItem('railway-atlas:basemap:v1','true'));
 await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8766/');
 await page.locator('#basemap-status').filter({hasText:'底图已显示'}).waitFor();
 for(const direction of ['缩小地图','放大地图']){
  // Reset MapLibre's in-memory tile cache between directions: zooming back to
  // a previously visited level may correctly make no network request at all.
  fail=false;await page.goto(new URL('/',page.url()).href);
  await page.locator('#basemap-status').filter({hasText:'底图已显示'}).waitFor();
  await page.waitForLoadState('networkidle');
  fail=true;const before=failed;
  await page.getByRole('button',{name:direction,exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#basemap-status')?.textContent.includes('部分底图未加载'));
  assert(failed>before,'zoom must hit injected failures');
  fail=false;const beforeOK=ok;
  await page.getByRole('button',{name:direction,exact:true}).click();
  await page.locator('#basemap-status').filter({hasText:'底图已显示'}).waitFor();
  assert(ok>beforeOK,'new zoom must still request tiles without pressing retry');
 }
 assert.deepEqual(errors,[]);
 const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/basemap-zoom');await fs.mkdir(output,{recursive:true});
 const report={browser:browser.version(),ok,failed,errors,checks:['zoom out: upstream failure then automatic recovery on next zoom','zoom in: upstream failure then automatic recovery on next zoom'],scope:'390px touch emulation; intercepted raster fixtures only, not provider uptime or physical phone acceptance'};
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
