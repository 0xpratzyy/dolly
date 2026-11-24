import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {BackgroundLayer, CaptionsLayer, FONT, Keystrokes} from './Dolly.tsx';
import {backgroundIsDark, grainStyle, vignetteStyle} from './backgrounds.ts';
import type {Frame} from '../camera.ts';
import type {CaptionsInput, Plan, Style} from '../types.ts';

// Single pictures for the native renderer (recorder/Sources/dolly-render), drawn by the SAME components as the Remotion
// render so they match it: a caption state (transparent), a keystroke pill (transparent), or the static background.
// The native renderer composites these on the GPU; scripts/render-prep.mjs renders each one once and caches it.
export interface StillProps {
  mode: 'caption' | 'key' | 'bg' | 'grain' | 'vignette';
  width: number; height: number; fps: number;
  /** Length of the real video in frames (captions are timed against it); the still is taken at the frame asked for. */
  frames: number;
  style: Style;
  captions?: CaptionsInput;
  captionStyle?: Record<string, any>;
  /** mode key: the shortcut label. */
  label?: string;
}

export const DollyStill: React.FC<StillProps> = ({mode, width: W, height: H, fps, frames, style, captions = [], captionStyle, label}) => {
  const frame = useCurrentFrame();
  const u = Math.min(W, H) / 1080;
  if (mode === 'bg') {
    return (
      <AbsoluteFill style={{background: '#0C0C0D'}}>
        <BackgroundLayer bg={style.background} u={u} video="" pieces={[]} fps={fps} />
      </AbsoluteFill>
    );
  }
  // background type video: the grain tile layer (the native renderer blends it as overlay) and the vignette, each on transparent
  if (mode === 'grain') return <AbsoluteFill style={{...grainStyle(1, u), opacity: 1, mixBlendMode: undefined}} />;
  if (mode === 'vignette') return <AbsoluteFill style={vignetteStyle(style.background.vignette ?? 0)} />;
  if (mode === 'key') {
    // fully shown: 500 ms after the key
    const plan = {keys: [{tMs: 0, label: label ?? ''}]} as unknown as Plan;
    return <AbsoluteFill style={{fontFamily: FONT}}><Keystrokes plan={plan} f={{src: 500} as Frame} u={u} W={W} H={H} dark={backgroundIsDark(style.background)} /></AbsoluteFill>;
  }
  return <AbsoluteFill style={{fontFamily: FONT}}><CaptionsLayer captions={captions} captionStyle={captionStyle} style={style} frame={frame} fps={fps} u={u} W={W} H={H} durationMs={(frames / fps) * 1000} /></AbsoluteFill>;
};
