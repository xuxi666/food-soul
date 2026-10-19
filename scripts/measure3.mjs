import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:5180/',{waitUntil:'load'});
await p.waitForTimeout(2500);
const r = await p.evaluate(()=>{
  const pick=(sel)=>{const el=document.querySelector(sel); if(!el) return null; const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return {w:Math.round(r.width), x:Math.round(r.x), sw:el.scrollWidth, cw:el.clientWidth, cols:cs.gridTemplateColumns, pad:cs.padding};};
  return {wrap:pick('.wrap'), board:pick('.board'), intro:pick('.board__intro'), grid:pick('.board__grid'), card:pick('.dish-card'), desc:pick('.board__desc'), doc:document.documentElement.scrollWidth};
});
console.log(JSON.stringify(r,null,1));
await b.close();
