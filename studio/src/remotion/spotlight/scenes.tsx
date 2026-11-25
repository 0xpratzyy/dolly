import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {Style} from '../../types.ts';
import {BackgroundField} from '../BackgroundField.tsx';
import {backgroundIsDark, grainStyle} from '../backgrounds.ts';
import type {SceneId} from './types.ts';

// Scenes: the stage behind the component. Graphite (default: near-black, a soft top light, a faint floor sheen), Void (the older,
// flatter near-black), Studio (clean off-white) and Wallpaper (any Dolly background, dimmed and softened so the UI reads).
// Neutral on purpose: the component carries the colour.

export const sceneDark = (scene: SceneId, bg?: Style['background']): boolean => {
  if (scene === 'studio') return false;
  if (scene === 'wallpaper') return bg ? backgroundIsDark(bg) : true;
  return true;
};

const NOISE = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 -.25'/></filter><rect width='200' height='200' filter='url(#n)'/></svg>")}")`;
const NOISE_DARK = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .9 -.25'/></filter><rect width='200' height='200' filter='url(#n)'/></svg>")}")`;

/** Animated film grain: the tile jumps every frame, so it reads as grain not as a pattern. */
const Grain: React.FC<{frame: number; amount: number; dark: boolean; u: number}> = ({frame, amount, dark, u}) => (
  <AbsoluteFill style={{backgroundImage: dark ? NOISE : NOISE_DARK, backgroundSize: `${200 * Math.max(0.7, u)}px`, backgroundPosition: `${(frame * 53) % 200}px ${(frame * 97) % 200}px`, opacity: amount, mixBlendMode: dark ? 'screen' : 'multiply'}} />
);

export const SceneBackground: React.FC<{scene: SceneId; bg?: Style['background']; W: number; H: number; u: number; frame: number; fps: number; shift: {x: number; y: number}; zoom: number}> = ({scene, bg, W, H, u, frame, fps, shift, zoom}) => {
  const par = `translate(${(-shift.x * 0.05).toFixed(2)}px, ${(-shift.y * 0.05).toFixed(2)}px) scale(${(1.06 + (zoom - 1) * 0.06).toFixed(4)})`;
  if (scene === 'graphite') {
    // graphite #0c0c0d lit from above like a product table: a broad soft key from the top, a faint sheen where the floor would
    // catch it, a gentle vignette. No colour: the component carries it.
    return (
      <AbsoluteFill style={{background: '#0b0b0c'}}>
        <AbsoluteFill style={{background: 'radial-gradient(78% 62% at 50% -16%, rgba(232,238,244,0.105) 0%, rgba(232,238,244,0.04) 42%, rgba(232,238,244,0) 74%)', transform: par}} />
        <AbsoluteFill style={{background: 'linear-gradient(to bottom, rgba(255,255,255,0) 60%, rgba(255,255,255,0.016) 78%, rgba(255,255,255,0.004) 100%)'}} />
        <AbsoluteFill style={{background: 'radial-gradient(46% 9% at 50% 86%, rgba(255,255,255,0.04), rgba(255,255,255,0))'}} />
        <AbsoluteFill style={{background: 'radial-gradient(125% 95% at 50% 42%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.5) 100%)'}} />
        <Grain frame={frame} amount={0.035} dark u={u} />
      </AbsoluteFill>
    );
  }
  if (scene === 'void') {
    return (
      <AbsoluteFill style={{background: '#040405'}}>
        <AbsoluteFill style={{background: 'radial-gradient(62% 58% at 50% 46%, #141418 0%, #0a0a0c 48%, #030304 100%)', transform: par}} />
        <AbsoluteFill style={{background: 'radial-gradient(40% 14% at 50% 80%, rgba(255,255,255,0.045), rgba(255,255,255,0))'}} />
        <Grain frame={frame} amount={0.05} dark u={u} />
      </AbsoluteFill>
    );
  }
  if (scene === 'studio') {
    return (
      <AbsoluteFill style={{background: '#f3f3f0'}}>
        <AbsoluteFill style={{background: 'radial-gradient(85% 70% at 50% -8%, #ffffff 0%, rgba(255,255,255,0.0) 72%), radial-gradient(70% 50% at 50% 112%, rgba(0,0,0,0.07), rgba(0,0,0,0))', transform: par}} />
        <Grain frame={frame} amount={0.05} dark={false} u={u} />
      </AbsoluteFill>
    );
  }
  // wallpaper: dimmed and softened by default (the CLI passes blur 6 / dim 0.22 unless told otherwise) so the UI reads on it
  const b: Style['background'] = bg ?? {type: 'preset', value: 'liquid-dusk', grain: 0.2, blur: 6, dim: 0.22};
  return (
    <AbsoluteFill style={{background: '#0c0c0d', overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: par}}>
        <BackgroundField bg={b} width={W} height={H} frame={frame} fps={fps} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
