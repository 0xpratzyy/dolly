import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {Style} from '../../types.ts';
import {BackgroundField} from '../BackgroundField.tsx';
import {backgroundIsDark, grainStyle} from '../backgrounds.ts';
import type {SceneId, SpotlightItem} from './types.ts';

// Scenes: the stage behind the component. Void (near-black), Studio (clean off-white), Wallpaper (any Dolly background),
// Desk (a soft-lit glass slab on a blurred wallpaper) and Curtain (dark with soft vertical light streaks).

export const sceneDark = (scene: SceneId, bg?: Style['background']): boolean => {
  if (scene === 'studio') return false;
  if (scene === 'wallpaper' || scene === 'desk') return bg ? backgroundIsDark(bg) : true;
  return true;
};

const NOISE = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 -.25'/></filter><rect width='200' height='200' filter='url(#n)'/></svg>")}")`;
const NOISE_DARK = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .9 -.25'/></filter><rect width='200' height='200' filter='url(#n)'/></svg>")}")`;

/** Animated film grain: the tile jumps every frame, so it reads as grain not as a pattern. */
const Grain: React.FC<{frame: number; amount: number; dark: boolean; u: number}> = ({frame, amount, dark, u}) => (
  <AbsoluteFill style={{backgroundImage: dark ? NOISE : NOISE_DARK, backgroundSize: `${200 * Math.max(0.7, u)}px`, backgroundPosition: `${(frame * 53) % 200}px ${(frame * 97) % 200}px`, opacity: amount, mixBlendMode: dark ? 'screen' : 'multiply'}} />
);

// deterministic light streaks for Curtain
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const STREAKS = (() => { const r = rng(7); return Array.from({length: 46}, (_, i) => ({x: r(), w: 0.006 + r() * r() * 0.07, o: 0.04 + r() * 0.12, ph: r() * 6.28, sp: 0.04 + r() * 0.09, amp: 0.002 + r() * 0.01, i})); })();

const Curtain: React.FC<{W: number; H: number; u: number; frame: number; fps: number}> = ({W, H, u, frame, fps}) => {
  const t = frame / fps;
  return (
    <AbsoluteFill style={{background: '#050506'}}>
      <AbsoluteFill style={{background: 'radial-gradient(70% 90% at 50% -12%, rgba(255,243,226,0.19) 0%, rgba(255,243,226,0.05) 38%, rgba(0,0,0,0) 70%)'}} />
      <AbsoluteFill style={{filter: `blur(${5 * u}px)`, maskImage: 'linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.55) 45%, transparent 92%)', WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.55) 45%, transparent 92%)'}}>
        {STREAKS.map((s) => {
          const cx = s.x * W * 1.1 - 0.05 * W + Math.sin(t * s.sp * 6.28 + s.ph) * s.amp * W;
          const centre = 1 - Math.min(1, Math.abs(cx / W - 0.5) * 1.7); // brighter toward the middle
          const o = s.o * (0.45 + 0.55 * centre) * (0.82 + 0.18 * Math.sin(t * s.sp * 9 + s.ph * 2));
          const w = Math.max(3 * u, s.w * W);
          return <div key={s.i} style={{position: 'absolute', left: cx - w / 2, top: -H * 0.05, width: w, height: H * 1.1, background: `linear-gradient(90deg, rgba(255,246,235,0), rgba(255,246,235,${o.toFixed(3)}) 50%, rgba(255,246,235,0))`}} />;
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{background: 'radial-gradient(90% 70% at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)'}} />
      <Grain frame={frame} amount={0.06} dark u={u} />
    </AbsoluteFill>
  );
};

export const SceneBackground: React.FC<{scene: SceneId; bg?: Style['background']; W: number; H: number; u: number; frame: number; fps: number; shift: {x: number; y: number}; zoom: number}> = ({scene, bg, W, H, u, frame, fps, shift, zoom}) => {
  const par = `translate(${(-shift.x * 0.05).toFixed(2)}px, ${(-shift.y * 0.05).toFixed(2)}px) scale(${(1.06 + (zoom - 1) * 0.06).toFixed(4)})`;
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
  if (scene === 'curtain') return <Curtain W={W} H={H} u={u} frame={frame} fps={fps} />;
  const b: Style['background'] = bg ?? {type: 'preset', value: 'liquid-dusk', grain: 0.2};
  if (scene === 'desk') {
    return (
      <AbsoluteFill style={{background: '#0c0c0d'}}>
        <AbsoluteFill style={{transform: par}}>
          <BackgroundField bg={{...b, blur: b.blur ?? 14}} width={W} height={H} frame={frame} fps={fps} />
        </AbsoluteFill>
        <AbsoluteFill style={{background: 'radial-gradient(70% 70% at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.28) 100%)'}} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: '#0c0c0d', overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: par}}>
        <BackgroundField bg={b} width={W} height={H} frame={frame} fps={fps} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The soft-lit glass slab of the Desk scene (drawn in the world, behind the hero). */
export const DeskSlab: React.FC<{item: SpotlightItem; s: number; u: number; dark: boolean}> = ({item, s, u, dark}) => {
  const m = item.meta, bb = m.bbox.filter(Boolean) as number[][];
  const med = (k: number) => { const a = bb.map((b) => b[k]).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length * 0.6)] : 0; };
  const mw = med(2) || m.image.cssW, mh = med(3) || m.image.cssH;
  // centred on the typical box, relative to the image centre (the item sits at the world origin)
  const cx = (med(0) + mw / 2 - m.image.cssW / 2) * s, cy = (med(1) + mh / 2 - m.image.cssH / 2) * s;
  const W = mw * s * 1.34 + 90 * u, H = mh * s * 1.3 + 80 * u, r = 46 * u;
  return (
    <div style={{position: 'absolute', left: cx - W / 2, top: cy - H / 2, width: W, height: H, borderRadius: r, transform: 'translateZ(-30px)',
      background: dark ? 'linear-gradient(150deg, rgba(255,255,255,0.14), rgba(255,255,255,0.045) 55%, rgba(255,255,255,0.08))' : 'linear-gradient(150deg, rgba(255,255,255,0.46), rgba(255,255,255,0.16) 55%, rgba(255,255,255,0.3))',
      backdropFilter: `blur(${26 * u}px) saturate(1.35)`, WebkitBackdropFilter: `blur(${26 * u}px) saturate(1.35)`,
      boxShadow: `0 ${60 * u}px ${130 * u}px rgba(0,0,0,${dark ? 0.5 : 0.28}), inset 0 ${1.5 * u}px 0 rgba(255,255,255,${dark ? 0.28 : 0.7}), inset 0 0 0 ${1 * u}px rgba(255,255,255,${dark ? 0.12 : 0.3}), inset 0 ${-30 * u}px ${60 * u}px rgba(255,255,255,${dark ? 0.03 : 0.12})`}} />
  );
};
