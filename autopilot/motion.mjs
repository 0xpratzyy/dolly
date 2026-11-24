// How the autopilot cursor and scroll move, and how long the driver waits. Shared by drive.mjs (real time) and smooth.mjs (virtual
// time). Every number comes from studio/src/types.ts `motionDefaults` (the one documented place); nothing is hard-coded here.
import {motionDefaults} from '../studio/src/types.ts';

export const M = motionDefaults;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Minimum-jerk ease (smootherstep): starts and ends with zero speed AND zero acceleration, like a hand. */
export const minJerk = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

/** Fitts-style move time for a distance in CSS px: about 450 ms for a hop, 900 ms across the page. */
export function moveMs(dist, k = 1) {
  const c = M.cursor;
  return clamp(c.fittsA + c.fittsB * Math.log2(1 + dist / 60), c.minMs, c.maxMs) * k;
}

/**
 * A cursor move from (x0,y0) to (x1,y1): one gentle arc (a quadratic curve bowed sideways), min-jerk along it, no overshoot and no
 * correction at the end. `side` is -1 or 1 (which way it bows). Returns {ms, at(u)} where u is 0..1 of the duration.
 */
export function cursorPath(x0, y0, x1, y1, side = 1, ms) {
  const dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy);
  const c = M.cursor;
  const bow = dist < 1 ? 0 : Math.min(c.arcMaxPx, dist * c.arc) * side;
  // control point: twice the bow, so the curve itself peaks `bow` px off the straight line
  const qx = (x0 + x1) / 2 + (dist ? (-dy / dist) * bow * 2 : 0), qy = (y0 + y1) / 2 + (dist ? (dx / dist) * bow * 2 : 0);
  return {
    dist,
    ms: ms ?? moveMs(dist),
    at(u) {
      const e = minJerk(u);
      return [(1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * qx + e * e * x1, (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * qy + e * e * y1];
    },
  };
}

/** Scroll time for a distance in px, eased in and out. */
export function scrollMs(px) {
  const p = M.pacing;
  return clamp(p.scrollA + p.scrollB * Math.abs(px), p.scrollMinMs, p.scrollMaxMs);
}

export const between = ([a, b], r) => a + (b - a) * r;
