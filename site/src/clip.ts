import {createContext, useContext} from 'react';
import {defaultStyle, mergeStyle, stylePresets, type Plan, type Style, type Zoom} from '@studio/types.ts';
import {planFromEvents} from '@studio/plan.ts';
import {BASE, DEFAULT_LINES, FPS, LINE_TIMES, LOOK, PLAN, POSTER, VIDEO} from './data';

/** What the editor is editing: the bundled demo, or a recording the visitor opened (everything stays in the browser, as object URLs). */
export interface Clip {
  id: string;
  name: string;
  demo: boolean;
  plan: Plan;
  video: string;
  poster?: string;
  look?: string;
  strip?: string;
  fps: number;
  base: Style;
  lines: string[];
  lineTimes: [number, number][];
  /** the folder the visitor opened was missing plan.json, so the editor built one with the planner */
  planned?: boolean;
}

export const DEMO_CLIP: Clip = {id: 'demo', name: 'refs-tour.mp4', demo: true, plan: PLAN, video: VIDEO, poster: POSTER, look: LOOK, fps: FPS, base: BASE, lines: DEFAULT_LINES, lineTimes: LINE_TIMES};

export const ClipCtx = createContext<Clip>(DEMO_CLIP);
export const useClip = () => useContext(ClipCtx);

export class OpenError extends Error { constructor(message: string, public cmd?: string) { super(message); } }

const VIDEO_EXT = /\.(mov|mp4|m4v|webm|mkv)$/i;
const depth = (f: File) => ((f as any).webkitRelativePath || f.name).split('/').length;
const pickBy = (files: File[], test: (f: File) => boolean) => files.filter(test).sort((a, b) => depth(a) - depth(b))[0];

/** A video, events.json and (optionally) plan.json out of whatever the visitor dropped or picked. */
export function sortFiles(files: File[]) {
  const videos = files.filter((f) => (f.type.startsWith('video/') || VIDEO_EXT.test(f.name)) && !/^(out|polished|vertical)\b/i.test(f.name));
  const video = videos.sort((a, b) => Number(/^recording\./i.test(b.name)) - Number(/^recording\./i.test(a.name)) || depth(a) - depth(b))[0];
  const events = pickBy(files, (f) => f.name === 'events.json');
  const plan = pickBy(files, (f) => f.name === 'plan.json');
  return {video, events, plan};
}

const readJson = async (f: File, what: string) => { try { return JSON.parse(await f.text()); } catch { throw new OpenError(`${what} is not valid JSON.`); } };

function thirds(durMs: number): [number, number][] {
  const s = durMs / 3;
  return [0, 1, 2].map((i) => [Math.round(i * s + s * 0.1), Math.round((i + 1) * s - s * 0.1)] as [number, number]);
}

/** Probe the video, grab a poster frame; fails with a helpful message when this browser can't decode it (a ScreenCaptureKit .mov is often HEVC). */
function probe(url: string): Promise<{video: HTMLVideoElement; poster: string}> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
    const fail = () => reject(new OpenError("This browser can't play this file. Convert it, then open the mp4 with events.json:", 'ffmpeg -i recording.mov -c:v libx264 recording.mp4'));
    const timer = window.setTimeout(fail, 12000);
    v.onerror = () => { clearTimeout(timer); fail(); };
    v.onloadeddata = () => {
      if (!v.videoWidth) { clearTimeout(timer); return fail(); }
      v.onseeked = () => { clearTimeout(timer); const poster = grab(v, 640); poster ? resolve({video: v, poster}) : fail(); };
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
    };
  });
}
function grab(v: HTMLVideoElement, w: number): string {
  const c = document.createElement('canvas'); c.width = w; c.height = Math.round((w * v.videoHeight) / v.videoWidth);
  const x = c.getContext('2d'); if (!x) return '';
  x.drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
/** The timeline's film strip: 30 frames side by side in one image, as /demo/strip.jpg is. Best effort. */
export async function makeStrip(url: string, durMs: number, n = 30): Promise<string | undefined> {
  try {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(); });
    const tw = 160, th = Math.max(1, Math.round((tw * v.videoHeight) / v.videoWidth));
    const c = document.createElement('canvas'); c.width = tw * n; c.height = th;
    const x = c.getContext('2d')!;
    for (let i = 0; i < n; i++) {
      await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = Math.min(durMs / 1000 - 0.05, ((i + 0.5) / n) * (durMs / 1000)); });
      x.drawImage(v, i * tw, 0, tw, th);
    }
    return c.toDataURL('image/jpeg', 0.6);
  } catch { return undefined; }
}

/** Turn the picked files into a Clip. Object URL only: nothing leaves the browser. */
export async function clipFromFiles(files: File[]): Promise<Clip> {
  const {video, events, plan: planFile} = sortFiles(files);
  if (!video) throw new OpenError('No video found. Open the recording folder, or pick recording.mov (or .mp4) together with events.json.');
  if (!events && !planFile) throw new OpenError('events.json is missing. Open the whole recording folder, or pick it together with the video.');
  let plan: Plan;
  let planned = false;
  if (planFile) {
    plan = await readJson(planFile, 'plan.json');
    if (!plan?.source || !Array.isArray(plan.zooms) || !Array.isArray(plan.cursor)) throw new OpenError('plan.json does not look like a Dolly plan.');
  } else {
    const ev = await readJson(events!, 'events.json');
    if (!ev?.width || !ev?.height || !Array.isArray(ev.cursor)) throw new OpenError('events.json does not look like a Dolly events file (see CONTRACT.md).');
    plan = planFromEvents(ev); planned = true;
  }
  plan = {...plan, source: {...plan.source, video: video.name}, zooms: plan.zooms ?? [], speed: plan.speed ?? [], clicks: plan.clicks ?? [], keys: plan.keys ?? [], cursorRaw: plan.cursorRaw ?? []};
  const url = URL.createObjectURL(video);
  try {
    const {poster} = await probe(url);
    const own = plan.style && Object.keys(plan.style).length > 0;
    const base = mergeStyle(defaultStyle, own ? plan.style : stylePresets.dunes);
    base.captions = {...base.captions, enabled: false};
    return {id: `own-${Date.now()}`, name: video.name, demo: false, plan, video: url, poster, look: poster, fps: plan.source.fps, base, lines: ['', '', ''], lineTimes: thirds(plan.source.durationMs), planned};
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

/** The plan the Export tab downloads: the opened plan with the edited zooms and the full style. */
export function exportPlan(clip: Clip, zooms: Zoom[], style: Style): string {
  const s = JSON.parse(JSON.stringify(style)) as Style;
  if (s.background.type === 'image') s.background = {...s.background, type: 'preset', value: 'dunes'}; // an uploaded image stays on the device
  return JSON.stringify({...clip.plan, zooms, style: s});
}

/** Files out of a drop, folders included. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const walk = async (e: any, path: string): Promise<void> => {
    if (e.isFile) { const f: File = await new Promise((res, rej) => e.file(res, rej)); try { Object.defineProperty(f, 'webkitRelativePath', {value: path + f.name}); } catch { /* ignore */ } out.push(f); }
    else if (e.isDirectory) {
      const r = e.createReader(); let batch: any[];
      do { batch = await new Promise((res, rej) => r.readEntries(res, rej)); for (const c of batch) await walk(c, `${path}${e.name}/`); } while (batch.length);
    }
  };
  const items = [...dt.items].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (items.length) { for (const e of items) await walk(e, ''); return out; }
  return [...dt.files];
}
