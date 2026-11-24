// Face-cam bubble geometry and its corner schedule. Pure TypeScript (no React, no Remotion): the Remotion component
// (remotion/Facecam.tsx) and the native render spec (track.ts) both use it, so the bubble sits and moves identically.
import type {Timeline} from './camera.ts';
import type {Plan, Style} from './types.ts';

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const ease = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export const facecamDefaults = {enabled: true, shape: 'circle', corner: 'auto', prefer: 'bottom-left', size: 0.24, border: 'subtle', mirror: false} as const;

export interface Geo {W: number; H: number; D: number; bw: number; bh: number; m: number; /** extra space kept free at the bottom (bottom captions in a portrait frame) */ inset: number}
export const rectAt = (c: Corner, g: Geo) => ({
  x: c.endsWith('left') ? g.m : g.W - g.m - g.bw,
  y: c.startsWith('top') ? g.m : g.H - g.m - g.inset - g.bh,
});

/** Which corner the bubble sits in at every output frame, and when it last moved. Pure, computed once per render. */
export function planCorners(tl: Timeline, plan: Plan, fc: NonNullable<Style['facecam']>, geo: Geo, fps: number) {
  const L = tl.layout;
  const n = tl.frames.length;
  const toCanvas = (sx: number, sy: number, i: number) => {
    const f = tl.frames[i];
    const k = L.content.w / f.vw;
    return {x: L.content.x + (sx - f.vx) * k, y: L.content.y + (sy - f.vy) * k};
  };
  const prefer = (fc.prefer ?? 'bottom-left') as Corner;
  const fixed = fc.corner && fc.corner !== 'auto' ? (fc.corner as Corner) : null;
  const corner: Corner[] = new Array(n).fill(fixed ?? prefer);
  const since: number[] = new Array(n).fill(-1000);
  const from: Corner[] = new Array(n).fill(fixed ?? prefer);
  if (fixed || n === 0) return {corner, since, from};
  const pad = geo.D * 0.22;
  const clicks = plan.clicks;
  const hit = (c: Corner, pts: {x: number; y: number}[]) => {
    const r = rectAt(c, geo);
    return pts.some((p) => p.x > r.x - pad && p.x < r.x + geo.bw + pad && p.y > r.y - pad && p.y < r.y + geo.bh + pad);
  };
  const ahead = Math.round(fps * 0.7);
  let cur = prefer, last = -1000, prev = prefer;
  for (let i = 0; i < n; i++) {
    const pts: {x: number; y: number}[] = [];
    for (let j = i; j <= Math.min(n - 1, i + ahead); j += 5) {
      const f = tl.frames[j];
      pts.push(toCanvas(f.cx, f.cy, i));
    }
    const src = tl.frames[i].src;
    for (const c of clicks) if (c.tMs > src - 400 && c.tMs < src + 900) pts.push(toCanvas(c.x, c.y, i));
    const held = i - last > fps * 0.9;
    if (held) {
      if (hit(cur, pts)) {
        const free = CORNERS.filter((c) => !hit(c, pts));
        // nearest to the preferred corner among the free ones, else the corner whose nearest point is farthest away
        const pick = free.length
          ? free.sort((a, b) => Number(b === prefer) - Number(a === prefer) || Number(a.slice(0, 3) !== prefer.slice(0, 3)) - Number(b.slice(0, 3) !== prefer.slice(0, 3)))[0]
          : [...CORNERS].sort((a, b) => minDist(b, pts, geo) - minDist(a, pts, geo))[0];
        if (pick !== cur) { prev = cur; cur = pick; last = i; }
      } else if (cur !== prefer && !hit(prefer, pts) && i - last > fps * 1.4) {
        prev = cur; cur = prefer; last = i;
      }
    }
    corner[i] = cur; since[i] = last; from[i] = prev;
  }
  return {corner, since, from};
}

function minDist(c: Corner, pts: {x: number; y: number}[], g: Geo) {
  const r = rectAt(c, g);
  const cx = r.x + g.bw / 2, cy = r.y + g.bh / 2;
  return Math.min(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)), 1e9);
}


/** The bubble's size and margins on a canvas. */
export function facecamGeo(W: number, H: number, style: Style): Geo {
  const fc = {...facecamDefaults, ...(style.facecam ?? {})};
  const short = Math.min(W, H);
  const D = Math.round(fc.size * short);
  const bw = fc.shape === 'rounded' ? Math.round(D * 1.33) : D;
  // a portrait frame has no room beside a bottom caption, so the bottom corners sit above it
  const inset = H > W && style.captions.enabled && style.captions.position === 'bottom' ? Math.round(H * 0.17) : 0;
  return {W, H, D, bw, bh: D, m: Math.round(short * 0.04), inset};
}

/** Where the bubble is at output frame `frame`: top-left corner (canvas px), opacity and scale (about its centre). */
export function facecamPose(sched: ReturnType<typeof planCorners>, geo: Geo, frame: number, n: number, fps: number) {
  const i = clamp(frame, 0, n - 1);
  const a = rectAt(sched.from[i], geo), b = rectAt(sched.corner[i], geo);
  const t = ease((i - sched.since[i]) / (fps * 0.45));
  const inT = ease(frame / (fps * 0.45)), outT = ease((n - 1 - frame) / (fps * 0.3));
  const o = Math.min(inT, outT);
  return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, opacity: o, scale: 0.86 + 0.14 * o};
}

/** Border ring and drop shadows of the bubble, canvas px (u = canvas px per 1080p px). */
export function facecamLook(style: Style, geo: Geo, u: number) {
  const fc = {...facecamDefaults, ...(style.facecam ?? {})};
  return {
    radius: fc.shape === 'circle' ? geo.bh / 2 : geo.D * 0.2,
    ring: fc.border === 'none' ? null : fc.border === 'ice' ? {width: 3 * u, color: [134, 228, 240, 0.9] as [number, number, number, number]} : {width: 2 * u, color: [255, 255, 255, 0.28] as [number, number, number, number]},
    shadows: [{dy: 14 * u, blur: 44 * u, color: [0, 0, 0, 0.5] as [number, number, number, number]}, {dy: 4 * u, blur: 12 * u, color: [0, 0, 0, 0.35] as [number, number, number, number]}],
    mirror: !!fc.mirror,
  };
}
