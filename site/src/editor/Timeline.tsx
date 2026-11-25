import {useEffect, useMemo, useRef, useState} from 'react';
import type {Timeline as TL, Zoom} from '@studio/lib.ts';
import {useClip} from '../clip';
import type {Plan} from '@studio/lib.ts';
import {Icon, fmtTime} from '../ui';
import {clamp} from './state';
import {Popover, SIcon} from './shell';
import type {Transport} from './Stage';

const STRIP_N = 30;
const fmtMs = (ms: number) => `${fmtTime(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`;

export function newZoomAt(srcMs: number, PLAN: Plan): Zoom {
  const DUR = PLAN.source.durationMs;
  const cur = PLAN.cursorRaw.length ? PLAN.cursorRaw : PLAN.cursor;
  let lo = 0, hi = cur.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cur[m][0] < srcMs) lo = m + 1; else hi = m; }
  const c = cur[lo] ?? [0, PLAN.source.width / 2, PLAN.source.height / 2];
  const start = clamp(Math.round(srcMs - 400), 0, DUR - 2400);
  return {id: 'm' + Date.now().toString(36), startMs: start, endMs: start + 2400, inMs: 700, outMs: 700, scale: 1.9, center: {x: Math.round(c[1]), y: Math.round(c[2])}, bbox: {x: Math.round(c[1]), y: Math.round(c[2]), w: 0, h: 0}, why: 'added by hand'};
}

interface Props {
  t: Transport; tl: TL; zooms: Zoom[]; sel: string | null; lines: string[]; captionsOn: boolean;
  onSelect: (id: string | null) => void; onPatch: (id: string, p: Partial<Zoom>, key: string) => void;
  onAdd: () => void; onDelete: () => void; onCaptions: () => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
}

export function Timeline({t, tl, zooms, sel, lines, captionsOn, onSelect, onPatch, onAdd, onDelete, onCaptions, onUndo, onRedo, canUndo, canRedo}: Props) {
  const clip = useClip();
  const PLAN = clip.plan, FPS = clip.fps, DUR = PLAN.source.durationMs, LINE_TIMES = clip.lineTimes;
  const track = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const frame = t.useFrame();
  const srcMs = tl.src[clamp(frame, 0, tl.frames.length - 1)] ?? 0;
  const outSec = frame / FPS, totalSec = tl.frames.length / FPS;

  useEffect(() => {
    const el = track.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 800)); ro.observe(el); setW(el.clientWidth || 800);
    return () => ro.disconnect();
  }, []);
  const pct = (ms: number) => `${(ms / DUR) * 100}%`;

  // ---- scrub
  const scrub = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.zblock, .cblock')) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const was = t.player.current?.isPlaying() ?? false;
    t.pause();
    const r = track.current!.getBoundingClientRect();
    const go = (cx: number) => t.seekSrc(clamp((cx - r.left) / r.width, 0, 1) * DUR);
    go(e.clientX);
    const move = (ev: PointerEvent) => go(ev.clientX);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (was) t.play(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };

  // ---- drag a zoom block (move) or an edge (retime)
  const drag = (e: React.PointerEvent, z: Zoom, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    onSelect(z.id);
    const width = track.current!.getBoundingClientRect().width;
    const x0 = e.clientX; let moved = false;
    const minLen = z.inMs + z.outMs + 200, len = z.endMs - z.startMs;
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - x0) / width) * DUR;
      if (Math.abs(ev.clientX - x0) > 2) moved = true;
      if (!moved) return;
      if (mode === 'move') { const s = clamp(Math.round(z.startMs + dx), 0, DUR - len); onPatch(z.id, {startMs: s, endMs: s + len}, 'drag:' + z.id); }
      else if (mode === 'l') onPatch(z.id, {startMs: clamp(Math.round(z.startMs + dx), 0, z.endMs - minLen)}, 'drag:' + z.id);
      else onPatch(z.id, {endMs: clamp(Math.round(z.endMs + dx), z.startMs + minLen, DUR)}, 'drag:' + z.id);
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      t.pause();
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    t.pause();
  };
  const blockKey = (e: React.KeyboardEvent, z: Zoom) => {
    const step = e.shiftKey ? 500 : 100, len = z.endMs - z.startMs;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect(z.id); t.seekSrc(z.startMs + z.inMs + 200); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      const d = e.key === 'ArrowLeft' ? -step : step;
      if (e.altKey) onPatch(z.id, {endMs: clamp(z.endMs + d, z.startMs + z.inMs + z.outMs + 200, DUR)}, 'key:' + z.id);
      else { const s = clamp(z.startMs + d, 0, DUR - len); onPatch(z.id, {startMs: s, endMs: s + len}, 'key:' + z.id); }
    }
  };

  // rows for overlapping zooms
  const rows = useMemo(() => {
    const ends: number[] = []; const map = new Map<string, number>();
    [...zooms].sort((a, b) => a.startMs - b.startMs).forEach((z) => {
      let r = ends.findIndex((e) => e <= z.startMs); if (r < 0) r = ends.length;
      ends[r] = z.endMs; map.set(z.id, Math.min(r, 2));
    });
    return {map, n: Math.min(3, Math.max(1, ends.length))};
  }, [zooms]);

  const ticks = useMemo(() => {
    const secs = DUR / 1000, pxPerSec = w / Math.max(1, secs);
    const per = [1, 2, 5, 10, 15, 30, 60].find((p) => p * pxPerSec >= 72) ?? 60;
    const out: number[] = []; for (let s = 0; s <= secs; s += per) out.push(s); return out;
  }, [w, DUR]);

  const tiles = Math.max(6, Math.ceil(w / 76));
  const caps = lines.map((text, i) => ({text: text.replace(/\*/g, '').trim(), i, a: tl.src[clamp(Math.round((LINE_TIMES[i][0] / 1000) * FPS), 0, tl.frames.length - 1)], b: tl.src[clamp(Math.round((LINE_TIMES[i][1] / 1000) * FPS), 0, tl.frames.length - 1)]})).filter((c) => c.text);
  const selZoom = zooms.find((z) => z.id === sel);

  const ROW = 28;
  return (
    <div className="tl" role="group" aria-label="Timeline">
      <div className="tl-bar">
        <button type="button" className="ibtn play" onClick={t.toggle} aria-label={t.playing ? 'Pause (Space)' : 'Play (Space)'} data-tip={t.playing ? 'Pause' : 'Play'}>{t.playing ? Icon.pause : Icon.play}</button>
        <span className="time">{fmtMs(outSec * 1000)}<i>/</i><em>{fmtMs(totalSec * 1000)}</em></span>
        <span className="tl-sp" />
        <button type="button" className="ibtn" onClick={onUndo} disabled={!canUndo} aria-label="Undo" data-tip="Undo ⌘Z">{Icon.undo}</button>
        <button type="button" className="ibtn" onClick={onRedo} disabled={!canRedo} aria-label="Redo" data-tip="Redo ⇧⌘Z">{Icon.redo}</button>
        <span className="tl-div" aria-hidden />
        <button type="button" className="chip" onClick={onAdd} data-tip="Add a zoom at the playhead">{Icon.plus}Zoom<kbd>Z</kbd></button>
        <button type="button" className="ibtn" onClick={onDelete} disabled={!selZoom} aria-label="Remove the selected zoom" data-tip="Remove zoom ⌫">{Icon.trash}</button>
        <span className="tl-div" aria-hidden />
        <Popover label="Keyboard shortcuts" className="keys-pop" button={({open, toggle, id}) => (
          <button type="button" className="ibtn" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label="Keyboard shortcuts" data-tip="Shortcuts">{SIcon.keys}</button>
        )}>
          {() => (
            <ul className="keys">
              <li><span>Play / pause</span><kbd>Space</kbd></li>
              <li><span>Step a frame (⇧ for ten)</span><span><kbd>←</kbd><kbd>→</kbd></span></li>
              <li><span>Add a zoom at the playhead</span><kbd>Z</kbd></li>
              <li><span>Remove the selected zoom</span><kbd>⌫</kbd></li>
              <li><span>Undo / redo</span><span><kbd>⌘Z</kbd><kbd>⇧⌘Z</kbd></span></li>
            </ul>
          )}
        </Popover>
      </div>
      <div className="tl-body">
        <div className="tl-labels" aria-hidden>
          <span className="l-ruler" />
          <span className="l-clip">Clip</span>
          <span className="l-zoom" style={{height: rows.n * ROW + 4}}>Zoom</span>
          {captionsOn && <span className="l-subs">Captions</span>}
        </div>
        <div className="tl-track" ref={track} onPointerDown={scrub}>
          <div className="tl-ruler">
            {ticks.map((s) => <span key={s} style={{left: pct(s * 1000)}}>{fmtTime(s)}</span>)}
          </div>
          <div className="tl-clip" aria-hidden>
            {Array.from({length: tiles}, (_, i) => {
              const idx = Math.min(STRIP_N - 1, Math.floor(((i + 0.5) / tiles) * STRIP_N));
              return <i key={i} style={{...(clip.strip ? {backgroundImage: `url(${clip.strip})`} : clip.demo ? {} : {backgroundImage: 'none'}), backgroundSize: `${STRIP_N * 100}% 100%`, backgroundPosition: `${(idx / (STRIP_N - 1)) * 100}% 0`}} />;
            })}
            <span className="tl-clicks">{PLAN.clicks.map((c, i) => <b key={i} style={{left: pct(c.tMs)}} />)}</span>
          </div>
          <div className="tl-zoom" style={{height: rows.n * ROW + 4}}>
            {zooms.map((z) => {
              const len = z.endMs - z.startMs, a = (z.inMs / len) * 100, b = (z.outMs / len) * 100;
              return (
                <div
                  key={z.id} className={`zblock${sel === z.id ? ' on' : ''}`} role="button" tabIndex={0}
                  aria-label={`Zoom ${z.scale.toFixed(1)} times, ${fmtMs(z.startMs)} to ${fmtMs(z.endMs)}`} aria-pressed={sel === z.id}
                  style={{left: pct(z.startMs), width: pct(len), top: 2 + (rows.map.get(z.id) ?? 0) * ROW}}
                  onPointerDown={(e) => drag(e, z, 'move')} onKeyDown={(e) => blockKey(e, z)}
                  onDoubleClick={() => t.seekSrc(z.startMs + z.inMs + 200)}
                >
                  <svg preserveAspectRatio="none" viewBox="0 0 100 24" aria-hidden><path d={`M0 23 C ${a * 0.5} 23 ${a * 0.5} 4 ${a} 4 L ${100 - b} 4 C ${100 - b * 0.5} 4 ${100 - b * 0.5} 23 100 23`} vectorEffect="non-scaling-stroke" /></svg>
                  {(len / DUR) * w > 40 && <b>{z.scale.toFixed(1)}×</b>}
                  <span className="zh l" onPointerDown={(e) => drag(e, z, 'l')} aria-hidden />
                  <span className="zh r" onPointerDown={(e) => drag(e, z, 'r')} aria-hidden />
                </div>
              );
            })}
          </div>
          {captionsOn && (
            <div className="tl-subs">
              {caps.map((c) => (
                <button key={c.i} type="button" className="cblock" style={{left: pct(c.a), width: pct(c.b - c.a)}} onClick={onCaptions} title="Edit this caption">{c.text}</button>
              ))}
            </div>
          )}
          <div className="tl-head" style={{left: pct(srcMs)}} aria-hidden><i /></div>
        </div>
      </div>
    </div>
  );
}
