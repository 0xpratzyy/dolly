// Planner: events.json -> plan.json. Pure TypeScript (runs under plain Node).
import {defaultPlanParams, motionDefaults, type Events, type Plan, type PlanParams, type SpeedSegment, type Zoom} from './types.ts';
import {samplePath, smoothCursor} from './camera.ts';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r1 = (n: number) => Math.round(n * 10) / 10;

interface Action {t: number; x: number; y: number; kind: 'click' | 'key'}
type Bbox = {x0: number; y0: number; x1: number; y1: number};
const M = motionDefaults.camera;
interface Cluster {
  actions: Action[];
  x0: number; y0: number; x1: number; y1: number; // bbox of click/key points
  first: number; last: number;
}

export function planFromEvents(ev: Events, overrides: Partial<PlanParams> = {}): Plan {
  const P: PlanParams = {...defaultPlanParams, ...overrides};
  const W = ev.width, H = ev.height, dur = ev.durationMs;
  const stepMs = 1000 / ev.fps;
  const rawIn = [...ev.cursor].sort((a, b) => a[0] - b[0]);

  // 1. cursor resampled to one sample per frame, then smoothed
  const cursorRaw: [number, number, number][] = [];
  const hint = {i: 0};
  for (let t = 0; t <= dur + 1e-6; t += stepMs) {
    const [x, y] = samplePath(rawIn, t, hint);
    cursorRaw.push([Math.round(t * 10) / 10, r1(x), r1(y)]);
  }
  const cursor = smoothCursor(cursorRaw, P.cursorSmoothing).map(([t, x, y]) => [t, r1(x), r1(y)] as [number, number, number]);
  const at = (t: number): [number, number] => samplePath(rawIn, t);

  // 2. actions. Clicks and keys make shots; scrolling never starts a zoom, and the camera is not zoomed in while the page scrolls.
  const actions: Action[] = [];
  for (const c of ev.clicks) if (c.kind === 'down') actions.push({t: c.tMs, x: c.x, y: c.y, kind: 'click'});
  for (const k of ev.keys ?? []) { const [x, y] = at(k.tMs); actions.push({t: k.tMs, x, y, kind: 'key'}); }
  actions.sort((a, b) => a.t - b.t);
  const bursts: {s: number; e: number}[] = []; // scroll bursts
  for (const sc of [...(ev.scroll ?? [])].sort((a, b) => a.tMs - b.tMs)) {
    const last = bursts[bursts.length - 1];
    if (last && sc.tMs - last.e < 400) last.e = sc.tMs; else bursts.push({s: sc.tMs, e: sc.tMs});
  }
  const scrollBetween = (t0: number, t1: number) => bursts.some((q) => q.e > t0 && q.s < t1);

  // 3. cluster by time and space (a scroll in between moves the page, so it always splits)
  const clusters: Cluster[] = [];
  const dist = (c: Cluster, a: Action) => {
    if (c.x0 === Infinity) return 0;
    const dx = Math.max(c.x0 - a.x, 0, a.x - c.x1), dy = Math.max(c.y0 - a.y, 0, a.y - c.y1);
    return Math.hypot(dx, dy);
  };
  for (const a of actions) {
    const cur = clusters[clusters.length - 1];
    if (cur && a.t - cur.last < P.clusterGapMs && dist(cur, a) < P.clusterDistFrac * W && !scrollBetween(cur.last, a.t)) {
      cur.actions.push(a);
      cur.last = a.t;
    } else {
      clusters.push({actions: [a], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, first: a.t, last: a.t});
    }
    const c = clusters[clusters.length - 1];
    c.x0 = Math.min(c.x0, a.x); c.x1 = Math.max(c.x1, a.x);
    c.y0 = Math.min(c.y0, a.y); c.y1 = Math.max(c.y1, a.y);
  }

  const fit = (b: Bbox) => {
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    // visible rect must hold the bbox plus margin; start from baseScale, never beyond maxScale
    let rw = Math.max(W / P.baseScale, bw + 0.3 * W, (bh + 0.3 * H) * (W / H));
    rw = Math.max(rw, W / P.maxScale);
    const scale = W / rw;
    const rh = rw * (H / W);
    const cx = clamp((b.x0 + b.x1) / 2, rw / 2, W - rw / 2);
    const cy = clamp((b.y0 + b.y1) / 2, rh / 2, H - rh / 2);
    return {scale, cx, cy};
  };

  // 4. clusters -> shots. A shot: the zoom has LANDED `land` ms before its first action (it starts while the cursor is still on its
  //    way there), and the pull-out starts `hold` ms after its last action, when the result has been on screen long enough to read.
  const land = P.zoomLandMs ?? M.zoomLandMs, dwell = P.minDwellMs ?? M.minDwellMs, panMs = P.panMs ?? M.panMs;
  const calmLead = P.calmLeadMs ?? M.calmLeadMs, calmTail = P.calmTailMs ?? M.calmTailMs, holdMin = P.holdMinMs ?? M.holdMinMs;
  const MIN_IN = 500;
  type Shot = {first: number; last: number; start: number; inMs: number; outAt: number; outMs: number; bbox: Bbox; why: string; bridge: boolean};
  const shots: Shot[] = [];
  for (const c of clusters) {
    const nClick = c.actions.filter((a) => a.kind === 'click').length;
    const nKey = c.actions.filter((a) => a.kind === 'key').length;
    if (nClick === 0 && nKey < 3) continue;
    const bbox = {x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1};
    if (fit(bbox).scale < P.minScale) continue;
    // arrive: not during the calm lead-in, and not while the page is still scrolling
    let start = c.first - land - P.zoomInMs;
    const sb = bursts.filter((q) => q.e <= c.first && q.e > start - 100).pop();
    start = Math.max(start, calmLead, sb ? sb.e - 350 : 0); // may share the last, slow third of a second of the scroll, no more
    let inMs = c.first - land - start;
    if (inMs < MIN_IN) { inMs = MIN_IN; start = Math.max(0, c.first - land - MIN_IN); }
    // leave: after the hold, but before the page scrolls again
    let outAt = c.last + P.zoomHoldAfterMs;
    const sa = bursts.find((q) => q.s > c.last && q.s < outAt + P.zoomOutMs);
    if (sa) outAt = Math.max(c.last + 250, Math.min(outAt, sa.s - P.zoomOutMs * 0.6));
    shots.push({first: c.first, last: c.last, start, inMs, outAt, outMs: P.zoomOutMs, bbox, bridge: false,
      why: `${nClick} click${nClick === 1 ? '' : 's'}${nKey ? `, ${nKey} keys` : ''}`});
  }

  // 5. shots that would pull out and push straight back in (less than `dwell` apart) are joined: one wider shot when both fit
  //    in it at nearly the same size, otherwise the camera stays in and glides from one to the next.
  const joined: Shot[] = [];
  for (const s of shots) {
    const last = joined[joined.length - 1];
    if (last && s.start - (last.outAt + last.outMs) < dwell && !scrollBetween(last.last, s.first)) {
      const u = {x0: Math.min(last.bbox.x0, s.bbox.x0), y0: Math.min(last.bbox.y0, s.bbox.y0), x1: Math.max(last.bbox.x1, s.bbox.x1), y1: Math.max(last.bbox.y1, s.bbox.y1)};
      const fu = fit(u).scale, fa = fit(last.bbox).scale, fb = fit(s.bbox).scale;
      if (fu >= P.minScale && fu >= 0.85 * Math.min(fa, fb)) {
        last.bbox = u; last.last = s.last; last.outAt = s.outAt; last.why = `${last.why} + ${s.why}`;
        continue;
      }
      // glide: leaves the previous result after it could be read, lands before the next click
      // (a long way across the page takes longer: up to 1.8x panMs for a full view width or more)
      const earliest = last.last + holdMin;
      const ca = fit(last.bbox), cb = fit(s.bbox);
      const far = Math.hypot(cb.cx - ca.cx, cb.cy - ca.cy) / (W / Math.max(ca.scale, cb.scale));
      let pan = panMs * clamp(0.7 + 0.6 * far, 0.8, 1.8), gs = s.first - land - pan;
      if (gs < earliest) { pan = Math.max(MIN_IN, s.first - land - earliest); gs = s.first - land - pan; }
      last.bridge = true; last.outAt = gs; last.outMs = 0;
      s.start = gs; s.inMs = pan;
    }
    joined.push(s);
  }
  // the end of the video is calm: finish the last pull-out early if the result was readable, else stay in until the end
  for (const s of joined) {
    if (s.bridge) continue;
    if (s.outAt + s.outMs > dur - calmTail) {
      const early = dur - calmTail - s.outMs;
      if (early >= s.last + holdMin) s.outAt = early; else { s.outAt = dur; s.outMs = 0; }
    }
  }
  const zooms: Zoom[] = joined.map((s, i) => {
    const f = fit(s.bbox);
    return {
      id: `z${i + 1}`,
      startMs: Math.round(s.start), endMs: Math.round(Math.min(dur, s.outAt + s.outMs)),
      inMs: Math.round(s.inMs), outMs: Math.round(s.outMs),
      scale: Math.round(f.scale * 100) / 100,
      center: {x: Math.round(f.cx), y: Math.round(f.cy)},
      bbox: {x: Math.round(s.bbox.x0), y: Math.round(s.bbox.y0), w: Math.round(s.bbox.x1 - s.bbox.x0), h: Math.round(s.bbox.y1 - s.bbox.y0)},
      why: s.why + (s.bridge ? ' (glides to the next)' : s.outMs === 0 ? ' (held to the end)' : ''),
    };
  });

  // 6. idle stretches: no click/key/scroll and a nearly still cursor for longer than the threshold. Cut them, or play them at most
  //    2x (params.idleSpeed, capped again by the style's maxSpeed at render time). Never the first or last calm second.
  const bin = 100, nb = Math.ceil(dur / bin);
  const active = new Array<boolean>(nb).fill(false);
  const mark = (t: number) => { const b = Math.floor(t / bin); if (b >= 0 && b < nb) active[b] = true; };
  for (const a of actions) mark(a.t);
  for (const sc of ev.scroll ?? []) mark(sc.tMs);
  for (let t = bin; t < dur; t += bin) {
    const [x0, y0] = samplePath(rawIn, t - bin), [x1, y1] = samplePath(rawIn, t);
    if (Math.hypot(x1 - x0, y1 - y0) > 4) mark(t - 1);
  }
  const speed: SpeedSegment[] = [];
  let runStart = -1;
  for (let b = 0; b <= nb; b++) {
    const idle = b < nb && !active[b];
    if (idle && runStart < 0) runStart = b;
    if (!idle && runStart >= 0) {
      const s = runStart * bin, e = b * bin;
      if (e - s >= P.idleThresholdMs) {
        const a = Math.max(s + P.idleKeepMs, calmLead), z = Math.min(e - P.idleKeepMs, dur - calmTail);
        if (z - a > 500) speed.push(P.idleMode === 'cut' ? {startMs: a, endMs: z, speed: 1, cut: true} : {startMs: a, endMs: z, speed: P.idleSpeed});
      }
      runStart = -1;
    }
  }

  return {
    version: 1,
    source: {video: ev.video, width: W, height: H, fps: ev.fps, durationMs: dur, pointScale: ev.pointScale ?? 1},
    params: P,
    style: {},
    zooms,
    speed,
    clicks: ev.clicks.filter((c) => c.kind === 'down').map((c) => ({tMs: c.tMs, x: r1(c.x), y: r1(c.y), button: c.button})),
    keys: (ev.keys ?? []).filter((k) => k.label).map((k) => ({tMs: k.tMs, label: k.label as string})),
    cursor,
    cursorRaw,
  };
}

/** Max distance between the smoothed cursor and each click point, at click time (alignment check). */
export function clickError(plan: Plan): number {
  let worst = 0;
  const h = {i: 0};
  for (const c of plan.clicks) {
    const [x, y] = samplePath(plan.cursor, c.tMs, h);
    worst = Math.max(worst, Math.hypot(x - c.x, y - c.y));
  }
  return worst;
}
