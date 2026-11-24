#!/usr/bin/env node
// Dolly autopilot, end to end:  script.json -> drive (record) -> plan -> captions from the narration -> render 16:9 + 9:16 -> contact sheets.
// The 9:16 cut is a SECOND take of the same script at a phone viewport (390x693, mobile layout, touch UA), rendered full-frame with
// the cursor hidden and the click ripple as the tap indicator. --vertical=letterbox renders the desktop take letterboxed instead;
// --vertical=no skips the vertical cut.
//
//   node make.mjs <script.json> --out <dir> [--style ice] [--set a.b=v ...] [--viewport 1440x900] [--capture auto|window|screencast] [--vertical mobile|letterbox|no]
//   node make.mjs --polish <dir> [--style ..] [--set ..]      own footage: <dir> has recording.* + events.json (from dolly-record);
//                                                              optional scenes.json / captions.json are used if present
// Flags for the render are passed on to ../studio/dolly.mjs (--style, --set). Output in <dir>:
//   recording.mp4 events.json scenes.json plan.json captions.json   out.mp4 (16:9)  vertical.mp4 (9:16)  sheet.jpg  vertical-sheet.jpg
//   mobile/ (the phone take: recording, events, scenes, plan, captions)
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.resolve(here, '../studio');
const argv = process.argv.slice(2);
const flags = {}, sets = [], pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--set') sets.push(argv[++i]);
  else if (a.startsWith('--') && a.includes('=')) flags[a.slice(2, a.indexOf('='))] = a.slice(a.indexOf('=') + 1);
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  else pos.push(a);
}
const die = (m) => { console.error(m); process.exit(1); };
const polish = flags.polish && path.resolve(flags.polish);
const dir = path.resolve(polish ?? flags.out ?? '');
if (!polish && (!pos[0] || !flags.out)) die('usage: node make.mjs <script.json> --out <dir> [--style ..] [--set a.b=v]   |   node make.mjs --polish <dir>');
const run = (cmd, args, opt = {}) => {
  const r = spawnSync(cmd, args, {stdio: 'inherit', ...opt});
  if (r.status !== 0) die(`${cmd} ${args.slice(0, 2).join(' ')} failed (${r.status})`);
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const {resolveQuality, dirSize, mb} = await import(path.join(studio, 'scripts/lib/env.mjs'));
const quality = resolveQuality(flags.quality); // lite | normal | max, auto from this machine (docs/performance.md); handed to the capture and the render
console.log(`quality: ${quality.mode} (${quality.auto ? 'auto: ' : ''}${quality.why})`);
const styleArgs = [...(flags.style ? ['--style', flags.style] : []), ...sets.flatMap((s) => ['--set', s]), '--quality', quality.mode, ...(flags.engine ? ['--engine', flags.engine] : [])];

// 1. record
const vmode = flags.vertical === undefined || flags.vertical === 'true' ? (polish ? 'letterbox' : 'mobile') : flags.vertical; // mobile | letterbox | no
const driveArgs = (out, extra = []) => {
  const a = [path.join(here, 'drive.mjs'), path.resolve(pos[0]), '--out', out, '--quality', quality.mode, ...extra];
  for (const k of ['dsf', 'capture', 'pos', 'keep-raw']) if (flags[k]) a.push(`--${k}`, flags[k]);
  return a;
};
const mobileDir = path.join(dir, 'mobile');
if (!polish) {
  run('node', driveArgs(dir, flags.viewport ? ['--viewport', flags.viewport] : []));
  if (vmode === 'mobile') run('node', driveArgs(mobileDir, ['--mobile', ...(flags['mobile-viewport'] ? ['--viewport', flags['mobile-viewport']] : [])]));
}
const recFile = fs.readdirSync(dir).find((f) => /^recording\.(mp4|mov)$/.test(f));
if (!recFile || !fs.existsSync(path.join(dir, 'events.json'))) die(`${dir} needs recording.mp4|mov and events.json`);

// style the plan/captions are timed with (aspect does not matter for timing)
const {mapTime} = await import(path.join(studio, 'src/camera.ts'));
const {mergeStyle, defaultStyle, stylePresets} = await import(path.join(studio, 'src/types.ts'));
let preset = {};
if (flags.style) preset = stylePresets[flags.style] ?? (fs.existsSync(flags.style) ? readJson(flags.style) : {});
const over = {};
for (const s of sets) {
  const [k, ...rest] = s.split('=');
  let v = rest.join('=');
  try { v = JSON.parse(v); } catch { /* string */ }
  const parts = k.split('.');
  let o = over;
  parts.slice(0, -1).forEach((q) => (o = o[q] ??= {}));
  o[parts.at(-1)] = v;
}

/** plan + captions for one take folder. Captions: one line per scene narration, timed to the scene's span in OUTPUT time: we map
 *  recording time -> output time with the studio's own timeline (mapTime), so idle speed-up and cuts are accounted for. */
async function prepare(d) {
  if (!fs.existsSync(path.join(d, 'plan.json')) || !polish) run('node', [path.join(studio, 'dolly.mjs'), 'plan', d]);
  const plan = readJson(path.join(d, 'plan.json'));
  const style = mergeStyle(defaultStyle, plan.style, preset, over);
  const fps = plan.source.fps;
  const srcPerFrame = mapTime(plan, style, fps); // source ms of every output frame
  const toOut = (srcMs) => {
    let lo = 0, hi = srcPerFrame.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (srcPerFrame[mid] >= srcMs) hi = mid; else lo = mid + 1; }
    return Math.round((lo / fps) * 1000);
  };
  const totalOutMs = Math.round((srcPerFrame.length / fps) * 1000);
  let captions = [];
  const capPath = path.join(d, 'captions.json');
  if (polish && fs.existsSync(capPath)) captions = readJson(capPath);
  else if (fs.existsSync(path.join(d, 'scenes.json'))) {
    for (const sc of readJson(path.join(d, 'scenes.json'))) {
      if (!sc.narration) continue;
      const a = toOut(sc.startMs) + 250, b = Math.min(totalOutMs, toOut(sc.endMs)) - 120;
      if (b - a < 700) continue; // scene too short to read a line: lengthen it in script.json (wait or minMs)
      captions.push({startMs: a, endMs: b, text: sc.narration});
    }
    fs.writeFileSync(capPath, JSON.stringify(captions, null, 2));
  }
  console.log(`${path.basename(d)}: ${captions.length} caption line(s) over ${(totalOutMs / 1000).toFixed(1)} s of output`);
  // check frames: first, every click (cursor on target?), the middle of each caption, last
  const clicks = plan.clicks.map((c) => toOut(c.tMs) / 1000 + 0.12);
  const mids = captions.map((c) => (c.startMs + c.endMs) / 2000);
  const times = [...new Set([0.4, ...clicks, ...mids, totalOutMs / 1000 - 0.5].map((t) => Math.max(0, t).toFixed(2)))].sort((a, b) => a - b).slice(0, 15);
  return {plan, capPath, capArgs: captions.length ? ['--captions', capPath] : [], times};
}

const dollyJs = path.join(studio, 'dolly.mjs');
const sheet = (d, file, name, times) => {
  const tmp = path.join(dir, '.sheet-tmp');
  fs.mkdirSync(tmp, {recursive: true});
  fs.copyFileSync(path.join(d, file), path.join(tmp, 'out.mp4'));
  spawnSync('sh', [path.join(studio, 'scripts/sheet.sh'), tmp, ...times], {stdio: 'inherit'});
  fs.renameSync(path.join(tmp, 'sheet.jpg'), path.join(dir, name));
  fs.rmSync(tmp, {recursive: true, force: true});
};

// 2-3. desktop take: plan, captions, 16:9 render, sheet
const main = await prepare(dir);
run('node', [dollyJs, 'render', dir, ...styleArgs, ...main.capArgs, '--out', path.join(dir, 'out.mp4')]);
sheet(dir, 'out.mp4', 'sheet.jpg', main.times);

// 4. the 9:16 cut
const outs = [path.join(dir, 'out.mp4')];
if (vmode === 'mobile' && fs.existsSync(path.join(mobileDir, 'events.json'))) {
  const mob = await prepare(mobileDir);
  // the phone take already is 9:16: full frame, no padding or chrome, no synthetic cursor (a finger has none); the click ripple is the tap
  const phone = ['--set', 'aspect=9:16', '--set', 'fit=crop', '--set', 'padding=0', '--set', 'radius=0', '--set', 'shadow=0', '--set', 'frame=none',
    '--set', 'cursor.visible=false', '--set', 'zoom.auto=false']; // no auto zoom: a portrait page filling the frame would pan sideways and clip text
  run('node', [dollyJs, 'render', mobileDir, ...phone, ...styleArgs, ...mob.capArgs, '--out', path.join(dir, 'vertical.mp4')]);
  sheet(dir, 'vertical.mp4', 'vertical-sheet.jpg', mob.times);
  outs.push(path.join(dir, 'vertical.mp4'));
} else if (vmode === 'letterbox' || vmode === 'mobile') {
  // letterboxed desktop take: the whole page stays in view (text is never cut off), but the picture is a small strip in the frame
  const lb = ['--set', 'aspect=9:16', '--set', 'fit=letterbox', '--set', 'padding=3', '--set', 'zoom.amount=0.9'];
  run('node', [dollyJs, 'render', dir, ...lb, ...styleArgs, ...main.capArgs, '--out', path.join(dir, 'vertical.mp4')]);
  sheet(dir, 'vertical.mp4', 'vertical-sheet.jpg', main.times);
  outs.push(path.join(dir, 'vertical.mp4'));
}
console.log(`disk: ${mb(dirSize(dir))} in ${dir}`);
console.log(`\ndone: ${outs.join(', ')}\nsheet(s): ${path.join(dir, 'sheet.jpg')}${outs.length > 1 ? ', ' + path.join(dir, 'vertical-sheet.jpg') : ''}. LOOK at them before handing over.`);
