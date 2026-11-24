import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {buildTimeline, videoPieces, type Frame} from '../camera.ts';
import {defaultStyle, mergeStyle, motionDefaults, type AudioTrack, type Caption, type CaptionsInput, type FacecamTrack, type Plan, type Style} from '../types.ts';
import {Facecam} from './Facecam.tsx';
import {LoadingCover} from './LoadingCover.tsx';
import {toSubtleCaptions} from '../captions.ts';
import {Captions as SubtleCaptions} from '@subtle/Captions';
import {backgroundStyle, backgroundIsDark, grainStyle, vignetteStyle} from './backgrounds.ts';
import {boxShadowCss, boxShadows, cameraBlur, chromeLook, cursorGhosts, cursorPress, cursorShapes, keystrokeAt, rippleAt} from '../track.ts';

export interface DollyProps {
  /** File name inside the public dir (CLI), or an absolute / root-relative URL (website). */
  video: string;
  plan: Plan;
  /** Any subset of Style; merged over plan.style and defaultStyle. */
  style?: Partial<Style> | Record<string, any>;
  /**
   * Subtitles in OUTPUT time (what the viewer sees): [{startMs,endMs,text}] or a Subtle captions file with word timings.
   * Drawn by Subtle's caption engine in the style `style.captions.style`.
   */
  captions?: CaptionsInput;
  /**
   * The Subtle style JSON for `style.captions.style` (subtle/styles/<name>.json). The CLI loads it; the website passes it
   * from its own glob. Without it the captions fall back to a plain readable bar.
   */
  captionStyle?: Record<string, any>;
  /** Narrate mode: the user's voice as the audio track (the screen recording itself is silent). */
  audio?: AudioTrack;
  /** Narrate mode: the speaker's clip, shown as a bubble (style.facecam). */
  facecam?: FacecamTrack;
  /** events.loading: route-change shells to cover (style.loadingCover=false turns it off). */
  loading?: {startMs: number; endMs: number}[];
}

export const FONT = "'Figtree', ui-sans-serif, system-ui, -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif";
const MONO = "'DM Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const ICE = '#86E4F0';
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export const resolveStyle = (plan: Plan, style?: DollyProps['style']): Style => mergeStyle(defaultStyle, plan.style, style);
const resolveSrc = (v: string) => (/^(https?:|blob:|data:|\/)/.test(v) ? v : staticFile(v));

export const Dolly: React.FC<DollyProps> = ({video, plan, style: styleIn, captions = [], captionStyle, audio, facecam, loading}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const style = useMemo(() => resolveStyle(plan, styleIn), [plan, styleIn]);
  const tl = useMemo(() => buildTimeline(plan, style, fps), [plan, style, fps]);
  const pieces = useMemo(() => videoPieces(tl.src, fps), [tl, fps]);
  const i = clamp(frame, 0, tl.frames.length - 1);
  const f = tl.frames[i];
  const p = tl.frames[Math.max(0, i - 1)];
  const L = tl.layout;
  const {width: SW, height: SH, pointScale: ps} = plan.source;
  const k = L.content.w / f.vw;
  const dark = backgroundIsDark(style.background);

  // ---- motion blur: directional, from how far the camera moved this frame (canvas px)
  // (the math lives in ../track.ts, shared with the native renderer)
  const {sx, sy, on: blur} = cameraBlur(f, p, L.content.w, style.motionBlur);
  const M = 60; // margin so the blur never samples the clipped edge

  const radius = style.radius * L.u;
  const sh = style.shadow;

  return (
    <AbsoluteFill style={{background: '#0C0C0D', fontFamily: FONT, overflow: 'hidden'}}>
      <BackgroundLayer bg={style.background} u={L.u} video={video} pieces={pieces} fps={fps} />
      <svg width="0" height="0" style={{position: 'absolute'}}>
        <defs>
          <filter id="dolly-mb" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`} />
          </filter>
        </defs>
      </svg>

      {/* window box */}
      <div
        style={{
          position: 'absolute', left: L.box.x, top: L.box.y, width: L.box.w, height: L.box.h,
          borderRadius: radius, background: '#000',
          boxShadow: boxShadow(style, L.u, dark, sh),
        }}
      >
        <div style={{position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden'}}>
          {style.frame !== 'none' && <Chrome style={style} u={L.u} h={L.chromeH} w={L.box.w} />}
          <div style={{position: 'absolute', left: 0, top: L.chromeH, width: L.content.w, height: L.content.h, overflow: 'hidden'}}>
            <div
              style={{
                position: 'absolute', left: -M, top: -M, width: L.content.w + 2 * M, height: L.content.h + 2 * M,
                filter: blur ? 'url(#dolly-mb)' : undefined,
              }}
            >
              <div
                style={{
                  position: 'absolute', left: M, top: M, width: SW, height: SH, transformOrigin: '0 0',
                  transform: `translate(${(-f.vx * k).toFixed(3)}px, ${(-f.vy * k).toFixed(3)}px) scale(${k.toFixed(5)})`,
                }}
              >
                {pieces.map((pc, n) => (
                  <Sequence key={n} from={pc.outStart} durationInFrames={pc.frames} layout="none">
                    <OffthreadVideo
                      src={resolveSrc(video)}
                      startFrom={Math.round((pc.srcStartMs / 1000) * fps)}
                      playbackRate={pc.speed}
                      muted
                      style={{width: SW, height: SH, display: 'block'}}
                    />
                    {/* a sped-up stretch shows every frame it skips, blended in (no stutter): the in-between source frame at half opacity */}
                    {pc.speed > 1.2 && (
                      <OffthreadVideo
                        src={resolveSrc(video)}
                        startFrom={Math.round((pc.srcStartMs / 1000) * fps) + Math.max(1, Math.round(pc.speed / 2))}
                        playbackRate={pc.speed}
                        muted
                        style={{position: 'absolute', left: 0, top: 0, width: SW, height: SH, display: 'block', opacity: 0.5}}
                      />
                    )}
                  </Sequence>
                ))}
                {loading?.length && style.loadingCover !== false ? <LoadingCover video={video} plan={plan} tl={tl} windows={loading} fps={fps} /> : null}
                <Effects plan={plan} style={style} f={f} p={p} ps={ps} k={k / L.u} fps={fps} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {facecam && <Facecam track={facecam} style={style} tl={tl} plan={plan} />}
      {audio && (
        <Sequence from={Math.round(((audio.offsetMs ?? 0) / 1000) * fps)} layout="none">
          <Audio src={resolveSrc(audio.src)} volume={(fr) => (audio.volume ?? 1) * interpolate(fr, [Math.max(0, tl.frames.length - 1 - Math.round((audio.offsetMs ?? 0) / 1000 * fps) - 12), tl.frames.length - 1 - Math.round((audio.offsetMs ?? 0) / 1000 * fps)], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} />
        </Sequence>
      )}
      {style.keystrokes && <Keystrokes plan={plan} f={f} u={L.u} W={L.canvasW} H={L.canvasH} dark={dark} />}
      <CaptionsLayer captions={captions} captionStyle={captionStyle} style={style} frame={frame} fps={fps} u={L.u} W={L.canvasW} H={L.canvasH} durationMs={(tl.frames.length / fps) * 1000} />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ cursor + click effects (source space)
const Effects: React.FC<{plan: Plan; style: Style; f: Frame; p: Frame; ps: number; k: number; fps: number}> = ({plan, style, f, p, ps, k, fps}) => {
  const now = f.src;
  const size = 26 * ps * style.cursor.size;
  // press, trail and click circles: ../track.ts (shared with the native renderer)
  const press = cursorPress(plan, now);
  // trail on fast moves only: ghosts along this frame's path (speed measured on screen, in 1080p px/s)
  const ghosts = cursorGhosts(f, p, k, fps, style).map((g) => ({...f, ...g}));
  return (
    <>
      {style.clickEffect !== 'none' &&
        plan.clicks.map((c, n) => {
          const rp = rippleAt(c, style.clickEffect, now, ps);
          if (!rp) return null;
          const r = rp.r;
          return <div key={n} style={{position: 'absolute', left: c.x - r, top: c.y - r, width: 2 * r, height: 2 * r, borderRadius: '50%', border: rp.border ? `${rp.border}px solid ${ICE}` : undefined, opacity: rp.opacity, boxSizing: 'border-box', background: `rgba(134,228,240,${rp.fill})`}} />;
        })}
      {style.cursor.visible && f.co > 0.01 && ghosts.map((g, n) => <Cursor key={`g${n}`} kind={style.cursor.style ?? 'arrow'} f={g} size={size} ps={ps} press={press} soft />)}
      {style.cursor.visible && f.co > 0.01 && <Cursor kind={style.cursor.style ?? 'arrow'} f={f} size={size} ps={ps} press={press} />}
    </>
  );
};

// ------------------------------------------------------------------ cursor shapes (hotspot at the tip, or the centre for dot / ring)
const Cursor: React.FC<{kind: NonNullable<Style['cursor']['style']>; f: Frame; size: number; ps: number; press: number; soft?: boolean}> = ({kind, f, size, ps, press, soft}) => {
  const shadow = soft ? undefined : `drop-shadow(0 ${1.5 * ps}px ${2.5 * ps}px rgba(0,0,0,0.45))`;
  const base = {position: 'absolute' as const, left: f.cx, top: f.cy, opacity: f.co, overflow: 'visible' as const, filter: shadow};
  if (kind === 'dot' || kind === 'ring') {
    const d = size * (kind === 'dot' ? 0.62 : 0.95);
    return (
      <div
        style={{
          ...base, left: f.cx - d / 2, top: f.cy - d / 2, width: d, height: d, borderRadius: '50%', boxSizing: 'border-box', transform: `scale(${press})`,
          ...(kind === 'dot'
            ? {background: '#F2F3F4', border: `${2.2 * ps}px solid rgba(12,12,13,0.75)`}
            : {border: `${3.4 * ps}px solid #F2F3F4`, background: 'rgba(242,243,244,0.12)'}),
        }}
      />
    );
  }
  // arrow and hand: one outlined path each (cursorShapes in ../track.ts, shared with the native renderer)
  const sh = cursorShapes[kind];
  return (
    <svg width={size * sh.w} height={size * sh.h} viewBox={`0 0 ${sh.vbW} ${sh.vbH}`} style={{...base, left: f.cx - size * sh.hotX, transformOrigin: `${size * sh.hotX}px 0`, transform: `scale(${press})`}}>
      <path d={sh.d} fill="#fff" stroke="#0C0C0D" strokeWidth={sh.stroke} strokeLinejoin="round" />
    </svg>
  );
};

// ------------------------------------------------------------------ background (base + blur, or the blurred recording; grain; vignette)
export const BackgroundLayer: React.FC<{bg: Style['background']; u: number; video: string; pieces: ReturnType<typeof videoPieces>; fps: number}> = ({bg, u, video, pieces, fps}) => {
  const isVideo = bg.type === 'video';
  const blur = Math.max(0, bg.blur ?? (isVideo ? 40 : 0)) * u;
  return (
    <AbsoluteFill>
      {isVideo ? (
        <AbsoluteFill style={{filter: `blur(${blur}px) brightness(0.5) saturate(1.25)`, transform: 'scale(1.25)'}}>
          {pieces.map((pc, n) => (
            <Sequence key={n} from={pc.outStart} durationInFrames={pc.frames} layout="none">
              <OffthreadVideo src={resolveSrc(video)} startFrom={Math.round((pc.srcStartMs / 1000) * fps)} playbackRate={pc.speed} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />
            </Sequence>
          ))}
        </AbsoluteFill>
      ) : (
        <div style={{position: 'absolute', inset: blur ? -blur * 2.2 : 0, ...backgroundStyle(bg), filter: blur ? `blur(${blur}px)` : undefined}} />
      )}
      {(bg.dim ?? 0) > 0 && <AbsoluteFill style={{background: `rgba(0,0,0,${Math.min(1, bg.dim ?? 0)})`}} />}
      {(bg.grain ?? 0) > 0 && <AbsoluteFill style={grainStyle(bg.grain ?? 0, u)} />}
      {(bg.vignette ?? 0) > 0 && <AbsoluteFill style={vignetteStyle(bg.vignette ?? 0)} />}
    </AbsoluteFill>
  );
};

/** Drop shadow (strength = shadow, colour = shadowColor) plus the optional edge: the list is built in ../track.ts. */
function boxShadow(style: Style, u: number, dark: boolean, _sh: number): string {
  return boxShadowCss(boxShadows(style, u, dark));
}

// ------------------------------------------------------------------ window chrome
const Chrome: React.FC<{style: Style; u: number; h: number; w: number}> = ({style, u, h, w}) => {
  const look = chromeLook(style, backgroundIsDark(style.background));
  const {light, bar, text} = look;
  const dot = look.dot * u;
  return (
    <div style={{position: 'absolute', left: 0, top: 0, width: w, height: h, background: bar, borderBottom: `1px solid ${light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'}`, display: 'flex', alignItems: 'center', padding: `0 ${16 * u}px`, boxSizing: 'border-box'}}>
      <div style={{display: 'flex', gap: 8 * u}}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{width: dot, height: dot, borderRadius: '50%', background: c}} />)}
      </div>
      {style.frame === 'browser' ? (
        <div style={{position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '46%', height: 28 * u, borderRadius: 14 * u, background: light ? '#fff' : '#2a2b2e', color: text, fontSize: 14 * u, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: 0.1}}>
          {style.frameLabel || 'localhost'}
        </div>
      ) : (
        <div style={{position: 'absolute', left: 0, right: 0, textAlign: 'center', color: text, fontSize: 14 * u, fontWeight: 600}}>{style.frameLabel}</div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ keystroke overlay (labelled shortcuts only)
export const Keystrokes: React.FC<{plan: Plan; f: Frame; u: number; W: number; H: number; dark: boolean}> = ({plan, f, u, W, H, dark}) => {
  const ks = keystrokeAt(plan, f.src);
  if (!ks) return null;
  const k = plan.keys[ks.index];
  const o = ks.opacity;
  return (
    <div style={{position: 'absolute', left: 0, width: W, bottom: H * 0.035, display: 'flex', justifyContent: 'center', opacity: o, transform: `translateY(${(1 - o) * 10 * u}px)`}}>
      <div style={{fontFamily: MONO, fontSize: 30 * u, color: '#F2F3F4', background: 'rgba(20,21,23,0.82)', border: `${u}px solid rgba(255,255,255,0.14)`, borderRadius: 18 * u, padding: `${10 * u}px ${24 * u}px`, boxShadow: `0 ${8 * u}px ${30 * u}px rgba(0,0,0,0.4)`}}>{k.label}</div>
    </div>
  );
};

// ------------------------------------------------------------------ subtitles
const CAPTION_Y = {bottom: 84, middle: 50, top: 13, below: 94} as const; // below: on the wallpaper under the window (needs padding of about 11)

/**
 * Captions on top of everything, drawn by Subtle's caption engine (imported unchanged through the `@subtle` alias, see
 * remotion.config.ts). Falls back to a plain bar when no Subtle style JSON was passed.
 */
export const CaptionsLayer: React.FC<{captions: CaptionsInput; captionStyle?: Record<string, any>; style: Style; frame: number; fps: number; u: number; W: number; H: number; durationMs: number}> = ({captions, captionStyle, style, frame, fps, u, W, H, durationMs}) => {
  const empty = Array.isArray(captions) ? !captions.length : !captions?.pages?.length;
  if (!style.captions.enabled || empty) return null;
  if (!captionStyle) return <PlainCaptions captions={captions} style={style} frame={frame} fps={fps} u={u} W={W} H={H} />;
  return <SubtleLayer captions={captions} captionStyle={captionStyle} style={style} fps={fps} W={W} H={H} durationMs={durationMs} />;
};

const SubtleLayer: React.FC<{captions: CaptionsInput; captionStyle: Record<string, any>; style: Style; fps: number; W: number; H: number; durationMs: number}> = ({captions, captionStyle, style, fps, W, H, durationMs}) => {
  const st = useMemo(() => {
    const pos = style.captions.position;
    const sz = style.captions.size;
    const base = captionStyle as any;
    return {...base, size: base.size * sz, position: {...base.position, y: CAPTION_Y[pos] ?? CAPTION_Y.bottom}};
  }, [captionStyle, style.captions.position, style.captions.size]);
  const file = useMemo(() => toSubtleCaptions(captions, st, {width: W, height: H, fps, durationMs}), [captions, st, W, H, fps, durationMs]);
  return <SubtleCaptions captions={file as any} style={st} layer="all" />;
};

const PlainCaptions: React.FC<{captions: CaptionsInput; style: Style; frame: number; fps: number; u: number; W: number; H: number}> = ({captions, style, frame, fps, u, W, H}) => {
  const list: Caption[] = Array.isArray(captions)
    ? captions
    : captions.pages.map((p) => ({startMs: p.startMs, endMs: p.endMs, text: p.words.map((w) => w.text).join(' ')}));
  const t = (frame / fps) * 1000;
  const c = list.find((x) => t >= x.startMs && t < x.endMs);
  if (!c) return null;
  const o = clamp((t - c.startMs) / 140, 0, 1) * clamp((c.endMs - t) / 140, 0, 1);
  const fs = 44 * u * style.captions.size;
  return (
    <div style={{position: 'absolute', left: W * 0.08, right: W * 0.08, [style.captions.position === 'top' ? 'top' : 'bottom']: H * 0.06, display: 'flex', justifyContent: 'center', opacity: o}}>
      <div style={{maxWidth: '100%', textAlign: 'center', fontSize: fs, lineHeight: 1.25, fontWeight: 600, color: '#fff', background: 'rgba(12,12,13,0.72)', padding: `${0.28 * fs}px ${0.6 * fs}px`, borderRadius: 0.6 * fs, textShadow: '0 1px 2px rgba(0,0,0,0.5)'}}>{c.text}</div>
    </div>
  );
};
