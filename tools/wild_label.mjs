#!/usr/bin/env node
/* Надпись WILD для ленты на символе W: прозрачный PNG шрифтом игры (Dela Gothic One из index.html).
 * node tools/wild_label.mjs [out.png] [текст]  — по умолчанию tools/wild_label.png, "WILD" */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const req = n => { try { return require(n); } catch { return require('/opt/npm-tools/node_modules/' + n); } };
const { chromium } = req('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(ROOT, 'tools/wild_label.png'), text = process.argv[3] || 'WILD';
const m = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/font-family:"Dela Gothic One"[^}]*?base64,([A-Za-z0-9+/=]+)/);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 220 }, deviceScaleFactor: 1 });
await page.setContent(`<style>@font-face{font-family:Dela;src:url(data:font/woff2;base64,${m[1]}) format('woff2')}
body{margin:0;background:transparent}#t{position:absolute;left:0;top:0;width:800px;height:220px;display:flex;align-items:center;justify-content:center;
font:150px/1 Dela,sans-serif;letter-spacing:.04em;color:#fff6e6;-webkit-text-stroke:10px #4a1410;paint-order:stroke fill;
text-shadow:0 8px 0 rgba(40,10,10,.55)}</style><div id="t">${text}</div>`);
await page.evaluate(() => document.fonts.ready);
await page.locator('#t').screenshot({ path: out, omitBackground: true });
await browser.close();
console.log(out);
