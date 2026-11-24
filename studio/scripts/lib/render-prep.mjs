// Prepares a native render: the render spec (per-frame camera / cursor track from src/camera.ts, layout, look) plus the few
// pictures the native renderer cannot draw itself (caption states, keystroke pills, gradient / SVG backgrounds). Those are
// drawn ONCE each by the Remotion composition `DollyStill` in one headless Chrome and cached in studio/.cache, so a second
// render with the same captions never starts Chrome.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {studioDir} from './render-args.mjs';
import {headlessShell} from './env.mjs';

const cacheDir = path.join(studioDir, '.cache');
const sha = (v) => crypto.createHash('sha1').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16);
const link = (from, to) => { if (fs.existsSync(to)) return; try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } };

function treeStamp(dirs) { // names + sizes + mtimes of the sources the stills depend on
  const parts = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else { const s = fs.statSync(p); parts.push(`${p}:${s.size}:${Math.round(s.mtimeMs)}`); }
    }
  };
  dirs.forEach(walk);
  return sha(parts.sort().join('\n'));
}

/** Where the background comes from: drawn natively (a flat colour, an image file) or as one cached still (everything else that is static). */
async function resolveBackground(style, dir, unsupported) {
  const bg = style.background;
  const {aiWallpaperDefs, photoDefs} = await import('../../src/remotion/backgrounds.ts');
  const plain = !(bg.grain > 0) && !(bg.vignette > 0);
  // the blurred, darkened recording (Dolly.tsx BackgroundLayer): blur(blur x u) brightness(0.5) saturate(1.25), scaled 1.25
  if (bg.type === 'video') return {kind: 'video', blur: Math.max(0, bg.blur ?? 40), scale: 1.25, brightness: 0.5, saturate: 1.25, grain: '', grainOpacity: bg.grain > 0 ? Math.min(1, bg.grain) * 0.9 : 0, vignette: ''};
  if (bg.type === 'solid' && plain && !(bg.blur > 0) && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(bg.value)) return {kind: 'solid', color: bg.value};
  let file;
  if (bg.type === 'preset') {
    const ai = aiWallpaperDefs.find((d) => d.id === bg.value);
    const ph = photoDefs.find((d) => `photo-${d.id}` === bg.value);
    if (ai) file = path.join(studioDir, 'public/wallpapers/ai', ai.file);
    else if (ph) file = path.join(studioDir, 'assets/backgrounds', ph.file);
  } else if (bg.type === 'image' && !/^(https?:|data:|blob:)/.test(bg.value)) {
    file = [path.resolve(bg.value), path.join(dir, bg.value), path.join(studioDir, 'public', bg.value)].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  }
  if (file && fs.existsSync(file) && plain) return {kind: 'image', path: file, blur: Math.max(0, bg.blur ?? 0), dim: Math.min(1, Math.max(0, bg.dim ?? 0))};
  return {kind: 'still', path: ''};
}

/**
 * @returns {Promise<{spec: object, timings: {trackMs: number, stillsMs: number, stillsRendered: number, stillsCached: number}}>}
 */
export async function prepareNative({dir, planJson, style, captions, captionStyle, subtleDir, audio, facecam, loading, fps, log = () => {}}) {
  const t0 = Date.now();
  const {buildRenderSpec, captionStates} = await import('../../src/track.ts');
  const {toSubtleCaptions} = await import('../../src/captions.ts');
  const {backgroundIsDark} = await import('../../src/remotion/backgrounds.ts');
  const {buildTimeline} = await import('../../src/camera.ts');
  const outFps = fps ?? planJson.source.fps;
  const unsupported = [];
  const background = await resolveBackground(style, dir, unsupported);

  // size and length first (captions are timed against them)
  const tl0 = buildTimeline(planJson, style, outFps);
  const W = tl0.layout.canvasW, H = tl0.layout.canvasH, n = tl0.frames.length;
  const hasCaptions = style.captions?.enabled && (Array.isArray(captions) ? captions.length : captions?.pages?.length);
  let capPlan, capProps;
  if (hasCaptions) {
    const CAPTION_Y = {bottom: 84, middle: 50, top: 13, below: 94};
    if (captionStyle) {
      const st = {...captionStyle, size: captionStyle.size * style.captions.size, position: {...captionStyle.position, y: CAPTION_Y[style.captions.position] ?? CAPTION_Y.bottom}};
      const file = toSubtleCaptions(captions, st, {width: W, height: H, fps: outFps, durationMs: (n / outFps) * 1000});
      capPlan = captionStates(file.pages, outFps, n, st.anim ?? {});
    } else { // the plain bar: one state per line, 140 ms fades
      const list = Array.isArray(captions) ? captions : captions.pages.map((p) => ({startMs: p.startMs, endMs: p.endMs}));
      capPlan = captionStates(list.map((c) => ({startMs: c.startMs, endMs: c.endMs, words: []})), outFps, n, {pageIn: 4.2, pageOut: 4.2});
    }
    capProps = {mode: 'caption', width: W, height: H, fps: outFps, frames: n, style, captions, captionStyle};
  }
  const {spec} = buildRenderSpec({
    plan: planJson, style, fps: outFps, video: path.join(dir, planJson.source.video), dark: backgroundIsDark(style.background), background, loading,
    captions: capPlan ? {plan: capPlan} : undefined,
    audio: audio ? {path: path.join(dir, audio.src), volume: audio.volume ?? 1, offsetMs: audio.offsetMs ?? 0, fadeOutFrames: 12} : null,
    facecam: facecam ? {path: path.join(dir, facecam.src), startMs: facecam.startMs ?? 0} : undefined,
    unsupported,
  });
  if (spec.background.kind === 'video') spec.background.blur *= spec.layout.u;
  const trackMs = Date.now() - t0;

  // ---- the stills this render needs: [{props, frame, apply(path)}]
  const t1 = Date.now();
  const jobs = [];
  if (capPlan) capPlan.stills.forEach((s, i) => jobs.push({props: capProps, frame: s.frame, apply: (p) => { spec.images[i] = p; }}));
  const keyBase = capPlan ? capPlan.stills.length : 0;
  const usedKeys = new Set(Object.values(spec.x).filter((e) => e.key).map((e) => e.key[0]));
  const keyImage = new Map();
  for (const ki of [...usedKeys].sort((a, b) => a - b)) {
    const label = planJson.keys[ki].label;
    if (!keyImage.has(label)) {
      const idx = keyBase + keyImage.size;
      keyImage.set(label, idx);
      jobs.push({props: {mode: 'key', width: W, height: H, fps: outFps, frames: 1, style, label}, frame: 0, apply: (p) => { spec.images[idx] = p; }});
    }
  }
  for (const e of Object.values(spec.x)) if (e.key) e.key[0] = keyImage.get(planJson.keys[e.key[0]].label);
  if (background.kind === 'still') jobs.push({props: {mode: 'bg', width: W, height: H, fps: outFps, frames: 1, style: {...style, captions: undefined}}, frame: 0, apply: (p) => { spec.background.path = p; }});

  if (background.kind === 'video') {
    if (background.grainOpacity > 0) jobs.push({props: {mode: 'grain', width: W, height: H, fps: outFps, frames: 1, style: {background: {type: 'solid', value: '#000'}}}, frame: 0, apply: (p) => { spec.background.grain = p; }});
    if (style.background.vignette > 0) jobs.push({props: {mode: 'vignette', width: W, height: H, fps: outFps, frames: 1, style: {background: {type: 'solid', value: '#000', vignette: style.background.vignette}}}, frame: 0, apply: (p) => { spec.background.vignette = p; }});
  }
  let rendered = 0;
  if (jobs.length) {
    const stamp = treeStamp([path.join(studioDir, 'src'), path.join(subtleDir, 'template/src'), path.join(subtleDir, 'fonts')]);
    const stillDir = path.join(cacheDir, 'stills');
    fs.mkdirSync(stillDir, {recursive: true});
    for (const j of jobs) {
      // a caption still does not depend on the rest of the look, only on the canvas and the caption settings
      const keyProps = j.props.mode === 'caption' ? {...j.props, style: {captions: j.props.style.captions}} : j.props.mode === 'key' ? {...j.props, style: {background: j.props.style.background}} : {...j.props, style: {background: j.props.style.background}};
      j.file = path.join(stillDir, `${j.props.mode}-${sha({stamp, keyProps, frame: j.frame})}.png`);
    }
    const missing = jobs.filter((j) => !fs.existsSync(j.file));
    if (missing.length) {
      log(`drawing ${missing.length} still(s) (captions / keys / background) once; cached after this`);
      await renderStills(missing, {stamp, subtleDir});
      rendered = missing.length;
    }
    for (const j of jobs) j.apply(j.file);
  }
  return {spec, timings: {trackMs, stillsMs: Date.now() - t1, stillsRendered: rendered, stillsCached: jobs.length - rendered}};
}

async function renderStills(jobs, {stamp, subtleDir}) {
  const {bundle} = await import('@remotion/bundler');
  const {renderStill, selectComposition, openBrowser} = await import('@remotion/renderer');
  // the bundle is cached per source stamp; its public dir carries Subtle's fonts and the wallpapers
  const serveUrl = path.join(cacheDir, `bundle-${stamp}`);
  if (!fs.existsSync(path.join(serveUrl, 'index.html'))) {
    const pub = path.join(cacheDir, `public-${stamp}`);
    fs.mkdirSync(pub, {recursive: true});
    const fontDir = path.join(subtleDir, 'fonts');
    if (fs.existsSync(fontDir)) for (const f of fs.readdirSync(fontDir)) link(path.join(fontDir, f), path.join(pub, f));
    for (const [from, to] of [[path.join(studioDir, 'public/wallpapers/ai'), 'wallpapers/ai'], [path.join(studioDir, 'assets/backgrounds'), 'backgrounds']]) {
      if (!fs.existsSync(from)) continue;
      fs.mkdirSync(path.join(pub, to), {recursive: true});
      for (const f of fs.readdirSync(from)) if (/\.jpe?g$/.test(f)) link(path.join(from, f), path.join(pub, to, f));
    }
    const nm = (p) => path.join(studioDir, 'node_modules', p);
    const tmp = `${serveUrl}.tmp-${process.pid}`;
    await bundle({
      entryPoint: path.join(studioDir, 'src/remotion/entry.ts'), outDir: tmp, publicDir: pub,
      webpackOverride: (c) => ({...c, resolve: {...c.resolve, alias: {...(c.resolve?.alias ?? {}), '@subtle': path.join(subtleDir, 'template/src'), remotion: nm('remotion'), react: nm('react'), 'react-dom': nm('react-dom'), '@remotion/layout-utils': nm('@remotion/layout-utils')}}}),
    });
    fs.renameSync(tmp, serveUrl);
    fs.rmSync(pub, {recursive: true, force: true});
    // older bundles are of no use any more
    for (const d of fs.readdirSync(cacheDir)) if (d.startsWith('bundle-') && d !== `bundle-${stamp}` && !d.includes('.tmp-')) fs.rmSync(path.join(cacheDir, d), {recursive: true, force: true});
  }
  const browser = await openBrowser('chrome', {logLevel: 'error', browserExecutable: headlessShell() ?? undefined});
  try {
    const comps = new Map();
    for (const j of jobs) {
      const key = JSON.stringify(j.props);
      if (!comps.has(key)) comps.set(key, await selectComposition({serveUrl, id: 'DollyStill', inputProps: j.props, puppeteerInstance: browser, logLevel: 'error'}));
      const tmp = `${j.file}.tmp-${process.pid}.png`;
      await renderStill({composition: comps.get(key), serveUrl, inputProps: j.props, frame: j.frame, output: tmp, imageFormat: 'png', puppeteerInstance: browser, logLevel: 'error', overwrite: true});
      fs.renameSync(tmp, j.file);
    }
  } finally {
    await browser.close({silent: true});
  }
}
