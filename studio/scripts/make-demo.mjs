#!/usr/bin/env node
// Generates test footage for Dolly: a Playwright walk through https://refs.video recorded as a
// headless video (no cursor is drawn, like the real recorder with showsCursor=false) plus an
// events.json in the format of ../../CONTRACT.md.
//
//   node scripts/make-demo.mjs [name]        -> demo/<name>/recording.mp4 + events.json
//
// Timing alignment (the hard part): Playwright's video starts at page creation, our event log uses
// wall-clock time. To tie the two together we flash the page white for 600 ms (a full-screen overlay)
// once the home page is loaded, find the flash edges in the recorded video with ffmpeg, and shift all
// event times so t=0 is the first frame of the trimmed output video. Accuracy is about one video
// frame (the screencast runs at 25 fps).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? 'refs-tour';
const outDir = path.resolve(here, '..', 'demo', name);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dolly-demo-'));
fs.mkdirSync(outDir, {recursive: true});

const W = 1440, H = 900, OUT_FPS = 30;
const BASE = 'https://refs.video';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const exe = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // easeInOutCubic
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ---- event log (wall-clock ms; converted to video time at the end) ----
const log = {cursor: [], clicks: [], scroll: []};
let cx = 300, cy = 520;

const browser = await chromium.launch({executablePath: exe});
const ctx = await browser.newContext({
  viewport: {width: W, height: H},
  userAgent: UA,
  recordVideo: {dir: tmpDir, size: {width: W, height: H}},
});
const page = await ctx.newPage();
const video = page.video();

async function moveTo(x, y, ms) {
  // A slightly curved path (quadratic Bezier with a perpendicular bow) with eased speed.
  const x0 = cx, y0 = cy;
  const dx = x - x0, dy = y - y0, dist = Math.hypot(dx, dy);
  const bow = Math.min(60, dist * 0.12) * (Math.random() < 0.5 ? -1 : 1);
  const mx = (x0 + x) / 2 + (-dy / (dist || 1)) * bow;
  const my = (y0 + y) / 2 + (dx / (dist || 1)) * bow;
  const start = performance.now();
  for (;;) {
    const t = Math.min(1, (performance.now() - start) / ms);
    const e = easeOut(ease(t) * 0.35 + t * 0.65); // fast start, soft landing
    const px = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * mx + e * e * x;
    const py = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * my + e * e * y;
    await page.mouse.move(px, py);
    log.cursor.push([Date.now(), px, py]);
    cx = px; cy = py;
    if (t >= 1) break;
    await sleep(14);
  }
}

async function center(sel, opts = {}) {
  const loc = typeof sel === 'string' ? page.locator(sel).first() : sel;
  await loc.waitFor({state: 'visible', timeout: 15000});
  const b = await loc.boundingBox();
  return {x: b.x + b.width * (opts.fx ?? 0.5), y: b.y + b.height * (opts.fy ?? 0.5), b};
}

async function click(x, y) {
  await page.mouse.down();
  log.clicks.push({wall: Date.now(), x, y, button: 'left', kind: 'down'});
  await sleep(85);
  await page.mouse.up();
  log.clicks.push({wall: Date.now(), x, y, button: 'left', kind: 'up'});
}

async function moveClick(target, {ms = 750, settle = 140} = {}) {
  const p = typeof target === 'object' && 'x' in target ? target : await center(target);
  await moveTo(p.x, p.y, ms);
  await sleep(settle);
  await click(p.x, p.y);
}

async function scrollBy(total, ms) {
  // Wheel events at ~60 Hz with an eased total, logged one by one.
  const start = performance.now();
  let sent = 0;
  for (;;) {
    const t = Math.min(1, (performance.now() - start) / ms);
    const want = total * ease(t);
    const step = want - sent;
    if (Math.abs(step) >= 1) {
      await page.mouse.wheel(0, step);
      log.scroll.push({wall: Date.now(), dy: Math.round(step)});
      sent += step;
    }
    if (t >= 1) break;
    await sleep(14);
  }
}

async function load(pathname, settle = 1800) {
  await page.waitForLoadState('domcontentloaded');
  await sleep(settle);
}

// ---------------------------------------------------------------- calibration flash
await page.goto(BASE + '/', {waitUntil: 'domcontentloaded'});
await sleep(2500);
await page.mouse.move(cx, cy);
const flash = {};
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = '__flash';
  d.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:2147483647';
  document.body.appendChild(d);
});
flash.onWall = Date.now();
await sleep(650);
await page.evaluate(() => document.getElementById('__flash').remove());
flash.offWall = Date.now();
const T0 = flash.offWall + 160; // output t=0 (wall clock)
await sleep(700);

// ---------------------------------------------------------------- the walk
// Home: a little life, scroll down and back, then Pricing.
await moveTo(520, 430, 900);
await sleep(500);
await moveTo(760, 560, 700);
await scrollBy(1100, 2600);
await sleep(700);
await moveTo(900, 480, 500);
await scrollBy(-1100, 1800);
await sleep(500);
await moveClick('a[href="/pricing"]:visible:has-text("Pricing")', {ms: 950});
await page.waitForURL('**/pricing', {timeout: 15000});
await load('/pricing', 1900);

// Pricing: peek at the cards, then flip Monthly <-> Yearly.
await moveTo(700, 640, 800);
await scrollBy(260, 1100);
await sleep(450);
await scrollBy(-260, 900);
await sleep(300);
const monthly = await center('button:has-text("Monthly")');
await moveClick(monthly, {ms: 850});
await sleep(1700);
const yearly = await center('button:has-text("Yearly")');
await moveClick(yearly, {ms: 600});
await sleep(1600);
await moveTo(1100, 780, 800);
await sleep(700);

// Channels.
await moveClick('a[href="/channels"]:visible:has-text("Channels")', {ms: 1100});
await page.waitForURL('**/channels', {timeout: 15000});
await load('/channels', 2200);
await moveTo(720, 460, 700);
await scrollBy(420, 1400);
await sleep(500);
await scrollBy(-420, 1000);
await sleep(400);
const card = page.locator('a[href^="/channels/"]:visible').first();
const cardPos = await center(card, {fy: 0.45});
await moveClick(cardPos, {ms: 900});
await page.waitForURL(/\/channels\/[^/]+$/, {timeout: 15000});
await load('channel', 2500);
await moveTo(900, 520, 700);
await scrollBy(520, 1700);
await sleep(700);

// MCP / connect.
await scrollBy(-520, 700);
await moveClick('a[href="/connect"]:visible:has-text("MCP")', {ms: 1000});
await page.waitForURL('**/connect', {timeout: 15000});
await load('/connect', 2200);
await moveTo(640, 520, 700);
await scrollBy(600, 1800);
await sleep(1200);
await sleep(300);
const flash2 = {};
await page.evaluate(() => {
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;inset:0;background:#fff;z-index:2147483647";
  document.body.appendChild(d);
  d.id = "__flash2";
});
flash2.onWall = Date.now();
await sleep(650);
await page.evaluate(() => document.getElementById("__flash2").remove());
flash2.offWall = Date.now();
await sleep(500);
const endWall = flash2.onWall - 250; // output ends just before the closing flash

await ctx.close(); // flushes the video
const rawPath = await video.path();
await browser.close();

// ---------------------------------------------------------------- find the flash in the video
if (process.env.KEEP_RAW) fs.copyFileSync(rawPath, process.env.KEEP_RAW);
const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', rawPath, '-vf', 'fps=50,scale=4:4,format=gray', '-f', 'rawvideo', '-'], {maxBuffer: 1 << 28});
const buf = raw.stdout, fpx = 16;
const means = [];
for (let i = 0; i + fpx <= buf.length; i += fpx) {
  let s = 0;
  for (let k = 0; k < fpx; k++) s += buf[i + k];
  means.push(s / fpx);
}
// The video also starts white (blank page before load); the calibration flashes are the 0.3-0.9 s bright runs.
const runs = [];
for (let i = 0; i < means.length; i++) {
  if (means[i] > 215 && (i === 0 || means[i - 1] <= 215)) {
    let j = i; while (j < means.length && means[j] > 150) j++;
    if (j - i >= 15 && j - i <= 45) runs.push([i / 50, j / 50]);
  }
}
if (runs.length < 2) throw new Error("calibration flashes not found in video (" + runs.length + ")");
// Pair a run with a later one whose spacing best matches the wall-clock spacing of our two flashes
// (other white stretches exist, e.g. the blank page at the start).
const wallGap = ((flash2.onWall + flash2.offWall) - (flash.onWall + flash.offWall)) / 2000;
let best = null;
for (let a = 0; a < runs.length; a++) for (let b = a + 1; b < runs.length; b++) {
  const r = ((runs[b][0] + runs[b][1]) - (runs[a][0] + runs[a][1])) / 2 / wallGap;
  if (Math.abs(r - 1) < 0.1 && (!best || Math.abs(r - 1) < best.err)) best = {a, b, err: Math.abs(r - 1)};
}
if (!best) throw new Error("no pair of flashes matches the wall-clock spacing: " + JSON.stringify(runs));
const [[vOn, vOff], [vOn2, vOff2]] = [runs[best.a], runs[best.b]];
const offA = ((vOn - flash.onWall / 1000) + (vOff - flash.offWall / 1000)) / 2;
const midWallA = (flash.onWall + flash.offWall) / 2000, midWallB = (flash2.onWall + flash2.offWall) / 2000;
const midVA = (vOn + vOff) / 2, midVB = (vOn2 + vOff2) / 2;
const rate = (midVB - midVA) / (midWallB - midWallA); // video seconds per wall second (should be ~1)
console.log("flash A video " + vOn.toFixed(2) + "-" + vOff.toFixed(2) + "s, flash B " + vOn2.toFixed(2) + "-" + vOff2.toFixed(2) + "s, wall gap " + (midWallB - midWallA).toFixed(2) + "s vs video gap " + (midVB - midVA).toFixed(2) + "s -> rate " + rate.toFixed(4));
console.log("on/off edge disagreement at A: " + (1000 * ((vOn - flash.onWall / 1000) - (vOff - flash.offWall / 1000))).toFixed(0) + " ms");
const cutStart = midVA + (T0 / 1000 - midWallA) * rate; // video time of output t=0
const durMs = Math.round(endWall - T0);

// ---------------------------------------------------------------- trim + convert
const mp4 = path.join(outDir, 'recording.mp4');
const enc = spawnSync('ffmpeg', [
  '-y', '-v', 'error', '-i', rawPath, '-ss', cutStart.toFixed(3), '-t', ((durMs / 1000) * rate).toFixed(3),
  '-vf', `setpts=(PTS-STARTPTS)/${rate.toFixed(5)},fps=${OUT_FPS}`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
], {stdio: 'inherit'});
if (enc.status !== 0) throw new Error('ffmpeg encode failed');

// ---------------------------------------------------------------- events.json
const t = (wall) => Math.round(wall - T0);
const round1 = (n) => Math.round(n * 10) / 10;
const cursor = log.cursor.filter((c) => c[0] >= T0).map(([w, x, y]) => [t(w), round1(x), round1(y)]);
const events = {
  version: 1,
  video: 'recording.mp4',
  width: W,
  height: H,
  fps: OUT_FPS,
  durationMs: durMs,
  pointScale: 1,
  cursor,
  clicks: log.clicks.filter((c) => c.wall >= T0).map((c) => ({tMs: t(c.wall), x: round1(c.x), y: round1(c.y), button: c.button, kind: c.kind})),
  keys: [],
  scroll: log.scroll.filter((s) => s.wall >= T0).map((s) => ({tMs: t(s.wall), dy: s.dy})),
};
fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify(events));
fs.rmSync(tmpDir, {recursive: true, force: true});
console.log(`wrote ${outDir}: ${(durMs / 1000).toFixed(1)} s, ${cursor.length} cursor samples, ${events.clicks.length / 2} clicks, ${events.scroll.length} scroll events`);
