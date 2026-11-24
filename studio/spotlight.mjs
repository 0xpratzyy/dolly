#!/usr/bin/env node
// Dolly Spotlight renderer: turns one or more spotlight captures (spotlight/capture.mjs) into a cinematic, feed-ready animation.
//
//   node spotlight.mjs <capture dir> [more dirs...] [--scene void|studio|wallpaper|desk|curtain] [--bg <background id>]
//        [--layout single|carousel|collage|grid] [--aspect 3:2|16:9|1:1|4:5|9:16 | a,b,c] [--hero 0.4] [--tilt 9] [--dof 0.6]
//        [--motion-blur 0.55] [--loop] [--sound off|subtle|full] [--glow '#86E4F0'] [--title "..."] [--wordmark "..."]
//        [--plate auto|on|off] [--reflection on|off] [--shadow 0.75] [--cursor off|mac|light] [--cursor-size 1.25] [--bg-blur 0] [--bg-dim 0] [--bg-drift 0]
//        [--focus 0] [--pace 1] [--out file.mp4] [--frames a-b] [--concurrency 4] [--scale 1] [--still N]
// Also callable as `node dolly.mjs spotlight <dir> ...` (see the one-liner in the report).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildTimeline} from './src/remotion/spotlight/timeline.ts';
import {aspectSize, defaultSpotlightOptions} from './src/remotion/spotlight/types.ts';
import {renderSounds, wavBytes} from './src/spotlight-sound.ts';
import {browserArgs, capBundlerCache, dirSize, mb, resolveQuality, withPrivateTemp} from './scripts/lib/env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { const k = argv[i].slice(2); flags[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; } else pos.push(argv[i]);
}
if (pos[0] === 'spotlight') pos.shift();
const die = (m) => { console.error(m); process.exit(1); };
if (!pos.length) die('usage: node spotlight.mjs <capture dir> [...] [--scene void|studio|wallpaper|desk|curtain] [--layout single|carousel|collage|grid] [--aspect 3:2|16:9|1:1|4:5|9:16] [--loop] [--sound off|subtle|full]');

const dirs = pos.map((d) => path.resolve(d));
const metas = dirs.map((d) => { const f = path.join(d, 'spotlight.json'); if (!fs.existsSync(f)) die(`no spotlight.json in ${d} (run spotlight/capture.mjs first)`); return JSON.parse(fs.readFileSync(f, 'utf8')); });
const num = (v, d) => (v === undefined || v === 'true' ? d : Number(v));
const layout = flags.layout ?? (dirs.length > 1 ? 'carousel' : 'single');
const scene = flags.scene ?? (flags.bg ? 'wallpaper' : 'void');
const bgId = flags.bg;
const background = bgId ? {type: 'preset', value: bgId, grain: num(flags['bg-grain'], 0.18), blur: num(flags['bg-blur'], 0), dim: num(flags['bg-dim'], 0), drift: num(flags['bg-drift'], 0)} : (scene === 'wallpaper' || scene === 'desk' ? {type: 'preset', value: 'liquid-dusk', grain: 0.18} : undefined);
if (flags['bg-image']) Object.assign(background ?? {}, {type: 'image', value: path.resolve(flags['bg-image'])});
const sound = flags.sound ?? 'subtle';
// --quality lite|normal|max (auto from the machine, docs/performance.md): lite = one Chrome tab, no motion blur or depth of field, animated backgrounds as stills
const quality = resolveQuality(flags.quality);
console.log(`quality: ${quality.mode} (${quality.auto ? 'auto: ' : ''}${quality.why})`);
if (quality.q.staticBackgrounds && background) background.still = true;
const aspects = (flags.aspect ?? flags.aspects ?? '3:2').split(',');
const opt = {
  ...defaultSpotlightOptions, scene, background, layout,
  hero: flags.hero ? Number(flags.hero) : undefined,
  tilt: num(flags.tilt, defaultSpotlightOptions.tilt), dof: num(flags.dof, quality.q.motionBlur ? defaultSpotlightOptions.dof : 0), motionBlur: num(flags['motion-blur'], quality.q.motionBlur ? defaultSpotlightOptions.motionBlur : 0),
  loop: !!flags.loop, shadow: num(flags.shadow, defaultSpotlightOptions.shadow),
  reflection: flags.reflection ? flags.reflection !== 'off' : undefined, glow: flags.glow ? (flags.glow === 'off' ? false : flags.glow) : undefined,
  cursor: {visible: flags.cursor !== 'off', size: num(flags['cursor-size'], 1.25), theme: flags.cursor === 'light' ? 'light' : 'mac', ripple: flags.ripple !== 'off'},
  plate: flags.plate ?? 'auto', title: flags.title, wordmark: flags.wordmark, focus: num(flags.focus, 0), pace: num(flags.pace, 1),
};
const base = flags.out ? path.resolve(flags.out).replace(/\.mp4$/, '') : path.join(dirs[0], `spotlight-${scene}-${layout}${opt.loop ? '-loop' : ''}`);

// public dir: the frames of every capture (hard links), the backgrounds' files, and the sound track
const pub = fs.mkdtempSync(path.join(path.dirname(dirs[0]), '.sp-public-'));
const link = (from, to) => { fs.mkdirSync(path.dirname(to), {recursive: true}); try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } };
const items = dirs.map((d, i) => {
  const id = `i${i}`;
  if (metas[i].image.video) link(path.join(d, metas[i].image.video), path.join(pub, 'sp', id, metas[i].image.video));
  else for (const f of fs.readdirSync(path.join(d, 'frames'))) link(path.join(d, 'frames', f), path.join(pub, 'sp', id, 'frames', f));
  return {id, base: `sp/${id}`, meta: metas[i], label: path.basename(d)};
});
for (const sub of ['backgrounds', 'wallpapers/ai']) {
  const from = path.join(here, sub === 'backgrounds' ? 'assets/backgrounds' : 'public/wallpapers/ai');
  if (fs.existsSync(from)) for (const f of fs.readdirSync(from)) if (fs.statSync(path.join(from, f)).isFile()) link(path.join(from, f), path.join(pub, sub, f));
}
if (background?.type === 'image' && path.isAbsolute(background.value)) { link(background.value, path.join(pub, 'bg-user' + path.extname(background.value))); background.value = 'bg-user' + path.extname(background.value); }
if (background?.type === 'image' && !/^(https?:|\/|bg-user)/.test(background.value)) background.value = background.value;

try {
  // the sound track, placed on the exact output frames (one wav; the composition plays it from frame 0)
  let soundFile = null;
  if (sound !== 'off') {
    const fps = metas[0].fps;
    const tl = buildTimeline(items, {...opt, aspect: aspects[0]}, fps);
    const ev = [];
    items.forEach((it, i) => {
      const off = (tl.playAt[i] / fps) * 1000;
      const maxT = (it.meta.frames / it.meta.fps) * 1000 - (opt.loop && layout === 'single' ? tl.loopMix / fps * 1000 : 0);
      for (const s of it.meta.sounds ?? []) { if (opt.loop && s.tMs >= maxT) continue; ev.push({tMs: off + s.tMs, kind: s.kind}); }
    });
    const {left, right} = renderSounds(ev, (tl.frames / fps) * 1000, sound);
    soundFile = 'ui-sounds.wav';
    fs.writeFileSync(path.join(pub, soundFile), wavBytes(left, right));
    fs.writeFileSync(`${base}.sounds.wav`, wavBytes(left, right));
    console.log(`sound: ${ev.length} events, ${sound}`);
  }
  for (const asp of aspects) {
    const out = aspects.length > 1 ? `${base}-${asp.replace(':', 'x')}.mp4` : `${base}.mp4`;
    const props = {...opt, aspect: asp, items, sound: soundFile};
    const propsPath = path.join(pub, '.props.json');
    fs.writeFileSync(propsPath, JSON.stringify(props));
    const entry = path.join(here, 'src/remotion/spotlight/entry.ts');
    const common = [`--props=${propsPath}`, `--public-dir=${pub}`, '--log=warn', '--gl=angle', `--scale=${flags.scale ?? 1}`, ...browserArgs()];
    let args;
    if (flags.still) args = ['remotion', 'still', entry, 'Spotlight', `${base}-still-${flags.still}.png`, `--frame=${flags.still}`, ...common, '--overwrite'];
    else args = ['remotion', 'render', entry, 'Spotlight', out, ...common, '--codec=h264', `--crf=${quality.q.spotlightCrf}`, ...(quality.mode === 'lite' ? ['--x264-preset=veryfast'] : []), '--pixel-format=yuv420p', `--concurrency=${flags.concurrency ?? quality.q.spotlightConcurrency}`, '--overwrite', ...(flags.frames ? [`--frames=${flags.frames}`] : []), ...(soundFile ? ['--audio-codec=aac', '--audio-bitrate=192k'] : [])];
    console.log(`render ${asp}:`, flags.still ? `${base}-still-${flags.still}.png` : out);
    const t0 = Date.now();
    const r = withPrivateTemp((env) => spawnSync('npx', args, {cwd: here, stdio: 'inherit', env}), !!flags.keep);
    if (r.status !== 0) die('remotion render failed');
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${fs.existsSync(out) ? mb(dirSize(out)) : ''}`);
  }
} finally { if (!flags.keep) fs.rmSync(pub, {recursive: true, force: true}); capBundlerCache(); }
