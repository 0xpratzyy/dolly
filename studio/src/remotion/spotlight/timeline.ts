// Spotlight timeline: lays the captured components out in a world, plans the camera (a damped spring chasing eased shot targets),
// and precomputes every output frame (camera pose + speed, which capture frame each item shows, the hero's cursor). Pure and
// deterministic, so the Remotion CLI render and a browser Player agree. Camera DOFs: x, y (world px), zoom, rx, ry, rz (deg).
import {aspectSize, type SpotlightItem, type SpotlightOptions} from './types.ts';

export interface Placed {x: number; y: number; z: number; rot: number; s: number; w: number; h: number}
export interface ItemFrame {
  /** capture frame shown (primary) and, in a loop seam, the one it cross-fades to */
  frame: number; frame2: number; mix: number;
  /** playing now (camera is on it) */
  active: boolean;
}
export interface FrameState {
  cam: {x: number; y: number; zoom: number; rx: number; ry: number; rz: number};
  /** camera speed in screen px / frame (pan) and zoom change per frame, for motion blur */
  vel: {x: number; y: number; z: number; rot: number};
  items: ItemFrame[];
  hero: number;
  /** 0..1 how "arriving" the camera is (entrance / transitions): drives the depth-of-field blur of the hero */
  arrive: number;
  cursorAlpha: number;
  titleAlpha: number;
  /** context intro (single hero with a context screenshot): page = opacity of the real page around it, dim = its brightness,
   * ring = the outline around the component, lift = 0 (in the page) .. 1 (isolated on the stage: full shadow) */
  intro: {page: number; dim: number; ring: number; lift: number} | null;
  /** 0..1 how far the action push-in is in (for the record; the camera already carries it) */
  push: number;
}
export interface Built {
  W: number; H: number; u: number; fps: number; frames: number;
  placed: Placed[];
  states: FrameState[];
  loopMix: number;
  /** absolute output frame at which each item's capture starts playing */
  playAt: number[];
  /** capture time (ms) shown at playAt: the start of the active range (sounds are placed at playAt + tMs - startMs) */
  startMs: number[];
  /** the action push-in beats (output frames: ramp in from a to b, hold to c, out to d) with their zoom */
  beats: {a: number; b: number; c: number; d: number; zoom: number}[];
}

const FOLLOW = 0.7; // how closely the camera centres the component's current box (a dropdown that opens glides the frame down)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (t: number) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
/** Context intro beats (seconds): the ring draws in, then the page falls away while the component lifts and the camera eases
 * onto it (one move), and the capture starts playing just before the camera lands. */
export const INTRO = {ring0: 0.12, ring1: 0.45, lift0: 0.5, lift1: 1.3, play: 1.15};
/** Height of the browser bar drawn above the context screenshot, in CSS px of the page. */
export const CHROME_BAR = 40;

interface Shot {
  start: number; end: number; // frames
  item: number; // hero item (cursor, tilt, play), -1 overview
  cx: number; cy: number; zoom: number; ry: number; rx: number;
  playAt: number; // frame (absolute) at which this item's capture starts (-1: none)
  dip: number;
  follow: boolean;
}

export function heroFraction(item: SpotlightItem, W: number, H: number, hero?: number): number {
  if (hero) return clamp(hero, 0.15, 0.95);
  const bs = item.meta.bbox.filter(Boolean).map((b) => b![2]).sort((a, b) => a - b);
  const w = bs.length ? bs[Math.floor(bs.length * 0.6)] : item.meta.image.cssW, h = item.meta.image.cssH;
  // a big hero, like the references (the UI takes 45-90% of the frame): small components still leave air around them
  // wide components fill about 60-70 % of the frame; the action push-in brings the detail closer when it matters
  let f = w <= 420 ? 0.5 : w <= 520 ? 0.56 : w <= 800 ? 0.62 : 0.68;
  if (W < H) f = Math.min(0.8, f + 0.14); // portrait frames are narrow (a wide component still leaves room to push in)
  return f;
}

/** The stretch of a capture where something happens (cursor moving, the component changing), without the idle lead and tail. */
export function activeRange(it: SpotlightItem, keepAll: boolean): [number, number] {
  const m = it.meta, N = m.frames;
  if (keepAll) return [0, N - 1];
  const cf = m.fps;
  let a = -1, b = -1;
  for (let i = 3; i < N; i++) {
    const c0 = m.cursor[i - 1], c1 = m.cursor[i];
    const b0 = m.bbox[i - 1], b1 = m.bbox[i];
    const moved = Math.hypot(c1[1] - c0[1], c1[2] - c0[2]) > 0.6 && c1[1] > -40 && c1[1] < m.image.cssW + 40 && c1[2] > -40 && c1[2] < m.image.cssH + 40;
    const grew = !!(b0 && b1 && (Math.abs(b1[2] - b0[2]) > 0.8 || Math.abs(b1[3] - b0[3]) > 0.8));
    if (moved || grew) { if (a < 0) a = i; b = i; }
  }
  if (a < 0) return [0, N - 1];
  return [Math.max(0, a - Math.round(0.22 * cf)), Math.min(N - 1, b + Math.round(0.55 * cf))];
}
/** Where the cursor first comes to rest inside the component (the thing the video is about to touch). */
export function firstDwell(m: SpotlightItem['meta'], from: number): {x: number; y: number} | null {
  let still = 0, travelled = 0;
  for (let i = from + 1; i < m.cursor.length; i++) {
    const a = m.cursor[i - 1], b = m.cursor[i];
    travelled += Math.hypot(b[1] - a[1], b[2] - a[2]);
    if (travelled < 60) continue; // the cursor has not started moving yet
    const inside = b[1] > 0 && b[1] < m.image.cssW && b[2] > 0 && b[2] < m.image.cssH;
    still = inside && Math.hypot(b[1] - a[1], b[2] - a[2]) < 0.35 ? still + 1 : 0;
    if (still >= 8) return {x: b[1], y: b[2]};
  }
  return null;
}
/** Zoom the camera needs for the text being worked to read (about 17 px at 1080p), capped. */
export function legibleZoom(it: SpotlightItem, s: number, u: number): number {
  const font = it.meta.hitFont ?? it.meta.font ?? 14;
  return Math.min(2.4, Math.max(1, (17 * u) / (Math.max(6, font) * s)));
}

export function buildTimeline(items: SpotlightItem[], o: SpotlightOptions, outFps?: number): Built {
  const {w: W, h: H} = aspectSize(o.aspect);
  const u = Math.min(W, H) / 1080;
  const fps = outFps ?? items[0]?.meta.fps ?? 60;
  const capFps = (it: SpotlightItem) => it.meta.fps;
  const pace = o.pace ?? 1;
  const n = items.length;
  const focusIdx = clamp(o.focus ?? 0, 0, n - 1);

  // ---------------------------------------------------------------- world layout
  const placed: Placed[] = [];
  let singleCentre = {x: 0, y: 0}; // a lone hero is framed on everything it ever paints (its union box), so an opening menu has its room
  const typical = (it: SpotlightItem) => {
    const ws = it.meta.bbox.filter(Boolean).map((b) => b![2]).sort((a, b) => a - b), hs = it.meta.bbox.filter(Boolean).map((b) => b![3]).sort((a, b) => a - b);
    return {w: ws.length ? ws[Math.floor(ws.length * 0.6)] : it.meta.image.cssW, h: hs.length ? hs[Math.floor(hs.length * 0.6)] : it.meta.image.cssH};
  };
  const fit = (it: SpotlightItem, sw: number, sh: number, cap = 2.0) => { const t = typical(it); return Math.min(sw / t.w, sh / t.h, cap, (0.8 * W) / it.meta.image.cssW * 1.6); };
  if (o.layout === 'single' || n === 1) {
    const it = items[0];
    const fw = heroFraction(it, W, H, o.hero);
    // size by the typical (median) box so a component that only grows for a moment is not tiny at rest; the union must still fit
    const ws = it.meta.bbox.filter(Boolean).map((b) => b![2]).sort((a, b) => a - b), hs = it.meta.bbox.filter(Boolean).map((b) => b![3]).sort((a, b) => a - b);
    const mw = ws.length ? ws[Math.floor(ws.length * 0.6)] : it.meta.image.cssW, mh = hs.length ? hs[Math.floor(hs.length * 0.6)] : it.meta.image.cssH;
    // the biggest it ever gets (the union of every frame's painted box; the image itself also holds the capture's padding)
    let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
    for (const b of it.meta.bbox) if (b) { ux0 = Math.min(ux0, b[0]); uy0 = Math.min(uy0, b[1]); ux1 = Math.max(ux1, b[0] + b[2]); uy1 = Math.max(uy1, b[1] + b[3]); }
    const uw = ux1 > ux0 ? ux1 - ux0 : it.meta.image.cssW, uh = uy1 > uy0 ? uy1 - uy0 : it.meta.image.cssH;
    const s = Math.min((fw * W) / mw, (0.7 * H) / mh, (0.88 * W) / uw, (0.78 * H) / uh);
    placed.push({x: 0, y: 0, z: 0, rot: 0, s, w: it.meta.image.cssW * s, h: it.meta.image.cssH * s});
    if (ux1 > ux0) singleCentre = {x: ((ux0 + ux1) / 2 - it.meta.image.cssW / 2) * s, y: ((uy0 + uy1) / 2 - it.meta.image.cssH / 2) * s};
  } else if (o.layout === 'carousel') {
    const gap = 0.12 * W;
    const raw = items.map((it) => { const s = fit(it, 0.56 * W, 0.7 * H, 2.4); return {s, w: it.meta.image.cssW * s, h: it.meta.image.cssH * s}; });
    const total = raw.reduce((a, r) => a + r.w, 0) + gap * (n - 1);
    let x = -total / 2;
    raw.forEach((r) => { placed.push({x: x + r.w / 2, y: 0, z: 0, rot: 0, s: r.s, w: r.w, h: r.h}); x += r.w + gap; });
  } else if (o.layout === 'collage') {
    const rot = [-3.5, 2.5, -1.5, 4, -2.5, 1.8];
    const zs = [0, -140, 90, -220, 40, -80];
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const s = fit(it, 0.46 * W * (0.9 + 0.2 * ((i * 7) % 3) / 2), 0.5 * H, 1.8);
      const a = i * 2.399 + 0.6, R = i === 0 ? 0 : (0.30 + 0.18 * Math.ceil(i / 3)) * W;
      placed.push({x: Math.cos(a) * R, y: Math.sin(a) * R * 0.62, z: zs[i % zs.length], rot: rot[i % rot.length], s, w: it.meta.image.cssW * s, h: it.meta.image.cssH * s});
    }
  } else { // grid
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const cw = 0.34 * W, ch = 0.30 * H, gx = 0.05 * W, gy = 0.06 * H;
    for (let i = 0; i < n; i++) {
      const it = items[i], r = Math.floor(i / cols), c = i % cols;
      const s = fit(it, cw, ch, 1.6);
      placed.push({x: (c - (cols - 1) / 2) * (cw + gx), y: (r - (rows - 1) / 2) * (ch + gy), z: 0, rot: 0, s, w: it.meta.image.cssW * s, h: it.meta.image.cssH * s});
    }
  }

  // ---------------------------------------------------------------- shots
  const sec = (s: number) => Math.round(s * fps);
  const shots: Shot[] = [];
  const loopMode = o.loop && (o.layout === 'single' || n === 1);
  const ranges = items.map((it) => activeRange(it, loopMode));
  // a lone hero keeps playing well past its last click: the result (a price that counts, a panel that settles) is the payoff
  if (!loopMode && (o.layout === 'single' || n === 1)) {
    const m = items[0].meta, last = Math.max(-1, ...m.clicks.map((c) => c.tMs), ...(m.keys ?? []).map((k) => k.tMs));
    if (last >= 0) ranges[0][1] = Math.min(m.frames - 1, Math.max(ranges[0][1], Math.round(((last / 1000) + 1.6) * m.fps)));
  }
  const durOf = (i: number) => Math.round(((ranges[i][1] - ranges[i][0] + 1) / capFps(items[i])) * fps);
  // context intro: only a lone hero whose capture saved the page (capture.mjs --context); off in a loop unless asked for
  const singleMode = o.layout === 'single' || n === 1;
  const ctx = singleMode ? items[0].meta.context : undefined;
  const introOn = !!ctx && (o.intro === 'on' || ((o.intro ?? 'auto') === 'auto' && !o.loop));
  const loopIntro = introOn && loopMode; // the intro every cycle: the end lowers the component back into the page (the seam)
  const loopX = loopMode && !loopIntro ? Math.min(Math.round(0.55 * fps), Math.floor(durOf(0) / 3)) : 0;
  // zoom each component needs for its text to read, kept within what the frame can show
  const zFit = (i: number) => { const t = typical(items[i]); return Math.min((0.94 * W) / (t.w * placed[i].s), (0.9 * H) / (t.h * placed[i].s)); };
  const zoomOf = (i: number) => Math.max(1, Math.min(legibleZoom(items[i], placed[i].s, u), Math.max(1, zFit(i)) * 1.3));
  let total = 0;
  const heroTilt = (i: number) => o.tilt * ((i % 2 ? 1 : -1) * 0.3);
  if (o.layout === 'single' || n === 1) {
    const pre = introOn ? sec(INTRO.play) : o.loop ? 0 : sec(0.5 * pace), post = loopIntro ? sec(INTRO.play + 0.25) : o.loop ? 0 : sec(0.55);
    const d = durOf(0) - loopX;
    // zoom 1: the hero is sized by the layout above; the action push-in brings the detail closer when it is used
    shots.push({start: 0, end: pre + d + post, item: 0, cx: singleCentre.x, cy: singleCentre.y, zoom: 1, ry: 0, rx: 0, playAt: pre, dip: 0, follow: true});
    total = pre + d + post;
  } else if (o.layout === 'carousel') {
    // the camera is already moving to the next component as the previous one resolves
    let t = 0;
    for (let i = 0; i < n; i++) {
      const tr = i === 0 ? sec(0.5 * pace) : sec(0.75 * pace), d = durOf(i);
      const playAt = t + Math.round(tr * 0.7), playEnd = playAt + d;
      const nextT = i < n - 1 ? playEnd - sec(0.3) : playEnd + sec(0.5);
      shots.push({start: t, end: nextT, item: i, cx: placed[i].x, cy: 0, zoom: zoomOf(i), ry: heroTilt(i) * 1.2, rx: 0, playAt, dip: 0.05, follow: true});
      t = nextT;
    }
    total = t;
  } else if (o.layout === 'collage') {
    let t = 0;
    const over = sec(1.1 * pace);
    // overview, then fly to each
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    placed.forEach((p) => { minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2); minY = Math.min(minY, p.y - p.h / 2); maxY = Math.max(maxY, p.y + p.h / 2); });
    const oz = clamp(Math.min((0.9 * W) / (maxX - minX), (0.86 * H) / (maxY - minY)), 0.3, 1);
    shots.push({start: 0, end: over, item: -1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom: oz, ry: -o.tilt * 0.5, rx: o.tilt * 0.2, playAt: -1, dip: 0, follow: false});
    t = over;
    for (let i = 0; i < n; i++) {
      const tr = sec(1.0 * pace), d = durOf(i), hold = sec(0.35);
      const p = placed[i];
      const z = Math.max(clamp(((0.5 * W) / p.w), 0.9, 1.5), zoomOf(i));
      shots.push({start: t, end: t + tr + d + hold, item: i, cx: p.x, cy: p.y, zoom: z, ry: (i % 2 ? 1 : -1) * o.tilt * 0.8 - p.rot, rx: (i % 3 - 1) * o.tilt * 0.25, playAt: t + tr * 0.8, dip: 0.28, follow: true});
      t += tr + d + hold;
    }
    total = t + sec(0.3); shots[shots.length - 1].end = total;
  } else { // grid: overview, push into one, play, pull out
    const over = sec(1.0 * pace);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    placed.forEach((p) => { minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2); minY = Math.min(minY, p.y - p.h / 2); maxY = Math.max(maxY, p.y + p.h / 2); });
    const oz = clamp(Math.min((0.9 * W) / (maxX - minX), (0.86 * H) / (maxY - minY)), 0.3, 1);
    const ov = {item: -1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom: oz, ry: -o.tilt * 0.45, rx: o.tilt * 0.15, playAt: -1, dip: 0, follow: false};
    shots.push({start: 0, end: over, ...ov});
    const p = placed[focusIdx], d = durOf(focusIdx), tr = sec(1.1 * pace), hold = sec(0.4);
    const z = Math.max(clamp((0.56 * W) / p.w, 1, 3), zoomOf(focusIdx));
    shots.push({start: over, end: over + tr + d + hold, item: focusIdx, cx: p.x, cy: p.y, zoom: z, ry: -o.tilt * 0.4, rx: 0, playAt: over + tr * 0.85, dip: 0, follow: true});
    const t2 = over + tr + d + hold;
    shots.push({start: t2, end: t2 + sec(1.0), ...ov});
    total = t2 + sec(1.0);
  }
  if (o.loop && o.layout === 'single' && !loopIntro) total = durOf(0) - loopX;

  // ---------------------------------------------------------------- action push-in beats (single hero)
  // Scheduled from the capture's clicks / key presses (hovers when there are none), never from cursor motion: each cluster of
  // actions gets ONE ease in toward the control(s) it touches, a hold while the result animates, and an ease back out.
  const beats: {a: number; b: number; c: number; d: number; zoom: number; cx: number; cy: number}[] = [];
  let comp = {x0: 0, y0: 0, x1: 0, y1: 0};
  if (singleMode && (o.push ?? 1.35) > 1.02) {
    const it = items[0], m = it.meta, ps = placed[0], cf = capFps(it);
    const pa = shots[0].playAt, startMs = (ranges[0][0] / cf) * 1000;
    const outF = (tMs: number) => pa + Math.round(((tMs - startMs) / 1000) * fps);
    const wx = (x: number) => (x - m.image.cssW / 2) * ps.s, wy = (y: number) => (y - m.image.cssH / 2) * ps.s;
    let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
    for (const bb of m.bbox) if (bb) { ux0 = Math.min(ux0, bb[0]); uy0 = Math.min(uy0, bb[1]); ux1 = Math.max(ux1, bb[0] + bb[2]); uy1 = Math.max(uy1, bb[1] + bb[3]); }
    if (!(ux1 > ux0)) { ux0 = 0; uy0 = 0; ux1 = m.image.cssW; uy1 = m.image.cssH; }
    comp = {x0: wx(ux0), y0: wy(uy0), x1: wx(ux1), y1: wy(uy1)};
    const frameAt = (tMs: number) => clamp(Math.round((tMs / 1000) * cf), 0, m.frames - 1);
    const cursorAt = (tMs: number) => { const c = m.cursor[frameAt(tMs)]; return {x: c[1], y: c[2]}; };
    let anchors: {t: number; x: number; y: number}[] = [
      ...m.clicks.filter((c) => c.kind === 'down').map((c) => ({t: c.tMs, x: c.x, y: c.y})),
      ...(m.keys ?? []).map((k) => ({t: k.tMs, ...cursorAt(k.tMs)})),
    ];
    if (!anchors.length) anchors = (m.hovers ?? []).map((h) => ({t: h.tMs, x: h.x, y: h.y}));
    const maxMs = (m.frames / cf) * 1000 - (loopX ? (loopX / fps) * 1000 : 0);
    anchors = anchors.filter((q) => q.t >= startMs && q.t <= maxMs).sort((p, q) => p.t - q.t);
    const IN = 0.8, LEAD = 0.15, HOLD = 1.1, OUT = 0.85, MERGE = 1.6; // seconds
    const clusters: {t0: number; t1: number; pts: typeof anchors}[] = [];
    for (const q of anchors) {
      const last = clusters[clusters.length - 1];
      if (last && (q.t / 1000 - LEAD - IN) - (last.t1 / 1000 + HOLD + OUT) < MERGE) { last.t1 = q.t; last.pts.push(q); }
      else clusters.push({t0: q.t, t1: q.t, pts: [q]});
    }
    // the control under each anchor: the smallest real box (cards) holding it, else a small square around the point
    const regionOf = (pts: typeof anchors) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of pts) {
        const cards = (m.cards?.[frameAt(q.t)] ?? []).filter((c) => q.x >= c[0] - 6 && q.x <= c[0] + c[2] + 6 && q.y >= c[1] - 6 && q.y <= c[1] + c[3] + 6 && c[2] * c[3] < 0.5 * (ux1 - ux0) * (uy1 - uy0)).sort((p, r) => p[2] * p[3] - r[2] * r[3]);
        const r = cards[0] ? [cards[0][0], cards[0][1], cards[0][0] + cards[0][2], cards[0][1] + cards[0][3]] : [q.x - 40, q.y - 24, q.x + 40, q.y + 24];
        x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]);
      }
      const pad = 48;
      return {x0: wx(x0 - pad), y0: wy(y0 - pad), x1: wx(x1 + pad), y1: wy(y1 + pad)};
    };
    const cmx = (comp.x0 + comp.x1) / 2, cmy = (comp.y0 + comp.y1) / 2;
    const lastPlay = pa + durOf(0) - loopX;
    for (const cl of clusters) {
      const R = regionOf(cl.pts);
      let Z = Math.max(1, Math.min(o.push ?? 1.35, 0.9 * Math.min(W / Math.max(1, R.x1 - R.x0), H / Math.max(1, R.y1 - R.y0))));
      // a component that would only just overflow the frame at Z is better shown whole and tidy (a centred push that fills
      // ~88 % of the frame) than cropped by a sliver; one much bigger than the frame gets the close-up on the control
      const zFitAll = Math.min((0.9 * W) / (comp.x1 - comp.x0), (0.88 * H) / (comp.y1 - comp.y0));
      if (Z > zFitAll && Z < zFitAll * 1.15) Z = zFitAll;
      // a close-up crops the component: worth it only when the controls span a good part of it on the cropped axis (a column
      // of settings in a tall panel). A lone small control (a toggle that changes prices across three cards) gets the whole
      // component, a little closer, instead of a crop through the cards it changes.
      if (Z > zFitAll) {
        const cropX = (comp.x1 - comp.x0) * Z > 0.98 * W, cropY = (comp.y1 - comp.y0) * Z > 0.98 * H;
        const spanX = (R.x1 - R.x0) / (comp.x1 - comp.x0), spanY = (R.y1 - R.y0) / (comp.y1 - comp.y0);
        if ((cropX && spanX < 0.3) || (cropY && spanY < 0.3)) Z = Math.max(1, zFitAll);
      }
      if (Z < 1.06) continue;
      // centre on the control, but keep the frame inside the component (a toggle at the top edge does not leave half a frame of empty stage)
      const hw = W / (2 * Z), hh = H / (2 * Z), mx = 0.03 * W / Z, my = 0.03 * H / Z;
      const axis = (rc: number, c0: number, c1: number, cm: number, h: number, mg: number) => (c1 - c0 + 2 * mg <= 2 * h ? cm : clamp(rc, c0 - mg + h, c1 + mg - h));
      const cx = axis((R.x0 + R.x1) / 2, comp.x0, comp.x1, cmx, hw, mx), cy = axis((R.y0 + R.y1) / 2, comp.y0, comp.y1, cmy, hh, my);
      let b = outF(cl.t0) - sec(LEAD), a = b - sec(IN);
      const minA = introOn ? pa + sec(0.15) : loopMode ? sec(0.1) : sec(0.35);
      if (a < minA) { a = minA; b = Math.max(b, a + sec(0.45)); }
      let c = outF(cl.t1) + sec(HOLD), d = c + sec(OUT);
      if (loopMode) { // the loop's seam (or its outro) must be at the resting framing
        const lim = loopIntro ? lastPlay - sec(0.1) : total - sec(0.1);
        if (d > lim) { d = lim; c = Math.min(c, d - sec(0.5)); }
        if (c <= b) continue;
      }
      beats.push({a, b, c, d, zoom: Z, cx, cy});
    }
    // a non-loop ends on the payoff: the whole component, held, after the last push-in has eased out
    if (!o.loop && beats.length) total = Math.max(total, beats[beats.length - 1].d + sec(1.0));
    if (!o.loop) shots[0].end = Math.max(shots[0].end, total);
  }
  const smoother = (t: number) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
  const pushAt = (f: number) => {
    let best = {p: 0, k: -1};
    beats.forEach((q, k) => {
      const p = f < q.a || f > q.d ? 0 : f < q.b ? smoother((f - q.a) / Math.max(1, q.b - q.a)) : f <= q.c ? 1 : 1 - smoother((f - q.c) / Math.max(1, q.d - q.c));
      if (p > best.p) best = {p, k};
    });
    return best;
  };
  const frames = Math.max(1, total);
  // the camera on the whole page (the browser window filling the frame) for the context intro
  let pageCam = {x: 0, y: 0, zoom: 1};
  if (introOn && ctx) {
    const m = items[0].meta, ps = placed[0], clip = m.clip ?? {x: 0, y: 0};
    const left = -ps.w / 2 - clip.x * ps.s, top = -ps.h / 2 - clip.y * ps.s, bar = CHROME_BAR * ps.s;
    const pw = ctx.w * ps.s, ph = ctx.h * ps.s + bar;
    pageCam = {x: left + pw / 2, y: top - bar + ph / 2, zoom: Math.min((W < H ? 0.92 : 0.88) * W / pw, 0.86 * H / ph)};
  }

  // ---------------------------------------------------------------- per-frame simulation (two laps in a loop so it settles periodic)
  const states: FrameState[] = [];
  const dt = 1 / fps;
  const DOFS = ['x', 'y', 'zoom', 'rx', 'ry', 'rz'] as const;
  type K = typeof DOFS[number];
  // critically damped (zeta 1): the camera eases onto its target and never passes it (0.88 overshot and came back: wobble)
  const omega: Record<K, number> = {x: 3.6 / pace, y: 3.6 / pace, zoom: 4.2 / pace, rx: 3.0 / pace, ry: 3.0 / pace, rz: 3.0 / pace};
  const zeta = 1;
  const pos: Record<K, number> = {x: 0, y: 0, zoom: 1, rx: 0, ry: 0, rz: 0}, vel: Record<K, number> = {x: 0, y: 0, zoom: 0, rx: 0, ry: 0, rz: 0};
  const shotAt = (f: number) => shots.find((s) => f >= s.start && f < s.end) ?? shots[shots.length - 1];

  const itemFrameFor = (i: number, f: number, sh: Shot): ItemFrame => {
    const it = items[i], N = it.meta.frames, cf = capFps(it);
    const play = shots.filter((s) => s.item === i && s.playAt >= 0);
    let local = ranges[i][0];
    if (play.length) {
      const pa = play[0].playAt;
      local = ranges[i][0] + clamp(Math.round(((f - pa) / fps) * cf), 0, ranges[i][1] - ranges[i][0]);
    }
    if (loopX && i === 0) {
      const L = N - Math.round(loopX * cf / fps);
      const X = Math.round(loopX * cf / fps);
      const k = Math.round((f / fps) * cf);
      if (k < X) return {frame: Math.min(N - 1, L + k), frame2: k, mix: k / X, active: true};
      return {frame: Math.min(N - 1, k), frame2: 0, mix: 0, active: true};
    }
    return {frame: local, frame2: local, mix: 0, active: sh.item === i};
  };

  const cursorNorm = (i: number, fr: ItemFrame) => {
    const m = items[i].meta, c1 = m.cursor[Math.min(m.cursor.length - 1, fr.frame)], c2 = m.cursor[Math.min(m.cursor.length - 1, fr.frame2)];
    const x = c1[1] + (c2[1] - c1[1]) * fr.mix, y = c1[2] + (c2[2] - c1[2]) * fr.mix;
    return {x: clamp(x / m.image.cssW - 0.5, -0.75, 0.75), y: clamp(y / m.image.cssH - 0.5, -0.75, 0.75)};
  };

  const laps = o.loop ? 3 : 1;
  let prevScreen = {x: 0, y: 0, zoom: 1, rot: 0};
  for (let lap = 0; lap < laps; lap++) {
    for (let f = 0; f < frames; f++) {
      const sh = shotAt(f);
      const local = f - sh.start, span = Math.max(1, sh.end - sh.start);
      const hero = sh.item >= 0 ? sh.item : focusIdx;
      const fr = items.map((_, i) => itemFrameFor(i, f, sh));
      const nrm = cursorNorm(hero, fr[hero]);
      const prog = f / Math.max(1, frames - 1);
      // target pose
      const tr = o.loop ? 0 : Math.min(span, sec(1.0 * pace));
      const dip = sh.dip * Math.sin(Math.PI * clamp(local / Math.max(1, tr), 0, 1));
      const t = f / fps;
      const p = placed[hero];
      let tx = sh.cx, ty = sh.cy;
      if (sh.follow && sh.item >= 0) {
        const m = items[sh.item].meta, ps = placed[sh.item], fi = fr[sh.item].frame;
        const b = m.bbox[Math.min(m.bbox.length - 1, fi)], cc = m.cursor[Math.min(m.cursor.length - 1, fi)];
        if (b) {
          const bx = ps.x + ((b[0] + b[2] / 2) - m.image.cssW / 2) * ps.s, by = ps.y + ((b[1] + b[3] / 2) - m.image.cssH / 2) * ps.s;
          const fol = shots.length === 1 ? FOLLOW * 0.5 : FOLLOW; // a lone hero mostly holds still: a menu that opens grows into the frame
          tx = sh.cx + (bx - sh.cx) * fol; ty = sh.cy + (by - sh.cy) * fol;
          // zoomed in on something bigger than the frame: the camera slides along with the cursor, inside the component
          const ox = Math.max(0, (b[2] * ps.s) / 2 + 36 * u - W / (2 * sh.zoom)), oy = Math.max(0, (b[3] * ps.s) / 2 + 36 * u - H / (2 * sh.zoom));
          tx += clamp(ps.x + (cc[1] - m.image.cssW / 2) * ps.s - bx, -ox, ox); ty += clamp(ps.y + (cc[2] - m.image.cssH / 2) * ps.s - by, -oy, oy);
        }
      }
      // 3D drift: ONE slow, steady sweep of the tilt over the whole clip (a full slow orbit in a loop). It never follows the
      // cursor, so the component does not rock every time the pointer moves.
      const single = shots.length === 1;
      const sweep = smooth(prog) * 2 - 1; // -1 .. 1 across the clip
      const push = single ? (introOn ? 1 + 0.02 * prog : 0.955 + 0.045 * smooth(f / Math.max(1, sec(1.3 * pace))) + 0.035 * prog) : 1 + 0.04 * smooth(local / span) - dip; // gentle push-in (or the intro), then a slow creep
      let target: Record<K, number>;
      if (o.loop) {
        const ph = (f / frames) * Math.PI * 2;
        target = {x: tx, y: ty, zoom: sh.zoom * (1 + 0.012 * Math.sin(ph)), rx: o.tilt * 0.16 * Math.cos(ph), ry: o.tilt * 0.42 * Math.sin(ph), rz: 0};
      } else {
        target = {
          x: tx, y: ty,
          zoom: sh.zoom * push,
          rx: sh.rx + (single ? o.tilt * 0.12 : 0),
          ry: sh.ry + (single ? o.tilt * 0.42 * sweep : 0),
          rz: 0,
        };
      }
      if (lap === 0 && f === 0) {
        pos.x = target.x; pos.y = target.y; pos.zoom = target.zoom; pos.rx = target.rx; pos.ry = target.ry; pos.rz = target.rz;
      }
      // semi-implicit integration (4 substeps)
      for (let s4 = 0; s4 < 4; s4++) {
        for (const k of DOFS) {
          const w = omega[k];
          const a = w * w * (target[k] - pos[k]) - 2 * zeta * w * vel[k];
          vel[k] += a * (dt / 4); pos[k] += vel[k] * (dt / 4);
        }
      }
      if (lap === laps - 1) {
        // scheduled moves on top of the spring (exact timing, no lag): the action push-in, then the context intro / outro
        const cam = {x: pos.x, y: pos.y, zoom: pos.zoom, rx: pos.rx, ry: pos.ry, rz: pos.rz};
        const pu = pushAt(f);
        if (pu.k >= 0) {
          const q = beats[pu.k];
          cam.zoom *= 1 + (q.zoom - 1) * pu.p; cam.x += (q.cx - cam.x) * pu.p; cam.y += (q.cy - cam.y) * pu.p;
          cam.rx *= 1 - 0.6 * pu.p; cam.ry *= 1 - 0.6 * pu.p; // flatter while the detail is close: crisper, no lean
        }
        let intro: FrameState['intro'] = null;
        if (introOn && ctx) {
          const ti = f / fps, to = loopIntro ? (frames - 1 - f) / fps : Infinity, tt = Math.min(ti, to);
          const e = easeInOut((tt - INTRO.lift0) / (INTRO.lift1 - INTRO.lift0));
          const ringIn = smooth((tt - INTRO.ring0) / (INTRO.ring1 - INTRO.ring0));
          intro = {
            page: 1 - smooth((tt - INTRO.lift0 - 0.05) / 0.6),
            dim: 0.97 - 0.33 * ringIn,
            ring: ringIn * (1 - smooth((tt - INTRO.lift0 - 0.2) / 0.4)),
            lift: e,
          };
          if (e < 1) {
            const pz = pageCam.zoom;
            cam.zoom = Math.exp(Math.log(pz) + (Math.log(cam.zoom) - Math.log(pz)) * e);
            cam.x = pageCam.x + (cam.x - pageCam.x) * e; cam.y = pageCam.y + (cam.y - pageCam.y) * e;
            cam.rx *= e; cam.ry *= e; cam.rz *= e;
          }
        }
        const screen = {x: cam.x * cam.zoom, y: cam.y * cam.zoom, zoom: Math.log(cam.zoom), rot: cam.ry + cam.rx * 0.5 + cam.rz};
        const sp = {x: screen.x - prevScreen.x, y: screen.y - prevScreen.y, z: screen.zoom - prevScreen.zoom, rot: screen.rot - prevScreen.rot};
        prevScreen = screen;
        // depth of field is scheduled, never driven by camera speed (that pumped the blur on every cursor move): soft only
        // while the camera travels between components; pin sharp the rest of the time, including the first and last frames
        // (the owner, 2026-11-24: no blur at the start and end). A loop has none.
        let arriving = 0;
        if (!o.loop) {
          for (const q of shots) if (q.start > 0) { // travelling to the next component
            const a0 = q.start - sec(0.15), a1 = q.start + Math.min(q.end - q.start, sec(0.85 * pace));
            if (f > a0 && f < a1) arriving = Math.max(arriving, 0.8 * Math.sin(Math.PI * (f - a0) / (a1 - a0)));
          }
        }
        const c0 = introOn ? shots[0].playAt : o.loop ? 0 : sec(0.05);
        const c1 = loopIntro ? frames - shots[0].playAt + sec(0.1) : frames;
        const cAlpha = clamp((f - c0) / sec(introOn ? 0.3 : 0.2), 0, 1) * clamp((c1 - f) / sec(0.25), 0, 1);
        states.push({
          cam,
          vel: f === 0 ? {x: 0, y: 0, z: 0, rot: 0} : {x: sp.x, y: sp.y, z: sp.z, rot: sp.rot},
          items: fr, hero, arrive: arriving, cursorAlpha: o.loop && !loopIntro ? 1 : cAlpha, intro, push: pu.p,
          titleAlpha: o.title || o.wordmark ? clamp((f - sec(0.25)) / sec(0.5), 0, 1) * clamp((frames - f) / sec(0.6), 0, 1) : 0,
        });
      }
    }
  }
  const playAt = items.map((_, i) => shots.find((x) => x.item === i && x.playAt >= 0)?.playAt ?? 0);
  const startMs = items.map((it, i) => (loopX && i === 0 ? 0 : (ranges[i][0] / capFps(it)) * 1000));
  return {W, H, u, fps, frames, placed, states, loopMix: loopX, playAt, startMs, beats: beats.map(({a, b, c, d, zoom}) => ({a, b, c, d, zoom}))};
}
