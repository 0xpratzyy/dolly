#!/usr/bin/env node
// Dolly Spotlight capture: isolate ONE component of a live page (or a standalone HTML snippet) with a real alpha channel, drive its
// interactions on a virtual clock, and write a perfect 60 fps PNG sequence + spotlight.json for the Spotlight composition.
//
//   node spotlight/capture.mjs --url https://refs.video --target "Archive" --actions actions.json --out out/archive
//   node spotlight/capture.mjs --html snippet.html --target "#card" --out out/card
//
// flags: --url | --html <file>   --target "<css selector | visible text | description>" (required)
//        --actions <json>   --viewport 1440x900   --scale 2|3|4 (default: automatic, 2-4 by the component's size)   --out <dir>   --lead 500 --tail 900 (ms of rest before / after)
//        --pad 130 (px around the component)   --max-area 0.4   --dark | --light (colour scheme)   --seed 1   --no-flatten
//        --exact (use the matched element itself, no climbing to a container)   --hide "sel,sel"   --fps 60 (default)
//        --context on|off (default on): also save the untouched page (context.jpg + spotlight.json `context`) for the intro beat
// actions.json: see spotlight/README.md (hover, click, type, press, select, drag, slide, swipe, scroll, wait, move, state).
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({chromium} = await import('playwright')); } catch {
  ({chromium} = await import(pathToFileURL(path.join(here, '../autopilot/node_modules/playwright/index.mjs')).href));
}

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  flags[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
}
const die = (m) => { console.error(m); process.exit(1); };
if ((!flags.url && !flags.html) || !flags.target || !flags.out) die('usage: node spotlight/capture.mjs --url <url> | --html <file> --target "<selector|text|description>" [--actions a.json] [--viewport 1440x900] [--scale 2] --out <dir>');

const FPS = Number(flags.fps ?? 60);
const DT = 1000 / FPS;
const [VW, VH] = (flags.viewport ?? '1440x900').split('x').map(Number);
const {resolveQuality, dirSize, mb} = await import(pathToFileURL(path.join(here, '../studio/scripts/lib/env.mjs')).href);
const QUALITY = resolveQuality(flags.quality);
const {phase, accumulator} = await import(pathToFileURL(path.join(here, '../studio/scripts/lib/profile.mjs')).href);
const prof = accumulator(); // per-frame sums for DOLLY_PROFILE (studio/scripts/lib/profile.mjs) // lite caps the capture scale at 2x (docs/performance.md)
let SCALE = Number(flags.scale ?? 2); // without --scale it is raised after the measuring pass so a small component stays crisp as a big hero
const PAD = Number(flags.pad ?? 130);
const LEAD = Number(flags.lead ?? 500), TAIL = Number(flags.tail ?? 900);
// --context on|off (default on; --no-context): save the page as it looked (context.jpg) for the renderer's context intro
const CONTEXT = !flags['no-context'] && flags.context !== 'off' && flags.context !== 'false';
const out = path.resolve(flags.out);
const actions = flags.actions ? JSON.parse(fs.readFileSync(flags.actions, 'utf8')) : [];
const url = flags.html ? pathToFileURL(path.resolve(flags.html)).href : flags.url;
const log = (...a) => console.error('[spotlight]', ...a);

// seeded RNG (cursor wobble, typing rhythm): same take every run
const seedInit = () => (Number(flags.seed ?? 1) * 2654435761) >>> 0;
let rs = seedInit();
const rnd = () => { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rr = (a, b) => a + rnd() * (b - a);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** VP9 alpha WebM encoder fed with PNG frames on stdin (same settings as the encode after the take used). Resolves true on success. */
function startWebm(file) {
  const proc = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '18', '-b:v', '0',
    '-row-mt', '1', '-cpu-used', '4', '-threads', String(Number(flags['encode-threads'] ?? QUALITY.q.encodeThreads)), '-g', String(FPS * 2), file], {stdio: ['pipe', 'inherit', 'inherit']});
  const exited = new Promise((res) => { proc.on('exit', (c) => res(c === 0)); proc.on('error', () => res(false)); });
  proc.stdin.on('error', () => {});
  return {
    async write(buf) { if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once('drain', r)); },
    async end() { proc.stdin.end(); return exited; },
  };
}

/** One full pass: run the whole script; capture=false only measures (finds the union of everything that is ever painted). */
async function pass(browser, capture, clip) {
  rs = seedInit();
  const ctx = await browser.newContext({
    viewport: {width: VW, height: VH}, deviceScaleFactor: SCALE, locale: 'en-US',
    colorScheme: flags.light ? 'light' : flags.dark ? 'dark' : undefined, reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', {color: {r: 0, g: 0, b: 0, a: 0}});
  await page.addInitScript({path: path.join(here, 'inject.js')});
  let inflight = 0, lastNet = Date.now();
  page.on('request', () => { inflight++; lastNet = Date.now(); });
  page.on('requestfinished', () => { inflight--; lastNet = Date.now(); });
  page.on('requestfailed', () => { inflight--; lastNet = Date.now(); });
  page.on('pageerror', () => {});
  page.on('console', () => {});
  await page.goto(url, {waitUntil: 'commit', timeout: 45000});
  await page.waitForLoadState('load', {timeout: 45000}).catch(() => {});
  const pump = async (ms) => { for (let t = 0; t < ms; t += DT) await page.evaluate((d) => window.__sp.step(d), DT); };
  // settle on virtual time while the network finishes (hydration timers, fonts, intro animations)
  const t0 = Date.now();
  let pumped = 0;
  while ((Date.now() - t0 < 12000) && (pumped < 1800 || inflight > 0 || Date.now() - lastNet < 500)) { await pump(DT * 6); pumped += DT * 6; await new Promise((r) => setTimeout(r, 6)); }
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await pump(300);
  if (flags.hide) await page.addStyleTag({content: `${flags.hide}{display:none!important}`});
  if (flags['no-flatten']) await page.evaluate(() => window.__sp.setFlatten(false));
  const isoOpts = {maxArea: Number(flags['max-area'] ?? 0.4), exact: !!flags.exact};
  // context intro: the real page as it looked (viewport, page background on), before anything is hidden. Pass 2 only.
  let context = null;
  if (capture && CONTEXT) {
    const dry = await page.evaluate(([t, o]) => window.__sp.isolate(t, {...o, dry: true}), [flags.target, isoOpts]);
    if (dry.ok) {
      await pump(DT * 2);
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {});
      const shot = await cdp.send('Page.captureScreenshot', {format: 'jpeg', quality: 90, fromSurface: true, captureBeyondViewport: false});
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {color: {r: 0, g: 0, b: 0, a: 0}});
      fs.writeFileSync(path.join(out, 'context.jpg'), Buffer.from(shot.data, 'base64'));
      context = {image: 'context.jpg', w: VW, h: VH, scale: SCALE, rect: [dry.rect.x, dry.rect.y, dry.rect.w, dry.rect.h].map((v) => +v.toFixed(1))};
    }
  }
  const info = await page.evaluate(([t, o]) => { window.__sp.snapshotKnown(); return window.__sp.isolate(t, o); }, [flags.target, isoOpts]);
  info.context = context;
  if (!info.ok) { await ctx.close(); die(info.why); }
  await pump(100);

  // ---- recording state
  const rec = {frames: 0, bbox: [], roots: [], cards: [], rr: [], fs: [], cursor: [], clicks: [], hovers: [], keys: [], states: [], sounds: [], notes: []};
  let cx = Math.min(VW - 10, info.rect.x + info.rect.w + 140), cy = Math.min(VH - 10, info.rect.y + info.rect.h + 110);
  if (flags['cursor-start']) { const [a, b] = flags['cursor-start'].split(',').map(Number); cx = a; cy = b; }
  let ck = 'arrow', prevSample = null, hitLabelPrev = '', hidden = false;
  let pressed = false;
  const writes = [];
  // frames go straight into the VP9 encoder while the take runs (the encode used to start after it: 11.6 s of 55 s);
  // --keep-frames writes the PNG sequence instead, as before
  const stream = capture && flags['keep-frames'] !== 'true' ? startWebm(path.join(out, 'frames.webm')) : null;
  if (capture && !stream) fs.mkdirSync(path.join(out, 'frames'), {recursive: true});
  await page.mouse.move(cx, cy);
  let mx = cx, my = cy;

  const tNow = () => rec.frames * DT;
  /** One output frame: apply the cursor, advance virtual time, sample, (capture). */
  const frame = async () => {
    let tp = performance.now();
    if (cx !== mx || cy !== my) { await page.mouse.move(cx, cy); mx = cx; my = cy; } // an unchanged pointer needs no event (each one waits ~7-14 ms for a frame)
    prof.add('mouse', performance.now() - tp); tp = performance.now();
    await page.evaluate((d) => window.__sp.step(d), DT);
    prof.add('step', performance.now() - tp); tp = performance.now();
    const s = await page.evaluate(([x, y]) => window.__sp.sample(x, y), [cx, cy]);
    prof.add('sample', performance.now() - tp);
    const t = tNow();
    // sound / state hints from state changes
    if (prevSample) {
      if (s.nKeep > prevSample.nKeep) rec.sounds.push({tMs: t, kind: 'open'});
      else if (s.nKeep < prevSample.nKeep) rec.sounds.push({tMs: t, kind: 'close'});
      if (s.checked !== prevSample.checked && prevSample.checked !== '' && s.nKeep === prevSample.nKeep) rec.sounds.push({tMs: t, kind: 'toggle'});
      if (s.ok && !prevSample.ok) rec.sounds.push({tMs: t, kind: 'success'});
      if (s.hit && s.hit !== prevSample.hit && s.ck === 'hand' && !pressed) { rec.sounds.push({tMs: t, kind: 'tick'}); rec.hovers.push({tMs: t, x: cx, y: cy, label: s.hitLabel}); }
    }
    prevSample = s;
    ck = s.ck;
    rec.cursor.push([Math.round(t * 10) / 10, +cx.toFixed(2), +cy.toFixed(2), s.ck, pressed ? 1 : 0]);
    rec.bbox.push(s.u ? [s.u.x, s.u.y, s.u.w, s.u.h].map((v) => +v.toFixed(2)) : null);
    rec.roots.push(s.roots.map((r) => r.map((v) => +v.toFixed(2))));
    rec.rr.push(s.rr ? s.rr.map((v) => +v.toFixed(1)) : null); rec.fs.push(s.hit ? s.fs : 0);
    rec.cards.push(s.cards.map((r) => r.map((v) => +v.toFixed(1))));
    if (capture) {
      // clip.scale must carry the device scale: with a clip, CDP returns CSS-pixel-sized images whatever the context's deviceScaleFactor
      // (every capture before this fix was 1x, labelled 2x, and was upscaled by the renderer: soft text)
      const n = String(rec.frames + 1).padStart(5, '0');
      const r = await prof.time('shot', cdp.send('Page.captureScreenshot', {format: 'png', clip: {x: clip.x + s.sx, y: clip.y + s.sy, width: clip.width, height: clip.height, scale: SCALE}, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true}));
      if (stream) await prof.time('encode', stream.write(Buffer.from(r.data, 'base64')));
      else {
        writes.push(fs.promises.writeFile(path.join(out, 'frames', `${n}.png`), Buffer.from(r.data, 'base64')));
        if (writes.length > 24) await Promise.all(writes.splice(0, 12));
      }
    }
    rec.frames++;
  };
  const rest = async (ms) => { for (let t = 0; t < ms - 1e-6; t += DT) await frame(); };

  // ---- human cursor: curved, min-jerk, small overshoot on long moves, softly landing
  const moveTo = async (x, y, ms) => {
    const x0 = cx, y0 = cy, dx = x - x0, dy = y - y0, dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    ms ??= Math.min(1500, Math.max(420, 380 + 250 * Math.log2(1 + dist / 80))) * rr(0.92, 1.1);
    const bow = Math.min(60, dist * 0.09) * (rnd() < 0.5 ? -1 : 1);
    const mx = (x0 + x) / 2 + (-dy / dist) * bow, my = (y0 + y) / 2 + (dx / dist) * bow;
    const over = dist > 360 ? rr(6, 14) : 0;
    const tx = x + (dx / dist) * over, ty = y + (dy / dist) * over;
    const seg = async (ax, ay, bx, by, qx, qy, dur) => {
      const n = Math.max(1, Math.round(dur / DT));
      for (let i = 1; i <= n; i++) {
        const t = i / n, e = ease(t) * 0.72 + t * 0.28 * (1 - (1 - t) * (1 - t));
        cx = (1 - e) * (1 - e) * ax + 2 * (1 - e) * e * qx + e * e * bx;
        cy = (1 - e) * (1 - e) * ay + 2 * (1 - e) * e * qy + e * e * by;
        await frame();
      }
    };
    if (over) { await seg(x0, y0, tx, ty, mx, my, ms * 0.86); await seg(tx, ty, x, y, (tx + x) / 2, (ty + y) / 2, ms * 0.3); }
    else await seg(x0, y0, x, y, mx, my, ms);
    cx = x; cy = y;
  };
  /** A straight, eased move (drags, slides, swipes keep a clean line). */
  const lineTo = async (x, y, ms, fn = ease) => {
    const x0 = cx, y0 = cy, n = Math.max(1, Math.round(ms / DT));
    for (let i = 1; i <= n; i++) { const e = fn(i / n); cx = x0 + (x - x0) * e; cy = y0 + (y - y0) * e; await frame(); }
  };
  const down = async () => { pressed = true; await page.mouse.down(); rec.clicks.push({tMs: tNow(), x: +cx.toFixed(2), y: +cy.toFixed(2), kind: 'down'}); rec.sounds.push({tMs: tNow(), kind: 'press'}); };
  const up = async () => { await page.mouse.up(); rec.clicks.push({tMs: tNow(), x: +cx.toFixed(2), y: +cy.toFixed(2), kind: 'up'}); pressed = false; rec.sounds.push({tMs: tNow(), kind: 'release'}); };
  const pt = async (spec, at) => {
    if (Array.isArray(spec)) return {x: spec[0], y: spec[1]};
    if (spec && typeof spec === 'object' && ('x' in spec)) return {x: spec.x, y: spec.y};
    const p = await page.evaluate(([s, a]) => window.__sp.point(s, a), [spec, at]);
    if (!p) throw new Error(`action target not found: ${JSON.stringify(spec)}`);
    return p;
  };
  const jitter = (v) => v + rr(-2, 2);

  const runAction = async (a) => {
    const kind = Object.keys(a).find((k) => ['hover', 'click', 'dblclick', 'type', 'press', 'select', 'drag', 'slide', 'swipe', 'scroll', 'wait', 'move', 'state', 'sound', 'toggle'].includes(k));
    if (!kind) throw new Error('unknown action ' + JSON.stringify(a));
    const v = a[kind];
    switch (kind) {
      case 'wait': await rest(Number(v)); break;
      case 'state': rec.states.push({tMs: tNow(), name: String(v)}); break;
      case 'sound': rec.sounds.push({tMs: tNow(), kind: String(v)}); break;
      case 'move': { const p = await pt(v, a.at); await moveTo(jitter(p.x), jitter(p.y), a.ms); break; }
      case 'hover': { const p = await pt(v, a.at); await moveTo(jitter(p.x), jitter(p.y), a.ms); await rest(a.dwell ?? a.ms2 ?? 450); break; }
      case 'click': case 'toggle': case 'dblclick': {
        const p = await pt(v, a.at);
        await moveTo(jitter(p.x), jitter(p.y), a.ms);
        await rest(rr(110, 190));
        await down(); await rest(rr(80, 120)); await up();
        if (kind === 'dblclick') { await rest(70); await down(); await rest(90); await up(); }
        if (a.sound) rec.sounds.push({tMs: tNow(), kind: a.sound});
        await rest(a.dwell ?? 380);
        break;
      }
      case 'type': {
        if (a.into) { const p = await pt(a.into, a.at); await moveTo(jitter(p.x), jitter(p.y), a.ms); await rest(rr(100, 160)); await down(); await rest(90); await up(); await rest(200); }
        const text = String(v);
        for (const ch of text) {
          await page.keyboard.type(ch);
          rec.keys.push({tMs: tNow()}); rec.sounds.push({tMs: tNow(), kind: 'key'});
          await rest(rr(48, 92) + (ch === ' ' ? 30 : 0));
        }
        await rest(a.dwell ?? 350);
        break;
      }
      case 'press': { await page.keyboard.press(String(v)); rec.keys.push({tMs: tNow()}); rec.sounds.push({tMs: tNow(), kind: 'key'}); await rest(a.dwell ?? 300); break; }
      case 'select': { // custom select / dropdown: open the trigger, then choose the option by its text
        const p = await pt(v, a.at); await moveTo(jitter(p.x), jitter(p.y), a.ms); await rest(140); await down(); await rest(90); await up(); await rest(a.openMs ?? 420);
        const o = await pt(a.option); await moveTo(jitter(o.x), jitter(o.y), a.ms2 ?? 520); await rest(160); await down(); await rest(90); await up(); await rest(a.dwell ?? 420);
        break;
      }
      case 'drag': {
        const from = await pt(v, a.at); const dur = a.dur ?? 700;
        await moveTo(jitter(from.x), jitter(from.y), a.ms); await rest(130); await down(); await rest(110);
        let to;
        if (a.to) to = await pt(a.to, a.toAt);
        else to = {x: from.x + (a.dx ?? 0), y: from.y + (a.dy ?? 0)};
        // a slight arc, so a drag does not look ruled
        const steps = Math.max(1, Math.round(dur / DT)), x0 = cx, y0 = cy, bow = a.straight ? 0 : Math.min(24, Math.hypot(to.x - x0, to.y - y0) * 0.06);
        const nx = -(to.y - y0), ny = to.x - x0, nl = Math.hypot(nx, ny) || 1;
        for (let i = 1; i <= steps; i++) { const e = ease(i / steps), b = Math.sin(e * Math.PI) * bow; cx = x0 + (to.x - x0) * e + (nx / nl) * b; cy = y0 + (to.y - y0) * e + (ny / nl) * b; await frame(); }
        await rest(110); await up(); await rest(a.dwell ?? 400);
        break;
      }
      case 'slide': { // a slider / range / toggle track: grab the thumb and move it by a fraction of the track, or by dx
        const p = await pt(v, a.at ?? [0.5, 0.5]);
        const w = p.w ?? 200;
        let tx;
        if (typeof a.to === 'number' && p.min != null && p.max != null && p.tag === 'input' && p.type === 'range') {
          const frac = (a.to - Number(p.min)) / (Number(p.max) - Number(p.min));
          const cur = (Number(p.value) - Number(p.min)) / (Number(p.max) - Number(p.min));
          const left = p.x - w * 0.5; tx = left + w * frac; await moveTo(jitter(left + w * cur), jitter(p.y), a.ms);
        } else { tx = p.x + (a.dx ?? w * 0.4); await moveTo(jitter(p.x), jitter(p.y), a.ms); }
        await rest(130); await down(); await rest(100);
        await lineTo(tx, cy + rr(-1.5, 1.5), a.dur ?? 800); await rest(100); await up(); await rest(a.dwell ?? 420);
        break;
      }
      case 'swipe': { // flick: press, quick ease-out move, release
        const p = await pt(v, a.at ?? [0.5, 0.5]);
        const dist = a.dist ?? 220; const d = {left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]}[a.dir ?? 'left'];
        await moveTo(jitter(p.x - d[0] * dist * 0.4), jitter(p.y - d[1] * dist * 0.4), a.ms); await rest(120); await down(); await rest(60);
        await lineTo(cx + d[0] * dist, cy + d[1] * dist, a.dur ?? 340, easeOut); await up(); await rest(a.dwell ?? 520);
        break;
      }
      case 'scroll': {
        const spec = v.in ?? null; const by = v.by ?? 300; const ms = v.ms ?? 900;
        const p0 = await page.evaluate((s) => window.__sp.scrollTopOf(s), spec);
        if (v.at) { const p = await pt(v.at); await moveTo(p.x, p.y, a.ms); }
        const n = Math.max(1, Math.round(ms / DT));
        for (let i = 1; i <= n; i++) { await page.evaluate(([s, y]) => window.__sp.scrollInside(s, y), [spec, p0 + by * ease(i / n)]); await frame(); }
        await rest(v.dwell ?? 350);
        break;
      }
    }
  };

  // ---- the script: lead-in rest, every action, tail rest
  await rest(LEAD);
  for (const a of actions) await runAction(a);
  await rest(TAIL);
  if (writes.length) await Promise.all(writes);
  if (stream) { const endE = phase('spotlight.encodeFlush'); rec.webm = await stream.end(); endE(); }
  const theme = await page.evaluate(() => {
    const el = window.__spRoot; const c = getComputedStyle(el).backgroundColor; const m = /rgba?\(([^)]+)\)/.exec(c);
    let lum = null; if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); if ((p.length < 4 || p[3] > 0.3)) lum = (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255; }
    return lum;
  });
  await ctx.close();
  return {rec, info, theme};
}

fs.mkdirSync(out, {recursive: true});
const browser = await chromium.launch({headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-features=CalculateNativeWinOcclusion', '--font-render-hinting=none']});
const killBrowser = async () => { try { await browser.close(); } catch {} };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await killBrowser(); process.exit(130); });
try {
  log('pass 1: measuring');
  let endP = phase('spotlight.pass1');
  const m = await pass(browser, false, null);
  endP(); prof.flush('spotlight.pass1.');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of m.rec.bbox) if (b) { x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]); }
  if (!(x1 > x0)) die('nothing visible was measured for that target');
  const clip = {x: Math.max(0, Math.floor(x0 - PAD)), y: Math.max(0, Math.floor(y0 - PAD))};
  clip.width = Math.min(VW, Math.ceil(x1 + PAD)) - clip.x; clip.height = Math.min(VH, Math.ceil(y1 + PAD)) - clip.y;
  if (!flags.scale) SCALE = Math.max(2, Math.min(QUALITY.q.spotlightScaleMax, Math.ceil(1400 / Math.max(1, x1 - x0)))); // the hero is drawn up to ~1400 px wide at 1080p
  log(`target ${m.info.tag}: ${m.rec.frames} frames (${(m.rec.frames / FPS).toFixed(1)} s), clip ${clip.width}x${clip.height} @${SCALE}x`);
  log('pass 2: capturing');
  endP = phase('spotlight.pass2');
  const c = await pass(browser, true, clip);
  endP({frames: c.rec.frames}); prof.flush('spotlight.pass2.');
  const rec = c.rec;
  const rel = (x, y) => [+(x - clip.x).toFixed(2), +(y - clip.y).toFixed(2)];
  const spot = {
    version: 1, tool: 'dolly-spotlight', url: flags.url ?? flags.html, target: flags.target, resolved: c.info.tag,
    fps: FPS, frames: rec.frames, durationMs: Math.round(rec.frames * DT), scale: SCALE,
    viewport: {w: VW, h: VH}, clip, image: {w: Math.round(clip.width * SCALE), h: Math.round(clip.height * SCALE), cssW: clip.width, cssH: clip.height, pattern: 'frames/%05d.png'},
    theme: c.theme == null ? 'unknown' : c.theme < 0.5 ? 'dark' : 'light', radius: c.info.radius, font: c.info.font, ink: c.info.ink, pageBg: c.info.pageBg,
    // everything below is in the image's CSS px (origin = top-left of the clip)
    bbox: rec.bbox.map((b) => (b ? [+(b[0] - clip.x).toFixed(2), +(b[1] - clip.y).toFixed(2), b[2], b[3]] : null)),
    roots: rec.roots.map((rs) => rs.map((r) => [+(r[0] - clip.x).toFixed(2), +(r[1] - clip.y).toFixed(2), r[2], r[3], r[4]])),
    rootRect: rec.rr.map((q) => (q ? [+(q[0] - clip.x).toFixed(1), +(q[1] - clip.y).toFixed(1), q[2], q[3]] : null)),
    hitFont: (() => { const f = rec.fs.filter((v) => v > 0).sort((a, b) => a - b); return f.length ? f[Math.floor(f.length * 0.4)] : null; })(),
    cards: rec.cards.map((rs) => rs.map((r) => [+(r[0] - clip.x).toFixed(1), +(r[1] - clip.y).toFixed(1), r[2], r[3], r[4]])),
    cursor: rec.cursor.map((q) => [q[0], ...rel(q[1], q[2]), q[3], q[4]]), // [tMs, x, y, kind, pressed]
    clicks: rec.clicks.map((q) => ({...q, ...Object.fromEntries([['x', rel(q.x, q.y)[0]], ['y', rel(q.x, q.y)[1]]])})),
    hovers: rec.hovers.map((q) => ({...q, x: rel(q.x, q.y)[0], y: rel(q.x, q.y)[1]})),
    keys: rec.keys, states: rec.states, sounds: rec.sounds,
  };
  // the page before isolation (viewport CSS px; the capture image sits at `clip` inside it), for the context intro
  if (c.info.context) spot.context = c.info.context;
  else fs.rmSync(path.join(out, 'context.jpg'), {force: true});
  // the frames as ONE alpha video (VP9 WebM, about 1 % of the PNGs' size); the PNG sequence is deleted unless --keep-frames
  if (rec.webm) {
    spot.image.video = 'frames.webm';
    log(`frames.webm: ${(fs.statSync(path.join(out, 'frames.webm')).size / 1e6).toFixed(1)} MB (encoded while capturing)`);
  } else if (rec.webm === false) die('could not encode frames.webm (ffmpeg with libvpx-vp9 needed); run again with --keep-frames to keep PNG frames');
  else if (flags['keep-frames'] !== 'true') {
    const {spawnSync} = await import('node:child_process');
    const webm = path.join(out, 'frames.webm');
    const pngBytes = fs.readdirSync(path.join(out, 'frames')).reduce((a, f) => a + fs.statSync(path.join(out, 'frames', f)).size, 0);
    const endE = phase('spotlight.encodeWebm');
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(out, 'frames', '%05d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '18', '-b:v', '0',
      '-row-mt', '1', '-cpu-used', '4', '-threads', String(Number(flags['encode-threads'] ?? QUALITY.q.encodeThreads)), '-g', String(FPS * 2), webm], {stdio: ['ignore', 'inherit', 'inherit']});
    endE();
    if (r.status === 0 && fs.existsSync(webm)) {
      spot.image.video = 'frames.webm';
      fs.rmSync(path.join(out, 'frames'), {recursive: true, force: true});
      log(`frames.webm: ${(fs.statSync(webm).size / 1e6).toFixed(1)} MB (the PNG frames were ${(pngBytes / 1e6).toFixed(0)} MB, removed; --keep-frames keeps them)`);
    } else log('could not encode frames.webm (ffmpeg with libvpx-vp9 needed); keeping the PNG frames');
  }
  fs.writeFileSync(path.join(out, 'spotlight.json'), JSON.stringify(spot));
  log(`wrote ${rec.frames} frames and spotlight.json to ${out} (${mb(dirSize(out))} on disk)`);
} finally { await killBrowser(); }
process.exit(0);
