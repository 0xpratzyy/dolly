import React, {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {Style} from '../types.ts';
import {backgroundStyle, grainStyle, vignetteStyle, shaderById, isAiBackground, isPhotoBackground} from './backgrounds.ts';
import {ShaderRenderer} from './shaders.ts';

// BackgroundField draws ANY Style['background'] into a width x height box: solid, gradient, image, the CSS/SVG presets, the animated
// shader presets and the photo presets, with the same blur / grain / vignette handling as Dolly's own background layer.
// Shaders are a pure function of (size, frame / fps), so the Remotion CLI and the browser <Player> draw the same picture.
// A video background has no field of its own here (Dolly draws it from the recording): it renders as the dark base.

const safe = <T,>(fn: () => T, fallback: T): T => {
  try { return fn(); } catch { return fallback; }
};

export interface BackgroundFieldProps {
  bg: Style['background'];
  width: number;
  height: number;
  /** Defaults to Remotion's current frame (0 outside a composition). */
  frame?: number;
  /** Defaults to the composition's fps (30 outside a composition). */
  fps?: number;
}

export const BackgroundField: React.FC<BackgroundFieldProps> = ({bg, width, height, frame, fps}) => {
  // hooks are always called, in the same order; they throw outside a composition, so fall back to 0 / 30
  const ctxFrame = safe(() => useCurrentFrame(), 0);
  const ctxFps = safe(() => useVideoConfig().fps, 30);
  const f = frame ?? ctxFrame;
  const fr = fps ?? ctxFps;
  const u = Math.min(width, height) / 1080;
  const blur = Math.max(0, bg.blur ?? 0) * u;
  const pad = blur ? blur * 2.2 : 0;
  const shader = bg.type === 'preset' ? shaderById[bg.value] : undefined;
  const [failed, setFailed] = useState(false);

  return (
    <div style={{position: 'relative', width, height, overflow: 'hidden', background: '#0C0C0D'}}>
      <div style={{position: 'absolute', inset: -pad, filter: blur ? `blur(${blur}px)` : undefined}}>
        {shader && !failed && !(bg as {still?: boolean}).still ? (  /* still: lite mode draws the shader's static fallback */
          <ShaderCanvas key={shader.id} id={shader.id} w={width + 2 * pad} h={height + 2 * pad} t={f / fr} onFail={() => setFailed(true)} fallback={shader.fallback} />
        ) : (
          <div style={{position: 'absolute', inset: 0, ...backgroundStyle(bg), ...driftStyle(bg, f / fr)}} />
        )}
      </div>
      {(bg.dim ?? 0) > 0 && <div style={{position: 'absolute', inset: 0, background: `rgba(0,0,0,${Math.min(1, bg.dim ?? 0)})`}} />}
      {(bg.grain ?? 0) > 0 && <div style={{position: 'absolute', inset: 0, ...grainStyle(bg.grain ?? 0, u)}} />}
      {(bg.vignette ?? 0) > 0 && <div style={{position: 'absolute', inset: 0, ...vignetteStyle(bg.vignette ?? 0)}} />}
    </div>
  );
};

/** Slow Ken Burns for image backgrounds: scale 1 -> 1+0.06*drift with a small pan, over a 40 s sine so it also loops. */
function driftStyle(bg: Style['background'], t: number): React.CSSProperties {
  const d = bg.drift ?? 0;
  if (!(d > 0) || !(bg.type === 'image' || isAiBackground(bg) || isPhotoBackground(bg))) return {};
  const ph = Math.sin((t / 40) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
  const sc = 1.0 + 0.07 * d * (0.4 + ph);
  return {transform: `scale(${sc.toFixed(5)}) translate(${(Math.sin(t / 40 * Math.PI * 2) * 1.2 * d).toFixed(3)}%, ${(Math.cos(t / 40 * Math.PI * 2) * 0.8 * d).toFixed(3)}%)`};
}

const ShaderCanvas: React.FC<{id: string; w: number; h: number; t: number; onFail: () => void; fallback: string}> = ({id, w, h, t, onFail, fallback}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const rend = useRef<{r: ShaderRenderer; id: string} | null>(null);
  const def = shaderById[id];
  const px = useMemo(() => ({w: Math.max(16, Math.round(w * def.res)), h: Math.max(16, Math.round(h * def.res))}), [w, h, def.res]);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    try {
      if (!rend.current || rend.current.id !== id) {
        rend.current?.r.dispose();
        rend.current = {r: new ShaderRenderer(c, def), id};
      }
      if (c.width !== px.w) c.width = px.w;
      if (c.height !== px.h) c.height = px.h;
      rend.current.r.draw(t);
    } catch {
      onFail(); // no WebGL, or the program failed: the CSS fallback takes over
    }
  });
  useLayoutEffect(() => () => { rend.current?.r.dispose(); rend.current = null; }, [id]);

  return <canvas ref={ref} width={px.w} height={px.h} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', background: fallback}} />;
};
