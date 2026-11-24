// What this machine can take, and Dolly's own housekeeping. Shared by the studio (dolly.mjs, spotlight.mjs) and the autopilot
// (make.mjs, narrate.mjs, drive / smooth capture, spotlight/capture.mjs). Plain JS, no dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * --quality lite | normal | max. Without the flag it is picked from the machine: lite on 8 GB or less (or 4 cores or fewer),
 * max on 32 GB+ with 10+ cores, normal otherwise. DOLLY_QUALITY sets the default.
 *   dsf                  capture scale of the autopilot / Narrate take (device pixels per CSS px)
 *   spotlightScaleMax    cap on Spotlight's automatic capture scale (2-4)
 *   maxShort             cap on the output's short side (lite never renders above 1080p)
 *   remotionConcurrency  Chrome tabs for a Remotion render (the fallback engine); spotlightConcurrency the same for Spotlight
 *   motionBlur           false: camera / Spotlight motion blur off
 *   staticBackgrounds    animated (shader) backgrounds drawn as their still
 *   nativeQuality        dolly-render's constant quality (0..1)
 *   x264                 extra Remotion flags (encoder; lite also caps the video frame cache at 256 MB);  capturePreset / captureCrf: the capture's x264 settings;  encodeThreads: ffmpeg threads
 */
export const QUALITY = {
  lite: {dsf: 1.5, spotlightScaleMax: 2, maxShort: 1080, remotionConcurrency: 1, spotlightConcurrency: 1, motionBlur: false, staticBackgrounds: true, nativeQuality: 0.62, x264: ['--crf=20', '--x264-preset=veryfast', '--offthreadvideo-cache-size-in-bytes=268435456', '--offthreadvideo-video-threads=1'], spotlightCrf: 19, capturePreset: 'veryfast', captureCrf: 17, encodeThreads: 2},
  normal: {dsf: 2, spotlightScaleMax: 4, maxShort: 2160, remotionConcurrency: 3, spotlightConcurrency: 2, motionBlur: true, staticBackgrounds: false, nativeQuality: 0.72, x264: ['--crf=16'], spotlightCrf: 15, capturePreset: 'medium', captureCrf: 14, encodeThreads: 4},
  max: {dsf: 2, spotlightScaleMax: 4, maxShort: 2160, remotionConcurrency: 6, spotlightConcurrency: 4, motionBlur: true, staticBackgrounds: false, nativeQuality: 0.85, x264: ['--crf=14'], spotlightCrf: 14, capturePreset: 'medium', captureCrf: 12, encodeThreads: 8},
};

/** @returns {{mode: 'lite'|'normal'|'max', auto: boolean, why: string, q: typeof QUALITY.lite}} */
export function resolveQuality(flag) {
  const asked = [flag, process.env.DOLLY_QUALITY].find((v) => v && QUALITY[v]);
  const gb = os.totalmem() / 2 ** 30, cores = os.cpus().length;
  if (asked) return {mode: asked, auto: false, why: flag && QUALITY[flag] ? '--quality' : 'DOLLY_QUALITY', q: QUALITY[asked]};
  const mode = gb <= 8.5 || cores <= 4 ? 'lite' : gb >= 31 && cores >= 10 ? 'max' : 'normal';
  return {mode, auto: true, why: `${Math.round(gb)} GB, ${cores} cores`, q: QUALITY[mode]};
}

/**
 * The headless Chrome Remotion should drive: Playwright's chromium_headless_shell (already on disk for the autopilot), so
 * Remotion does not download its own 570 MB copy into studio/node_modules/.remotion. DOLLY_CHROME overrides; null = let
 * Remotion use (or download) its own.
 */
export function headlessShell() {
  if (process.env.DOLLY_CHROME) return fs.existsSync(process.env.DOLLY_CHROME) ? process.env.DOLLY_CHROME : null;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const builds = fs.readdirSync(root).filter((d) => /^chromium_headless_shell-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds) {
      for (const sub of fs.readdirSync(path.join(root, b))) {
        for (const exe of ['chrome-headless-shell', 'headless_shell', 'chrome-headless-shell.exe']) {
          const p = path.join(root, b, sub, exe);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  }
  return null;
}
/** `--browser-executable=...` for the Remotion CLI, or nothing. */
export const browserArgs = () => { const p = headlessShell(); return p ? [`--browser-executable=${p}`] : []; };

/**
 * Runs a Remotion CLI command with a private temp folder (its webpack bundle, extracted assets and Chrome profile land
 * there, 30-60 MB a run) and deletes that folder afterwards, so nothing piles up in the system temp dir. keep: leave it.
 */
export function withPrivateTemp(fn, keep = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dolly-remotion-'));
  try { return fn({...process.env, TMPDIR: dir, TEMP: dir, TMP: dir}); } finally { if (!keep) fs.rmSync(dir, {recursive: true, force: true}); }
}

export function dirSize(p) {
  let n = 0;
  try {
    const st = fs.lstatSync(p);
    if (!st.isDirectory()) return st.size;
    for (const e of fs.readdirSync(p)) n += dirSize(path.join(p, e));
  } catch { /* gone */ }
  return n;
}
export const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`);

/** Keeps Remotion's webpack cache (studio/node_modules/.cache) under `capBytes` by dropping its oldest entries. */
export function capBundlerCache(capBytes = 300e6) {
  const root = path.join(studioDir, 'node_modules/.cache');
  if (!fs.existsSync(root)) return 0;
  const entries = [];
  for (const kind of fs.readdirSync(root)) {
    const kd = path.join(root, kind);
    if (!fs.statSync(kd).isDirectory()) continue;
    for (const e of fs.readdirSync(kd)) { const p = path.join(kd, e); entries.push({p, size: dirSize(p), t: fs.statSync(p).mtimeMs}); }
  }
  let total = entries.reduce((a, e) => a + e.size, 0), freed = 0;
  for (const e of entries.sort((a, b) => a.t - b.t)) {
    if (total <= capBytes) break;
    fs.rmSync(e.p, {recursive: true, force: true});
    total -= e.size; freed += e.size;
  }
  return freed;
}
