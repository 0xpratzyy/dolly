import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {buildTimeline, mergeStyle, stylePresets, type Zoom} from '@studio/lib.ts';
import {BASE, FPS, PLAN} from '../data';
import {track} from '../analytics';
import {Icon} from '../ui';
import type {CopyBtn} from '../copy';
import {zoomsJson} from '../prompt';
import {Inspector, type TabId} from './Inspector';
import {Stage, useTransport} from './Stage';
import {Timeline, newZoomAt} from './Timeline';
import {ORIGINAL, clamp, encodeEdit, type useEdit} from './state';

const timers: Record<string, number> = {};
const tweaked = (what: string) => { clearTimeout(timers[what]); timers[what] = window.setTimeout(() => track('dolly_tweaked', {what}), 600); }; // a drag is one event
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.matches('input, textarea, select, [contenteditable="true"]') && !(el instanceof HTMLInputElement && ['button', 'checkbox', 'radio'].includes(el.type)));

interface Props {ed: ReturnType<typeof useEdit>; CopyBtn: CopyBtn; prompt: string; json: string}

export default function Editor({ed, CopyBtn, prompt, json}: Props) {
  const {edit, commit, undo, redo, canUndo, canRedo} = ed;
  const {style, zooms, lines} = edit;
  const [tab, setTab] = useState<TabId>('background');
  const [sel, setSel] = useState<string | null>(null);
  const [adv, setAdv] = useState(false); // the Advanced disclosure
  const [pick, setPick] = useState(false);

  const plan = useMemo(() => ({...PLAN, zooms}), [zooms]);
  const tl = useMemo(() => buildTimeline(plan, style, FPS), [plan, style]);
  const t = useTransport(tl);
  const selZoom = zooms.find((z) => z.id === sel);
  const holdMid = (z: Zoom) => (z.startMs + z.inMs + z.endMs - z.outMs) / 2;

  // ---- edits
  const set = useCallback((p: Record<string, any>, key: string) => {
    commit((e) => {
      const q = {...p};
      // a frame brings its own default label, unless the visitor typed one
      if (q.aspect) q.fit = q.aspect === '16:9' ? 'letterbox' : 'crop';
      if (q.frame && q.frame !== 'none' && (!e.style.frameLabel || e.style.frameLabel === 'refs.video' || e.style.frameLabel === 'Refs')) q.frameLabel = q.frame === 'browser' ? 'refs.video' : 'Refs';
      return {...e, style: mergeStyle(e.style, q)};
    }, key);
    tweaked(key.replace(/-.*$/, ''));
  }, [commit]);
  const setLines = useCallback((l: string[]) => commit((e) => ({...e, lines: l}), 'lines'), [commit]);
  const onLook = useCallback((name: string) => {
    commit((e) => ({...e, style: mergeStyle(BASE, stylePresets[name] ?? {}, {captions: e.style.captions})}));
    track('dolly_look', {look: name});
  }, [commit]);
  const onReset = useCallback(() => { commit(() => ORIGINAL); setSel(null); setPick(false); track('dolly_reset'); }, [commit]);

  const patchZoom = useCallback((id: string, p: Partial<Zoom>, key: string) => {
    commit((e) => {
      const cur = e.zooms.find((z) => z.id === id); if (!cur) return e;
      const others = e.zooms.filter((z) => z.id !== id);
      const prevEnd = Math.max(0, ...others.filter((z) => z.startMs < cur.startMs).map((z) => z.endMs));
      const nextStart = Math.min(PLAN.source.durationMs, ...others.filter((z) => z.startMs > cur.startMs).map((z) => z.startMs));
      const n = {...cur, ...p};
      const len = n.endMs - n.startMs;
      if (p.startMs !== undefined && p.endMs !== undefined) { n.startMs = clamp(n.startMs, prevEnd, Math.max(prevEnd, nextStart - len)); n.endMs = n.startMs + len; }
      else { n.startMs = Math.max(n.startMs, prevEnd); n.endMs = Math.min(n.endMs, nextStart); if (n.endMs - n.startMs < n.inMs + n.outMs + 200) return e; }
      return {...e, zooms: e.zooms.map((z) => (z.id === id ? n : z))};
    }, key);
    tweaked('zoom-edit');
  }, [commit]);
  const patchFromInspector = useCallback((id: string, p: Partial<Zoom>, key: string) => {
    patchZoom(id, p, key);
    // show the result: park the playhead inside the zoom's hold
    const z = zooms.find((x) => x.id === id);
    if (z) { const n = {...z, ...p}; const s = t.srcNow(); if (s < n.startMs + n.inMs || s > n.endMs - n.outMs) { t.pause(); t.seekSrc(holdMid(n)); } }
  }, [patchZoom, zooms, t]);
  const select = useCallback((id: string | null) => {
    setSel(id);
    if (id) { setAdv(true); setTab('camera'); const z = zooms.find((x) => x.id === id); if (z) { t.pause(); t.seekSrc(holdMid(z)); } }
  }, [zooms, t]);
  const addZoom = useCallback(() => {
    let z = newZoomAt(t.srcNow());
    const hit = () => zooms.find((o) => o.startMs < z.endMs && o.endMs > z.startMs);
    for (let i = 0; i < 6 && hit(); i++) { const h = hit()!; const len = z.endMs - z.startMs; z = {...z, startMs: h.endMs + 150, endMs: h.endMs + 150 + len}; }
    if (hit() || z.endMs > PLAN.source.durationMs) return;
    commit((e) => ({...e, zooms: [...e.zooms, z].sort((a, b) => a.startMs - b.startMs)}));
    setSel(z.id); setAdv(true); setTab('camera'); t.pause(); t.seekSrc(holdMid(z));
    track('dolly_zoom_add');
  }, [commit, t, zooms]);
  const removeZoom = useCallback(() => {
    if (!sel) return;
    commit((e) => ({...e, zooms: e.zooms.filter((z) => z.id !== sel)}));
    setSel(null); setPick(false);
    track('dolly_zoom_remove');
  }, [commit, sel]);

  // ---- focus picker
  const startPick = useCallback(() => { if (!selZoom) return; t.pause(); t.seekSrc(selZoom.startMs); setPick(true); }, [selZoom, t]);
  const endPick = useCallback(() => { setPick(false); if (selZoom) t.seekSrc(holdMid(selZoom)); }, [selZoom, t]);
  const onPickMove = useCallback((c: {x: number; y: number}) => { if (sel) patchZoom(sel, {center: {x: clamp(c.x, 0, PLAN.source.width), y: clamp(c.y, 0, PLAN.source.height)}}, 'pick:' + sel); }, [sel, patchZoom]);

  // ---- keyboard
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (typing(e.target) || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod || e.altKey) return;
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); t.toggle(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if ((e.target as HTMLElement | null)?.closest?.('[role="tablist"], [role="slider"]')) return;
        e.preventDefault(); t.pause(); t.seekFrame(t.frameNow() + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      }
      else if (e.key.toLowerCase() === 'z') { e.preventDefault(); addZoom(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); removeZoom(); } }
      else if (e.key === 'Escape') { if (pick) endPick(); else setSel(null); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [t, undo, redo, addZoom, removeZoom, sel, pick, endPick]);

  const link = useCallback(() => { const h = encodeEdit(edit); return `${location.origin}${location.pathname}${h ? `#e=${h}` : ''}`; }, [edit]);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([zoomsJson(zooms)], {type: 'application/json'}));
    a.download = 'plan-edits.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    track('dolly_plan_download');
  };

  const L = tl.layout;
  const main = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = main.current; if (!el) return;
    const ro = new ResizeObserver(() => root.current?.style.setProperty('--stick-h', `${el.offsetHeight}px`)); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="ed" aria-label="Dolly editor" ref={root}>
      <div className="ed-main" ref={main}>
        <div className="app-bar">
          <span className="dots" aria-hidden><i /><i /><i /></span>
          <span className="app-title">refs-tour.mp4<em>demo recording · {Math.round(PLAN.source.durationMs / 1000)} s</em></span>
          <span className="tl-sp" />
          <span className="app-meta">{L.canvasW}×{L.canvasH}</span>
        </div>
        <Stage tl={tl} style={style} plan={plan} lines={lines} t={t} wipe={null} setWipe={() => {}} pick={pick ? selZoom ?? null : null} onPickMove={onPickMove} onPickEnd={endPick} />
        <Timeline lite={!adv} t={t} tl={tl} zooms={zooms} sel={sel} lines={lines} captionsOn={style.captions.enabled} onSelect={select} onPatch={patchZoom} onAdd={addZoom} onDelete={removeZoom}
          onCaptions={() => { setAdv(true); setTab('subtitles'); }} onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo} />
      </div>
      <Inspector
        tab={tab} setTab={setTab} style={style} zooms={zooms} sel={selZoom} set={set} patchZoom={patchFromInspector} onPick={startPick} onRemove={removeZoom} onAdd={addZoom}
        lines={lines} setLines={setLines} onLook={onLook} onReset={onReset}
        canvas={`${L.canvasW}×${L.canvasH}`} frames={tl.frames.length} CopyBtn={CopyBtn as any} prompt={prompt} json={json} link={link} onDownload={download}
        adv={adv} setAdv={setAdv}
      />
    </div>
  );
}
