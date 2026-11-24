import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {loadCaptionFonts, type Timeline, type Style, type Plan, type Zoom} from '@studio/lib.ts';
import {DollyLive} from './DollyLive';
import {CAPTION_STYLES, FPS, PLAN, POSTER, SRC_ASPECT, VIDEO, toCaptions} from '../data';
import {Icon} from '../ui';
import {clamp, lowerBound} from './state';

// The caption engine loads its fonts through staticFile(), served from /fonts (scripts/prep-media.sh copies them there).
(window as any).remotion_staticBase = '/fonts';

/** Playback controller: the Player, a frame store that only the timeline subscribes to, and a few helpers. */
export function useTransport(tl: Timeline) {
  const player = useRef<PlayerRef>(null);
  const [playing, setPlaying] = useState(true);
  const store = useRef({f: 0, subs: new Set<() => void>()});
  const frames = tl.frames.length;
  const tlRef = useRef(tl);
  tlRef.current = tl;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: {detail: {frame: number}}) => { store.current.f = e.detail.frame; store.current.subs.forEach((s) => s()); };
    const onPlay = () => setPlaying(true), onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame as any);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    return () => { p.removeEventListener('frameupdate', onFrame as any); p.removeEventListener('play', onPlay); p.removeEventListener('pause', onPause); };
  }, [mounted]);

  const subscribe = useCallback((cb: () => void) => { store.current.subs.add(cb); return () => { store.current.subs.delete(cb); }; }, []);
  const useFrame = () => useSyncExternalStore(subscribe, () => store.current.f, () => 0);
  const seekFrame = useCallback((f: number) => {
    const n = clamp(Math.round(f), 0, tlRef.current.frames.length - 1);
    store.current.f = n; store.current.subs.forEach((s) => s());
    player.current?.seekTo(n);
  }, []);
  const seekSrc = useCallback((ms: number) => seekFrame(lowerBound(tlRef.current.src, ms)), [seekFrame]);
  const play = useCallback(() => player.current?.play(), []);
  const pause = useCallback(() => player.current?.pause(), []);
  const toggle = useCallback(() => { const p = player.current; if (!p) return; if (p.isPlaying()) p.pause(); else p.play(); }, []);
  const srcNow = useCallback(() => tlRef.current.src[clamp(store.current.f, 0, tlRef.current.frames.length - 1)] ?? 0, []);
  return {player, playing, frames, useFrame, seekFrame, seekSrc, play, pause, toggle, srcNow, frameNow: () => store.current.f, onMount: () => setMounted(true)};
}
export type Transport = ReturnType<typeof useTransport>;

/** Fit a box of the given aspect inside the element. */
function useFit(ratio: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({w: 0, h: 0});
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => {
      const cw = el.clientWidth - 24, ch = el.clientHeight - 24;
      if (cw <= 0 || ch <= 0) return;
      const w = cw / ch > ratio ? ch * ratio : cw;
      setSize((s) => (Math.abs(s.w - w) < 0.5 ? s : {w: Math.floor(w), h: Math.floor(w / ratio)}));
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  return {ref, ...size};
}

export interface StageProps {
  tl: Timeline; style: Style; plan: Plan; lines: string[]; t: Transport;
  wipe: number | null; setWipe: (v: number | null) => void;
  pick: Zoom | null; onPickMove: (c: {x: number; y: number}) => void; onPickEnd: () => void;
}

export function Stage({tl, style, plan, lines, t, wipe, setWipe, pick, onPickMove, onPickEnd}: StageProps) {
  const L = tl.layout;
  const ratio = L.canvasW / L.canvasH;
  const fit = useFit(ratio);
  const [fontTick, setFontTick] = useState(0);
  const raw = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const captions = useMemo(() => toCaptions(lines), [lines]);
  const captionStyle = useMemo(() => (style.captions.enabled ? CAPTION_STYLES[style.captions.style] : undefined), [style.captions.enabled, style.captions.style]);
  const inputProps = useMemo(() => ({video: VIDEO, plan, style, captions, captionStyle, _f: fontTick}), [plan, style, captions, captionStyle, fontTick]);

  useEffect(() => {
    if (!captionStyle) return;
    let live = true;
    loadCaptionFonts(captionStyle as any).catch(() => {}).then(() => live && setFontTick((n) => n + 1));
    return () => { live = false; };
  }, [captionStyle]);

  // pause while the editor is scrolled out of view
  useEffect(() => {
    const el = box.current; if (!el) return;
    let was = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) { was = t.player.current?.isPlaying() ?? false; t.pause(); } else if (was) { t.play(); was = false; }
    }, {threshold: 0.02});
    io.observe(el);
    return () => io.disconnect();
  }, [t]);

  // the raw recording under the wipe follows the Player (source time of the current output frame)
  useEffect(() => {
    if (wipe === null) return;
    const v = raw.current; if (!v) return;
    let id = 0;
    const loop = () => {
      const p = t.player.current;
      const want = t.srcNow() / 1000;
      const playing = p?.isPlaying() ?? false;
      if (Math.abs(v.currentTime - want) > (playing ? 0.18 : 0.02)) v.currentTime = want;
      if (playing && v.paused) v.play().catch(() => {});
      if (!playing && !v.paused) v.pause();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [wipe === null, t]);

  // ---- wipe handle
  const dragWipe = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = box.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => setWipe(clamp((ev.clientX - r.left) / r.width, 0.02, 0.98));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    move(e.nativeEvent);
  };

  // ---- zoom focus picker: drawn over the un-zoomed frame at the moment the zoom starts
  const f0 = useMemo(() => (pick ? tl.frames[lowerBound(tl.src, pick.startMs)] : null), [pick?.startMs, tl]);
  const pickGeo = useMemo(() => {
    if (!pick || !f0) return null;
    const k = L.content.w / f0.vw;
    const cropped = f0.vw < PLAN.source.width - 0.5 || f0.vh < PLAN.source.height - 0.5;
    const m = 1 + (pick.scale - 1) * Math.max(0, style.zoom.amount) * (cropped ? 0.6 : 1);
    const rw = f0.vw / m, rh = f0.vh / m;
    const cx = clamp(pick.center.x, rw / 2, PLAN.source.width - rw / 2), cy = clamp(pick.center.y, rh / 2, PLAN.source.height - rh / 2);
    const toPct = (sx: number, sy: number) => ({x: ((L.content.x + (sx - f0.vx) * k) / L.canvasW) * 100, y: ((L.content.y + (sy - f0.vy) * k) / L.canvasH) * 100});
    const a = toPct(cx - rw / 2, cy - rh / 2), b = toPct(cx + rw / 2, cy + rh / 2), c = toPct(cx, cy);
    return {a, b, c, k};
  }, [pick, f0, L, style.zoom.amount]);
  const pickPointer = (e: React.PointerEvent) => {
    if (!f0 || !pickGeo) return;
    const el = e.currentTarget as HTMLElement;
    if (e.type === 'pointerdown') el.setPointerCapture(e.pointerId);
    else if (!(e.buttons & 1)) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * L.canvasW, py = ((e.clientY - r.top) / r.height) * L.canvasH;
    onPickMove({x: Math.round(f0.vx + (px - L.content.x) / pickGeo.k), y: Math.round(f0.vy + (py - L.content.y) / pickGeo.k)});
  };
  useEffect(() => {
    if (!pick) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); onPickEnd(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [pick, onPickEnd]);

  const wipeOn = wipe !== null && !pick;
  return (
    <div className="stage" ref={fit.ref}>
      {fit.w > 0 && (
        <div className="stage-box" ref={box} style={{width: fit.w, height: fit.h}}>
          {wipeOn && <video ref={raw} className="raw" src={VIDEO} poster={POSTER} muted playsInline loop preload="auto" aria-label="The raw recording" />}
          <div className="stage-dolly" style={wipeOn ? {clipPath: `inset(0 0 0 ${(wipe! * 100).toFixed(2)}%)`} : undefined}>
            <Player
              ref={t.player}
              component={DollyLive as any}
              inputProps={inputProps as any}
              durationInFrames={Math.max(2, tl.frames.length)}
              compositionWidth={L.canvasW}
              compositionHeight={L.canvasH}
              fps={FPS}
              autoPlay
              loop
              controls={false}
              clickToPlay={false}
              numberOfSharedAudioTags={0}
              acknowledgeRemotionLicense
              style={{width: '100%', height: '100%'}}
              posterFillMode="player-size"
              errorFallback={() => <div className="err">The preview couldn't load.</div>}
              renderLoading={() => <div className="loading"><img src={POSTER} alt="" /></div>}
            />
          </div>
          <MountSignal onMount={t.onMount} />
          {!pick && <button className="stage-hit" onClick={t.toggle} aria-label="Play or pause" tabIndex={-1} />}
          {wipeOn && (
            <>
              <span className="wipe-tag l">Before</span>
              <span className="wipe-tag r">After</span>
              <div className="wipe-bar" style={{left: `${wipe! * 100}%`}} onPointerDown={dragWipe}
                role="slider" aria-label="Before and after" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(wipe! * 100)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'ArrowLeft') setWipe(clamp(wipe! - 0.03, 0.02, 0.98)); if (e.key === 'ArrowRight') setWipe(clamp(wipe! + 0.03, 0.02, 0.98)); e.stopPropagation(); }}>
                <i>{Icon.left}{Icon.right}</i>
              </div>
            </>
          )}
          {pick && pickGeo && (
            <div className="pick" onPointerDown={pickPointer} onPointerMove={pickPointer}>
              <div className="pick-rect" style={{left: `${pickGeo.a.x}%`, top: `${pickGeo.a.y}%`, width: `${pickGeo.b.x - pickGeo.a.x}%`, height: `${pickGeo.b.y - pickGeo.a.y}%`}} />
              <div className="pick-dot" style={{left: `${pickGeo.c.x}%`, top: `${pickGeo.c.y}%`}}><i /></div>
              <div className="pick-bar">
                <span>Drag the target to choose where the camera looks</span>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={onPickEnd}>Done</button>
              </div>
            </div>
          )}
        </div>
      )}
      {fit.w === 0 && <img className="stage-ph" src={POSTER} alt="" />}
    </div>
  );
}

function MountSignal({onMount}: {onMount: () => void}) { useEffect(onMount, []); return null; }
export {SRC_ASPECT};
