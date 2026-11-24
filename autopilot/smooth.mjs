#!/usr/bin/env node
// Dolly smooth capture: plays a script.json in a HEADLESS Chromium on a virtual clock and screenshots every frame.
// The page's time (timers, requestAnimationFrame, CSS / Web animations, video) only advances when the driver steps it by 1/60 s, so:
//   - recording.mp4 is exactly 60 fps: no duplicate frames, no dropped frames, no variable frame rate (window capture gives ~30-45)
//   - the cursor path, the scroll and the pacing are exact (to the frame) and repeatable
//   - network waits and page loads take no time on camera (the clock stands still while a request is in flight)
// Nothing is shown on screen and nothing of the owner's screen is recorded. Same script format and the same outputs as drive.mjs:
//   recording.mp4 (viewport at --dsf, default 2x), events.json (../CONTRACT.md), scenes.json, timing.json, script.json
//
//   node smooth.mjs script.json --out dir [--viewport 1440x900] [--dsf 2] [--mobile] [--storage state.json] [--fps 60] [--seed 1]
//                   [--image png|jpeg] [--crf 14] [--headed]
// Usually run through drive.mjs / make.mjs with `--capture smooth` (the default for autopilot takes). Real-time window capture
// (`--capture window`) stays for pages this cannot drive: real desktop apps, WebRTC, anything that needs a visible window.
// Motion and pacing numbers: studio/src/types.ts `motionDefaults` (see ../docs/motion-audit.md).
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {M, moveMs, cursorPath, scrollMs, minJerk, between} from './motion.mjs';
import {resolveQuality} from '../studio/scripts/lib/env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  else pos.push(a);
}
const die = (m) => { console.error(m); process.exit(1); };
if (!pos[0] || !flags.out) die('usage: node smooth.mjs <script.json> --out <dir> [--viewport 1440x900] [--dsf 2] [--mobile] [--storage state.json]');
const script = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
const outDir = path.resolve(flags.out);
fs.mkdirSync(outDir, {recursive: true});
const log = (...a) => console.error('[smooth]', ...a);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOBILE = flags.mobile === 'true' || flags.mobile === '1';
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Mobile Safari/537.36';
const [VW, VH] = (flags.viewport ?? (MOBILE ? script.mobileViewport ?? '390x693' : script.viewport ?? '1440x900')).split('x').map(Number);
const QUALITY = resolveQuality(flags.quality); // lite captures at 1.5x (a phone take stays 2x: it is small), see docs/performance.md
const DSF = Number(flags.dsf ?? script.deviceScaleFactor ?? (MOBILE ? 2 : QUALITY.q.dsf));
const FPS = Number(flags.fps ?? 60), DT = 1000 / FPS;
const BASE = script.url;
if (!BASE) die('script.json needs a "url"');
const avoid = (script.avoid ?? []).map((r) => new RegExp(r, 'i'));
const PACED = script.paced === true; // Narrate: every action carries atMs, no automatic holds
const P = M.pacing, C = M.cursor;

// seeded randomness (which way a move bows, typing rhythm, where in a button the click lands): the same take every run
let rs = (Number(flags.seed ?? script.seed ?? 1) * 2654435761) >>> 0;
const rnd = () => { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rr = (a, b) => a + rnd() * (b - a);

// ---------------------------------------------------------------- browser
const launchOpts = {headless: flags.headed !== 'true', args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-smooth-scrolling', '--disable-features=CalculateNativeWinOcclusion', '--autoplay-policy=no-user-gesture-required']};
let browser;
try { browser = await chromium.launch({...launchOpts, channel: 'chromium'}); } // full Chromium in new headless mode (has the video codecs)
catch { browser = await chromium.launch(launchOpts); }
let closed = false, enc = null;
async function shutdown() {
  if (closed) return;
  closed = true;
  try { await Promise.race([browser.close(), realSleep(4000)]); } catch {}
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { log(`${sig}: shutting down`); try { enc?.proc.kill('SIGKILL'); } catch {} await shutdown(); process.exit(130); });

const storagePath = flags.storage ?? script.storageState;
if (storagePath && !fs.existsSync(path.resolve(storagePath))) die(`storage state ${storagePath} not found. Make it with:  node autopilot/login.mjs <url>`);
const ctx = await browser.newContext({
  viewport: {width: VW, height: VH}, deviceScaleFactor: DSF, locale: 'en-US', reducedMotion: 'no-preference',
  storageState: storagePath ? path.resolve(storagePath) : undefined,
  ...(MOBILE ? {isMobile: true, hasTouch: true, userAgent: UA_MOBILE} : {}),
});
await ctx.addInitScript({path: path.join(here, 'vclock.js')});
const page = await ctx.newPage();
page.on('pageerror', () => {});
let cdp = await ctx.newCDPSession(page);

// network: the clock does not advance while a request the page is waiting for is in flight
const inflight = new Map();
let lastNet = Date.now(), navStarted = false, docCommitted = false;
const WAITED = new Set(['document', 'script', 'stylesheet', 'fetch', 'xhr', 'image', 'font']);
page.on('request', (r) => {
  if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navStarted = true;
  if (WAITED.has(r.resourceType())) { inflight.set(r, Date.now()); lastNet = Date.now(); }
});
const done = (r) => { if (inflight.delete(r)) lastNet = Date.now(); };
page.on('requestfinished', done);
page.on('requestfailed', done);
page.on('framenavigated', (f) => { if (f === page.mainFrame()) docCommitted = true; });
const pending = () => { const now = Date.now(); let n = 0; for (const [r, t] of inflight) { if (now - t > 4000) inflight.delete(r); else n++; } return n; };
async function netQuiet(maxMs = 1500) {
  const t0 = Date.now();
  while (pending() > 0 && Date.now() - t0 < maxMs) await realSleep(8);
}

const step = async (ms = DT) => page.evaluate((d) => window.__vt.step(d), ms);
/** Let a freshly loaded document finish off camera: virtual time runs (hydration, fonts, intro animations) until it is calm. */
async function settleDocument(minMs = 600, maxRealMs = 14000) {
  await page.waitForLoadState('load', {timeout: 30000}).catch(() => {});
  const t0 = Date.now();
  let pumped = 0, calm = 0;
  while (Date.now() - t0 < maxRealMs) {
    let busy = false;
    try { for (let i = 0; i < 6; i++) busy = (await step()).busy; } catch { await realSleep(50); continue; }
    pumped += DT * 6;
    const quiet = pending() === 0 && Date.now() - lastNet > 350;
    calm = quiet && !busy ? calm + DT * 6 : 0;
    if (pumped >= minMs && calm >= 300) break;
    if (pumped > 9000 && quiet) break; // something animates for ever: go on
    await realSleep(4);
  }
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  try { await step(); await step(); } catch {}
  await page.evaluate(() => { window.__vtDoc = true; }).catch(() => {});
}

// ---------------------------------------------------------------- encoder (frames are piped straight in: nothing lands on disk)
const IMG = flags.image === 'jpeg' ? 'jpeg' : 'png';
function startEncoder(file) {
  const proc = spawn('ffmpeg', [
    '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', IMG === 'png' ? 'png' : 'mjpeg', '-i', '-',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:out_range=tv:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', QUALITY.q.capturePreset, '-threads', String(QUALITY.q.encodeThreads), '-crf', String(flags.crf ?? QUALITY.q.captureCrf), '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', '-an', file,
  ], {stdio: ['pipe', 'inherit', 'inherit']});
  const exited = new Promise((res) => proc.on('exit', res));
  proc.stdin.on('error', () => {});
  return {
    proc,
    async write(buf) { if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once('drain', r)); },
    async end() { proc.stdin.end(); return exited; },
  };
}

// ---------------------------------------------------------------- the clock, the cursor, one frame
const ev = {cursor: [], clicks: [], keys: [], scroll: [], loading: []};
const timing = [];
let frames = 0;
let cx = Math.round(VW * 0.32), cy = Math.round(VH * 0.62), sentX = -1, sentY = -1;
let busy = false, curScene = 0, capturing = false;
const now = () => frames * DT; // ms on the recording's clock
const r1 = (n) => Math.round(n * 10) / 10;

async function shot() {
  for (let k = 0; k < 3; k++) {
    try {
      // The clip's scale must carry the device scale: without a clip CDP returns a CSS-pixel-sized (1x) picture whatever the
      // context's deviceScaleFactor (every take was 1440x900 labelled 2x: soft when zoomed). A clip is in page coordinates,
      // so it starts at the scroll position.
      const vv = (await cdp.send('Page.getLayoutMetrics')).cssVisualViewport;
      const r = await cdp.send('Page.captureScreenshot', {format: IMG, ...(IMG === 'jpeg' ? {quality: 96} : {}), fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true,
        clip: {x: vv.pageX, y: vv.pageY, width: VW, height: VH, scale: DSF}});
      return Buffer.from(r.data, 'base64');
    } catch (e) {
      await realSleep(60);
      try { cdp = await ctx.newCDPSession(page); } catch {}
    }
  }
  throw new Error('could not capture a frame');
}

/** A document navigation happened (or is under way): wait for the new page off camera, then carry on. Returns true if it did. */
async function crossNavigation() {
  if (!navStarted) return false;
  const t = now();
  const t0 = Date.now();
  while (!docCommitted && Date.now() - t0 < 15000) await realSleep(20);
  navStarted = false; docCommitted = false;
  const fresh = !(await page.evaluate(() => window.__vtDoc === true).catch(() => false));
  if (fresh) { // a new document: load and settle it with the clock running off camera, and cross-fade to it (events.loading)
    await settleDocument();
    await page.mouse.move(cx, cy); sentX = cx; sentY = cy;
    try { await step(); } catch {}
    if (capturing) ev.loading.push({startMs: Math.round(t), endMs: Math.round(t + 2 * DT)});
    navStarted = false; docCommitted = false;
  } else await netQuiet(5000); // same-document route change: only the data has to arrive
  return fresh;
}

/** One output frame: wait for the network, place the cursor, advance the page by 1/60 s, screenshot. */
async function frame() {
  await netQuiet();
  await crossNavigation();
  if (cx !== sentX || cy !== sentY) { await page.mouse.move(cx, cy); sentX = cx; sentY = cy; }
  try { busy = (await step()).busy; } catch { // the document went away under us
    navStarted = true; await realSleep(80); await crossNavigation();
  }
  if (capturing) {
    await enc.write(await shot());
    ev.cursor.push([r1(now()), r1(cx * DSF), r1(cy * DSF)]);
    frames++;
  }
}
const rest = async (ms) => { const n = Math.round(ms / DT); for (let i = 0; i < n; i++) await frame(); };
const restUntil = async (t) => { while (now() < t - DT / 2) await frame(); };

// ---------------------------------------------------------------- input
let bowSide = 1;
async function moveTo(x, y, ms) {
  const p = cursorPath(cx, cy, x, y, (bowSide = rnd() < 0.5 ? -1 : 1), ms);
  if (p.dist < 1) return;
  const n = Math.max(2, Math.round(p.ms / DT));
  for (let i = 1; i <= n; i++) { [cx, cy] = p.at(i / n); await frame(); }
  cx = x; cy = y;
}

async function scrollTo(total, ms) {
  if (!total) return;
  ms ??= scrollMs(total);
  const y0 = await page.evaluate(() => window.scrollY);
  const n = Math.max(2, Math.round(ms / DT));
  let prev = 0;
  for (let i = 1; i <= n; i++) {
    const d = total * minJerk(i / n);
    await page.evaluate((y) => window.scrollTo(0, y), y0 + d);
    ev.scroll.push({tMs: Math.round(now()), dy: r1(d - prev)});
    prev = d;
    await frame();
  }
}

const SELECTOR = /^(text=|css=|xpath=|role=|id=|data-testid=|\/\/|#|\.|\[|:|[a-z][a-z0-9-]*(\[|\.|#|:|\s*>))/i;
async function locateOnce(spec) {
  const first = async (loc) => {
    const n = await loc.count();
    for (let i = 0; i < Math.min(n, 12); i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
    return null;
  };
  if (spec && typeof spec.boundingBox === 'function') return spec;
  if (typeof spec === 'object') spec = spec.selector ?? spec.text;
  if (SELECTOR.test(spec)) return first(page.locator(spec));
  const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const re of [new RegExp(`^\\s*${esc}\\s*$`, 'i'), new RegExp(esc, 'i')]) {
    const hit = (await first(page.getByRole('button', {name: re}))) ?? (await first(page.getByRole('link', {name: re}))) ?? (await first(page.getByRole('tab', {name: re}))) ?? (await first(page.getByText(re)));
    if (hit) return hit;
  }
  return null;
}
/** Find a visible element; while it is not there yet the take keeps rolling (the page may still be bringing it in). */
async function locate(spec, maxMs = 8000) {
  const t0 = now(), r0 = Date.now();
  for (;;) {
    const l = await locateOnce(spec);
    if (l) return l;
    if (now() - t0 > maxMs || Date.now() - r0 > 30000) throw new Error(`could not find a visible element for "${typeof spec === 'string' ? spec : JSON.stringify(spec)}" on ${page.url()}`);
    await rest(100);
  }
}
async function findMenuButton() {
  const sel = 'button[aria-label*="menu" i], button[aria-label*="navigation" i], [aria-controls*="menu" i], [aria-controls*="nav" i], button[class*="burger" i], button[class*="menu" i], [class*="hamburger" i], [class*="menu-toggle" i]';
  const loc = page.locator(sel), n = await loc.count();
  for (let i = 0; i < Math.min(n, 8); i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
  return null;
}

/** Find the element and bring it into view with an eased scroll. `deadline` (recording ms): scroll no slower than that allows. */
async function target(spec, deadline) {
  let loc = null;
  if (MOBILE && typeof spec === 'string') {
    loc = await locateOnce(spec);
    if (!loc) { const mb = await findMenuButton(); if (mb) { log('  (opening the menu)'); await click(mb); await rest(400); } }
  }
  loc ??= await locate(spec);
  let b = await loc.boundingBox();
  const pinned = await loc.evaluate((el) => { for (let e = el; e; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return true; } return false; }).catch(() => false);
  const inView = b.y >= 0 && b.y + b.height <= VH;
  if (!(pinned && inView) && (b.y < 70 || b.y + b.height > VH - 70)) {
    const dy = Math.round(b.y + b.height / 2 - VH * 0.42);
    const nat = scrollMs(dy);
    log(`  (scrolling ${dy} px to bring "${typeof spec === 'string' ? spec.slice(0, 40) : 'the target'}" into view: box y ${Math.round(b.y)}..${Math.round(b.y + b.height)})`);
    await scrollTo(dy, deadline == null ? nat : Math.max(350, Math.min(nat, deadline - now())));
    if (deadline == null) await rest(P.holdSmallMs * 0.5); // let the eye land before the cursor sets off
    b = await loc.boundingBox();
    if (b.y < 0 || b.y + b.height > VH) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await rest(100); b = await loc.boundingBox(); }
  }
  const text = ((await loc.innerText().catch(() => '')) + ' ' + ((await loc.getAttribute('href').catch(() => '')) ?? '')).trim();
  const bad = avoid.find((r) => r.test(text));
  if (bad) throw new Error(`refusing to touch "${text.slice(0, 60)}" (matches avoid ${bad})`);
  const fx = rr(0.4, 0.6), fy = rr(0.42, 0.58);
  return {x: b.x + b.width * fx, y: b.y + b.height * fy, text, loc, fx, fy};
}

const record = (kind, spec, atMs, actualMs, extra = {}) => timing.push({scene: curScene, kind, target: typeof spec === 'string' ? spec : undefined, atMs: atMs ?? null, actualMs: Math.round(actualMs), lateMs: atMs != null ? Math.round(actualMs - atMs) : null, ...extra});

const mark = async () => page.evaluate(() => window.__vt.mark()).catch(() => {});
// ---- pacing: after an action wait for the visual change to finish, then hold long enough to read it
let holdFrom = 0, holdNeed = 0;
async function afterAction(kind, a, navigated) {
  if (PACED) return;
  const t0 = now();
  let calm = 0;
  await rest(2 * DT);
  while (now() - t0 < P.changeMaxMs) { // the change is over when nothing has animated for 150 ms
    await frame();
    calm = busy || pending() ? 0 : calm + DT;
    if (calm >= 150) break;
  }
  holdFrom = now();
  holdNeed = a?.hold ?? (navigated || kind === 'goto' ? P.holdPageMs : P.holdSmallMs);
  await rest(holdNeed);
}
/** An explicit {"wait": ms} is "at least this long after the last action", not extra on top of the automatic hold. */
async function wait(ms) {
  if (PACED) return rest(ms);
  const already = now() - holdFrom;
  const covered = already <= holdNeed + 2 * DT ? holdNeed : 0;
  await rest(Math.max(0, ms - covered));
}

async function pointerTo(t, atMs) {
  const dist = Math.hypot(t.x - cx, t.y - cy);
  const nat = moveMs(dist, MOBILE ? 0.8 : 1);
  const settle = between(C.settleMs, rnd());
  if (atMs != null) { // paced: be on the target `settle` ms before the moment, press on it
    const arrive = atMs - settle;
    await restUntil(arrive - nat);
    const b2 = await t.loc.boundingBox().catch(() => null); // the page may have shifted while we waited
    if (b2) { t.x = b2.x + b2.width * t.fx; t.y = b2.y + b2.height * t.fy; }
    await moveTo(t.x, t.y, Math.max(240, Math.min(nat, arrive - now())));
    await restUntil(atMs);
  } else {
    await moveTo(t.x, t.y, nat);
    await rest(settle);
  }
}

async function click(spec, atMs, a) {
  const t = await target(spec, atMs != null ? atMs - 1100 : undefined);
  await pointerTo(t, atMs);
  const url = page.url(), down = now();
  navStarted = false; docCommitted = false;
  await mark();
  await page.mouse.down();
  ev.clicks.push({tMs: Math.round(now()), x: r1(t.x * DSF), y: r1(t.y * DSF), button: 'left', kind: 'down'});
  await rest(between(C.pressMs, rnd()));
  await page.mouse.up();
  ev.clicks.push({tMs: Math.round(now()), x: r1(t.x * DSF), y: r1(t.y * DSF), button: 'left', kind: 'up'});
  await realSleep(120); // real time, clock frozen: does this click navigate?
  const fresh = await crossNavigation();
  log(`  click "${t.text.slice(0, 40).replace(/\s+/g, ' ')}" at ${Math.round(t.x)},${Math.round(t.y)} (${Math.round(down)} ms${atMs != null ? `, planned ${atMs}` : ''})`);
  if (atMs !== undefined || !String(spec?.constructor?.name).includes('Locator')) record('click', spec, atMs, down, {matched: t.text.slice(0, 80), url: page.url()});
  await afterAction('click', a, fresh || page.url() !== url);
}

async function hover(spec, atMs, a) {
  const t = await target(spec, atMs != null ? atMs - 1100 : undefined);
  await pointerTo(t, atMs);
  record('hover', spec, atMs, now(), {matched: t.text.slice(0, 80)});
  if (!PACED) { holdFrom = now(); holdNeed = a?.dwell ?? a?.hold ?? 600; await rest(holdNeed); }
}

const MODS = {meta: ['cmd', '⌘'], cmd: ['cmd', '⌘'], command: ['cmd', '⌘'], shift: ['shift', '⇧'], control: ['ctrl', '⌃'], ctrl: ['ctrl', '⌃'], alt: ['alt', '⌥'], option: ['alt', '⌥']};
async function press(combo, atMs, a) {
  if (atMs != null) await restUntil(atMs);
  record('press', combo, atMs, now());
  const parts = combo.split('+');
  const key = parts.pop();
  const mods = parts.map((p) => MODS[p.toLowerCase()]).filter(Boolean);
  const entry = {tMs: Math.round(now()), mods: mods.map((m) => m[0])};
  if (mods.length) entry.label = mods.map((m) => m[1]).join('') + (key.length === 1 ? key.toUpperCase() : key);
  ev.keys.push(entry);
  const url = page.url();
  navStarted = false; docCommitted = false;
  await mark();
  await page.keyboard.press(combo);
  await realSleep(120);
  const fresh = await crossNavigation();
  await afterAction('press', a, fresh || page.url() !== url);
}

// Typing: keystrokes are logged as timing only. The characters are never stored in the events.
async function type(text, into, atMs, a) {
  if (into) { const t = await target(into, atMs != null ? atMs - 1600 : undefined); await pointerTo(t, atMs != null ? atMs - 500 : undefined); await page.mouse.down(); ev.clicks.push({tMs: Math.round(now()), x: r1(t.x * DSF), y: r1(t.y * DSF), button: 'left', kind: 'down'}); await rest(90); await page.mouse.up(); ev.clicks.push({tMs: Math.round(now()), x: r1(t.x * DSF), y: r1(t.y * DSF), button: 'left', kind: 'up'}); await rest(260); }
  if (atMs != null) await restUntil(atMs);
  record('type', undefined, atMs, now(), {chars: text.length});
  for (const ch of text) {
    ev.keys.push({tMs: Math.round(now()), mods: []});
    await page.keyboard.type(ch);
    await rest(rr(50, 105) + (/[ .,]/.test(ch) ? rr(0, 60) : 0));
  }
  await afterAction('type', a, false);
}

function expand(actions) {
  const out = [];
  for (const a of actions ?? []) {
    if (MOBILE && 'mobile' in a) { const m = a.mobile; if (m === false || m === null) continue; out.push(...(Array.isArray(m) ? m : [m])); } else out.push(a);
  }
  return out;
}

async function runAction(a) {
  const n0 = timing.length;
  if ('click' in a) await click(a.click, a.atMs, a);
  else if ('hover' in a) await hover(a.hover, a.atMs, a);
  else if ('type' in a) await type(a.type, a.into, a.atMs, a);
  else if ('press' in a) await press(a.press, a.atMs, a);
  else if ('scroll' in a) {
    if (a.atMs != null) await restUntil(a.atMs);
    record('scroll', undefined, a.atMs, now(), {dy: a.scroll, ms: a.ms ?? null, _ambient: a._ambient ?? false});
    await scrollTo(a.scroll, a.ms);
    if (!PACED) { holdFrom = now(); holdNeed = a.hold ?? P.holdSmallMs; await rest(holdNeed); }
  } else if ('wait' in a) await wait(a.wait);
  else if ('goto' in a) {
    if (a.atMs != null) await restUntil(a.atMs);
    record('goto', a.goto, a.atMs, now());
    const t = now();
    capturing = false;
    await page.goto(new URL(a.goto, BASE).href, {waitUntil: 'commit'});
    navStarted = false; docCommitted = false;
    await settleDocument();
    capturing = true;
    ev.loading.push({startMs: Math.round(t), endMs: Math.round(t + 2 * DT)});
    await afterAction('goto', a, true);
  } else throw new Error(`unknown action ${JSON.stringify(a)}`);
  if (a.wordMs != null) for (let i = n0; i < timing.length; i++) if (timing[i].atMs != null) timing[i].wordMs = a.wordMs;
}

// ---------------------------------------------------------------- the take
const t00 = Date.now();
log(`virtual-time capture: ${VW}x${VH} @${DSF}x, ${FPS} fps, ${IMG} frames${MOBILE ? ', phone' : ''}`);
await page.goto(BASE, {waitUntil: 'commit', timeout: 45000});
await settleDocument(Math.max(1800, script.settleMs ?? 0));
navStarted = false; docCommitted = false;
if (MOBILE) { const got = await page.evaluate(() => innerWidth); if (got !== VW) log(`WARNING: the page lays out at ${got} CSS px wide (wanted ${VW})`); }
await page.mouse.move(cx, cy); sentX = cx; sentY = cy;
enc = startEncoder(path.join(outDir, 'recording.mp4'));
capturing = true;
const scenes = [];
let failed = null;
try {
  if (!PACED) await rest(script.leadMs ?? P.leadInMs); // a calm first second
  for (const [n, sc] of (script.scenes ?? []).entries()) {
    const start = now();
    log(`scene ${n + 1}: ${sc.goal ?? ''}`);
    curScene = n + 1;
    for (const a of expand(MOBILE && sc.mobileActions ? sc.mobileActions : sc.actions)) await runAction(a);
    const words = (sc.narration ?? '').trim().split(/\s+/).filter(Boolean).length;
    const need = PACED ? 0 : sc.minMs ?? (words ? 900 + words * 300 : 0);
    if (now() - start < need) await rest(need - (now() - start));
    scenes.push({goal: sc.goal ?? '', narration: sc.narration ?? '', startMs: Math.round(start), endMs: Math.round(now())});
  }
  if (PACED && script.endMs) await restUntil(script.endMs);
  else await rest(Math.max(300, (script.tailMs ?? P.leadOutMs) - Math.max(0, now() - holdFrom))); // a calm last second
} catch (e) {
  failed = e;
  log(`FAILED in scene ${scenes.length + 1}: ${e.message}`);
  try { fs.writeFileSync(path.join(outDir, 'failure.png'), await shot()); } catch {}
}
capturing = false;
const code = await enc.end();
await shutdown();
if (code !== 0) die('ffmpeg could not encode the frames');

const dur = Math.round(frames * DT);
const events = {
  version: 1, video: 'recording.mp4', width: Math.round(VW * DSF), height: Math.round(VH * DSF), fps: FPS, durationMs: dur, pointScale: DSF,
  capture: 'smooth',
  cursor: ev.cursor, clicks: ev.clicks, loading: ev.loading, keys: ev.keys, scroll: ev.scroll,
};
fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify(events));
fs.writeFileSync(path.join(outDir, 'scenes.json'), JSON.stringify(scenes, null, 2));
fs.copyFileSync(pos[0], path.join(outDir, 'script.json'));
if (timing.length) fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify(timing, null, 2));
{ const late = timing.filter((t) => t.lateMs != null && Math.abs(t.lateMs) > 50); if (late.length) log(`WARNING: ${late.length} action(s) off their planned moment: ${late.map((t) => `${t.kind} ${t.target ?? ''} ${t.lateMs > 0 ? '+' : ''}${t.lateMs} ms`).join('; ')}`); }
const real = (Date.now() - t00) / 1000;
console.log(`recorded ${outDir}: ${(dur / 1000).toFixed(1)} s, ${events.width}x${events.height}, exactly ${FPS} fps (${frames} frames in ${real.toFixed(0)} s), ${ev.clicks.length / 2} clicks, ${ev.keys.length} keys, ${ev.scroll.length} scroll steps`);
if (failed) { console.error(`take incomplete: ${failed.message}`); process.exit(2); }
process.exit(0);
