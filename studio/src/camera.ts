// Camera, cursor and time mapping. Shared by the planner (sanity checks) and the renderer, and
// evaluated at RENDER time on top of plan.json, so the zoom amount / speed / follow knobs in the
// style work live in a Remotion Player without re-planning. Pure TypeScript, no DOM.
import {motionDefaults, type Plan, type Style, type SpeedSegment} from './types.ts';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smootherstep = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// ------------------------------------------------------------------ cursor smoothing
/** One-euro filter (Casiez et al.) over [t,x,y] samples. amount 0 = raw, 1 = very smooth. */
export function smoothCursor(raw: [number, number, number][], amount: number): [number, number, number][] {
  if (raw.length === 0 || amount <= 0) return raw;
  const minCutoff = lerp(40, 1.6, clamp(amount, 0, 1)); // Hz, applied when the cursor is slow
  const beta = 0.012; // speed coefficient: fast moves loosen the filter, so there is little lag
  const dCut = 1.2;
  const alpha = (cut: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cut * dt));
  const out: [number, number, number][] = [[raw[0][0], raw[0][1], raw[0][2]]];
  let dx = 0, dy = 0;
  for (let i = 1; i < raw.length; i++) {
    const dt = Math.max(1e-3, (raw[i][0] - raw[i - 1][0]) / 1000);
    const rdx = (raw[i][1] - raw[i - 1][1]) / dt, rdy = (raw[i][2] - raw[i - 1][2]) / dt;
    const ad = alpha(dCut, dt);
    dx = lerp(dx, rdx, ad);
    dy = lerp(dy, rdy, ad);
    const speed = Math.hypot(dx, dy);
    const a = alpha(minCutoff + beta * speed, dt);
    out.push([raw[i][0], lerp(out[i - 1][1], raw[i][1], a), lerp(out[i - 1][2], raw[i][2], a)]);
  }
  return out;
}

/** Sample a [t,x,y] path (sorted) at time t with linear interpolation. `hint` speeds up sequential calls. */
export function samplePath(path: [number, number, number][], t: number, hint = {i: 0}): [number, number] {
  const n = path.length;
  if (n === 0) return [0, 0];
  if (t <= path[0][0]) return [path[0][1], path[0][2]];
  if (t >= path[n - 1][0]) return [path[n - 1][1], path[n - 1][2]];
  let i = hint.i;
  if (i >= n - 1 || path[i][0] > t) i = 0;
  while (i < n - 2 && path[i + 1][0] <= t) i++;
  hint.i = i;
  const a = path[i], b = path[i + 1];
  const k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
  return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

// ------------------------------------------------------------------ layout
export interface Layout {
  canvasW: number; canvasH: number;
  /** Window box incl. chrome, canvas px. */
  box: {x: number; y: number; w: number; h: number};
  chromeH: number;
  /** The video viewport inside the box, canvas px. */
  content: {x: number; y: number; w: number; h: number};
  viewAspect: number;
  /** canvas px per 1080p px. */
  u: number;
}

export function computeLayout(plan: Plan, style: Style): Layout {
  const {width: sw, height: sh} = plan.source;
  const ratio = {'16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, source: sw / sh}[style.aspect] ?? 16 / 9;
  const short = style.resolution === '4k' ? 2160 : style.resolution === '1080p' ? 1080 : Math.min(sw, sh);
  let canvasW = ratio >= 1 ? Math.round(short * ratio) : short;
  let canvasH = ratio >= 1 ? short : Math.round(short / ratio);
  canvasW += canvasW % 2; canvasH += canvasH % 2;
  const u = Math.min(canvasW, canvasH) / 1080;
  const pad = (Math.min(canvasW, canvasH) * style.padding) / 100;
  const aw = canvasW - 2 * pad, ah = canvasH - 2 * pad;
  const chromeH = style.frame === 'none' ? 0 : (style.frame === 'browser' ? 46 : 36) * u;
  let cw: number, ch: number;
  if (style.fit === 'crop') {
    cw = aw; ch = ah - chromeH;
  } else {
    const srcAsp = sw / sh;
    cw = Math.min(aw, (ah - chromeH) * srcAsp);
    ch = cw / srcAsp;
  }
  const bw = cw, bh = ch + chromeH;
  const bx = (canvasW - bw) / 2, by = (canvasH - bh) / 2;
  return {
    canvasW, canvasH, u, chromeH,
    box: {x: bx, y: by, w: bw, h: bh},
    content: {x: bx, y: by + chromeH, w: cw, h: ch},
    viewAspect: cw / ch,
  };
}

// ------------------------------------------------------------------ time mapping
export interface Piece {outStart: number; frames: number; srcStartMs: number; speed: number}

/** Idle speed-ups, capped at style.maxSpeed (default 2x: faster ramps smear and judder; cut the stretch instead). */
export function speedSegments(plan: Plan, style: Style): SpeedSegment[] {
  if (!style.idleSpeedup) return [];
  const cap = Math.max(1, style.maxSpeed ?? motionDefaults.pacing.maxSpeed);
  return [...plan.speed].sort((a, b) => a.startMs - b.startMs).map((s) => (s.cut ? s : {...s, speed: Math.min(s.speed, cap)}));
}

/** Source time (ms) for every output frame: honours idle speed-ups and cuts. */
export function mapTime(plan: Plan, style: Style, fps: number): number[] {
  const segs = speedSegments(plan, style);
  const step = 1000 / fps;
  const out: number[] = [];
  let t = 0, si = 0;
  const dur = plan.source.durationMs;
  while (t < dur - 1e-6 && out.length < 1e6) {
    while (si < segs.length && segs[si].endMs <= t) si++;
    const seg = segs[si];
    if (seg && t >= seg.startMs && seg.cut) { t = seg.endMs; continue; }
    out.push(t);
    t += step * (seg && t >= seg.startMs ? seg.speed : 1);
  }
  if (out.length === 0) out.push(0);
  return out;
}

export function outFrameCount(plan: Plan, style: Style, fps: number): number {
  return mapTime(plan, style, fps).length;
}

/** Runs of constant playback speed, for <Sequence><OffthreadVideo playbackRate/> pieces. */
export function videoPieces(src: number[], fps: number): Piece[] {
  const step = 1000 / fps;
  const pieces: Piece[] = [];
  for (let i = 0; i < src.length; i++) {
    const sp = i + 1 < src.length ? (src[i + 1] - src[i]) / step : pieces.length ? pieces[pieces.length - 1].speed : 1;
    const last = pieces[pieces.length - 1];
    if (last && Math.abs(last.speed - sp) < 0.02 && i + 1 < src.length + 1 && Math.abs(src[i] - (last.srcStartMs + last.frames * step * last.speed)) < step * 1.5) {
      last.frames++;
    } else {
      pieces.push({outStart: i, frames: 1, srcStartMs: src[i], speed: Math.max(0.1, Math.round(sp * 100) / 100)});
    }
  }
  return pieces;
}

// ------------------------------------------------------------------ camera timeline
export interface Frame {
  src: number;
  /** View rectangle in source pixels. */
  vx: number; vy: number; vw: number; vh: number;
  /** Cursor in source pixels and its opacity (0..1). */
  cx: number; cy: number; co: number;
  /** How far in the camera is, 0 (whole recording) .. 1 (the deepest zoom of this plan). */
  env: number;
}

export interface Timeline {frames: Frame[]; layout: Layout; src: number[]}

/** A camera pose: the centre and width of the view rectangle, source px. */
interface Pose {cx: number; cy: number; w: number}
/** One eased camera move, in OUTPUT seconds (so an idle speed-up or a cut never changes how long a move takes on screen). */
export interface Move {t0: number; t1: number; from: Pose; to: Pose; kind: 'in' | 'pan' | 'out'}

/**
 * The planned camera track: every zoom of the plan as eased moves between poses.
 *  - zoom in: lands when the plan says the ease ends (startMs + inMs), so it is there before the click;
 *  - two zooms that touch, overlap or sit closer than minDwellMs: no pull-out in between, the camera glides from one focus to the next;
 *  - zoom out: starts at endMs - outMs. A zoom that runs to the end of the recording (outMs 0) is simply held.
 * Moves never overlap, each is a smootherstep (ease-in-out, zero speed and acceleration at both ends, no overshoot).
 */
export function cameraMoves(plan: Plan, style: Style, fps: number, src: number[], base: Pose, baseH: number): Move[] {
  const {width: W, height: H} = plan.source;
  const zmul = Math.max(0, style.zoom.amount);
  const speed = Math.max(0.2, style.zoom.speed);
  const T = src.length / fps;
  const outOf = (ms: number) => { // source ms -> output seconds
    let lo = 0, hi = src.length - 1;
    if (ms <= src[0]) return 0;
    if (ms >= src[hi]) return hi / fps + Math.max(0, ms - src[hi]) / 1000;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (src[mid] <= ms) lo = mid; else hi = mid; }
    return (lo + (ms - src[lo]) / Math.max(1e-6, src[hi] - src[lo])) / fps;
  };
  const zs = (style.zoom.auto ? plan.zooms : [])
    .map((z) => {
      const m = 1 + (z.scale - 1) * zmul * (base.w < W - 0.5 || baseH < H - 0.5 ? 0.6 : 1);
      const w = base.w / m, h = baseH / m;
      return {z, m, pose: {cx: clamp(z.center.x, w / 2, W - w / 2), cy: clamp(z.center.y, h / 2, H - h / 2), w}};
    })
    .filter((q) => q.m > 1.01 && q.z.endMs > q.z.startMs)
    .sort((a, b) => a.z.startMs - b.z.startMs);
  // a plan from the current planner already joined what should be joined (its zooms touch); an older or hand-made plan is joined here
  const dwell = plan.params?.minDwellMs !== undefined ? 50 : motionDefaults.camera.minDwellMs;
  const moves: Move[] = [];
  const MIN = 0.3; // no move shorter than this on screen
  let cur: Pose = base, free = 0; // pose held now, and when the camera is free to move again
  for (let i = 0; i < zs.length; i++) {
    const {z, pose} = zs[i];
    const prev = zs[i - 1], next = zs[i + 1];
    const bridgedIn = !!prev && z.startMs - prev.z.endMs < dwell;
    const bridgedOut = !!next && next.z.startMs - z.endMs < dwell;
    // arrive: finished where the plan's ease ends
    const durIn = Math.max(MIN, (z.inMs || motionDefaults.camera.zoomInMs) / speed / 1000);
    let t1 = outOf(z.startMs + (z.inMs || 0)), t0 = t1 - durIn;
    if (t0 < free) { t0 = free; t1 = Math.max(t1, t0 + Math.min(durIn, MIN + 0.15)); }
    if (t0 < T - 0.05) {
      moves.push({t0, t1, from: cur, to: pose, kind: bridgedIn && cur !== base ? 'pan' : 'in'});
      cur = pose; free = t1;
    }
    if (bridgedOut) continue;
    // leave: only if the plan asks for it and there is room before the end
    if (!(z.outMs > 0) || cur === base) continue;
    const durOut = Math.max(MIN, z.outMs / speed / 1000);
    let o0 = Math.max(free, outOf(z.endMs - z.outMs));
    if (o0 + durOut > T) o0 = Math.max(free, T - durOut - 1 / fps);
    if (o0 + durOut > T + 0.5 / fps) continue; // no room: hold the zoom to the end instead of cutting a pull-out mid-move
    moves.push({t0: o0, t1: o0 + durOut, from: cur, to: base, kind: 'out'});
    cur = base; free = o0 + durOut;
  }
  return moves;
}

function poseAt(moves: Move[], base: Pose, t: number, hint: {i: number}): {pose: Pose; next: Pose} {
  let i = hint.i;
  if (i >= moves.length || (i > 0 && moves[i - 1].t1 > t)) i = 0;
  while (i < moves.length && moves[i].t1 <= t) i++;
  hint.i = i;
  const held = i > 0 ? moves[i - 1].to : base;
  const m = moves[i];
  if (!m) return {pose: held, next: held};
  if (t <= m.t0) return {pose: held, next: m.t0 - t < 1.2 ? m.to : held};
  const e = smootherstep((t - m.t0) / (m.t1 - m.t0));
  // a long glide at full zoom eases slightly wider in the middle, so the page does not smear past
  const dist = Math.hypot(m.to.cx - m.from.cx, m.to.cy - m.from.cy);
  const widen = m.kind === 'pan' ? 1 + 0.1 * Math.min(1, dist / Math.max(1, Math.max(m.from.w, m.to.w))) * Math.sin(Math.PI * e) : 1;
  return {pose: {cx: lerp(m.from.cx, m.to.cx, e), cy: lerp(m.from.cy, m.to.cy, e), w: lerp(m.from.w, m.to.w, e) * widen}, next: m.to};
}

/**
 * Builds the whole camera/cursor track (one entry per output frame). Deterministic, cheap
 * (about 1.5k frames for a 50 s clip), so the renderer computes it once per (plan, style).
 *
 * Camera = the planned track (cameraMoves: exact eased moves, no spring) + a follow offset. The follow offset only wakes up when the
 * cursor leaves the safe middle of the view; its target is clamped to the recording and it is chased by a critically damped spring,
 * so it glides and never overshoots. While a planned move is under way (or about to start) the dead zone of the pose the camera is
 * heading to counts too, so the camera does not chase a cursor that is only travelling to the next shot.
 */
export function buildTimeline(plan: Plan, style: Style, fps: number): Timeline {
  const layout = computeLayout(plan, style);
  const {width: W, height: H} = plan.source;
  const srcAsp = W / H;
  const va = layout.viewAspect;
  const baseW = va > srcAsp ? W : H * va;
  const baseH = va > srcAsp ? W / va : H;
  const cropped = baseW < W - 0.5 || baseH < H - 0.5;
  const src = mapTime(plan, style, fps);
  const MC = motionDefaults.camera, MK = motionDefaults.cursor;

  const cursor = style.cursor.smoothing === plan.params?.cursorSmoothing && plan.cursor.length
    ? plan.cursor
    : smoothCursor(plan.cursorRaw.length ? plan.cursorRaw : plan.cursor, style.cursor.smoothing);

  const base: Pose = {cx: W / 2, cy: H / 2, w: baseW};
  const moves = cameraMoves(plan, style, fps, src, base, baseH);
  const minW = Math.min(baseW, ...moves.map((m) => m.to.w));
  const follow = clamp(style.zoom.follow, 0, 1);
  const omega = lerp(MC.followOmega[0], MC.followOmega[1], follow);
  const dt = 1 / fps;
  const ee = Math.exp(-omega * dt);
  const hint = {i: 0}, mh = {i: 0};
  const clicks = plan.clicks.map((c) => c.tMs);
  const idleMs = style.cursor.idleMs ?? MK.idleHideMs;

  const frames: Frame[] = [];
  let ox = 0, oy = 0, ovx = 0, ovy = 0; // follow offset and its speed
  let sx = 0, sy = 0; // the eased follow target
  let lastMoveT = -1e9, co = 1;
  let prevC: [number, number] | null = null;
  const dz = 0.5 - MC.safeMargin;
  // how far the cursor is outside the safe middle of a pose, per axis
  const excess = (p: Pose, x: number, y: number): [number, number] => {
    const h = p.w / va, dx = x - p.cx, dy = y - p.cy;
    return [Math.sign(dx) * Math.max(0, Math.abs(dx) - dz * p.w), Math.sign(dy) * Math.max(0, Math.abs(dy) - dz * h)];
  };
  for (let i = 0; i < src.length; i++) {
    const t = src[i];
    const {pose, next} = poseAt(moves, base, i / fps, mh);
    const vw = Math.min(baseW, pose.w), vh = vw / va;
    const [cxp, cyp] = samplePath(cursor, t, hint);
    // follow target: how far to shift so the cursor is back inside the safe middle, kept inside the recording. While a planned
    // move is under way (or about to start) the same is worked out for the pose it is heading to, and the smaller shift wins.
    const ax = clamp(pose.cx, vw / 2, W - vw / 2), ay = clamp(pose.cy, vh / 2, H - vh / 2);
    const shift = (p: Pose, px: number, py: number, w: number): [number, number] => {
      const h = w / va;
      const [ex, ey] = cropped && w > baseW - 0.5 ? [cxp - px, cyp - py] : excess({...p, cx: px, cy: py, w}, cxp, cyp); // crop mode at rest: the narrow view always goes with the cursor
      return [clamp(px + follow * ex, w / 2, W - w / 2) - px, clamp(py + follow * ey, h / 2, H - h / 2) - py];
    };
    let [tx, ty] = shift(pose, ax, ay, vw);
    if (next !== pose) {
      const nw = Math.min(baseW, next.w), nh = nw / va;
      const [bx, by] = shift(next, clamp(next.cx, nw / 2, W - nw / 2), clamp(next.cy, nh / 2, H - nh / 2), nw);
      if (Math.abs(bx) < Math.abs(tx)) tx = bx;
      if (Math.abs(by) < Math.abs(ty)) ty = by;
    }
    // the target itself is eased first (a cursor that jumps would otherwise kick the spring: an acceleration step, felt as a jolt)
    const pre = 1 - Math.exp(-2.5 * omega * dt);
    if (i === 0) { sx = tx; sy = ty; ox = tx; oy = ty; }
    sx += (tx - sx) * pre; sy += (ty - sy) * pre;
    tx = sx; ty = sy;
    const ddx = ox - tx, tmpx = (ovx + omega * ddx) * dt;
    ox = tx + (ddx + tmpx) * ee; ovx = (ovx - omega * tmpx) * ee;
    const ddy = oy - ty, tmpy = (ovy + omega * ddy) * dt;
    oy = ty + (ddy + tmpy) * ee; ovy = (ovy - omega * tmpy) * ee;
    const fx = clamp(ax + ox, vw / 2, W - vw / 2), fy = clamp(ay + oy, vh / 2, H - vh / 2);

    // cursor: fades out after a rest, fades back in when it moves again
    if (!prevC || Math.hypot(cxp - prevC[0], cyp - prevC[1]) > 0.6) lastMoveT = t;
    prevC = [cxp, cyp];
    if (style.cursor.hideWhenIdle) {
      let lastAct = lastMoveT;
      for (const c of clicks) if (c <= t && c > lastAct) lastAct = c;
      const want = t - lastAct < idleMs ? 1 : 0;
      co = i === 0 ? want : want > co ? Math.min(1, co + (dt * 1000) / MK.fadeInMs) : Math.max(0, co - (dt * 1000) / MK.fadeOutMs);
    } else co = 1;
    frames.push({src: t, vx: fx - vw / 2, vy: fy - vh / 2, vw, vh, cx: cxp, cy: cyp, co: co * co * (3 - 2 * co), env: baseW - minW > 1 ? clamp((baseW - vw) / (baseW - minW), 0, 1) : 0});
  }
  return {frames, layout, src};
}
