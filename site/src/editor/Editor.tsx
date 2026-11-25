import {useCallback, useEffect, useMemo, useState} from 'react';
import {buildTimeline, mergeStyle, stylePresets, type Zoom} from '@studio/lib.ts';
import {useClip, exportPlan} from '../clip';
import {track} from '../analytics';
import type {CopyBtn} from '../copy';
import {zoomsJson} from '../prompt';
import {Inspector, type TabId} from './Inspector';
import {Stage, useTransport} from './Stage';
import {Timeline, newZoomAt} from './Timeline';
import {clamp, encodeEdit, originalOf, type useEdit} from './state';
import {FileMenu, OpenNotice, DropZone, type OpenApi} from './Open';
import {RecordExport} from './Export';
import {PhoneNote, TopSlot} from './shell';

const timers: Record<string, number> = {};
const tweaked = (what: string) => { clearTimeout(timers[what]); timers[what] = window.setTimeout(() => track('dolly_tweaked', {what}), 600); }; // a drag is one event
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.matches('input, textarea, select, [contenteditable="true"]') && !(el instanceof HTMLInputElement && ['button', 'checkbox', 'radio'].includes(el.type)));

interface Props {ed: ReturnType<typeof useEdit>; CopyBtn: CopyBtn; prompt: string; json: string; open: OpenApi}

export default function Editor({ed, CopyBtn, prompt, json, open}: Props) {
  const clip = useClip();
  const PLAN = clip.plan, FPS = clip.fps, BASE = clip.base;
  const {edit, commit, undo, redo, canUndo, canRedo} = ed;
  const {style, zooms, lines} = edit;
  const [tab, setTab] = useState<TabId>('look');
  const [sel, setSel] = useState<string | null>(null);
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
  }, [commit, BASE]);
  const onReset = useCallback(() => { commit(() => originalOf(clip)); setSel(null); setPick(false); track('dolly_reset'); }, [commit, clip]);

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
  }, [commit, PLAN]);
  const patchFromInspector = useCallback((id: string, p: Partial<Zoom>, key: string) => {
    patchZoom(id, p, key);
    // show the result: park the playhead inside the zoom's hold
    const z = zooms.find((x) => x.id === id);
    if (z) { const n = {...z, ...p}; const s = t.srcNow(); if (s < n.startMs + n.inMs || s > n.endMs - n.outMs) { t.pause(); t.seekSrc(holdMid(n)); } }
  }, [patchZoom, zooms, t]);
  const select = useCallback((id: string | null) => {
    setSel(id);
    if (id) { setTab('camera'); const z = zooms.find((x) => x.id === id); if (z) { t.pause(); t.seekSrc(holdMid(z)); } }
  }, [zooms, t]);
  const addZoom = useCallback(() => {
    let z = newZoomAt(t.srcNow(), PLAN);
    const hit = () => zooms.find((o) => o.startMs < z.endMs && o.endMs > z.startMs);
    for (let i = 0; i < 6 && hit(); i++) { const h = hit()!; const len = z.endMs - z.startMs; z = {...z, startMs: h.endMs + 150, endMs: h.endMs + 150 + len}; }
    if (hit() || z.endMs > PLAN.source.durationMs) return;
    commit((e) => ({...e, zooms: [...e.zooms, z].sort((a, b) => a.startMs - b.startMs)}));
    setSel(z.id); setTab('camera'); t.pause(); t.seekSrc(holdMid(z));
    track('dolly_zoom_add');
  }, [commit, t, zooms, PLAN]);
  const removeZoom = useCallback(() => {
    if (!sel) return;
    commit((e) => ({...e, zooms: e.zooms.filter((z) => z.id !== sel)}));
    setSel(null); setPick(false);
    track('dolly_zoom_remove');
  }, [commit, sel]);

  // ---- focus picker
  const startPick = useCallback(() => { if (!selZoom) return; t.pause(); t.seekSrc(selZoom.startMs); setPick(true); }, [selZoom, t]);
  const endPick = useCallback(() => { setPick(false); if (selZoom) t.seekSrc(holdMid(selZoom)); }, [selZoom, t]);
  const onPickMove = useCallback((c: {x: number; y: number}) => { if (sel) patchZoom(sel, {center: {x: clamp(c.x, 0, PLAN.source.width), y: clamp(c.y, 0, PLAN.source.height)}}, 'pick:' + sel); }, [sel, patchZoom, PLAN]);

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
    a.href = URL.createObjectURL(new Blob([clip.demo ? zoomsJson(zooms) : exportPlan(clip, zooms, style)], {type: 'application/json'}));
    a.download = clip.demo ? 'plan-edits.json' : 'plan.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    track('dolly_plan_download', {own: !clip.demo});
  };

  const L = tl.layout;
  const secs = Math.round(PLAN.source.durationMs / 1000);
  return (
    <DropZone open={open}>
      <div className="ws ws-rec" aria-label="Dolly editor">
        <TopSlot at="left"><FileMenu open={open} name={clip.name} meta={`${clip.demo ? 'Demo' : 'Yours'} · ${secs} s · ${L.canvasW}×${L.canvasH}`} demo={clip.demo} /></TopSlot>
        <TopSlot at="right">
          <RecordExport style={style} zooms={zooms} canvas={`${L.canvasW}×${L.canvasH}`} frames={tl.frames.length} CopyBtn={CopyBtn} prompt={prompt} json={json} link={link} onDownload={download} />
        </TopSlot>
        <div className="ws-stage">
          <OpenNotice open={open} />
          <Stage tl={tl} style={style} plan={plan} lines={lines} t={t} wipe={null} setWipe={() => {}} pick={pick ? selZoom ?? null : null} onPickMove={onPickMove} onPickEnd={endPick} />
        </div>
        <Inspector
          tab={tab} setTab={setTab} style={style} sel={selZoom} set={set} patchZoom={patchFromInspector} onPick={startPick} onRemove={removeZoom} onAdd={addZoom}
          lines={lines} setLines={setLines} onLook={onLook} onReset={onReset}
        />
        <Timeline t={t} tl={tl} zooms={zooms} sel={sel} lines={lines} captionsOn={style.captions.enabled} onSelect={select} onPatch={patchZoom} onAdd={addZoom} onDelete={removeZoom}
          onCaptions={() => setTab('captions')} onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo} />
        <PhoneNote><CopyBtn id="prompt" text={prompt} label="Copy prompt for Claude Code" primary big /></PhoneNote>
      </div>
    </DropZone>
  );
}
