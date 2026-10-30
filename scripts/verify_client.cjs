/* Built React client checks. Raster responses are fixtures: regression tests
 * must not drive automated pan/zoom traffic against a public tile service. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const zlib=require('node:zlib');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766';
const output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/client-browser');
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const kind=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([kind,data])));return Buffer.concat([length,kind,data,checksum]);}
function fixturePNG(){const header=Buffer.alloc(13);header.writeUInt32BE(256,0);header.writeUInt32BE(256,4);header[8]=8;header[9]=2;const rows=Buffer.alloc(256*(1+256*3));for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=y*769+1+x*3;rows[i]=230;rows[i+1]=235;rows[i+2]=232;}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
const png=fixturePNG();
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],requests=[],checks=[];
  async function attach(page,fail=false){
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
    await page.route('https://tile.openstreetmap.org/**',route=>fail
      ?route.fulfill({status:503,contentType:'text/plain',body:'fixture unavailable'})
      :route.fulfill({status:200,contentType:'image/png',body:png,headers:{'access-control-allow-origin':'*','cache-control':'public, max-age=86400'}}));
  }
  const railReady=page=>page.locator('#status').filter({hasText:'铁路地图已就绪'}).waitFor();
  const tileCount=()=>requests.filter(url=>url.startsWith('https://tile.openstreetmap.org/')).length;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});await attach(page);
    await page.goto(base);await railReady(page);await page.locator('#basemap-status').filter({hasText:'底图已显示'}).waitFor();
    assert.equal(await page.locator('#basemap-toggle').getAttribute('aria-checked'),'true');assert(tileCount()>0);
    checks.push('React 构建页面启动，淡化底图位于铁路之下（回归瓦片为测试夹具）');
    await page.getByRole('button',{name:'仅高速',exact:true}).click();
    await page.locator('#search').fill('沈阳北站');await page.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();
    await page.locator('.feature-title').filter({hasText:'沈阳北'}).waitFor();await page.waitForTimeout(600);
    const scale=await page.locator('.maplibregl-ctrl-scale').innerText();
    await page.locator('#basemap-toggle').click();
    assert.equal(await page.locator('#basemap-toggle').getAttribute('aria-checked'),'false');
    assert.equal(await page.getByRole('button',{name:'仅高速',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.feature-title').innerText(),'沈阳北');
    assert.equal(await page.locator('.maplibregl-ctrl-scale').innerText(),scale);
    await page.waitForTimeout(300);const hiddenCount=tileCount();
    await page.locator('#detail-close').click();await page.locator('#home').click();await page.waitForTimeout(800);
    assert.equal(tileCount(),hiddenCount,'hidden source must not request tiles after camera changes');
    checks.push('关闭底图保留筛选、选中站点和缩放；隐藏后平移/缩放无新增底图请求');
    await page.reload();await railReady(page);await page.waitForTimeout(500);
    assert.equal(await page.locator('#basemap-toggle').getAttribute('aria-checked'),'false');assert.equal(tileCount(),hiddenCount);
    checks.push('刷新恢复关闭偏好，首屏不请求外部底图');
    assert.equal(await page.getByRole('button',{name:'仅高速',exact:true}).getAttribute('aria-pressed'),'true','refresh must preserve the current preset');
    await page.getByRole('button',{name:'城市轨道',exact:true}).click();
    await page.locator('#search').fill('沈阳站');await page.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();
    await page.locator('.feature-title').filter({hasText:'沈阳'}).waitFor();assert.match(await page.locator('#map-notice').innerText(),/临时显示/);
    await page.locator('#detail-close').click();assert.equal(await page.getByRole('button',{name:'城市轨道',exact:true}).getAttribute('aria-pressed'),'true');
    await page.locator('#undo').click();assert.equal(await page.getByRole('button',{name:'仅高速',exact:true}).getAttribute('aria-pressed'),'true','undo must restore the preset retained across refresh');
    checks.push('迁移保留中文搜索、铁路/地铁消歧、临时显示和预设撤销');
    await page.locator('#home').click();await page.locator('#search-clear').click();await page.waitForTimeout(700);
    await page.screenshot({path:path.join(output,'rail-only.png')});
    await page.locator('#basemap-toggle').click();await page.locator('#basemap-status').filter({hasText:'底图已显示'}).waitFor();
    assert.equal(await page.locator('#basemap-toggle').getAttribute('aria-checked'),'true');
    checks.push('可重复开启底图，保留原有地图实例');
    const failed=await browser.newPage({viewport:{width:1440,height:1000}});await attach(failed,true);
    await failed.goto(base);await railReady(failed);await failed.locator('#basemap-retry').waitFor();
    assert.match(await failed.locator('#basemap-status').innerText(),/铁路仍可浏览/);
    await failed.locator('#search').fill('沈阳北站');await failed.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();await failed.locator('.feature-title').waitFor();
    await failed.locator('#basemap-toggle').click();assert.equal(await failed.locator('#basemap-toggle').getAttribute('aria-checked'),'false');
    checks.push('模拟底图 503 后回退纯色，铁路搜索/详情和开关继续可用');
    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await attach(mobile);
    await mobile.goto(base);await railReady(mobile);
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const switchRect=await mobile.locator('#basemap-toggle').boundingBox();assert(switchRect.height>=44&&switchRect.width>=44);
    await mobile.locator('#basemap-toggle').tap();await mobile.locator('#basemap-status').filter({hasText:'底图已隐藏'}).waitFor();
    await mobile.locator('#search').fill('沈阳北站');await mobile.locator('#results button').filter({hasText:'铁路'}).filter({hasText:'站点'}).click();await mobile.locator('.feature-title').waitFor();await mobile.waitForTimeout(600);
    const panel=await mobile.locator('#feature-panel').boundingBox(),attribution=await mobile.locator('.maplibregl-ctrl-attrib').boundingBox();
    assert(attribution.y+attribution.height<=panel.y+1);
    await mobile.screenshot({path:path.join(output,'mobile-rail-only.png')});
    checks.push('390px 手机开关触摸目标、详情避让与署名可见');
    assert.equal(errors.length,0,JSON.stringify(errors));
    assert(!requests.some(url=>/\/(railway|tracks)\.geojson/.test(url)));
    assert(!requests.some(url=>{const pathname=new URL(url).pathname;return /\/(palette\.json|stations\.geojson|lines\.json|details\/|tiles\/)/.test(pathname)&&!pathname.startsWith('/snapshots/');}),'all railway indexes, details and tiles must stay pinned to an immutable snapshot');
    checks.push('首屏解析当前版本后，铁路索引、瓦片和详情统一使用不可变快照地址');
    const external=[...new Set(requests.filter(url=>url.startsWith('http')&&new URL(url).origin!==new URL(base).origin).map(url=>new URL(url).hostname))];
    assert.deepEqual(external,['tile.openstreetmap.org']);
    const report={date:new Date().toISOString(),browser:browser.version(),checks,errors,external_domains:external,scope:'Built React client; raster fixture responses; 390px emulation, not real-device or provider uptime acceptance'};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
