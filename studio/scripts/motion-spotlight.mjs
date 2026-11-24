#!/usr/bin/env node
// Spotlight camera metrics for one or more captures, as the composition would play them.
//   node scripts/motion-spotlight.mjs <capture dir> [...] [--aspect 3:2] [--layout single] [--loop] [--tilt 9] [--dof 0.6] [--hero f] [--pace 1] [--json]
// Prints: hero width on screen (fraction of the frame, min / median / max), zoom range and reversals, tilt range and how often it
// changes direction (wobble), depth-of-field blur (peak px, share of frames blurred, number of separate blur pulses = pumping),
// camera pan speed peak, and the loop seam (pose difference between the last and the first frame).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { const k = argv[i].slice(2); flags[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; } else pos.push(argv[i]); }
if (!pos.length) { console.error('usage: node scripts/motion-spotlight.mjs <capture dir> [...] [--aspect 3:2] [--loop] ...'); process.exit(1); }
const {buildTimeline} = await import(path.join(here, '../src/remotion/spotlight/timeline.ts'));
const {defaultSpotlightOptions} = await import(path.join(here, '../src/remotion/spotlight/types.ts'));
const items = pos.map((d, i) => ({id: `i${i}`, base: '', meta: JSON.parse(fs.readFileSync(path.join(d, 'spotlight.json'), 'utf8'))}));
const num = (v, d) => (v === undefined || v === 'true' ? d : Number(v));
const o = {...defaultSpotlightOptions, layout: flags.layout ?? (items.length > 1 ? 'carousel' : 'single'), aspect: flags.aspect ?? '3:2', loop: !!flags.loop, tilt: num(flags.tilt, defaultSpotlightOptions.tilt), dof: num(flags.dof, defaultSpotlightOptions.dof), hero: flags.hero ? Number(flags.hero) : undefined, pace: num(flags.pace, 1)};
const tl = buildTimeline(items, o, items[0].meta.fps);
const S = tl.states, n = S.length, fps = tl.fps, u = tl.u;
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const reversals = (a, eps) => { let c = 0, last = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1]; const s = Math.abs(d) < eps ? 0 : Math.sign(d); if (s && last && s !== last) c++; if (s) last = s; } return c; };
const heroW = S.map((s) => { const it = items[s.hero], f = s.items[s.hero].frame, b = it.meta.bbox[Math.min(it.meta.bbox.length - 1, f)]; return ((b ? b[2] : it.meta.image.cssW) * tl.placed[s.hero].s * s.cam.zoom) / tl.W; });
const heroH = S.map((s) => { const it = items[s.hero], f = s.items[s.hero].frame, b = it.meta.bbox[Math.min(it.meta.bbox.length - 1, f)]; return ((b ? b[3] : it.meta.image.cssH) * tl.placed[s.hero].s * s.cam.zoom) / tl.H; });
const blur = S.map((s) => Math.min(24, o.dof * (s.blur ?? s.arrive * 10)) * u);
let pulses = 0; for (let i = 1; i < n; i++) if (blur[i] > 0.6 && blur[i - 1] <= 0.6) pulses++;
const pan = S.map((s) => Math.hypot(s.vel.x, s.vel.y) * fps);
const zoom = S.map((s) => s.cam.zoom), ry = S.map((s) => s.cam.ry), rx = S.map((s) => s.cam.rx), rz = S.map((s) => s.cam.rz);
const a = S[0].cam, b = S[n - 1].cam;
const r2 = (v) => +v.toFixed(2);
const out = {
  frames: n, seconds: r2(n / fps), frame: `${tl.W}x${tl.H}`,
  heroWidthFrac: {min: r2(Math.min(...heroW)), median: r2(med(heroW)), max: r2(Math.max(...heroW))}, heroHeightFracMax: r2(Math.max(...heroH)),
  zoom: {min: r2(Math.min(...zoom)), max: r2(Math.max(...zoom)), reversals: reversals(zoom, 0.0008)},
  tiltDeg: {ryRange: r2(Math.max(...ry) - Math.min(...ry)), rxRange: r2(Math.max(...rx) - Math.min(...rx)), rzRange: r2(Math.max(...rz) - Math.min(...rz)), reversals: reversals(ry, 0.004) + reversals(rx, 0.004), peakDegPerS: r2(Math.max(...ry.map((v, i) => (i ? Math.abs(v - ry[i - 1]) * fps : 0))))},
  dof: {peakPx: r2(Math.max(...blur)), blurredPct: Math.round(100 * blur.filter((v) => v > 0.6).length / n), pulses},
  pan: {peakPxPerS: Math.round(Math.max(...pan)), reversals: reversals(S.map((s) => s.cam.x * s.cam.zoom), 0.05) + reversals(S.map((s) => s.cam.y * s.cam.zoom), 0.05)},
  // the step from the last frame back to the first, next to a normal step just before it (equal = the loop is seamless)
  loopSeam: (() => { const c = S[n - 2].cam, d = (p, q) => Math.hypot((q.x - p.x) * p.zoom, (q.y - p.y) * p.zoom); return {seamStepPx: r2(d(b, a)), stepBeforePx: r2(d(c, b)), dZoom: +(a.zoom - b.zoom).toFixed(4), dTiltDeg: r2(Math.hypot(b.ry - a.ry, b.rx - a.rx)), crossfadeFrames: tl.loopMix}; })(),
};
console.log(flags.json ? JSON.stringify(out) : JSON.stringify(out, null, 1).replace(/\n\s{2,}/g, ' '));
