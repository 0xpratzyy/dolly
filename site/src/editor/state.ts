import {useCallback, useEffect, useRef, useState} from 'react';
import {mergeStyle, type Style, type Zoom} from '@studio/types.ts';
import {BASE, DEFAULT_LINES, PLAN} from '../data';
import type {Clip} from '../clip';

export interface Edit {style: Style; zooms: Zoom[]; lines: string[]}
export const originalOf = (c: Clip): Edit => ({style: c.base, zooms: c.plan.zooms, lines: c.lines});
export const ORIGINAL: Edit = {style: BASE, zooms: PLAN.zooms, lines: DEFAULT_LINES};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const zoomsChanged = (z: Zoom[], base: Zoom[] = PLAN.zooms) => !same(z, base);

// ---- share link: only what differs from the defaults, base64url JSON in the URL hash (#e=...)
const b64 = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
};
export function encodeEdit(e: Edit): string {
  const o: Record<string, unknown> = {};
  const st: Record<string, unknown> = {};
  for (const k of Object.keys(e.style) as (keyof Style)[]) {
    if (k === 'background' && e.style.background.type === 'image') continue; // an uploaded image stays on the device
    if (!same(e.style[k], BASE[k])) st[k] = e.style[k];
  }
  if (Object.keys(st).length) o.s = st;
  if (zoomsChanged(e.zooms)) o.z = e.zooms.map((z) => [z.id, z.startMs, z.endMs, z.inMs, z.outMs, +z.scale.toFixed(2), Math.round(z.center.x), Math.round(z.center.y)]);
  if (!same(e.lines, DEFAULT_LINES)) o.l = e.lines;
  return Object.keys(o).length ? b64.enc(JSON.stringify(o)) : '';
}
export function decodeEdit(hash: string): Edit | null {
  const m = /(?:^|[#&])e=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const o = JSON.parse(b64.dec(m[1]));
    const zooms: Zoom[] = Array.isArray(o.z)
      ? o.z.map((r: any[]) => ({id: String(r[0]), startMs: +r[1], endMs: +r[2], inMs: +r[3], outMs: +r[4], scale: +r[5], center: {x: +r[6], y: +r[7]}, bbox: {x: +r[6], y: +r[7], w: 0, h: 0}, why: 'edited'}))
      : PLAN.zooms;
    const lines = Array.isArray(o.l) ? o.l.slice(0, 3).map(String) : DEFAULT_LINES;
    return {style: mergeStyle(BASE, o.s ?? {}), zooms, lines};
  } catch { return null; }
}

/** The editor's document: style + zoom edits + subtitle lines, with undo / redo and the URL hash kept in step. */
export function useEdit(clip: Clip) {
  const [edit, setEdit] = useState<Edit>(() => (clip.demo && typeof location !== 'undefined' && decodeEdit(location.hash)) || originalOf(clip));
  const past = useRef<Edit[]>([]);
  const future = useRef<Edit[]>([]);
  const last = useRef({key: '', t: 0});
  const cur = useRef(edit);
  cur.current = edit;
  const [, tick] = useState(0);

  /** Apply a change. Changes with the same key within 700 ms (one slider drag, one drag of a block) are one undo step. */
  const commit = useCallback((fn: (e: Edit) => Edit, key = '') => {
    const next = fn(cur.current);
    if (next === cur.current) return;
    const now = performance.now();
    if (!(key && key === last.current.key && now - last.current.t < 700)) { past.current.push(cur.current); if (past.current.length > 80) past.current.shift(); }
    last.current = {key, t: now};
    future.current = [];
    cur.current = next;
    setEdit(next);
    tick((n) => n + 1);
  }, []);
  const undo = useCallback(() => {
    const p = past.current.pop();
    if (!p) return;
    future.current.push(cur.current); cur.current = p; last.current = {key: '', t: 0}; setEdit(p); tick((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const n = future.current.pop();
    if (!n) return;
    past.current.push(cur.current); cur.current = n; last.current = {key: '', t: 0}; setEdit(n); tick((x) => x + 1);
  }, []);

  useEffect(() => {
    if (!clip.demo) return; // the share link only describes the demo clip
    const t = setTimeout(() => {
      const h = encodeEdit(edit);
      try { history.replaceState(null, '', h ? `#e=${h}` : location.pathname + location.search); } catch { /* sandboxed */ }
    }, 400);
    return () => clearTimeout(t);
  }, [edit, clip.demo]);

  return {edit, commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0};
}

export const lowerBound = (a: number[], v: number) => { let lo = 0, hi = a.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; };
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
