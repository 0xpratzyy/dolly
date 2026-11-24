#!/usr/bin/env node
// Motion metrics of a video file: duplicate frames inside motion (judder), uneven frame-to-frame change, freezes.
//   node scripts/motion-video.mjs <video> [--crop w:h:x:y] [--from s] [--to s] [--series out.csv] [--json]
// How: every frame is decoded at 320 px wide (gray) and compared with the one before. d[i] = mean absolute difference (0..255).
//   moving frame    d > MOVE in the frame itself or a neighbour within 2 frames (so a still screen is not counted as judder)
//   duplicate       a moving-window frame whose d < DUP (the picture did not change although things are moving)
//   judder index    median over moving frames of |d[i]-d[i-1]| / (d[i]+d[i-1]): 0 = even motion, 1 = every other frame repeated
//   longest run     most consecutive duplicates inside motion (2+ at 60 fps is a visible hitch)
import {spawnSync} from 'node:child_process';
const argv = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; else pos.push(a); }
if (!pos[0]) { console.error('usage: node scripts/motion-video.mjs <video> [--crop w:h:x:y] [--from s] [--to s] [--series out.csv] [--json]'); process.exit(1); }
const MOVE = Number(flags.move ?? 0.35), DUP = Number(flags.dup ?? 0.06);
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', pos[0]], {encoding: 'utf8'}).stdout.trim().split(',');
const [n0, n1] = probe[2].split('/').map(Number);
const fps = n0 / (n1 || 1);
const sw = 320, sh = Math.round((320 * (flags.crop ? Number(flags.crop.split(':')[1]) / Number(flags.crop.split(':')[0]) : probe[1] / probe[0])) / 2) * 2;
const vf = `${flags.crop ? `crop=${flags.crop},` : ''}scale=${sw}:${sh}:flags=area,format=gray`;
const r = spawnSync('ffmpeg', ['-v', 'error', ...(flags.from ? ['-ss', flags.from] : []), ...(flags.to ? ['-to', flags.to] : []), '-i', pos[0], '-vf', vf, '-f', 'rawvideo', '-'], {maxBuffer: 2 ** 31 - 1});
if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1); }
const b = r.stdout, fb = sw * sh, n = Math.floor(b.length / fb);
const d = new Float64Array(n);
for (let f = 1; f < n; f++) { let s = 0; const o = f * fb, p = o - fb; for (let i = 0; i < fb; i++) s += Math.abs(b[o + i] - b[p + i]); d[f] = s / fb; }
const moving = new Uint8Array(n);
for (let f = 1; f < n; f++) if (d[f] > MOVE) for (let k = Math.max(1, f - 2); k <= Math.min(n - 1, f + 2); k++) moving[k] = 1;
let nMove = 0, nDup = 0, run = 0, longest = 0, hitches = 0;
const ratios = [];
for (let f = 1; f < n; f++) {
  if (!moving[f]) { run = 0; continue; }
  nMove++;
  if (d[f] < DUP) { nDup++; run++; if (run === 2) hitches++; longest = Math.max(longest, run); } else run = 0;
  if (moving[f - 1] && d[f] + d[f - 1] > 2 * MOVE) ratios.push(Math.abs(d[f] - d[f - 1]) / (d[f] + d[f - 1]));
}
ratios.sort((x, y) => x - y);
const q = (p) => (ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))] : 0);
const out = {file: pos[0], fps, frames: n, movingFrames: nMove, duplicateInMotion: nDup, duplicatePct: nMove ? +(100 * nDup / nMove).toFixed(1) : 0, longestDuplicateRun: longest, hitches, judderMedian: +q(0.5).toFixed(3), judderP90: +q(0.9).toFixed(3)};
if (flags.series) { const fs = await import('node:fs'); fs.writeFileSync(flags.series, 'frame,t,d,moving\n' + Array.from(d, (v, i) => `${i},${(i / fps).toFixed(4)},${v.toFixed(4)},${moving[i]}`).join('\n')); }
if (flags.json) console.log(JSON.stringify(out));
else console.log(`${pos[0]}\n  ${n} frames @${fps.toFixed(2)} fps, ${nMove} in motion; duplicates in motion ${nDup} (${out.duplicatePct}%), longest run ${longest}, hitches (2+ repeats) ${hitches}; judder index median ${out.judderMedian}, p90 ${out.judderP90}`);
