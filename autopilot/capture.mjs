// Video capture for the driver. Two backends:
//   window:     `dolly-record --window <id>` records only the driven Chromium window (ScreenCaptureKit, needs Screen Recording
//               permission). A full-viewport #ff00ff flash at the start and the end of the take gives (1) the viewport rectangle
//               to crop to and (2) a linear wall-clock -> video-time map (two points: offset + rate).
//   screencast: CDP Page.startScreencast frames -> mp4. Needs no permission; frames carry wall-clock timestamps, so no flash.
// Both end as `recording.mp4`: viewport only, 60 fps constant frame rate, t=0 at the first scene. Both are REAL-TIME captures (the
// fallback for real apps and pages that need a visible window); the default for autopilot takes is smooth.mjs (virtual time).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RECORDER = process.env.DOLLY_RECORD ?? path.resolve(here, '../recorder/.build/release/dolly-record');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function recorderStatus() {
  if (!fs.existsSync(RECORDER)) return {ok: false, why: `no recorder at ${RECORDER} (swift build -c release in recorder/)`};
  const r = spawnSync(RECORDER, ['--check'], {encoding: 'utf8'});
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return {ok: /Screen Recording:\s+granted/i.test(out), why: out.trim()};
}

/** Id of the window whose title contains `token` (set a unique page title first). */
export async function findWindow(token, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const out = spawnSync(RECORDER, ['--list'], {encoding: 'utf8'}).stdout ?? '';
    for (const line of out.split('\n')) {
      const m = /^\s+(\d+)\s+(\d+)x(\d+)\s+(.+?)\s+"(.*)"\s*$/.exec(line);
      if (m && m[5].includes(token)) return {id: Number(m[1]), w: Number(m[2]), h: Number(m[3]), app: m[4]};
    }
    await sleep(300);
  }
  throw new Error(`no window titled "${token}" found by dolly-record --list`);
}

export class WindowRecorder {
  constructor(windowId, dir, fps = 60) {
    this.dir = dir; this.fps = fps;
    this.proc = spawn(RECORDER, ['--window', String(windowId), '--out', dir, '--fps', String(fps), '--countdown', '0'], {stdio: ['ignore', 'pipe', 'pipe']});
    this.log = '';
    this.exited = new Promise((res) => this.proc.on('exit', (c) => res(c)));
    this.started = new Promise((res, rej) => {
      const onData = (d) => { this.log += d; if (/Recording\. Press/.test(this.log)) res(); };
      this.proc.stdout.on('data', onData); this.proc.stderr.on('data', onData);
      this.exited.then((c) => rej(new Error(`dolly-record exited early (${c}): ${this.log.trim()}`)));
      setTimeout(() => rej(new Error(`dolly-record did not start: ${this.log.trim()}`)), 10000);
    });
  }
  async stop() {
    this.proc.kill('SIGINT');
    const code = await Promise.race([this.exited, sleep(15000).then(() => 'timeout')]);
    if (code === 'timeout') this.proc.kill('SIGKILL');
    return path.join(this.dir, 'recording.mov');
  }
}

// ---------------------------------------------------------------- flash analysis (window backend)
const isMagenta = (r, g, b) => r > 190 && g < 80 && b > 190;

function probeSize(file) {
  const o = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], {encoding: 'utf8'}).stdout.trim().split(',');
  return {w: Number(o[0]), h: Number(o[1])};
}

/** Magenta pixel count per 60 fps frame (resampled by timestamp, so variable-frame-rate input is handled) at 320 px wide. */
function magentaCounts(file, fps) {
  const {w, h} = probeSize(file);
  const k = 160 / Math.max(w, h); // small frames: a long take must fit in the pipe buffer
  const sw = Math.max(2, Math.round((w * k) / 2) * 2), sh = Math.max(2, Math.round((h * k) / 2) * 2);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=${sw}:${sh}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'], {maxBuffer: 1 << 30});
  if (r.status !== 0) throw new Error('ffmpeg could not read the recording');
  const buf = r.stdout, fb = sw * sh * 3, n = Math.floor(buf.length / fb);
  const counts = new Array(n).fill(0);
  for (let f = 0; f < n; f++) {
    let c = 0;
    for (let i = f * fb; i < (f + 1) * fb; i += 3) if (isMagenta(buf[i], buf[i + 1], buf[i + 2])) c++;
    counts[f] = c;
  }
  return counts;
}

function runsOf(counts, minFrames = 4) {
  const max = Math.max(...counts, 1);
  const thr = max * 0.5;
  const runs = [];
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > thr && (i === 0 || counts[i - 1] <= thr)) {
      let j = i; while (j < counts.length && counts[j] > thr) j++;
      if (j - i >= minFrames) runs.push([i, j]);
    }
  }
  return {runs, max};
}

function viewportRect(file, atSec) {
  const {w, h} = probeSize(file);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', atSec.toFixed(3), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 28});
  const b = r.stdout;
  if (b.length < w * h * 3) throw new Error('could not read the flash frame');
  // Rows/columns that are mostly magenta make the viewport. (Chrome's focused address bar draws a thin magenta-ish ring,
  // which a plain bounding box of every magenta pixel would include.)
  const rows = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (isMagenta(b[i], b[i + 1], b[i + 2])) { rows[y]++; cols[x]++; }
  }
  const maxRow = Math.max(...rows), maxCol = Math.max(...cols);
  if (maxRow < 20) throw new Error('no magenta in the flash frame');
  const ys = [], xs = [];
  for (let y = 0; y < h; y++) if (rows[y] > maxRow * 0.6) ys.push(y);
  for (let x = 0; x < w; x++) if (cols[x] > maxCol * 0.6) xs.push(x);
  const x0 = xs[0], x1 = xs[xs.length - 1], y0 = ys[0], y1 = ys[ys.length - 1];
  return {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, videoW: w, videoH: h};
}

/**
 * flashes = {startOn, startOff, endOn, endOff} (wall-clock ms, measured in the page after a paint).
 * Returns {rect, toVideoSec(wallMs), rate, offset}.
 */
export function analyseFlashes(file, flashes, fps, expect) {
  const counts = magentaCounts(file, fps);
  const {runs} = runsOf(counts);
  if (runs.length < 2) throw new Error(`found ${runs.length} flash(es) in the video, need 2 (is the window covered or minimised?)`);
  // start flash = first run, end flash = last run
  const A = runs[0], B = runs[runs.length - 1];
  const midA = (A[0] + A[1]) / 2 / fps, midB = (B[0] + B[1]) / 2 / fps;
  const wA = (flashes.startOn + flashes.startOff) / 2000, wB = (flashes.endOn + flashes.endOff) / 2000;
  const rate = (midB - midA) / (wB - wA);
  const edgeErrMs = Math.abs(((A[1] - A[0]) / fps - (flashes.startOff - flashes.startOn) / 1000) * 1000);
  let rect = viewportRect(file, midA);
  if (expect && Math.abs(rect.w - expect.w) <= 4 && Math.abs(rect.h - expect.h) <= 4) rect = {...rect, w: expect.w, h: expect.h}; // snap to the exact viewport size
  rect.w -= rect.w % 2; rect.h -= rect.h % 2;
  return {rect, rate, toVideoSec: (wallMs) => midA + (wallMs / 1000 - wA) * rate, flashFrames: [A, B], flashLenErrMs: Math.round(edgeErrMs)};
}

/**
 * Variable frame rate -> constant 60 fps without duplicate-frame judder. A window capture delivers 30-50 distinct frames a second with
 * repeats in between; the plain `fps` filter keeps those repeats (a scroll then moves, stops, moves: measured judder index 0.97-0.99).
 * Here the repeats are dropped (at most 4 in a row, so a still screen that then changes is never turned into a slow fade) and the
 * gaps are filled by blending the two real neighbours by timestamp. Only frames that were missing get blended; real frames pass
 * through untouched. It is a repair, not a cure: use `--capture smooth` (virtual time, exact 60 fps) wherever the page allows it.
 */
export const toCfr = (fps, dejudder = true) => (dejudder
  ? `mpdecimate=max=4:hi=2048:lo=1024:frac=0.3,framerate=fps=${fps}:interp_start=0:interp_end=255:scene=100`
  : `fps=${fps}`);

/** Crop to the viewport, cut [fromSec, fromSec+durSec] of video time, 60 fps CFR, write recording.mp4. */
export function cutToMp4(raw, out, {rect, fromSec, durSec, fps = 60, dejudder = true}) {
  const r = spawnSync('ffmpeg', [
    '-y', '-v', 'error', '-ss', fromSec.toFixed(3), '-i', raw, '-t', durSec.toFixed(3),
    '-vf', `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y},${toCfr(fps, dejudder)}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out,
  ], {stdio: 'inherit'});
  if (r.status !== 0) throw new Error('ffmpeg encode failed');
}

// ---------------------------------------------------------------- CDP screencast backend
export class Screencast {
  constructor(page, dir, {width, height}) {
    this.page = page; this.dir = dir; this.size = {width, height};
    this.frames = []; // {file, ts (wall ms)}
    fs.mkdirSync(dir, {recursive: true});
  }
  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', async (ev) => {
      const n = this.frames.length;
      const file = path.join(this.dir, `f${String(n).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(ev.data, 'base64'));
      this.frames.push({file, ts: ev.metadata.timestamp * 1000});
      this.cdp.send('Page.screencastFrameAck', {sessionId: ev.sessionId}).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', {format: 'jpeg', quality: 92, maxWidth: this.size.width, maxHeight: this.size.height, everyNthFrame: 1});
  }
  async stop() { await this.cdp.send('Page.stopScreencast').catch(() => {}); }
  /** Build recording.mp4 covering wall-clock [t0, t1] ms (the frame showing at t0 is held from t0). */
  build(out, t0, t1, fps = 60) {
    const fr = this.frames.filter((f) => f.ts <= t1);
    let start = 0;
    while (start + 1 < fr.length && fr[start + 1].ts <= t0) start++;
    const use = fr.slice(start);
    if (!use.length) throw new Error('screencast produced no frames');
    const list = [];
    use.forEach((f, i) => {
      const a = Math.max(f.ts, t0), b = Math.min(use[i + 1]?.ts ?? t1, t1);
      if (b - a > 0.5) list.push(`file '${f.file}'\nduration ${((b - a) / 1000).toFixed(4)}`);
    });
    list.push(`file '${use[use.length - 1].file}'`);
    const lf = path.join(this.dir, 'list.txt');
    fs.writeFileSync(lf, list.join('\n'));
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lf, '-vf', `framerate=fps=${fps}:interp_start=0:interp_end=255:scene=100,scale=trunc(iw/2)*2:trunc(ih/2)*2`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], {stdio: 'inherit'});
    if (r.status !== 0) throw new Error('ffmpeg encode failed (screencast)');
  }
}
