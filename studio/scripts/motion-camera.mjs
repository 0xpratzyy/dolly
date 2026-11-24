#!/usr/bin/env node
// Camera / cursor / pacing metrics of a plan, exactly as the renderer would play it (same buildTimeline).
//   node scripts/motion-camera.mjs <recording-dir | plan.json> [--style preset|file.json] [--set a.b=v ...] [--csv out.csv] [--json]
// Prints, in OUTPUT time (what the viewer sees), per axis in canvas px:
//   camera   peak speed (px/s), peak acceleration (px/s^2), peak jerk (px/s^3), zoom rate (1/s, log scale), quick direction reversals
//   zooms    how long each ease really lasts on screen, when the zoom lands relative to the click, when the pull-out starts
//   cursor   peak and median on-screen speed, teleports (> 1/3 of the frame in one frame), time on target before each click
//   pacing   speed-ups (and what they do to a camera ease), hold after the last action, first / last calm second
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = {}, sets = [], pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--set') sets.push(argv[++i]); else if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; else pos.push(a); }
if (!pos[0]) { console.error('usage: node scripts/motion-camera.mjs <recording-dir | plan.json> [--style ..] [--set a.b=v] [--csv out.csv] [--json]'); process.exit(1); }
const planPath = fs.statSync(pos[0]).isDirectory() ? path.join(pos[0], 'plan.json') : pos[0];
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const {buildTimeline} = await import(path.join(here, '../src/camera.ts'));
const {mergeStyle, defaultStyle, stylePresets} = await import(path.join(here, '../src/types.ts'));
let preset = {};
if (flags.style) preset = stylePresets[flags.style] ?? JSON.parse(fs.readFileSync(flags.style, 'utf8'));
const over = {};
for (const s of sets) { const [k, ...rest] = s.split('='); let v = rest.join('='); try { v = JSON.parse(v); } catch {} const parts = k.split('.'); let o = over; parts.slice(0, -1).forEach((q) => (o = o[q] ??= {})); o[parts.at(-1)] = v; }
const style = mergeStyle(defaultStyle, plan.style, preset, over);
const fps = plan.source.fps;
const tl = buildTimeline(plan, style, fps);
const F = tl.frames, n = F.length, L = tl.layout, dt = 1 / fps;
const W = plan.source.width;
// on-screen quantities, canvas px
const k = F.map((f) => L.content.w / f.vw);
const z = F.map((f) => Math.max(...F.map((g) => g.vw)) / f.vw);
const camX = F.map((f, i) => (f.vx + f.vw / 2) * k[i]), camY = F.map((f, i) => (f.vy + f.vh / 2) * k[i]);
// pan as the viewer sees it: how far the picture slides per frame at the current scale
const slide = (i, ax) => (i === 0 ? 0 : ((ax === 'x' ? F[i].vx + F[i].vw / 2 - F[i - 1].vx - F[i - 1].vw / 2 : F[i].vy + F[i].vh / 2 - F[i - 1].vy - F[i - 1].vh / 2)) * k[i]);
const vx = F.map((_, i) => slide(i, 'x') / dt), vy = F.map((_, i) => slide(i, 'y') / dt);
const vz = z.map((v, i) => (i ? Math.log(v / z[i - 1]) / dt : 0)); // zoom rate, 1/s (log scale: 0.69 = doubling per second)
const diff = (a) => a.map((v, i) => (i ? (v - a[i - 1]) / dt : 0));
const ax = diff(vx), ay = diff(vy), az = diff(vz), jx = diff(ax), jy = diff(ay), jz = diff(az);
const peak = (a) => { let m = 0, at = 0; a.forEach((v, i) => { if (Math.abs(v) > m) { m = Math.abs(v); at = i; } }); return {v: m, t: at / fps}; };
const sp = F.map((_, i) => Math.hypot(vx[i], vy[i]));
const acc = F.map((_, i) => Math.hypot(ax[i], ay[i]));
const jerk = F.map((_, i) => Math.hypot(jx[i], jy[i]));
// reversals: the pan (or the zoom) flips direction within half a second of moving the other way (re-targeting jitter / overshoot).
// A pull-out seconds after a push-in is not a reversal.
const reversals = (a, eps) => { let c = 0, last = 0, lastAt = -1e9; a.forEach((v, i) => { const s = Math.abs(v) < eps ? 0 : Math.sign(v); if (s && last && s !== last && (i - lastAt) / fps < 0.5) c++; if (s) { last = s; lastAt = i; } }); return c; };
// source ms -> output s
const toOut = (ms) => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (F[mid].src >= ms) hi = mid; else lo = mid + 1; } return lo / fps; };
// zoom segments as seen: runs where |vz| > eps
const moves = [];
for (let i = 1, s = -1; i <= n; i++) {
  const on = i < n && Math.abs(vz[i]) > 0.01;
  if (on && s < 0) s = i;
  if (!on && s >= 0) { moves.push({from: s / fps, to: i / fps, ms: Math.round((i - s) * 1000 / fps), dir: z[i - 1] > z[s - 1] ? 'in' : 'out', z0: +z[s - 1].toFixed(2), z1: +z[i - 1].toFixed(2), peakRate: +Math.max(...vz.slice(s, i).map(Math.abs)).toFixed(2)}); s = -1; }
}
// cursor on screen (canvas px)
const cur = F.map((f, i) => [(f.cx - f.vx) * k[i], (f.cy - f.vy) * k[i]]);
const cs = cur.map((c, i) => (i ? Math.hypot(c[0] - cur[i - 1][0], c[1] - cur[i - 1][1]) / dt : 0));
const csSrc = F.map((f, i) => (i ? Math.hypot(f.cx - F[i - 1].cx, f.cy - F[i - 1].cy) * (L.content.w / W) / dt : 0)); // page-space speed at 1x
const movingCs = csSrc.filter((v) => v > 30).sort((a, b) => a - b);
const teleports = cs.filter((v) => v * dt > L.content.w / 3).length;
const clicks = plan.clicks.map((c) => {
  const t = toOut(c.tMs), i = Math.round(t * fps);
  let j = i; while (j > 0 && Math.hypot(F[j - 1].cx - c.x, F[j - 1].cy - c.y) < 6 * plan.source.pointScale) j--;
  const inMove = moves.filter((m) => m.dir === 'in' && m.from <= t + 0.05).at(-1);
  const zoomingAtClick = Math.abs(vz[Math.min(n - 1, i)]) > 0.01;
  return {t: +t.toFixed(2), settleBeforePressMs: Math.round((i - j) * 1000 / fps), zoomAtClick: +z[Math.min(n - 1, i)].toFixed(2), zoomStillMoving: zoomingAtClick, zoomLandedMsBeforeClick: inMove ? Math.round((t - inMove.to) * 1000) : null, cursorSpeedIntoClick: Math.round(Math.max(...csSrc.slice(Math.max(0, i - 6), i + 1)))};
});
const speedSegs = (style.idleSpeedup ? plan.speed : []).map((s) => ({outFrom: +toOut(s.startMs).toFixed(2), srcMs: s.endMs - s.startMs, speed: s.cut ? 'cut' : s.speed, cameraMovesInside: moves.filter((m) => m.from < toOut(s.endMs) && m.to > toOut(s.startMs)).length}));
const lastAction = Math.max(0, ...plan.clicks.map((c) => c.tMs), ...plan.keys.map((c) => c.tMs));
const firstAction = Math.min(...plan.clicks.map((c) => c.tMs), ...plan.keys.map((c) => c.tMs), plan.source.durationMs);
const firstMove = F.findIndex((_, i) => sp[i] > 20 || Math.abs(vz[i]) > 0.01 || csSrc[i] > 30);
let lastMove = n - 1; while (lastMove > 0 && !(sp[lastMove] > 20 || Math.abs(vz[lastMove]) > 0.01 || csSrc[lastMove] > 30)) lastMove--;
const r0 = (v) => Math.round(v);
const out = {
  frames: n, seconds: +(n / fps).toFixed(2), canvas: `${L.canvasW}x${L.canvasH}`,
  camera: {
    peakPanSpeed: r0(peak(sp).v), peakPanSpeedAt: +peak(sp).t.toFixed(2), peakPanAccel: r0(peak(acc).v), peakPanJerk: r0(peak(jerk).v), peakPanJerkAt: +peak(jerk).t.toFixed(2),
    peakZoomRate: +peak(vz).v.toFixed(2), peakZoomAccel: +peak(az).v.toFixed(1), peakZoomJerk: r0(peak(jz).v), peakZoomJerkAt: +peak(jz).t.toFixed(2),
    panReversals: reversals(vx, 15) + reversals(vy, 15), zoomReversals: reversals(vz, 0.02),
    movingPct: +(100 * sp.filter((v, i) => v > 8 || Math.abs(vz[i]) > 0.01).length / n).toFixed(0),
  },
  zoomMoves: moves,
  clicks,
  cursor: {peakSpeedOnScreen: r0(Math.max(...cs)), peakSpeedPage: r0(Math.max(...csSrc)), medianSpeedPageWhileMoving: r0(movingCs[movingCs.length >> 1] ?? 0), teleports, movingPct: +(100 * movingCs.length / n).toFixed(0)},
  pacing: {speedSegs, firstMotionAt: +(firstMove / fps).toFixed(2), firstActionAt: +toOut(firstAction).toFixed(2), holdAfterLastActionS: +(n / fps - toOut(lastAction)).toFixed(2), calmTailS: +((n - 1 - lastMove) / fps).toFixed(2)},
};
if (flags.csv) fs.writeFileSync(flags.csv, 't,src,zoom,camX,camY,panSpeed,panAccel,panJerk,zoomRate,cursorX,cursorY,cursorSpeed\n' + F.map((f, i) => [(i / fps).toFixed(4), f.src.toFixed(1), z[i].toFixed(4), camX[i].toFixed(2), camY[i].toFixed(2), sp[i].toFixed(1), acc[i].toFixed(0), jerk[i].toFixed(0), vz[i].toFixed(4), cur[i][0].toFixed(1), cur[i][1].toFixed(1), cs[i].toFixed(1)].join(',')).join('\n'));
if (flags.json) console.log(JSON.stringify(out)); else console.log(JSON.stringify(out, null, 1).replace(/\n\s{3,}/g, ' '));
