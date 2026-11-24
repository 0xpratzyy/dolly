// The per-frame overlay math (cursor press, click ripples, cursor trail, camera blur) and the "render spec": everything a
// renderer that is NOT Remotion needs to draw a Dolly video, as plain numbers. The native macOS renderer (recorder/Sources/
// dolly-render) only applies this file's output, so the camera, cursor and layout math stays in ONE place: camera.ts + here.
// Pure TypeScript, no DOM and no Remotion imports: Dolly.tsx (the Remotion composition) uses the same helpers.
import {buildTimeline, videoPieces, type Frame, type Timeline} from './camera.ts';
import {motionDefaults, type CaptionsInput, type LoadingWindow, type Plan, type Style} from './types.ts';
import {facecamGeo, facecamLook, facecamPose, planCorners} from './facecam.ts';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const ICE = '#86E4F0';

/**
 * The outlined cursors: an SVG path in a viewBox, drawn `w * size` by `h * size` (fitted and centred like an <svg>), white
 * with a dark outline. hotX: where the hotspot sits across the picture (x `size`); it is always at the top edge.
 */
export const cursorShapes = {
  arrow: {d: 'M1 1 L1 18.2 L5.3 14.3 L8.2 21 L11 19.8 L8.1 13.3 L13.9 13.3 Z', vbW: 16, vbH: 23, w: 1, h: 1.45, hotX: 0, stroke: 1.5},
  hand: {d: 'M8.2 1.3c-1 0-1.7.8-1.7 1.8v8.1l-1.3-1.4c-.7-.7-1.8-.7-2.5 0-.6.6-.6 1.5-.1 2.2l4.6 5.9c.9 1.2 2.3 1.9 3.8 1.9h2.6c2.6 0 4.7-2.1 4.7-4.7V10c0-.9-.7-1.6-1.6-1.6s-1.6.7-1.6 1.6V9c0-.9-.7-1.6-1.6-1.6S11.9 8.1 11.9 9V8c0-.9-.7-1.6-1.6-1.6-.4 0-.7.1-.9.3V3.1c0-1-.2-1.8-1.2-1.8z', vbW: 22, vbH: 24, w: 1.1, h: 1.2, hotX: 0.34, stroke: 1.3},
} as const;

// ------------------------------------------------------------------ shared with Dolly.tsx
/** Cursor scale while a click is going down and coming back up (1 = at rest). `now` is source ms. */
export function cursorPress(plan: Plan, now: number): number {
  let press = 1;
  for (const c of plan.clicks) {
    const age = now - c.tMs;
    if (age >= -30 && age < 160) press = Math.min(press, 0.84 + 0.16 * clamp((age < 70 ? 70 - age : age - 70) / 90, 0, 1));
  }
  return press;
}

/** One click-effect circle, source px. `border` is the ring's width (0 = a plain disc), `fill` the alpha of the ice fill. */
export interface Ripple {x: number; y: number; r: number; border: number; opacity: number; fill: number}

/** The click effect of one click at source time `now`, or null when it is not on screen. ps = video px per screen point. */
export function rippleAt(c: {tMs: number; x: number; y: number}, effect: Style['clickEffect'], now: number, ps: number): Ripple | null {
  if (effect === 'none') return null;
  const age = now - c.tMs;
  if (age < 0 || age > 800) return null;
  if (effect === 'ripple') {
    const t = age / 700;
    if (t > 1) return null;
    return {x: c.x, y: c.y, r: (14 + 62 * easeOut(t)) * ps, border: 3.2 * ps, opacity: Math.pow(1 - t, 1.6) * 0.95, fill: 0.16 * (1 - t)};
  }
  return {x: c.x, y: c.y, r: 38 * ps, border: 0, opacity: clamp(age / 90, 0, 1) * clamp(1 - (age - 90) / 700, 0, 1), fill: 0.34};
}

/** Directional blur from how far the camera moved since the previous frame: gaussian sigma in canvas px (x, y), and whether to apply it. */
export function cameraBlur(f: Frame, p: Frame, contentW: number, motionBlur: number): {sx: number; sy: number; on: boolean} {
  const k = contentW / f.vw;
  const panX = Math.abs((f.vx + f.vw / 2) - (p.vx + p.vw / 2)) * k;
  const panY = Math.abs((f.vy + f.vh / 2) - (p.vy + p.vh / 2)) * k;
  const zoomMove = Math.abs(Math.log(f.vw / p.vw)) * contentW * 0.07;
  const amt = clamp(motionBlur, 0, 1) * 0.3;
  const sx = Math.min(14, (panX + zoomMove) * amt), sy = Math.min(14, (panY + zoomMove) * amt);
  return {sx, sy, on: sx > 0.35 || sy > 0.35};
}

/** Ghost cursors behind a fast move: [x, y, opacity] in source px. kU = canvas px per source px, per 1080p unit (k / layout.u). */
export function cursorGhosts(f: Frame, p: Frame, kU: number, fps: number, style: Style): {cx: number; cy: number; co: number}[] {
  const MK = motionDefaults.cursor;
  const dx = f.cx - p.cx, dy = f.cy - p.cy;
  const speed = Math.hypot(dx, dy) * kU * fps;
  const trail = clamp(style.cursor.motionBlur ?? MK.blur, 0, 1) * clamp((speed - MK.blurFromPxS) / MK.blurFromPxS, 0, 1);
  return trail > 0.02 ? [0.22, 0.44, 0.66, 0.88].map((a, n) => ({cx: f.cx - dx * a * 0.9, cy: f.cy - dy * a * 0.9, co: f.co * trail * (0.34 - 0.07 * n)})) : [];
}

/** The keystroke pill on screen at source time `now`: which key (index into plan.keys), its opacity, and its drop in 1080p px. */
export function keystrokeAt(plan: Plan, now: number): {index: number; opacity: number; dy: number} | null {
  let index = -1;
  plan.keys.forEach((k, i) => { if (now >= k.tMs - 20 && now < k.tMs + 1500) index = i; });
  if (index < 0) return null;
  const age = now - plan.keys[index].tMs;
  const o = clamp(age / 120, 0, 1) * clamp((1500 - age) / 250, 0, 1);
  return {index, opacity: o, dy: (1 - o) * 10};
}

/** Window chrome colours and sizes (1080p px; multiply by layout.u). */
export function chromeLook(style: Style, dark: boolean) {
  const theme = style.frameTheme ?? 'auto';
  const light = theme === 'auto' ? !dark : theme === 'light';
  return {
    light,
    bar: light ? '#e9e9ec' : '#1c1d1f',
    text: light ? '#5d6064' : '#9ea3a8',
    line: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
    pill: light ? '#ffffff' : '#2a2b2e',
    dots: ['#ff5f57', '#febc2e', '#28c840'],
    dot: 12, gap: 8, padX: 16, fontSize: 14,
  };
}

/** The window's drop shadows and edge as a list (what Dolly.tsx turns into a CSS box-shadow). Sizes in canvas px, colour as [r,g,b,a] 0..255 / 0..1. */
export interface BoxShadow {dy: number; blur: number; spread: number; color: [number, number, number, number]}
const hexRgb = (hex: string): [number, number, number] => {
  let h = (/#?([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(hex)?.[1]) ?? '000000';
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
export function boxShadows(style: Style, u: number, dark: boolean): BoxShadow[] {
  const sc = hexRgb(style.shadowColor || '#000000');
  const sh = style.shadow;
  const out: BoxShadow[] = [];
  if (sh > 0) out.push({dy: 40 * u, blur: 110 * u, spread: 0, color: [...sc, 0.55 * sh]}, {dy: 10 * u, blur: 30 * u, spread: 0, color: [...sc, 0.4 * sh]});
  const border = style.border ?? 'none';
  if (border === 'glow') {
    const bc = hexRgb(style.borderColor || '#86E4F0');
    out.push({dy: 0, blur: 0, spread: Math.max(1.5, 2 * u), color: [...bc, 0.7]}, {dy: 0, blur: 70 * u, spread: 0, color: [...bc, 0.38]});
  } else {
    out.push({dy: 0, blur: 0, spread: Math.max(1, u), color: [255, 255, 255, border === 'hairline' ? (dark ? 0.2 : 0.1) : dark ? 0.09 : 0.05]});
  }
  return out;
}
export const boxShadowCss = (list: BoxShadow[]): string =>
  list.map((s) => `0 ${s.dy}px ${s.blur}px ${s.spread ? `${s.spread}px ` : ''}rgba(${s.color[0]},${s.color[1]},${s.color[2]},${s.color[3]})`).join(', ');

// ------------------------------------------------------------------ captions as states
/** One caption still to render: the Subtle engine's picture of `frame` (output frame), reused on every frame of its state. */
export interface CaptionState {frame: number}
export interface CaptionPlan {
  /** Stills to render once each (index = image index). */
  stills: CaptionState[];
  /** Per output frame: [image a, image b (-1 = none), mix 0..1 from a to b, opacity], or null when no caption is up. */
  frames: ([number, number, number, number] | null)[];
}

/**
 * Captions for a renderer that cannot run the Subtle engine per frame: every page is cut into states (one per word that has
 * been spoken so far), each state is drawn ONCE by the Subtle engine (at its last frame, when its animation has settled), and
 * the renderer cross-fades from state to state and fades the page in and out. Word timing follows Subtle's pageTimings().
 * `pages` is a Subtle captions file's pages (toSubtleCaptions), `anim` the caption style's anim block.
 */
export function captionStates(pages: {startMs: number; endMs: number; words: {startMs: number}[]}[], fps: number, total: number, anim: {pageIn?: number; pageOut?: number; wordIn?: number} = {}): CaptionPlan {
  const msToF = (ms: number) => Math.floor((ms * fps) / 1000 + 1e-6);
  const f30 = (n: number) => Math.max(1, Math.round((n * fps) / 30));
  const inF = f30(anim.pageIn ?? 3), outF = f30(anim.pageOut ?? 3), wordF = f30(anim.wordIn ?? 3);
  const stills: CaptionState[] = [];
  const frames: CaptionPlan['frames'] = new Array(total).fill(null);
  pages.forEach((p, pi) => {
    const s = msToF(p.startMs);
    let e = Math.max(msToF(p.endMs), s + 1);
    const next = pages[pi + 1] ? msToF(pages[pi + 1].startMs) : Infinity;
    e = Math.min(e, next, total);
    if (s >= total || e <= s) return;
    // state changes: the page start, then every later word start inside the page
    const cuts = [s];
    for (const w of p.words) { const f = msToF(w.startMs); if (f > cuts[cuts.length - 1] && f < e) cuts.push(f); }
    const first = stills.length;
    cuts.forEach((c, i) => {
      const end = cuts[i + 1] ?? e;
      // the state's settled picture: its last frame, but before the page starts to fade out
      stills.push({frame: Math.max(c, Math.min(end - 1, e - outF - 1))});
    });
    for (let f = s; f < e; f++) {
      let i = 0;
      while (i + 1 < cuts.length && cuts[i + 1] <= f) i++;
      const since = f - s, left = e - f;
      const op = Math.min(clamp((since + 1) / (inF + 1), 0, 1), clamp(left / outF, 0, 1));
      const k = i === 0 ? 1 : easeOut((f - cuts[i] + 1) / (wordF + 1));
      frames[f] = k >= 0.999 ? [first + i, -1, 0, r3(op)] : [first + i - 1, first + i, r3(k), r3(op)];
    }
  });
  return {stills, frames};
}

// ------------------------------------------------------------------ the render spec
export interface RenderSpec {
  version: 1;
  width: number; height: number; fps: number; frames: number;
  /** The recording (absolute path) and the plan's source size: all source px below are in this space, whatever the file's real size. */
  video: string;
  source: {width: number; height: number; pointScale: number};
  /**
   * Canvas px, origin top-left. `box` and `content` are snapped to whole pixels the way Chrome paints them (edges rounded), so a
   * renderer that draws them as given lands on the same pixels as the Remotion render. `scaleW` is the unsnapped content width:
   * canvas px per source px = scaleW / vw.
   */
  layout: {box: Rect; content: Rect; chromeH: number; radius: number; u: number; scaleW: number};
  background: SpecBackground;
  shadows: BoxShadow[];
  chrome: null | {kind: 'window' | 'browser'; h: number; bar: string; text: string; line: string; pill: string; dots: string[]; dot: number; gap: number; padX: number; fontSize: number; label: string};
  cursor: null | {kind: 'arrow' | 'hand' | 'dot' | 'ring'; /** width in source px */ size: number; ps: number; /** arrow / hand: the outline (cursorShapes) */ shape?: {d: string; vbW: number; vbH: number; w: number; h: number; hotX: number; stroke: number}};
  /** Face-cam bubble: the clip, the bubble's size and look (canvas px), and per frame [x, y, opacity, scale] (top-left corner; scale about the centre). */
  facecam: null | {path: string; startMs: number; w: number; h: number; radius: number; mirror: boolean; ring: null | {width: number; color: number[]}; shadows: {dy: number; blur: number; color: number[]}[]; f: number[][]};
  /** Overlay pictures (absolute PNG paths, canvas-sized, transparent): caption states, then keystroke pills. Filled in by the prepare step. */
  images: string[];
  /** Frozen frames for route-change loading covers: the source time of each still. */
  covers: {ms: number}[];
  audio: null | {path: string; volume: number; offsetMs: number; fadeOutFrames: number};
  /** Per frame, in `cols` order. Source px unless noted. */
  cols: string[];
  f: number[][];
  /** Sparse per-frame extras, keyed by frame index. */
  x: Record<string, FrameExtra>;
  /** Things in the style this spec cannot express; a renderer that only reads the spec should refuse (or the caller falls back to Remotion). */
  unsupported: string[];
}
export interface Rect {x: number; y: number; w: number; h: number}
export type SpecBackground =
  | {kind: 'solid'; color: string}
  | {kind: 'image'; path: string; /** gaussian sigma, canvas px */ blur: number; dim: number}
  /** a still drawn once by the Remotion composition `DollyStill` (gradients, SVG wallpapers, grain, vignette): path filled in by the prepare step */
  | {kind: 'still'; path: string}
  /**
   * the recording itself behind the window: covers the canvas, x `scale`, gaussian `blur` (canvas px, before the scale), brightness,
   * saturation; then `grain` (a tile picture blended as overlay at `grainOpacity`) and `vignette` (a transparent picture), drawn once
   * by `DollyStill`; their paths are filled in by the prepare step.
   */
  | {kind: 'video'; blur: number; scale: number; brightness: number; saturate: number; grain: string; grainOpacity: number; vignette: string};
export interface FrameExtra {
  /** click circles: [x, y, r, border, opacity, fill] */
  rip?: number[][];
  /** cursor ghosts: [x, y, opacity] */
  gh?: number[][];
  /** caption: [image a, image b or -1, mix, opacity] */
  cap?: number[];
  /** keystroke pill: [image, opacity, dy canvas px] */
  key?: number[];
  /** sped-up stretch: the second source time (ms) to blend in at 50 % */
  s2?: number;
  /** loading cover: [cover index, opacity] */
  cov?: number[];
}

export interface SpecInput {
  plan: Plan;
  style: Style;
  /** Output fps (default: the plan's source fps, like the Remotion render). */
  fps?: number;
  video: string;
  dark: boolean;
  background: SpecBackground;
  loading?: LoadingWindow[];
  captions?: {plan: CaptionPlan};
  audio?: RenderSpec['audio'];
  /** Face-cam clip (absolute path) and the media time at output 0. */
  facecam?: {path: string; startMs: number};
  unsupported?: string[];
}

/** Builds the timeline once and flattens it for a renderer. Image paths (captions, keys, a background still) are added by the caller. */
export function buildRenderSpec(inp: SpecInput): {spec: RenderSpec; tl: Timeline} {
  const {plan, style} = inp;
  const fps = inp.fps ?? plan.source.fps;
  const tl = buildTimeline(plan, style, fps);
  const L = tl.layout;
  const ps = plan.source.pointScale;
  const pieces = videoPieces(tl.src, fps);
  const n = tl.frames.length;
  const unsupported = [...(inp.unsupported ?? [])];
  const kind = style.cursor.style ?? 'arrow';

  // loading covers (LoadingCover.tsx): hold the last good frame over each window, then fade it out
  const covers: {ms: number}[] = [];
  const cov: (number[] | undefined)[] = new Array(n);
  if (inp.loading?.length && style.loadingCover !== false) {
    const toFrame = (ms: number) => { let lo = 0, hi = tl.src.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (tl.src[mid] >= ms) hi = mid; else lo = mid + 1; } return lo; };
    for (const w of inp.loading) {
      if (!(w.endMs > w.startMs)) continue;
      const from = toFrame(w.startMs);
      const hold = Math.max(1, toFrame(w.endMs + 60) - from);
      const fade = Math.max(2, Math.round((260 / 1000) * fps));
      const still = Math.max(0, Math.round(((w.startMs - 50) / 1000) * fps));
      covers.push({ms: r3((still / fps) * 1000)});
      for (let j = 0; j < hold + fade && from + j < n; j++) cov[from + j] = [covers.length - 1, r3(j < hold ? 1 : Math.max(0, 1 - (j - hold) / fade))];
    }
  }

  const f: number[][] = [];
  const x: Record<string, FrameExtra> = {};
  let pi = 0;
  for (let i = 0; i < n; i++) {
    const fr = tl.frames[i], pr = tl.frames[Math.max(0, i - 1)];
    const k = L.content.w / fr.vw;
    const b = cameraBlur(fr, pr, L.content.w, style.motionBlur);
    f.push([r3(fr.src), r3(fr.vx), r3(fr.vy), r3(fr.vw), r3(fr.cx), r3(fr.cy), style.cursor.visible && fr.co > 0.01 ? r3(fr.co) : 0, r3(cursorPress(plan, fr.src)), b.on ? r3(b.sx) : 0, b.on ? r3(b.sy) : 0]);
    const e: FrameExtra = {};
    const rip = plan.clicks.map((c) => rippleAt(c, style.clickEffect, fr.src, ps)).filter((r): r is Ripple => !!r && r.opacity > 0.003);
    if (rip.length) e.rip = rip.map((r) => [r.x, r.y, r3(r.r), r3(r.border), r3(r.opacity), r3(r.fill)]);
    if (style.cursor.visible && fr.co > 0.01) {
      const gh = cursorGhosts(fr, pr, k / L.u, fps, style);
      if (gh.length) e.gh = gh.map((g) => [r3(g.cx), r3(g.cy), r3(g.co)]);
    }
    while (pi + 1 < pieces.length && pieces[pi + 1].outStart <= i) pi++;
    const pc = pieces[pi];
    if (pc && pc.speed > 1.2) e.s2 = r3(((Math.round((pc.srcStartMs / 1000) * fps) + Math.max(1, Math.round(pc.speed / 2)) + (i - pc.outStart) * pc.speed) / fps) * 1000);
    if (cov[i]) e.cov = cov[i];
    const c = inp.captions?.plan.frames[i];
    if (c) e.cap = c;
    if (style.keystrokes) {
      const ks = keystrokeAt(plan, fr.src);
      if (ks && ks.opacity > 0.003) e.key = [ks.index, r3(ks.opacity), r3(ks.dy * L.u)];
    }
    if (Object.keys(e).length) x[i] = e;
  }

  // face-cam bubble (remotion/Facecam.tsx): same geometry, same corner schedule
  let facecam: RenderSpec['facecam'] = null;
  if (inp.facecam && style.facecam?.enabled !== false) {
    const geo = facecamGeo(L.canvasW, L.canvasH, style);
    const fcStyle = {enabled: true, shape: 'circle', corner: 'auto', prefer: 'bottom-left', size: 0.24, border: 'subtle', mirror: false, ...(style.facecam ?? {})} as NonNullable<Style['facecam']>;
    const sched = planCorners(tl, plan, fcStyle, geo, fps);
    const lk = facecamLook(style, geo, L.u);
    facecam = {
      path: inp.facecam.path, startMs: inp.facecam.startMs, w: geo.bw, h: geo.bh, radius: lk.radius, mirror: lk.mirror, ring: lk.ring, shadows: lk.shadows,
      f: tl.frames.map((_, i) => { const p = facecamPose(sched, geo, i, n, fps); return [r3(p.x), r3(p.y), r3(p.opacity), r3(p.scale)]; }),
    };
  }
  const look = chromeLook(style, inp.dark);
  // Chrome snaps a box to device pixels by rounding its edges; children are laid out from the snapped corner
  const snap = (r: Rect): Rect => ({x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.x + r.w) - Math.round(r.x), h: Math.round(r.y + r.h) - Math.round(r.y)});
  const box = snap(L.box);
  const cy = Math.round(box.y + L.chromeH);
  const spec: RenderSpec = {
    version: 1,
    width: L.canvasW, height: L.canvasH, fps, frames: n,
    video: inp.video,
    source: {width: plan.source.width, height: plan.source.height, pointScale: ps},
    layout: {box, content: {x: box.x, y: cy, w: box.w, h: box.y + box.h - cy}, chromeH: cy - box.y, radius: style.radius * L.u, u: L.u, scaleW: L.content.w},
    background: inp.background,
    shadows: boxShadows(style, L.u, inp.dark),
    chrome: style.frame === 'none' ? null : {kind: style.frame, h: L.chromeH, bar: look.bar, text: look.text, line: look.line, pill: look.pill, dots: look.dots, dot: look.dot * L.u, gap: look.gap * L.u, padX: look.padX * L.u, fontSize: look.fontSize * L.u, label: style.frame === 'browser' ? style.frameLabel || 'localhost' : style.frameLabel},
    cursor: style.cursor.visible ? {kind, size: 26 * ps * style.cursor.size, ps, shape: kind === 'arrow' || kind === 'hand' ? cursorShapes[kind] : undefined} : null,
    facecam,
    images: [],
    covers,
    audio: inp.audio ?? null,
    cols: ['src', 'vx', 'vy', 'vw', 'cx', 'cy', 'co', 'press', 'bx', 'by'],
    f, x, unsupported,
  };
  return {spec, tl};
}
