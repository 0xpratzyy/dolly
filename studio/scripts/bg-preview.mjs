#!/usr/bin/env node
// Contact sheet / single still of Dolly backgrounds, drawn in Playwright chromium with the same GLSL and CSS the product uses.
//   node scripts/bg-preview.mjs [--group animated|photo|wallpaper|gradient|all] [--only id,id] [--size 1620x1080] [--time 3]
//                               [--cell 480] [--cols 4] [--ui none|dark|light|both] [--out sheet.jpg] [--single id]
// --single id writes one full-size still (size = --size). Prints the output path and per-shader render ms.
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.resolve(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const group = arg('group', 'animated');
const only = arg('only', '')?.split(',').filter(Boolean);
const [W, H] = arg('size', '1620x1080').split('x').map(Number);
const time = parseFloat(arg('time', '3'));
const cell = parseInt(arg('cell', '480'), 10);
const cols = parseInt(arg('cols', '4'), 10);
const ui = arg('ui', 'none');
const single = arg('single', '');
const out = path.resolve(arg('out', path.join(os.tmpdir(), single ? `bg-${single}.jpg` : 'bg-sheet.jpg')));

const require = createRequire(path.join(os.homedir(), 'code/dolly/autopilot/package.json'));
const {chromium} = require('playwright');
const esbuild = require(path.join(studio, 'node_modules/esbuild'));

const entry = `
import {backgroundCatalog, backgroundStyle, backgroundIsDark, photoUrl} from './src/remotion/backgrounds.ts';
import {shaderById, ShaderRenderer} from './src/remotion/shaders.ts';
window.__bg = {backgroundCatalog, backgroundStyle, backgroundIsDark, photoUrl, shaderById, ShaderRenderer};
`;
const built = await esbuild.build({stdin: {contents: entry, resolveDir: studio, loader: 'ts'}, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022'});
const js = built.outputFiles[0].text;

const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--allow-file-access-from-files']});
const page = await browser.newPage({viewport: {width: single ? W : cols * (cell + 12) + 12, height: 800}, deviceScaleFactor: 1});
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const assetsDir = path.join(studio, 'assets/backgrounds');
await page.route('http://bg.local/**', (r) => r.fulfill({path: path.join(assetsDir, new URL(r.request().url()).pathname.slice(1))}));
await page.setContent('<html><body style="margin:0;background:#111"></body></html>');
await page.addScriptTag({content: js});

const result = await page.evaluate(async ({group, only, W, H, time, cell, cols, ui, single, assets}) => {
  const B = window.__bg;
  let list = B.backgroundCatalog.filter((b) => (group === 'all' ? true : b.category === group));
  if (only.length) list = B.backgroundCatalog.filter((b) => only.includes(b.id));
  if (single) list = B.backgroundCatalog.filter((b) => b.id === single);
  const body = document.body;
  body.style.cssText = 'margin:0;background:#111;display:flex;flex-wrap:wrap;align-content:flex-start;gap:12px;padding:' + (single ? '0' : '12px') + ';font:600 14px -apple-system,sans-serif;color:#fff';
  const timings = {};
  for (const b of list) {
    const w = single ? W : cell, h = single ? H : Math.round(cell * H / W);
    const box = document.createElement('div');
    box.style.cssText = `position:relative;width:${w}px;height:${h}px;overflow:hidden;flex:none;border-radius:${single ? 0 : 10}px`;
    const bg = {type: 'preset', value: b.id};
    if (B.shaderById[b.id]) {
      const def = B.shaderById[b.id];
      const c = document.createElement('canvas');
      const sc = single ? def.res : Math.max(def.res, 1);
      c.width = Math.round(w * sc * (single ? 1 : 2)); c.height = Math.round(h * sc * (single ? 1 : 2));
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      box.appendChild(c);
      const r = new B.ShaderRenderer(c, def);
      r.draw(time);
      const t0 = performance.now();
      for (let i = 0; i < 3; i++) { r.draw(time + i); (c.getContext('webgl') || c.getContext('experimental-webgl')).finish(); }
      timings[b.id] = Math.round((performance.now() - t0) / 3);
      r.draw(time);
    } else {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;inset:0';
      Object.assign(d.style, B.backgroundStyle(bg));
      if (b.category === 'photo') d.style.backgroundImage = `url(${assets}/${b.id.replace(/^photo-/, '')}.jpg)`;
      box.appendChild(d);
    }
    const mk = (kind) => {
      const u = document.createElement('div');
      const dk = kind === 'dark';
      u.style.cssText = `position:absolute;left:50%;top:50%;width:62%;height:56%;transform:translate(-50%,-50%);border-radius:${single ? 22 : 10}px;background:${dk ? '#17181a' : '#fafafa'};box-shadow:0 30px 80px rgba(0,0,0,.45),0 0 0 1px ${dk ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.06)'};color:${dk ? '#ddd' : '#222'};padding:${single ? 28 : 10}px;box-sizing:border-box;font-size:${single ? 22 : 11}px`;
      u.innerHTML = `<div style="opacity:.6">${kind} UI card</div><div style="margin-top:8px;height:8px;width:60%;background:currentColor;opacity:.18;border-radius:4px"></div><div style="margin-top:8px;height:8px;width:40%;background:currentColor;opacity:.12;border-radius:4px"></div>`;
      return u;
    };
    if (ui === 'dark' || ui === 'light') box.appendChild(mk(ui));
    if (ui === 'both') { const a = mk('dark'); a.style.left = '30%'; a.style.width = '38%'; const l = mk('light'); l.style.left = '70%'; l.style.width = '38%'; box.append(a, l); }
    if (!single) {
      const lab = document.createElement('div');
      lab.textContent = `${b.id}${b.dark ? '' : ' (light)'}`;
      lab.style.cssText = 'position:absolute;left:8px;top:6px;padding:2px 8px;border-radius:99px;background:rgba(0,0,0,.55);font-size:12px';
      box.appendChild(lab);
    }
    body.appendChild(box);
  }
  await new Promise((r) => setTimeout(r, 400));
  return {n: list.length, timings, h: document.body.scrollHeight};
}, {group, only, W, H, time, cell, cols, ui, single, assets: 'http://bg.local'});

await page.setViewportSize({width: single ? W : cols * (cell + 12) + 12, height: single ? H : Math.max(100, result.h)});
await page.waitForTimeout(300);
await page.screenshot({path: out, type: 'jpeg', quality: single ? 92 : 85, fullPage: !single});
console.log(JSON.stringify({out, shaders_ms_per_frame: result.timings, count: result.n}));
await browser.close();
