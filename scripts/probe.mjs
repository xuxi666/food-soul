import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
for (const [w,h,mob] of [[1440,900,false],[390,844,true]]) {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, deviceScaleFactor: mob?2:1, isMobile: mob, hasTouch: mob });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:5180/', { waitUntil:'load' });
  await p.waitForFunction(()=>window.__exhibition?.gallery?.ready===true,null,{timeout:20000});
  await p.waitForTimeout(300);
  console.log(w+'x'+h, JSON.stringify(await p.evaluate(()=>({
    d: window.__exhibition.gallery.debug,
    inner: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    canvasRect: (()=>{const r=document.getElementById('scene').getBoundingClientRect(); return [r.width,r.height];})(),
    stageRect: (()=>{const r=document.getElementById('stage').getBoundingClientRect(); return [r.width,r.height];})(),
  }))));
  await ctx.close();
}
await b.close();
