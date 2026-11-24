// Renders public/og.jpg (1200x630): the Dunes look frame, shifted so the window bleeds off the bottom right, with the dolly wordmark and tagline on the sky.
//   node scripts/og.mjs [frame.jpg]     (default public/hero/looks/dunes.jpg; needs Playwright, found in ../autopilot/node_modules)
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {chromium} = createRequire(path.join(root, '../autopilot/package.json'))('playwright');
const frame = path.resolve(process.argv[2] ?? path.join(root, 'public/hero/looks/dunes.jpg'));
const b64 = fs.readFileSync(frame).toString('base64');
// the window inside the 1920x1080 Dunes frame (padding 6 % of the short side, 16:9 recording), cropped 3 px inside its edge
const WX = 249, WY = 79, WW0 = 1422, K = 0.6, WW = Math.round(WW0 * K), WH = 700;
const html = `<!doctype html><meta charset=utf-8><link rel=stylesheet href="https://fonts.googleapis.com/css2?family=Figtree:wght@600&display=block"><style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;position:relative;background:#f0c4a4;font-family:Figtree,-apple-system,system-ui,sans-serif;color:#2b1a14}
/* Dunes sky, same stops as the studio's dunes background */
.back{position:absolute;inset:0;background:radial-gradient(circle at 78% 30%,#fff3df 0,rgba(255,243,223,0) 46%),linear-gradient(180deg,#fbe7cf 0%,#f6c9a4 45%,#eaa07e 78%,#d9805f 100%)}
.dune{position:absolute;left:-100px;right:-100px;bottom:-90px;height:240px;background:linear-gradient(180deg,#d9805f,#9d4d49);border-radius:50% 50% 0 0/100% 100% 0 0;opacity:.9}
.win{position:absolute;left:586px;top:226px;width:${WW}px;height:${WH}px;overflow:hidden;border-radius:16px 16px 0 0;box-shadow:0 40px 90px rgba(80,30,20,.45),0 0 0 1px rgba(255,255,255,.18)}
.win img{position:absolute;left:${-WX * K}px;top:${-WY * K}px;width:${1920 * K}px}
.t{position:absolute;left:72px;top:76px;width:600px}
.wm{font-size:128px;font-weight:600;letter-spacing:-.05em;line-height:1;color:#2b1a14}
.tag{margin-top:22px;font-size:42px;font-weight:600;letter-spacing:-.025em;line-height:1.1;color:#4a2c22;width:440px}
.sub{position:absolute;left:72px;bottom:54px;font-size:22px;font-weight:600;color:#7a3f30;display:flex;gap:12px;align-items:center}
.sub i{width:5px;height:5px;border-radius:50%;background:#b85f48}
</style>
<div class=back></div><div class=dune></div>
<div class=win><img src="data:image/jpeg;base64,${b64}"></div>
<div class=t><div class=wm>dolly</div><div class=tag>Screen recordings that edit themselves.</div></div>
<div class=sub>Free <i></i> Open source <i></i> Made for Claude Code</div>`;
const br = await chromium.launch(); const p = await br.newPage({viewport: {width: 1200, height: 630}, deviceScaleFactor: 1});
await p.setContent(html, {waitUntil: 'networkidle'}); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
await p.screenshot({path: path.join(root, 'public/og.jpg'), type: 'jpeg', quality: 92});
await br.close();
console.log('wrote public/og.jpg');
