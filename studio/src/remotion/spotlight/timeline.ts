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
}
export interface Built {
  W: number; H: number; u: number; fps: number; frames: number;
  placed: Placed[];
  states: FrameState[];
  loopMix: number;
  /** absolute output frame at which each item's capture starts playing */
  playAt: number[];
}

const FOLLOW = 0.7; // how closely the camera centres the component's current box (a dropdown that opens glides the frame down)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

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
  let f = w <= 420 ? 0.52 : w <= 520 ? 0.58 : w <= 800 ? 0.68 : 0.76;
  if (W < H) f = Math.min(0.84, f + 0.2); // portrait frames are narrow
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
    const s = Math.min((fw * W) / mw, (0.72 * H) / mh, (0.88 * W) / uw, (0.8 * H) / uh);
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
  const durOf = (i: number) => Math.round(((ranges[i][1] - ranges[i][0] + 1) / capFps(items[i])) * fps);
  const loopX = loopMode ? Math.min(Math.round(0.55 * fps), Math.floor(durOf(0) / 3)) : 0;
  // zoom each component needs for its text to read, kept within what the frame can show
  const zFit = (i: number) => { const t = typical(items[i]); return Math.min((0.94 * W) / (t.w * placed[i].s), (0.9 * H) / (t.h * placed[i].s)); };
  const zoomOf = (i: number) => Math.max(1, Math.min(legibleZoom(items[i], placed[i].s, u), Math.max(1, zFit(i)) * 1.3));
  let total = 0;
  const heroTilt = (i: number) => o.tilt * ((i % 2 ? 1 : -1) * 0.3);
  if (o.layout === 'single' || n === 1) {
    const pre = o.loop ? 0 : sec(0.5 * pace), post = o.loop ? 0 : sec(0.55);
    const d = durOf(0) - loopX;
    shots.push({start: 0, end: pre + d + post, item: 0, cx: singleCentre.x, cy: singleCentre.y, zoom: Math.min(zoomOf(0), 1.25), ry: 0, rx: 0, playAt: pre, dip: 0, follow: true});
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
  if (o.loop && o.layout === 'single') total = durOf(0) - loopX;
  const frames = Math.max(1, total);

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
      const push = single ? 0.955 + 0.045 * smooth(f / Math.max(1, sec(1.3 * pace))) + 0.035 * prog : 1 + 0.04 * smooth(local / span) - dip; // gentle push-in, then a slow creep
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
        const screen = {x: pos.x * pos.zoom, y: pos.y * pos.zoom, zoom: Math.log(pos.zoom), rot: pos.ry + pos.rx * 0.5 + pos.rz};
        const sp = {x: screen.x - prevScreen.x, y: screen.y - prevScreen.y, z: screen.zoom - prevScreen.zoom, rot: screen.rot - prevScreen.rot};
        prevScreen = screen;
        // depth of field is scheduled, never driven by camera speed (that pumped the blur on every cursor move): soft on the
        // entrance, on the exit and while the camera travels between components; pin sharp the rest of the time. A loop has none.
        let arriving = 0;
        if (!o.loop) {
          const inF = sec(0.75 * pace), outF = sec(0.4);
          arriving = Math.max(arriving, 1 - smooth(f / inF), 0.7 * smooth((f - (frames - outF)) / outF));
          for (const q of shots) if (q.start > 0) { // travelling to the next component
            const a0 = q.start - sec(0.15), a1 = q.start + Math.min(q.end - q.start, sec(0.85 * pace));
            if (f > a0 && f < a1) arriving = Math.max(arriving, 0.8 * Math.sin(Math.PI * (f - a0) / (a1 - a0)));
          }
        }
        const cAlpha = clamp((f - (o.loop ? 0 : sec(0.05))) / sec(0.2), 0, 1) * clamp((frames - f) / sec(0.25), 0, 1);
        states.push({
          cam: {x: pos.x, y: pos.y, zoom: pos.zoom, rx: pos.rx, ry: pos.ry, rz: pos.rz},
          vel: f === 0 ? {x: 0, y: 0, z: 0, rot: 0} : {x: sp.x, y: sp.y, z: sp.z, rot: sp.rot},
          items: fr, hero, arrive: arriving, cursorAlpha: o.loop ? 1 : cAlpha,
          titleAlpha: o.title || o.wordmark ? clamp((f - sec(0.25)) / sec(0.5), 0, 1) * clamp((frames - f) / sec(0.6), 0, 1) : 0,
        });
      }
    }
  }
  const playAt = items.map((_, i) => shots.find((x) => x.item === i && x.playAt >= 0)?.playAt ?? 0);
  return {W, H, u, fps, frames, placed, states, loopMix: loopX, playAt};
}
