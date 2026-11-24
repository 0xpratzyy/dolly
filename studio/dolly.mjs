#!/usr/bin/env node
// Dolly studio CLI.
//   node dolly.mjs plan   <dir> [--cluster-gap ms] [--idle cut|speed|off]
//   node dolly.mjs render <dir> [--style <preset|file.json>] [--set a.b=value ...] [--captions file.json] [--out out.mp4] [--concurrency n]
//                           [--engine native|remotion]   native (default on macOS once recorder/dolly-render is built): GPU, about 10x faster,
//                                                        a fraction of the memory; remotion: headless Chrome (the fallback, and for facecam etc.)
//                           [--quality lite|normal|max]  how hard to work this machine (auto: lite on 8 GB, see docs/performance.md)
//                           [--codec h264|hevc] [--bitrate Mbit/s] [--stats]   native engine only
//   node dolly.mjs clean [--dry-run] [--older-than 14]   remove Dolly's caches and temp files; move old runs to the Trash
//                           [--audio voice.m4a [--audio-volume 1]]   the voice as the audio track (Narrate; a file inside <dir>)
//                           [--facecam facecam.mp4 [--facecam-start ms]]   face-cam bubble, style via --set facecam.corner=auto etc.
// <dir> holds recording.* + events.json (see ../CONTRACT.md); plan.json and out.mp4 are written there.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs, resolveRender} from './scripts/lib/render-args.mjs';
import {browserArgs, capBundlerCache, dirSize, mb, withPrivateTemp} from './scripts/lib/env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv.shift();
if (cmd === 'spotlight') { process.argv = [process.argv[0], path.join(here, 'spotlight.mjs'), ...argv]; await import('./spotlight.mjs'); process.exit(0); } // Spotlight: see ../docs/spotlight.md
if (cmd === 'clean') { await import('./scripts/clean.mjs'); process.exit(0); } // caches, temp files, old runs: see scripts/clean.mjs
const {flags, sets, pos} = parseArgs(argv);
const die = (m) => { console.error(m); process.exit(1); };
const dir = pos[0] && path.resolve(pos[0]);
if (!['plan', 'render'].includes(cmd) || !dir) die('usage: node dolly.mjs plan|render <recording-dir> [options]  (see README.md)');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

async function plan() {
  const evPath = path.join(dir, 'events.json');
  if (!fs.existsSync(evPath)) die(`no events.json in ${dir}`);
  const {planFromEvents, clickError} = await import('./src/plan.ts');
  const over = {};
  if (flags['cluster-gap']) over.clusterGapMs = Number(flags['cluster-gap']);
  if (flags.idle === 'cut') over.idleMode = 'cut';
  const p = planFromEvents(readJson(evPath), over);
  if (flags.idle === 'off') p.speed = [];
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(p));
  fs.copyFileSync(path.join(here, 'docs', 'plan-fields.md'), path.join(dir, 'plan.README.md'));
  console.log(`plan: ${p.zooms.length} zoom(s), ${p.speed.length} speed-up(s), cursor-vs-click error ${clickError(p).toFixed(1)} px`);
  for (const z of p.zooms) console.log(`  ${z.id} ${z.startMs}-${z.endMs} ms  x${z.scale}  centre ${z.center.x},${z.center.y}  (${z.why})`);
  return p;
}

async function render() {
  const planPath = path.join(dir, 'plan.json');
  if (!fs.existsSync(planPath)) await plan();
  let rr;
  try { rr = await resolveRender(dir, flags, sets); } catch (e) { die(String(e?.message ?? e)); }
  const {planJson, style, captions, captionStyle, subtleDir, out, video, audio, facecam, loading, quality} = rr;
  console.log(`quality: ${quality.mode} (${quality.auto ? 'auto: ' : ''}${quality.why})`);

  // ---- engine: native (recorder/dolly-render: hardware decode, GPU composite, hardware encode) or remotion (headless Chrome)
  const want = flags.engine ?? 'auto';
  if (!['auto', 'native', 'remotion'].includes(want)) die(`unknown --engine "${want}" (native | remotion)`);
  if (want !== 'remotion') {
    const bin = process.env.DOLLY_RENDER_BIN ?? path.join(here, '../recorder/.build/release/dolly-render');
    let why = '';
    if (process.platform !== 'darwin') why = 'the native renderer is macOS only';
    else if (!fs.existsSync(bin)) why = `no native renderer at ${bin} (build it: cd ../recorder && swift build -c release --product dolly-render)`;
    else if (flags.frames) why = '--frames is a Remotion option';
    if (!why) {
      const t0 = Date.now();
      const {prepareNative} = await import('./scripts/lib/render-prep.mjs');
      const {spec, timings} = await prepareNative({dir, ...rr, log: (m) => console.log(m)});
      if (spec.unsupported.length) why = `not in the native renderer yet: ${spec.unsupported.join(', ')}`;
      else {
        const specPath = path.join(dir, `.spec-${process.pid}.tmp`);
        fs.writeFileSync(specPath, JSON.stringify(spec));
        const a = ['--spec', specPath, '--out', out];
        for (const k of ['codec', 'bitrate']) if (flags[k]) a.push(`--${k}`, flags[k]);
        if (!flags.bitrate) a.push('--quality', String(Number(flags.quality) > 0 ? flags.quality : quality.q.nativeQuality)); // a number is still taken as the encoder quality
        if (flags.stats) a.push('--stats');
        console.log(`render (native): ${out}`);
        const res = spawnSync(bin, a, {stdio: 'inherit'});
        fs.rmSync(specPath, {force: true});
        if (res.status !== 0) die('native render failed (try --engine remotion)');
        console.log(`rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s (track ${timings.trackMs} ms, stills ${timings.stillsRendered} drawn / ${timings.stillsCached} cached in ${timings.stillsMs} ms); ${mb(dirSize(out))}`);
        return;
      }
    }
    if (want === 'native') die(`cannot render natively: ${why}`);
    console.log(`engine: remotion (${why})`);
  }
  const props = {video, plan: planJson, style, captions, captionStyle, audio, facecam, loading};
  const propsPath = path.join(dir, '.props.tmp');
  // public dir = the recording's files + Subtle's fonts (captions load them with staticFile)
  // (Remotion's bundler does not follow symlinks: hard-link, or copy when that fails)
  const pub = fs.mkdtempSync(path.join(dir, '.public-'));
  const link = (from, to) => { try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } };
  const fontDir = path.join(subtleDir, 'fonts');
  if (captionStyle && fs.existsSync(fontDir)) for (const f of fs.readdirSync(fontDir)) link(path.join(fontDir, f), path.join(pub, f));
  // AI wallpapers (preset ids "ai-*") are read with staticFile('wallpapers/ai/<file>')
  const wallDir = path.join(here, 'public/wallpapers/ai');
  if (fs.existsSync(wallDir)) { fs.mkdirSync(path.join(pub, 'wallpapers/ai'), {recursive: true}); for (const f of fs.readdirSync(wallDir)) if (/\.jpe?g$/.test(f)) link(path.join(wallDir, f), path.join(pub, 'wallpapers/ai', f)); }
  for (const f of fs.readdirSync(dir)) if (!f.startsWith('.') && fs.statSync(path.join(dir, f)).isFile()) link(path.join(dir, f), path.join(pub, f));
  fs.writeFileSync(propsPath, JSON.stringify(props));
  const args = [
    'remotion', 'render', path.join(here, 'src/remotion/entry.ts'), 'Dolly', out,
    `--props=${propsPath}`, `--public-dir=${pub}`, '--codec=h264', ...quality.q.x264, '--log=warn',
    `--concurrency=${flags.concurrency ?? quality.q.remotionConcurrency}`, '--overwrite', ...browserArgs(),
  ];
  if (flags.frames) args.push(`--frames=${flags.frames}`);
  console.log('render:', out);
  const t0 = Date.now();
  const r = withPrivateTemp((env) => spawnSync('npx', args, {cwd: here, stdio: 'inherit', env}), !!flags.keep);
  if (!flags.keep) { fs.rmSync(propsPath, {force: true}); fs.rmSync(pub, {recursive: true, force: true}); } // --keep leaves the temp files for debugging
  capBundlerCache();
  if (r.status !== 0) die('remotion render failed');
  console.log(`rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${mb(dirSize(out))}`);
}

if (cmd === 'plan') await plan(); else await render();
