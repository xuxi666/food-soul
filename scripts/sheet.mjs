import { chromium } from 'playwright-core';
import fs from 'fs';
const dir = 'public/dishes';
const files = fs.readdirSync(dir).filter(f=>f.endsWith('.jpg')).sort();
const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:6px;font:11px/1.2 monospace;color:#fff">
${files.map(f=>`<div><img src="/${dir}/${f}" style="width:100%;height:190px;object-fit:cover;display:block"><div style="padding:3px">${f}</div></div>`).join('')}
</body></html>`;
fs.writeFileSync('public/_sheet.html', html);
const b = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
const p = await b.newPage({ viewport:{width:1400,height:900} });
await p.goto('http://127.0.0.1:5180/_sheet.html');
await p.waitForTimeout(1200);
await p.screenshot({ path:'shots/sheet.png', fullPage:true });
await b.close();
