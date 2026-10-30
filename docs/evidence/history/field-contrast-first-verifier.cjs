/* Computed, opaque form boundaries and keyboard focus, not every UI pixel. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const target=require('./browser_target.cjs'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:8766',output=path.resolve(process.env.PREVIEW_EVIDENCE||'data/manifests/local/field-contrast'),observe=process.argv.includes('--observe');
const lum=c=>c.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
(async()=>{
  await fs.mkdir(output,{recursive:true});const browser=await target.launch(chromium),samples=[],failures=[],errors=[],external=[];
  try{
    for(const viewport of [{width:1440,height:1000},...observe?[]:[{width:390,height:844}]]){
      const page=await browser.newPage({viewport,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
      await page.addInitScript(()=>{localStorage.setItem('railway-atlas:basemap:v1','false');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('test clipboard disabled'))}});});
      await page.goto(base+'/?snapshot=shenyang-mvp-20261023');await page.waitForFunction(()=>performance.getEntriesByName('atlas:first-usable').length);
      async function field(selector,boundary=selector){
        assert.equal(await page.locator(selector).isEnabled(),true);await page.locator(selector).scrollIntoViewIfNeeded();
        for(const phase of ['default','hover','keyboard-focus']){
          if(phase==='default'){await page.locator(selector).evaluate(e=>e.blur());await page.mouse.move(0,0);}
          if(phase==='hover')await page.locator(selector).hover();
          if(phase==='keyboard-focus'){await page.locator(selector).focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert(await page.locator(selector).evaluate(e=>e===document.activeElement));}
          const value=await page.evaluate(({selector,boundary})=>{
            const el=document.querySelector(selector),owner=document.querySelector(boundary),style=getComputedStyle(owner),input=getComputedStyle(el);
            const parse=c=>{const m=c.match(/^rgba?\(([^)]+)\)$/);if(!m)throw Error('Unsupported computed colour: '+c);const v=m[1].split(',').map(Number);return [...v.slice(0,3).map(n=>n/255),v[3]??1];};
            const bg=element=>{const nodes=[];for(let n=element;n;n=n.parentElement)nodes.push(n);let c=[1,1,1];for(const n of nodes.reverse()){const s=getComputedStyle(n);if(s.backgroundImage!=='none'||Number(s.opacity)!==1)throw Error('Unmodelled background/opacity');const p=parse(s.backgroundColor);c=c.map((x,i)=>p[i]*p[3]+x*(1-p[3]));}return c;};
            const sides=['Top','Right','Bottom','Left'].map(side=>({color:parse(style['border'+side+'Color']),style:style['border'+side+'Style'],width:parseFloat(style['border'+side+'Width'])}));
            return {sides,inside:bg(owner),outside:bg(owner.parentElement),text:parse(input.color),text_background:bg(el),outline:parse(input.outlineColor),outline_width:parseFloat(input.outlineWidth),outline_style:input.outlineStyle,focus_visible:el.matches(':focus-visible')};
          },{selector,boundary});
          assert(value.sides.every(s=>s.color[3]===1&&s.width>=1&&s.style==='solid'),'all sampled border sides must be opaque visible solid lines');
          const border_min=Math.min(...value.sides.flatMap(s=>[ratio(s.color.slice(0,3),value.inside),ratio(s.color.slice(0,3),value.outside)]));
          assert.equal(value.text[3],1);const text_ratio=ratio(value.text.slice(0,3),value.text_background);
          const focus_ratio=phase==='keyboard-focus'?Math.min(ratio(value.outline.slice(0,3),value.inside),ratio(value.outline.slice(0,3),value.outside)):null;
          if(phase==='keyboard-focus')assert(value.focus_visible&&value.outline_width>=2&&value.outline_style==='solid'&&value.outline[3]===1,'actual keyboard focus outline required');
          const sample={viewport,selector,boundary,phase,border_min,text_ratio,focus_ratio,computed:value};samples.push(sample);
          if(border_min<3||text_ratio<4.5||focus_ratio!==null&&focus_ratio<3)failures.push({selector,viewport,phase,border_min,text_ratio,focus_ratio});
        }
      }
      await field('#search','.search-box');await page.locator('#dataset-picker summary').click();await page.locator('#dataset-version').waitFor();await field('#dataset-region');await field('#dataset-version');
      await page.locator('#share-open').click();await field('#share-link');await page.locator('#share-close').click();
      await page.locator('#list-open').click();await page.locator('.object-list button').first().waitFor();await field('#list-query');await field('#list-kind');
      await page.getByRole('button',{name:'复制当前视图与记录链接',exact:true}).click();await field('#list-share');
      await page.screenshot({path:path.join(output,'fields-'+viewport.width+'.png')});await page.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={date:new Date().toISOString(),browser_target:await target.describe(browser),mode:observe?'observation':'validation',status:failures.length?'fails-threshold':'passes-threshold',samples,failures,errors,external,scope:'Seven active authored form boundaries in default/hover/actual keyboard focus, desktop and 390px simulation. Opaque computed sRGB pairs only; not native popup/selection rendering, antialiasing, every control, all browsers, devices or complete WCAG.'};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({mode:report.mode,samples:samples.length,failures:failures.length,minimum_border:Math.min(...samples.map(s=>s.border_min))}));
    if(!observe)assert.equal(failures.length,0,'active form boundary/text/focus threshold failed');
  }catch(error){await target.failure(browser,error,{errors,external,failures});throw error;}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
