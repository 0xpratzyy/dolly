// Shared by dolly.mjs and scripts/camera-track.mjs: the render command's flags -> plan, style, captions, caption style, audio.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveQuality} from './env.mjs';

export const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

export function parseArgs(argv) {
  const flags = {}, sets = [], pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') sets.push(argv[++i]);
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    else pos.push(a);
  }
  return {flags, sets, pos};
}

/** Everything `render` needs, resolved the same way for every engine. Throws an Error with a readable message. */
export async function resolveRender(dir, flags, sets) {
  const planJson = readJson(path.join(dir, 'plan.json'));
  const {mergeStyle, defaultStyle, stylePresets} = await import('../../src/types.ts');
  let preset = {};
  const sName = flags.style;
  if (sName) {
    if (stylePresets[sName]) preset = stylePresets[sName];
    else if (fs.existsSync(sName)) preset = readJson(sName);
    else throw new Error(`unknown style "${sName}". presets: ${Object.keys(stylePresets).join(', ')}`);
  }
  const over = {};
  for (const s of sets) { // --set zoom.amount=1.4  --set frame=browser
    const [k, ...rest] = s.split('=');
    let v = rest.join('=');
    try { v = JSON.parse(v); } catch { /* keep string */ }
    const parts = k.split('.');
    let o = over;
    parts.slice(0, -1).forEach((q) => (o = o[q] ??= {}));
    o[parts.at(-1)] = v;
  }
  const style = mergeStyle(defaultStyle, planJson.style, preset, over);
  // --quality lite|normal|max (auto from the machine): lite renders at 1080p at most and without camera motion blur
  const quality = resolveQuality(flags.quality);
  if (!quality.q.motionBlur) style.motionBlur = 0;
  const srcShort = Math.min(planJson.source.width, planJson.source.height);
  if (quality.q.maxShort < 2160 && (style.resolution === '4k' || (style.resolution === 'source' && srcShort > quality.q.maxShort))) style.resolution = '1080p';
  const captions = flags.captions ? readJson(path.resolve(flags.captions)) : [];
  const out = path.resolve(flags.out ?? path.join(dir, 'out.mp4'));
  const video = planJson.source.video;
  // Subtle caption style (any vendor/subtle/styles/<name>.json, or a path to your own style JSON) + its fonts
  const subtleDir = path.resolve(process.env.SUBTLE_DIR ?? path.join(studioDir, 'vendor/subtle'));
  let captionStyle;
  const cs = style.captions?.style;
  if (cs && style.captions.enabled && (Array.isArray(captions) ? captions.length : captions.pages?.length)) {
    const [nm, variant] = String(cs).split(':');
    const f = fs.existsSync(cs) ? cs : path.join(subtleDir, 'styles', `${nm}.json`);
    if (!fs.existsSync(f)) throw new Error(`unknown caption style "${cs}" (looked for ${f}). Styles live in studio/vendor/subtle/styles (or set SUBTLE_DIR to your own Subtle checkout).`);
    captionStyle = readJson(f);
    if (variant && captionStyle.variants?.[variant]) captionStyle = mergeStyle(captionStyle, captionStyle.variants[variant]);
  }
  const inDir = (f, what) => { // Narrate files must sit in <dir> so they land in the public dir
    const abs = path.resolve(f);
    if (path.dirname(abs) !== dir) throw new Error(`${what} ${f} must be inside ${dir}`);
    if (!fs.existsSync(abs)) throw new Error(`no such ${what}: ${abs}`);
    return path.basename(abs);
  };
  const audio = flags.audio ? {src: inDir(flags.audio, 'audio'), volume: Number(flags['audio-volume'] ?? 1)} : undefined;
  const facecam = flags.facecam ? {src: inDir(flags.facecam, 'facecam'), startMs: Number(flags['facecam-start'] ?? 0)} : undefined;
  let loading;
  try { loading = readJson(path.join(dir, 'events.json')).loading; } catch { /* no events.json next to the plan */ }
  return {planJson, style, captions, captionStyle, subtleDir, out, video, audio, facecam, loading, quality};
}
