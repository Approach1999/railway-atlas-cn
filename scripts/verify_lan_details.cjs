/* Real non-loopback HTTP origin, no secure-context overrides. Phone viewport
 * emulation is regression evidence, not a substitute for the user's device. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),zlib=require('node:zlib');
const base=process.env.PREVIEW_URL,proxy=process.env.EXPECT_BASEMAP_PROXY==='1';
assert(base&&new URL(base).protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'actual LAN HTTP origin required');
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/lan-details');
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const kind=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([kind,data])));return Buffer.concat([length,kind,data,checksum]);}
const header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.alloc(256*769))),chunk('IEND',Buffer.alloc(0))]);
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),errors=[],requests=[];
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
  await page.route('**/preview-basemap/*/*/*.png',route=>route.fulfill({status:200,contentType:'image/png',body:png}));
  await page.addInitScript(active=>localStorage.setItem('railway-atlas:basemap:v1',String(active)),proxy);
  await page.goto(base);await page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
  const context=await page.evaluate(()=>({secure:isSecureContext,subtle:typeof globalThis.crypto?.subtle}));assert.equal(context.secure,false);assert.equal(context.subtle,'undefined');
  if(proxy)await page.locator('#basemap-status').filter({hasText:'底图已显示'}).waitFor();
  await page.locator('#search').fill('沈阳北站');await page.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();
  await page.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();
  await page.locator('#detail-close').click();await page.locator('#list-open').click();
  await page.locator('.object-list button').filter({hasText:'node/676578837'}).click();
  await page.locator('.list-record h3').filter({hasText:'沈阳北'}).waitFor();
  const shard=createHash('sha256').update('node/676578837').digest('hex').slice(0,2);
  assert(requests.filter(url=>new URL(url).pathname.endsWith('/details/'+shard+'.json')).length>=2,'both map and list must request the independent expected shard');
  assert(!await page.locator('.list-record [role=alert]').count());assert.deepEqual(errors,[]);
  if(proxy){assert(requests.some(url=>new URL(url).pathname.startsWith('/preview-basemap/')));assert(!requests.some(url=>new URL(url).hostname==='tile.openstreetmap.org'));}
  await page.screenshot({path:path.join(output,'list-detail.png')});
  const report={date:new Date().toISOString(),browser:browser.version(),context,proxy,expected_shard:shard,checks:['LAN HTTP is genuinely insecure and SubtleCrypto is absent','railway search result opens full detail','text explorer opens the same record and shard',...(proxy?['basemap loads from same-origin raster fixtures, no direct upstream browser requests']:[])],errors,scope:'Non-loopback HTTP + 390px emulation; all raster requests are intercepted fixtures. Not a real phone or provider uptime test.'};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
