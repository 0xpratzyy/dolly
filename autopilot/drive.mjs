#!/usr/bin/env node
// Dolly autopilot driver: plays a script.json in a headed Chromium with human-like eased mouse paths, logs EVERY event itself
// (cursor ~60/s, clicks, keys timing-only, scroll) and records the Chromium window only. Writes, into --out:
//   recording.mp4   viewport only, 60 fps CFR, t=0 = first scene          events.json   per ../CONTRACT.md
//   scenes.json     [{goal, narration, startMs, endMs}] in recording time (feeds the captions)
//
//   node drive.mjs script.json --out dir [--viewport 1440x900] [--dsf 2] [--capture auto|smooth|window|screencast]
// --capture smooth (what `auto` picks for a normal script): smooth.mjs plays the script headless on a virtual clock and screenshots
// every frame: exactly 60 fps, no duplicate frames, exact cursor and pacing. window / screencast are the real-time fallbacks (real
// apps, pages that need a visible window); `auto` keeps them for Narrate scripts (`paced: true`) unless you pass --capture smooth.
//                  [--pos 40,40] [--mobile] [--keep-raw] [--headless-fallback no] [--storage state.json] [--check]
// Narrate mode (see ../SKILL.md): actions may carry `atMs` (the moment, on the narration clock where 0 = the first scene, that the action
// must land: click down, hover rest, scroll start, typing start). The driver moves the cursor so it arrives ~260 ms before, idles
// until the moment, and writes timing.json (planned vs actual, per action). `script.paced: true` turns the reading-time dwell off and
// `script.endMs` is where the take ends. --check runs the whole script headless and fast (no recording, no pacing) and writes check.json:
// every target found? what did it match? Nothing is recorded. --storage loads a Playwright storageState the USER saved with login.mjs.
// See ../SKILL.md for the script format. Never records the full display; never touches the real system cursor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium} from 'playwright';
import {sleep as baseSleep, recorderStatus, findWindow, WindowRecorder, analyseFlashes, cutToMp4, Screencast} from './capture.mjs';
import {spawnSync} from 'node:child_process';
import {M, moveMs, cursorPath, scrollMs, minJerk, between} from './motion.mjs';
import {resolveQuality} from '../studio/scripts/lib/env.mjs';

const argv = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  else pos.push(a);
}
const die = (m) => { console.error(m); process.exit(1); };
const CHECK = flags.check === 'true' || flags.check === '1';
let FAST = CHECK; // --check and the silent warm-up: no pacing, short sleeps, quick moves
const sleep = (ms) => baseSleep(FAST ? Math.min(ms, 30) : ms);
if (!pos[0] || !flags.out) die('usage: node drive.mjs <script.json> --out <dir> [--viewport 1440x900] [--dsf 2] [--capture auto|window|screencast] [--pos 40,40]');
const script = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
const outDir = path.resolve(flags.out);
fs.mkdirSync(outDir, {recursive: true});
{ // smooth capture (virtual time): hand the whole take to smooth.mjs, which writes the same files
  const want = flags.capture ?? script.capture ?? 'auto';
  if (!CHECK && (want === 'smooth' || (want === 'auto' && script.paced !== true))) {
    const rest = [];
    for (let i = 0; i < argv.length; i++) { if (argv[i] === '--capture') { i++; continue; } rest.push(argv[i]); }
    process.argv = [process.argv[0], path.join(path.dirname(new URL(import.meta.url).pathname), 'smooth.mjs'), ...rest];
    await import('./smooth.mjs'); // exits the process when the take is written
    await new Promise(() => {});
  }
}

const MOBILE = flags.mobile === 'true' || flags.mobile === '1';
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Mobile Safari/537.36';
let [VW, VH] = (flags.viewport ?? (MOBILE ? script.mobileViewport ?? '390x693' : script.viewport ?? '1440x900')).split('x').map(Number);
let DSF = Number(flags.dsf ?? script.deviceScaleFactor ?? (MOBILE ? 2 : resolveQuality(flags.quality).q.dsf)); // window capture uses the display's real density (set below)
const FPS = 60;
const [WX, WY] = (flags.pos ?? '40,40').split(',').map(Number);
const BASE = script.url;
if (!BASE) die('script.json needs a "url"');
const avoid = (script.avoid ?? []).map((r) => new RegExp(r, 'i'));

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rnd = (a, b) => a + Math.random() * (b - a);
const log = (...a) => console.error('[drive]', ...a);

// ---------------------------------------------------------------- capture backend
let backend = CHECK ? 'none' : flags.capture ?? 'auto';
if (backend === 'none') { /* --check: nothing is recorded */ } else if (backend === 'auto') {
  const st = recorderStatus();
  backend = st.ok ? 'window' : 'screencast';
  if (!st.ok) log(`window capture unavailable (${st.why.split('\n')[0]}), using CDP screencast`);
} else if (backend === 'window') {
  const st = recorderStatus();
  if (!st.ok) die(`window capture needs dolly-record with Screen Recording permission: ${st.why}`);
}
log(`capture: ${backend}, viewport ${VW}x${VH} @${DSF}x`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dolly-drive-'));
process.on('exit', () => { if (flags.keep !== 'true') try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* best effort */ } }); // also when the take fails
const token = 'dolly-' + crypto.randomBytes(4).toString('hex');

const frontBefore = spawnSync('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], {encoding: 'utf8'}).stdout.trim();
const browser = await chromium.launch({
  headless: CHECK,
  args: CHECK ? ['--no-first-run', '--hide-scrollbars'] : [
    `--window-size=${VW},${VH + 130}`, `--window-position=${WX},${WY}`, `--force-device-scale-factor=${DSF}`,
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  ],
});
// viewport: null = the real window. Size the window so the page viewport is exactly VW x VH (no emulation, so the flash,
// the crop and the coordinates all agree).
// The browser's own pid, asked from the browser itself (SystemInfo.getProcessInfo), so we only ever kill the process we started.
let browserPid = null;
try {
  const bc = await browser.newBrowserCDPSession();
  const info = await bc.send('SystemInfo.getProcessInfo');
  browserPid = info.processInfo.find((p) => p.type === 'browser')?.id ?? null;
} catch (e) { log(`could not read the browser pid (${e.message}); falling back to a graceful close`); }
const killBrowser = () => { if (browserPid) { try { process.kill(browserPid, 'SIGKILL'); } catch {} } };
let recorder, screencast, sampler, closed = false;
const frontApp = () => spawnSync('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], {encoding: 'utf8'}).stdout.trim();
/**
 * Always runs on the way out (normal end, error, Ctrl-C, SIGTERM): stops the recorder, closes the page and context, then
 * ends the browser. Chrome for Testing 159 crashed once (EXC_BREAKPOINT in its AppKit quit path, which pops a macOS crash dialog)
 * when asked to quit gracefully while the take was winding down, so the browser is ended by killing its process: its profile is a
 * throwaway temp dir, there is nothing to flush, and a SIGKILL leaves no crash report.
 */
async function shutdown() {
  if (closed) return;
  closed = true;
  clearInterval(sampler);
  try { await recorder?.stop(); } catch {}
  try { await screencast?.stop(); } catch {}
  try { await Promise.race([page?.close({runBeforeUnload: false}), sleep(2000)]); } catch {}
  try { await Promise.race([ctx?.close(), sleep(2000)]); } catch {}
  killBrowser();
  if (!browserPid) { try { await Promise.race([browser.close(), sleep(3000)]); } catch {} }
}
let page, ctx;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { log(`${sig}: shutting down`); await shutdown(); process.exit(130); });
process.on('uncaughtException', async (e) => { console.error(e); await shutdown(); process.exit(1); });
process.on('unhandledRejection', async (e) => { console.error(e); await shutdown(); process.exit(1); });
process.on('exit', killBrowser);
const storagePath = flags.storage ?? script.storageState;
if (storagePath && !fs.existsSync(path.resolve(storagePath))) die(`storage state ${storagePath} not found. Make it with:  node autopilot/login.mjs <url>`);
const storageState = storagePath ? path.resolve(storagePath) : undefined;
if (storageState) log(`signed-in session from ${storageState} (a file the user saved themselves; its contents are never read or printed)`);
ctx = CHECK
  ? await browser.newContext({viewport: {width: VW, height: VH}, deviceScaleFactor: 1, locale: 'en-US', storageState, ...(MOBILE ? {isMobile: true, hasTouch: true, userAgent: UA_MOBILE} : {})})
  : await browser.newContext({viewport: null, locale: 'en-US', storageState});
page = await ctx.newPage();
await page.goto('about:blank');
let emuCdp = null;
if (!CHECK) {
  const cdp = await ctx.newCDPSession(page);
  const {windowId} = await cdp.send('Browser.getWindowForTarget');
  const m = await page.evaluate(() => ({dw: outerWidth - innerWidth, dh: outerHeight - innerHeight, aw: screen.availWidth, ah: screen.availHeight, dpr: devicePixelRatio}));
  DSF = m.dpr; // the window is captured at the display's real density
  // keep the whole window on the main display
  const fitK = Math.min(1, (m.aw - WX - 20 - m.dw) / VW, (m.ah - WY - 20 - m.dh) / VH);
  if (fitK < 1) {
    if (MOBILE) VH = Math.floor((VH * fitK) / 2) * 2; // a phone keeps its width, only the height shrinks
    else { VW = Math.floor((VW * fitK) / 2) * 2; VH = Math.floor((VH * fitK) / 2) * 2; }
    log(`viewport reduced to ${VW}x${VH} to fit the display`);
  }
  await cdp.send('Browser.setWindowBounds', {windowId, bounds: {left: WX, top: WY, width: Math.max(VW + m.dw, MOBILE ? 520 : 0), height: VH + m.dh, windowState: 'normal'}});
  await sleep(300);
  if (MOBILE) {
    // phone: mobile layout, touch, mobile user agent. The emulated viewport sits in the window's top-left; the flash finds it.
    await cdp.send('Emulation.setDeviceMetricsOverride', {width: VW, height: VH, deviceScaleFactor: DSF, mobile: true, screenWidth: VW, screenHeight: VH});
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
    await cdp.send('Emulation.setUserAgentOverride', {userAgent: UA_MOBILE, platform: 'Linux armv81', userAgentMetadata: {platform: 'Android', platformVersion: '14.0.0', model: 'Pixel 8', mobile: true, brands: [{brand: 'Chromium', version: '159'}], fullVersion: '159.0.0.0', architecture: '', bitness: '', wow64: false}});
    emuCdp = cdp; // keep the session: the overrides live as long as it does
    await sleep(300);
  }
  if (!MOBILE) { // (a phone's layout viewport is only known once a page with a viewport meta tag has loaded)
    const got = await page.evaluate(() => ({w: innerWidth, h: innerHeight}));
    if (got.w !== VW || got.h !== VH) log(`WARNING: viewport is ${got.w}x${got.h}, wanted ${VW}x${VH}`);
  }
  if (!MOBILE) await cdp.detach();
}
// give the keyboard focus back to whatever the owner was using (the window is captured fine in the background)
if (!CHECK && frontBefore && !/chrome|chromium/i.test(frontBefore) && !/["\\]/.test(frontBefore)) spawnSync('osascript', ['-e', `tell application "${frontBefore}" to activate`]);
await page.evaluate((t) => { document.title = t; document.body.style.background = '#fff'; }, token);

// ---------------------------------------------------------------- event log (wall-clock ms; converted to video time at the end)
const ev = {cursor: [], clicks: [], keys: [], scroll: []};
let cx = Math.round(VW * 0.32), cy = Math.round(VH * 0.62);
await page.mouse.move(cx, cy);
sampler = setInterval(() => ev.cursor.push([Date.now(), cx, cy]), 1000 / FPS);

async function flash(on) {
  // Returns the wall-clock ms at which the change was painted (two animation frames after the DOM change).
  return page.evaluate(async (on) => {
    if (on) {
      const d = document.createElement('div');
      d.id = '__dolly_flash';
      d.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:2147483647';
      document.documentElement.appendChild(d);
    } else document.getElementById('__dolly_flash')?.remove();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.timeOrigin + performance.now();
  }, on);
}

// narration clock state (used by the warm-up too)
let T0 = null;
const nowMs = () => Date.now() - T0;
const timing = []; // one entry per action: planned vs actual, what the target matched
const LEAD = 260; // the cursor is on the target this long before the word is spoken
const PACED_SCRIPT = script.paced === true;
let curScene = 0;
const loadingWins = []; // [{startWall, endWall}]: a navigation's route-change shell, from the click until real content is there
const pendingLoads = [];

// ---------------------------------------------------------------- human-like input
/** The natural duration of a move over `dist` px (no randomness, so pacing can plan with it). Fitts-style, see motion.mjs. */
const moveMsFor = (dist) => moveMs(dist, MOBILE ? 0.8 : 1);
/** One gentle arc, minimum-jerk along it, no overshoot and no correction at the end (motion.mjs cursorPath). */
async function moveTo(x, y, ms) {
  const p = cursorPath(cx, cy, x, y, Math.random() < 0.5 ? -1 : 1);
  if (p.dist < 1) return;
  ms = (ms ?? moveMsFor(p.dist)) * (FAST ? 0.02 : 1);
  const t0 = performance.now();
  for (;;) {
    const t = Math.min(1, (performance.now() - t0) / ms);
    const [px, py] = p.at(t);
    await page.mouse.move(px, py);
    cx = px; cy = py;
    if (t >= 1) break;
    await sleep(8);
  }
  cx = x; cy = y;
}

async function scrollBy(total, ms = scrollMs(total)) {
  ms *= FAST ? 0.02 : 1;
  const t0 = performance.now();
  let sent = 0;
  for (;;) {
    const t = Math.min(1, (performance.now() - t0) / ms);
    const step = Math.round(total * minJerk(t) - sent);
    if (step !== 0) {
      await page.mouse.wheel(0, step);
      ev.scroll.push({wall: Date.now(), dy: step});
      sent += step;
    }
    if (t >= 1) break;
    await sleep(14);
  }
}

// a tag followed by ':' is a selector only for a pseudo-class written tight (a:hover), not label text ("Look: Golden meadow")
const SELECTOR = /^(text=|css=|xpath=|role=|id=|data-testid=|\/\/|#|\.|\[|:|[a-z][a-z0-9-]*(\[|\.|#|:[a-z(-]|\s*>))/i;
/** "Pricing" -> a visible link/button/text with that text; a CSS or Playwright selector is used as is. */
async function locate(spec, maxWaitMs = 8000) {
  const first = async (loc) => {
    const n = await loc.count();
    for (let i = 0; i < Math.min(n, 12); i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
    return null;
  };
  if (spec && typeof spec.boundingBox === 'function') return spec; // already a Locator
  if (typeof spec === 'object') spec = spec.selector ?? spec.text;
  const wait = async (fn, ms = maxWaitMs) => {
    const t0 = Date.now();
    for (;;) { const l = await fn(); if (l) return l; if (Date.now() - t0 > ms) return null; await sleep(250); }
  };
  const loc = await wait(async () => {
    if (SELECTOR.test(spec)) return first(page.locator(spec));
    const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // exact names first ("Yearly" must be the Yearly button, not a banner link that mentions it), then substrings
    for (const re of [new RegExp(`^\\s*${esc}\\s*$`, 'i'), new RegExp(esc, 'i')]) {
      const hit = (await first(page.getByRole('button', {name: re}))) ?? (await first(page.getByRole('link', {name: re}))) ?? (await first(page.getByRole('tab', {name: re}))) ?? (await first(page.getByText(re)));
      if (hit) return hit;
    }
    return null;
  });
  if (!loc) throw new Error(`could not find a visible element for "${spec}" on ${page.url()}`);
  return loc;
}

let menuTried = false;
/** On a phone the nav often hides behind a hamburger: open it (a real, logged tap) when a target is not visible. */
async function findMenuButton() {
  const sel = 'button[aria-label*="menu" i], button[aria-label*="navigation" i], [aria-controls*="menu" i], [aria-controls*="nav" i], button[class*="burger" i], button[class*="menu" i], [class*="hamburger" i], [class*="menu-toggle" i], header button:has(svg):not(:has-text("a"))';
  const loc = page.locator(sel);
  const n = await loc.count();
  for (let i = 0; i < Math.min(n, 8); i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
  return null;
}

const locateQuick = async (spec) => {
  try { return await locate(spec, 350); } catch { return null; }
};

/** Find the element and bring it into view. `deadlineMs` (narration clock): scroll no slower than needed to make it. */
async function target(spec, deadlineMs) {
  const tr = (m) => process.env.DOLLY_TRACE && log(`  [trace] target(${typeof spec === 'string' ? spec : '…'}) ${m} at ${T0 ? nowMs() : '-'} ms`);
  tr('start');
  await waitLoaded(5000);
  tr('loaded');
  let loc;
  if (MOBILE && typeof spec === 'string') {
    // quick look first; if the element is not there, try the hamburger menu once per page, then the full wait
    try { loc = await locateQuick(spec); } catch { loc = null; }
    if (!loc) {
      const mb = await findMenuButton();
      if (mb) { log('  (opening the menu)'); await click(mb); await sleep(500); }
    }
  }
  loc ??= await locate(spec);
  tr('located');
  let b = await loc.boundingBox();
  // not comfortably in view: scroll with the wheel (logged), not a jump
  // (an element in a fixed or sticky header is already where it will be: scrolling would only waste time and move the page)
  const pinned = await loc.evaluate((el) => { for (let e = el; e; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return true; } return false; }).catch(() => false);
  const inView = b.y >= 0 && b.y + b.height <= VH;
  if (!(pinned && inView) && (b.y < 70 || b.y + b.height > VH - 70)) {
    const dy = Math.round(b.y + b.height / 2 - VH * 0.42);
    if (deadlineMs == null) await moveTo(Math.max(40, Math.min(VW - 40, cx)), Math.max(60, Math.min(VH - 60, cy)));
    const natural = scrollMs(dy);
    // paced: no detour for the mouse (a wheel works wherever the pointer is) and a scroll only as slow as the time allows
    await scrollBy(dy, deadlineMs == null || FAST ? natural : Math.max(300, Math.min(natural, deadlineMs - nowMs())));
    await sleep(deadlineMs == null ? M.pacing.holdSmallMs * 0.5 : 60);
    b = await loc.boundingBox();
  }
  const text = ((await loc.innerText().catch(() => '')) + ' ' + ((await loc.getAttribute('href').catch(() => '')) ?? '')).trim();
  const bad = avoid.find((r) => r.test(text));
  if (bad) throw new Error(`refusing to touch "${text.slice(0, 60)}" (matches avoid ${bad})`);
  const x = b.x + b.width * rnd(0.4, 0.6), y = b.y + b.height * rnd(0.42, 0.58);
  return {x, y, box: b, text, loc, fx: (x - b.x) / b.width, fy: (y - b.y) / b.height};
}

async function afterNav(quick = false) {
  await page.waitForLoadState('domcontentloaded', {timeout: 15000}).catch(() => {});
  await page.waitForLoadState('load', {timeout: 8000}).catch(() => {});
  await sleep(quick ? 120 : 500);
}

/**
 * Wait until the page is calm: load + network idle, then no running finite CSS/Web animation or transition for 600 ms
 * (looping ones, like a spinner or a marquee, are ignored). Hides intro curtains and reveal-on-load effects from the take.
 */
async function settle(maxMs) {
  await page.waitForLoadState('load', {timeout: maxMs}).catch(() => {});
  await page.waitForLoadState('networkidle', {timeout: Math.min(5000, maxMs)}).catch(() => {});
  const t0 = Date.now();
  let calmSince = null;
  while (Date.now() - t0 < maxMs) {
    const busy = await page.evaluate(() => document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)).catch(() => false);
    if (busy) calmSince = null;
    else if (calmSince === null) calmSince = Date.now();
    else if (Date.now() - calmSince >= 600) break;
    await sleep(100);
  }
  if (Date.now() - t0 >= maxMs) log(`page still animating after ${maxMs} ms, continuing`);
  await waitLoaded(Math.min(5000, maxMs));
}

/** '' when nothing in the viewport looks like it is loading, else why. */
async function loadingReason() {
  return page.evaluate(() => {
      const vh = innerHeight, vw = innerWidth;
      const inView = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
      };
      const loading = '[aria-busy="true"], [class*="skeleton" i], [class*="shimmer" i], [class*="placeholder" i], [class*="spinner" i], [class*="loading" i], [data-loading="true"], [role="progressbar"]';
      for (const el of document.querySelectorAll(loading)) {
        if (el.matches('input, textarea')) continue; // placeholder classes on inputs are not loading states
        if (inView(el)) return 'loading element ' + (el.className?.toString().slice(0, 40) || el.tagName);
      }
      for (const img of document.images) if (inView(img) && !(img.complete && img.naturalWidth > 0) && img.loading !== 'lazy') return 'image ' + (img.currentSrc || img.src).slice(-40);
      return '';
  }).catch(() => '');
}

/**
 * Wait (up to maxMs) until nothing in the viewport looks like it is still loading: no visible skeleton / shimmer / placeholder /
 * spinner / aria-busy element, and every image that is in the viewport has loaded. Never throws; a stuck page is logged and the
 * take goes on.
 */
async function waitLoaded(maxMs = 5000) {
  const t0 = Date.now();
  let why = '';
  while (Date.now() - t0 < maxMs) {
    why = await loadingReason();
    if (!why) { await sleep(150); return; }
    await sleep(200);
  }
  log(`still loading after ${maxMs} ms (${why}), continuing`);
}

// ---------------------------------------------------------------- narration clock (Narrate mode)
/** Idle until `ms` on the narration clock. */
async function waitUntil(ms) {
  if (FAST || ms == null || T0 === null) return;
  const ax = cx, ay = cy;
  const drift = false; // the cursor rests still while it waits (a tremor reads as jitter and keeps the idle fade from starting)
  const t0 = performance.now();
  for (;;) {
    const rem = ms - nowMs();
    if (rem <= 3) break;
    if (drift && rem > 250) {
      const k = (performance.now() - t0) / 1000;
      cx = ax + 1.6 * Math.sin(k * 1.3) + 0.9 * Math.sin(k * 3.1);
      cy = ay + 1.2 * Math.cos(k * 1.1) + 0.7 * Math.sin(k * 2.7);
      await page.mouse.move(cx, cy);
    }
    await baseSleep(Math.min(rem, 16));
  }
  if (drift) { cx = ax; cy = ay; }
}
const record = (kind, spec, atMs, actualMs, extra = {}) => {
  const lateMs = atMs != null && !FAST ? actualMs - atMs : null;
  timing.push({scene: curScene, kind, target: typeof spec === 'string' ? spec : undefined, atMs: atMs ?? null, actualMs: FAST ? null : actualMs, lateMs, ...extra});
};

// ---- pacing (unpaced scripts): after an action, wait until the visual change is over, then hold long enough to read it
let holdFrom = 0, holdNeed = 0;
async function hold(ms) {
  if (FAST) return;
  const t0 = Date.now();
  let calmSince = null;
  while (Date.now() - t0 < M.pacing.changeMaxMs) { // over = no finite animation or transition running for 150 ms
    const busy = await page.evaluate(() => document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)).catch(() => false);
    if (busy) calmSince = null; else if (calmSince === null) calmSince = Date.now(); else if (Date.now() - calmSince >= 150) break;
    await baseSleep(50);
  }
  holdFrom = Date.now(); holdNeed = ms;
  await sleep(ms);
}
/** An explicit {"wait": ms} means "at least this long after the last action", not extra on top of the automatic hold. */
async function waitAction(ms) {
  if (PACED_SCRIPT || FAST) return sleep(ms);
  const covered = Date.now() - holdFrom <= holdNeed + 60 ? holdNeed : 0;
  return sleep(Math.max(0, ms - covered));
}

async function click(spec, atMs, settleCap) {
  const t = await target(spec, atMs != null && !FAST ? atMs - LEAD - 950 : undefined);
  if (atMs != null && !FAST) {
    // paced: be on the target LEAD ms before the word, press on the word
    const arrive = atMs - LEAD;
    const nat = moveMsFor(Math.hypot(t.x - cx, t.y - cy));
    if (process.env.DOLLY_TRACE) log(`  [trace] target ready at ${nowMs()} ms; move ${Math.round(nat)} ms; arrive ${arrive}; press ${atMs}`);
    await waitUntil(arrive - nat);
    const b2 = await t.loc.boundingBox().catch(() => null); // the page may have shifted while we idled
    if (b2) { t.x = b2.x + b2.width * t.fx; t.y = b2.y + b2.height * t.fy; }
    const remaining = arrive - nowMs();
    await moveTo(t.x, t.y, remaining >= 240 ? Math.min(remaining, nat) : 240);
    await waitUntil(atMs - 20);
  } else {
    await moveTo(t.x, t.y);
    await sleep(between(M.cursor.settleMs, Math.random()));
  }
  const url = page.url();
  const down = nowMs();
  const downWall = Date.now();
  await page.mouse.down();
  ev.clicks.push({wall: Date.now(), x: t.x, y: t.y, button: 'left', kind: 'down'});
  await sleep(between(M.cursor.pressMs, Math.random()));
  await page.mouse.up();
  ev.clicks.push({wall: Date.now(), x: t.x, y: t.y, button: 'left', kind: 'up'});
  await sleep(atMs != null ? 100 : 250);
  if (page.url() !== url && !FAST) {
    const startWall = downWall; // the shell can appear any time after the press; the frozen frame is taken just before it
    pendingLoads.push((async () => { // when did the shell go away? (not waited for here: the take carries on)
      let clear = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 7000) {
        await baseSleep(70);
        if (Date.now() - startWall < 550) continue;
        if (!(await loadingReason())) { if (++clear >= 2) break; } else clear = 0;
      }
      loadingWins.push({startWall, endWall: Date.now() - 70});
    })());
  }
  if (page.url() !== url) {
    if (atMs != null && settleCap != null) {
      // paced: spend at most until `settleCap` (narration clock) waiting for the new page; the next target is then searched at once
      await Promise.race([afterNav(true), sleep(Math.max(0, settleCap - nowMs()))]);
      const left = settleCap - nowMs();
      if (left > 150) await Promise.race([settle(left), sleep(left)]);
    } else { await afterNav(atMs != null); await settle(2500); }
  }
  if (atMs == null) await hold(page.url() !== url ? M.pacing.holdPageMs : M.pacing.holdSmallMs);
  log(`  click "${t.text.slice(0, 40)}" at ${Math.round(t.x)},${Math.round(t.y)}${atMs != null && !FAST ? ` (planned ${atMs} ms, pressed ${down} ms)` : ''}`);
  if (atMs !== undefined || !String(spec?.constructor?.name).includes('Locator')) record('click', spec, atMs, down, {matched: t.text.slice(0, 80), url: page.url()});
}

async function hover(spec, atMs) {
  const t = await target(spec, atMs != null && !FAST ? atMs - LEAD - 950 : undefined);
  if (atMs != null && !FAST) {
    const arrive = atMs - LEAD;
    const nat = moveMsFor(Math.hypot(t.x - cx, t.y - cy));
    await waitUntil(arrive - nat);
    const b2 = await t.loc.boundingBox().catch(() => null);
    if (b2) { t.x = b2.x + b2.width * t.fx; t.y = b2.y + b2.height * t.fy; }
    const remaining = arrive - nowMs();
    await moveTo(t.x, t.y, remaining >= 240 ? Math.min(remaining, nat) : 240);
    await waitUntil(atMs);
  } else {
    await moveTo(t.x, t.y);
    await sleep(450);
  }
  record('hover', spec, atMs, nowMs(), {matched: t.text.slice(0, 80)});
}

const MODS = {meta: ['cmd', '⌘'], cmd: ['cmd', '⌘'], command: ['cmd', '⌘'], shift: ['shift', '⇧'], control: ['ctrl', '⌃'], ctrl: ['ctrl', '⌃'], alt: ['alt', '⌥'], option: ['alt', '⌥']};
async function press(combo, atMs) {
  await waitUntil(atMs);
  record('press', combo, atMs, nowMs());
  const parts = combo.split('+');
  const key = parts.pop();
  const mods = parts.map((p) => MODS[p.toLowerCase()]).filter(Boolean);
  const entry = {wall: Date.now(), mods: mods.map((m) => m[0])};
  if (mods.length) entry.label = mods.map((m) => m[1]).join('') + (key.length === 1 ? key.toUpperCase() : key);
  ev.keys.push(entry);
  await page.keyboard.press(combo);
  await sleep(200);
}

// Typing: keystrokes are logged as timing only. The characters are never stored in the events.
async function type(text, into, atMs) {
  if (into) await click(into, atMs != null ? atMs - 500 : undefined);
  await waitUntil(atMs);
  record('type', undefined, atMs, nowMs(), {chars: text.length});
  for (const ch of text) {
    ev.keys.push({wall: Date.now(), mods: []});
    await page.keyboard.type(ch);
    await sleep(rnd(45, 115) + (/[ .,]/.test(ch) ? rnd(0, 60) : 0));
  }
  await sleep(300);
}

// Per-action `mobile` override: an action object (replaces it), an array of actions (replaces it with a sequence), or false/null
// (skip it on a phone). Scenes may also give `mobileActions` for the whole scene.
function expand(actions) {
  const out = [];
  for (const a of actions ?? []) {
    if (MOBILE && 'mobile' in a) {
      const m = a.mobile;
      if (m === false || m === null) continue;
      out.push(...(Array.isArray(m) ? m : [m]));
    } else out.push(a);
  }
  return out;
}

async function runAction(a) {
  const n0 = timing.length;
  await runAction0(a);
  if (a.wordMs != null) for (let i = n0; i < timing.length; i++) if (timing[i].atMs != null) timing[i].wordMs = a.wordMs;
}
async function runAction0(a) {
  if ('click' in a) return click(a.click, a.atMs, a.settleMs);
  if ('hover' in a) return hover(a.hover, a.atMs);
  if ('type' in a) return type(a.type, a.into, a.atMs);
  if ('press' in a) return press(a.press, a.atMs);
  if ('scroll' in a) {
    await waitUntil(a.atMs);
    record('scroll', undefined, a.atMs, nowMs(), {dy: a.scroll, ms: a.ms ?? null, _ambient: a._ambient ?? false});
    await scrollBy(a.scroll, a.ms);
    if (a.atMs == null && !PACED_SCRIPT) { holdFrom = Date.now(); holdNeed = M.pacing.holdSmallMs; await sleep(holdNeed); }
    return;
  }
  if ('wait' in a) return waitAction(a.wait);
  if ('goto' in a) {
    await waitUntil(a.atMs);
    record('goto', a.goto, a.atMs, nowMs());
    await page.goto(new URL(a.goto, BASE).href, {waitUntil: 'domcontentloaded'});
    return afterNav();
  }
  throw new Error(`unknown action ${JSON.stringify(a)}`);
}

// ---------------------------------------------------------------- silent warm-up (before anything is recorded)
// Visit every page the script touches in this same browser context, hovering and clicking the targets, so images, data and
// scripts are cached and no loading skeleton is on camera. Fast, unpaced, nothing logged. Then back to the start URL.
if (!CHECK && script.warm !== false && script.paced === true) {
  FAST = true;
  log('warm-up: visiting every page of the script off camera');
  try {
    await page.goto(BASE, {waitUntil: 'domcontentloaded'});
    await afterNav(true);
    await settle(6000);
    for (const sc of script.scenes ?? []) {
      for (const a of expand(MOBILE && sc.mobileActions ? sc.mobileActions : sc.actions)) {
        if ('scroll' in a || 'wait' in a) continue;
        try { await runAction({...a, atMs: undefined}); await waitLoaded(4000); } catch (e) { log(`  warm-up: ${e.message}`); }
      }
    }
  } catch (e) { log(`warm-up failed (${e.message}), continuing`); }
  FAST = false;
  ev.cursor.length = 0; ev.clicks.length = 0; ev.keys.length = 0; ev.scroll.length = 0;
  timing.length = 0; curScene = 0;
  await page.goto('about:blank');
  await page.evaluate((t) => { document.title = t; document.body.style.background = '#fff'; }, token);
}

const flashes = {};
if (backend === 'none') { /* --check */ } else if (backend === 'window') {
  const win = await findWindow(token);
  log(`window ${win.id} (${win.app}) ${win.w}x${win.h} pt`);
  recorder = new WindowRecorder(win.id, path.join(tmp, 'win'), FPS);
  await recorder.started;
  await sleep(600);
  flashes.startOn = await flash(true);
  await sleep(450);
  flashes.startOff = await flash(false);
  await sleep(300);
} else {
  screencast = new Screencast(page, path.join(tmp, 'frames'), {width: VW * DSF, height: VH * DSF});
  await screencast.start();
}

// ---------------------------------------------------------------- the take
await page.goto(BASE, {waitUntil: 'domcontentloaded'});
await afterNav();
await settle(12000);
if (MOBILE) { const got = await page.evaluate(() => ({w: innerWidth, h: innerHeight})); if (got.w !== VW) log(`WARNING: the page lays out at ${got.w} CSS px wide (wanted ${VW}); it may have no viewport meta tag`); }
await sleep(script.settleMs ?? 400);
T0 = Date.now();
const PACED = script.paced === true;
if (!PACED && !CHECK) await sleep(script.leadMs ?? M.pacing.leadInMs); // a calm first second
const scenes = [];
let failed = null;
try {
  for (const [n, sc] of (script.scenes ?? []).entries()) {
    const startWall = Date.now();
    log(`scene ${n + 1}: ${sc.goal ?? ''}`);
    curScene = n + 1;
    for (const a of expand(MOBILE && sc.mobileActions ? sc.mobileActions : sc.actions)) {
      if (!CHECK) await runAction(a);
      else { // --check: carry on after a miss so every missing target is reported in one go
        try { await runAction(a); } catch (e) { record('error', undefined, null, 0, {action: a, error: e.message}); log(`  MISSING: ${e.message}`); }
      }
    }
    await waitLoaded(5000);
    // dwell so the narration line can be read (about 0.3 s a word)
    const words = (sc.narration ?? '').trim().split(/\s+/).filter(Boolean).length;
    const need = PACED ? 0 : sc.minMs ?? (words ? 900 + words * 300 : 0);
    const spent = Date.now() - startWall;
    if (spent < need) await sleep(need - spent);
    scenes.push({goal: sc.goal ?? '', narration: sc.narration ?? '', startWall, endWall: Date.now()});
  }
  if (PACED && script.endMs && !CHECK) await waitUntil(script.endMs); else await sleep(script.tailMs ?? M.pacing.leadOutMs); // a calm last second
} catch (e) {
  failed = e;
  log(`FAILED in scene ${scenes.length + 1}: ${e.message}`);
  try { await page.screenshot({path: path.join(outDir, 'failure.png')}); } catch {}
}
const T1 = Date.now();
clearInterval(sampler);
await Promise.all(pendingLoads);

if (CHECK) { // ---- --check: report and stop, nothing was recorded
  const miss = timing.filter((t) => t.kind === 'error');
  const report = {ok: !failed && !miss.length, url: BASE, mobile: MOBILE, finalUrl: page.url(), problems: miss.map((m) => ({scene: m.scene, action: m.action, error: m.error})), actions: timing};
  fs.writeFileSync(path.join(outDir, MOBILE ? 'check-mobile.json' : 'check.json'), JSON.stringify(report, null, 2));
  await shutdown();
  console.log(`check ${MOBILE ? '(phone) ' : ''}${report.ok ? 'OK' : 'PROBLEMS'}: ${timing.length - miss.length} action(s) ran, ${miss.length} problem(s)`);
  for (const t of timing) if (t.matched !== undefined) console.log(`  scene ${t.scene} ${t.kind} "${t.target}" -> "${t.matched}"`);
  for (const m of miss) console.log(`  scene ${m.scene} FAILED ${JSON.stringify(m.action)}: ${m.error}`);
  process.exit(report.ok ? 0 : 2);
}

// ---------------------------------------------------------------- finish capture
const ms2 = (w, t0, scale) => Math.round((w - t0) * scale);
let toVideoMs; // wall ms -> ms in recording.mp4 (t=0 at T0)
if (backend === 'window') {
  await sleep(250);
  flashes.endOn = await flash(true);
  await sleep(450);
  flashes.endOff = await flash(false);
  await sleep(300);
  const raw = await recorder.stop();
  await shutdown();
  if (!fs.existsSync(raw)) die('the recorder wrote no recording.mov');
  const fl = analyseFlashes(raw, flashes, FPS, {w: VW * DSF, h: VH * DSF});
  log(`viewport rect ${fl.rect.w}x${fl.rect.h} at ${fl.rect.x},${fl.rect.y}; rate ${fl.rate.toFixed(4)}; flash length error ${fl.flashLenErrMs} ms`);
  if (Math.abs(fl.rate - 1) > 0.02) log(`WARNING: video/wall rate ${fl.rate.toFixed(4)} is off, timing may drift`);
  const from = fl.toVideoSec(T0), dur = (T1 - T0) / 1000 * fl.rate;
  cutToMp4(raw, path.join(outDir, 'recording.mp4'), {rect: fl.rect, fromSec: from, durSec: dur, fps: FPS});
  if (flags['keep-raw']) fs.copyFileSync(raw, path.join(outDir, 'raw-window.mov'));
  toVideoMs = (w) => Math.round((fl.toVideoSec(w) - from) * 1000);
} else {
  await screencast.stop();
  await shutdown();
  screencast.build(path.join(outDir, 'recording.mp4'), T0, T1, FPS);
  toVideoMs = (w) => Math.round(w - T0);
}

// ---------------------------------------------------------------- events.json + scenes.json
const sz = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(outDir, 'recording.mp4')], {encoding: 'utf8'}).stdout.trim().split(',').map(Number);
const [W, H] = sz;
const S = W / VW; // video pixels per CSS pixel
const r1 = (n) => Math.round(n * 10) / 10;
const dur = toVideoMs(T1);
const inRange = (t) => t >= 0 && t <= dur;
const events = {
  version: 1, video: 'recording.mp4', width: W, height: H, fps: FPS, durationMs: dur, pointScale: S,
  cursor: ev.cursor.map(([w, x, y]) => [toVideoMs(w), r1(x * S), r1(y * S)]).filter((c) => inRange(c[0])),
  clicks: ev.clicks.map((c) => ({tMs: toVideoMs(c.wall), x: r1(c.x * S), y: r1(c.y * S), button: c.button, kind: c.kind})).filter((c) => inRange(c.tMs)),
  loading: loadingWins.map((w) => ({startMs: Math.max(0, toVideoMs(w.startWall)), endMs: Math.min(dur, toVideoMs(w.endWall))})).filter((w) => w.endMs > w.startMs),
  keys: ev.keys.map((k) => ({tMs: toVideoMs(k.wall), mods: k.mods, ...(k.label ? {label: k.label} : {})})).filter((k) => inRange(k.tMs)),
  scroll: ev.scroll.map((s) => ({tMs: toVideoMs(s.wall), dy: s.dy})).filter((s) => inRange(s.tMs)),
};
fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify(events));
fs.writeFileSync(path.join(outDir, 'scenes.json'), JSON.stringify(scenes.map((s) => ({goal: s.goal, narration: s.narration, startMs: Math.max(0, toVideoMs(s.startWall)), endMs: Math.min(dur, toVideoMs(s.endWall))})), null, 2));
fs.copyFileSync(pos[0], path.join(outDir, 'script.json'));
if (timing.length) fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify(timing.map((t) => ({...t, atMs: t.atMs, actualMs: t.actualMs})), null, 2));
{ const late = timing.filter((t) => t.lateMs != null && t.lateMs > 250); if (late.length) log(`WARNING: ${late.length} action(s) landed more than 250 ms late: ${late.map((t) => `${t.kind} ${t.target ?? ''} +${t.lateMs} ms`).join('; ')}`); }
console.log(`recorded ${outDir}: ${(dur / 1000).toFixed(1)} s, ${W}x${H}, ${events.cursor.length} cursor samples, ${events.clicks.length / 2} clicks, ${events.keys.length} keys, ${events.scroll.length} scroll events`);
if (failed) { console.error(`take incomplete: ${failed.message}`); process.exit(2); }
process.exit(0);
