import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {buildTimeline, CHROME_BAR, type Built, type FrameState} from './timeline.ts';
import {defaultSpotlightOptions, type SpotlightItem, type SpotlightOptions, type SpotlightProps} from './types.ts';
import {SpotCursor} from './Cursor.tsx';
import {SceneBackground, sceneDark} from './scenes.tsx';
import {backgroundIsDark} from '../backgrounds.ts';

const FONT = "'Figtree', ui-sans-serif, -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif";
const MONO = "'DM Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const resolve = (v: string) => (/^(https?:|blob:|data:|\/)/.test(v) ? v : staticFile(v));
const PLATE_PX = 16, PLATE_PY = 9;
/** A text-only component (its own box paints nothing) gets a plate in its page colour, so it keeps the surface it has on the site. */
function needsPlate(m: SpotlightItem['meta'], o: SpotlightOptions): boolean {
  if (o.plate === 'off') return false;
  if (o.plate === 'on') return true;
  if (!m.rootRect) return false;
  const k = Math.min(m.frames - 1, 12);
  const r = m.rootRect[k];
  if (!r) return false;
  const area = r[2] * r[3];
  const covered = (m.cards?.[k] ?? []).some((c) => {
    const w = Math.min(r[0] + r[2], c[0] + c[2]) - Math.max(r[0], c[0]), h = Math.min(r[1] + r[3], c[1] + c[3]) - Math.max(r[1], c[1]);
    return w > 0 && h > 0 && w * h >= 0.5 * area;
  });
  return !covered;
}
const pad5 = (n: number) => String(n + 1).padStart(5, '0');
const assetUrl = (item: SpotlightItem, file: string) => {
  const root = item.base.startsWith('http') || item.base.startsWith('/') ? item.base : staticFile(item.base);
  return `${root}/${file}`;
};
/** The component's painted box (image CSS px) at the capture frame shown. */
const boxAt = (m: SpotlightItem['meta'], n: number) => m.bbox[Math.min(m.bbox.length - 1, n)] ?? [0, 0, m.image.cssW, m.image.cssH];
const ICE = '134,228,240'; // #86E4F0, the one accent

/** Beat 1: the real page the component lives in, as a quiet browser window; it dims, pushes back and fades as the component lifts. */
const ContextPage: React.FC<{item: SpotlightItem; tl: Built; st: FrameState; u: number}> = ({item, tl, st, u}) => {
  const m = item.meta, ctx = m.context!, p = tl.placed[0], s = p.s, clip = m.clip ?? {x: 0, y: 0, width: m.image.cssW, height: m.image.cssH};
  const it = st.intro!;
  const bar = CHROME_BAR * s, pw = ctx.w * s, ph = ctx.h * s;
  const left = p.x - p.w / 2 - clip.x * s, top = p.y - p.h / 2 - clip.y * s - bar;
  const b = boxAt(m, st.items[0].frame);
  const ox = (clip.x + b[0] + b[2] / 2) * s, oy = bar + (clip.y + b[1] + b[3] / 2) * s;
  let label = 'localhost';
  try { const q = new URL(m.url ?? ''); if (/^https?:$/.test(q.protocol)) label = (q.host + q.pathname).replace(/\/$/, ''); } catch {}
  const zr = 1 / Math.max(0.2, st.cam.zoom);
  return (
    <div style={{position: 'absolute', left, top, width: pw, height: ph + bar, borderRadius: 14 * s, overflow: 'hidden', background: '#0e0e10', opacity: it.page,
      transformOrigin: `${ox}px ${oy}px`, transform: `translateZ(-1px) scale(${(1 - 0.045 * it.lift).toFixed(4)})`,
      boxShadow: `inset 0 0 0 ${zr * u}px rgba(255,255,255,0.10), 0 ${50 * u}px ${140 * u}px rgba(0,0,0,0.55)`}}>
      <div style={{position: 'absolute', left: 0, top: 0, width: pw, height: bar, background: '#161618', borderBottom: `${zr * u}px solid rgba(255,255,255,0.06)`}}>
        {[0, 1, 2].map((k) => <div key={k} style={{position: 'absolute', left: (18 + k * 18) * s, top: bar / 2 - 5.5 * s, width: 11 * s, height: 11 * s, borderRadius: '50%', background: 'rgba(255,255,255,0.13)'}} />)}
        <div style={{position: 'absolute', left: pw * 0.33, width: pw * 0.34, top: bar / 2 - 12 * s, height: 24 * s, borderRadius: 12 * s, background: 'rgba(255,255,255,0.055)', color: 'rgba(242,243,244,0.55)', fontSize: 12.5 * s, lineHeight: `${24 * s}px`, textAlign: 'center', fontFamily: FONT, letterSpacing: 0.1 * s}}>{label}</div>
      </div>
      <Img src={assetUrl(item, ctx.image)} style={{position: 'absolute', left: 0, top: bar, width: pw, height: ph, display: 'block', filter: `brightness(${it.dim.toFixed(3)})`}} />
    </div>
  );
};

/** The outline that says "this one": a soft ice-cyan ring around the component, drawn in as the page dims. */
const ContextRing: React.FC<{item: SpotlightItem; tl: Built; st: FrameState; u: number}> = ({item, tl, st, u}) => {
  const m = item.meta, p = tl.placed[0], s = p.s, it = st.intro!;
  const b = boxAt(m, st.items[0].frame);
  const zr = 1 / Math.max(0.2, st.cam.zoom);
  const grow = 1 - Math.min(1, it.ring * 1.6); // tightens onto the component as it appears
  const pad = (9 + 10 * grow) * s;
  const r = Math.max(m.radius || 0, ...(m.cards?.[0] ?? []).map((c) => c[4]), 16) * s + pad;
  return (
    <div style={{position: 'absolute', left: p.x - p.w / 2 + b[0] * s - pad, top: p.y - p.h / 2 + b[1] * s - pad, width: b[2] * s + 2 * pad, height: b[3] * s + 2 * pad, borderRadius: r,
      opacity: it.ring, border: `${1.5 * u * zr}px solid rgba(${ICE},0.9)`, boxSizing: 'border-box', transform: 'translateZ(1px)',
      boxShadow: `0 0 ${18 * u * zr}px rgba(${ICE},0.32), inset 0 0 ${14 * u * zr}px rgba(${ICE},0.12)`, pointerEvents: 'none'}} />
  );
};

export const resolveOptions = (p: Partial<SpotlightOptions>): SpotlightOptions => ({...defaultSpotlightOptions, ...p, cursor: {...defaultSpotlightOptions.cursor, ...(p.cursor ?? {})}});

export const Spotlight: React.FC<SpotlightProps> = (props) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const o = useMemo(() => resolveOptions(props), [props]);
  const items = props.items;
  const tl = useMemo(() => buildTimeline(items, o, fps), [items, o, fps]);
  const i = clamp(frame, 0, tl.frames - 1);
  const st = tl.states[i];
  const {W, H, u} = tl;
  const dark = sceneDark(o.scene, o.background);
  const cam = st.cam;

  // motion blur: directional, from this frame's screen-space camera movement (world px -> screen px)
  const amt = clamp(o.motionBlur, 0, 1);
  // zoom moves (the intro, the action push-in) are slow and must stay crisp: a flat gaussian is the wrong blur for a zoom anyway
  const bx = clamp(Math.abs(st.vel.x) * 0.55 * amt + Math.abs(st.vel.z) * W * 0.03 * amt + Math.abs(st.vel.rot) * 3 * amt, 0, 34 * u);
  const by = clamp(Math.abs(st.vel.y) * 0.55 * amt + Math.abs(st.vel.z) * H * 0.02 * amt, 0, 20 * u);
  const mb = bx > 0.8 || by > 0.8;

  const textColor = dark ? '#f2f3f4' : '#17181a';
  const reflection = o.reflection ?? o.scene === 'void';

  return (
    <AbsoluteFill style={{fontFamily: FONT, overflow: 'hidden', background: '#000'}}>
      <SceneBackground scene={o.scene} bg={o.background} W={W} H={H} u={u} frame={frame} fps={fps} shift={{x: cam.x * cam.zoom, y: cam.y * cam.zoom}} zoom={cam.zoom} />
      <svg width="0" height="0" style={{position: 'absolute'}}>
        <defs>
          <filter id="sp-mb" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`} />
          </filter>
        </defs>
      </svg>
      <AbsoluteFill style={{filter: mb ? 'url(#sp-mb)' : undefined}}>
        <div style={{position: 'absolute', inset: 0, perspective: 2600 * u, perspectiveOrigin: '50% 50%'}}>
          <div
            style={{
              position: 'absolute', left: W / 2, top: H / 2, width: 0, height: 0, transformStyle: 'preserve-3d',
              transform: `rotateX(${cam.rx.toFixed(3)}deg) rotateY(${cam.ry.toFixed(3)}deg) rotateZ(${cam.rz.toFixed(3)}deg) scale(${cam.zoom.toFixed(5)}) translate3d(${(-cam.x).toFixed(2)}px, ${(-cam.y).toFixed(2)}px, 0)`,
            }}
          >
            {st.intro && st.intro.page > 0.002 && <ContextPage item={items[0]} tl={tl} st={st} u={u} />}
            {items.map((it, k) => (
              <PlacedItem key={it.id} item={it} k={k} tl={tl} st={st} o={o} u={u} dark={dark} frame={frame} fps={fps} reflection={reflection && items.length === 1 && (!st.intro || st.intro.lift > 0.99)} light={!dark} />
            ))}
            {st.intro && st.intro.ring > 0.002 && <ContextRing item={items[0]} tl={tl} st={st} u={u} />}
          </div>
        </div>
      </AbsoluteFill>
      {(o.title || o.wordmark) && (
        <div style={{position: 'absolute', left: 0, right: 0, top: H * 0.085, textAlign: 'center', opacity: st.titleAlpha, transform: `translateY(${(1 - st.titleAlpha) * 8 * u}px)`, color: textColor}}>
          {o.wordmark && <div style={{fontFamily: MONO, fontSize: 15 * u, letterSpacing: 2.2 * u, textTransform: 'uppercase', opacity: 0.55, marginBottom: 10 * u}}>{o.wordmark}</div>}
          {o.title && <div style={{fontSize: 30 * u, fontWeight: 600, letterSpacing: -0.4 * u}}>{o.title}</div>}
        </div>
      )}
      {o.sound && <Audio src={resolve(o.sound)} />}
    </AbsoluteFill>
  );
};

const PlacedItem: React.FC<{item: SpotlightItem; k: number; tl: Built; st: FrameState; o: SpotlightOptions; u: number; dark: boolean; frame: number; fps: number; reflection: boolean; light: boolean}> = ({item, k, tl, st, o, u, dark, fps, reflection, light}) => {
  const p = tl.placed[k], f = st.items[k], m = item.meta;
  const {cam} = st;
  const hero = k === st.hero;
  // depth of field: soft while the camera arrives, and for what is far from the focus (screen distance + depth)
  const dScreen = Math.hypot((p.x - cam.x) * cam.zoom, (p.y - cam.y) * cam.zoom) / tl.W;
  const off = hero ? 0 : Math.max(0, dScreen - 0.5) * 10 + Math.abs(p.z) * 0.012;
  const blurPx = clamp(o.dof * ((hero ? st.arrive * 10 : st.arrive * 5) + off * 1.4), 0, 24) * u;
  // the capture's picture at capture frame n: one alpha video (image.video, what capture.mjs writes now) or the older PNG sequence
  const root = item.base.startsWith('http') || item.base.startsWith('/') ? item.base : staticFile(item.base);
  const shot = (n: number, style: React.CSSProperties) => m.image.video
    ? <Freeze frame={Math.max(0, n - 1)}><OffthreadVideo src={`${root}/${m.image.video}`} transparent muted style={style} /></Freeze>
    : <Img src={`${root}/frames/${pad5(n)}.png`} style={style} />;
  const tMs = (f.frame / m.fps) * 1000;
  const cur = (n: number) => m.cursor[Math.min(m.cursor.length - 1, n)];
  const c1 = cur(f.frame), c2 = cur(f.frame2);
  const cxl = c1[1] + (c2[1] - c1[1]) * f.mix, cyl = c1[2] + (c2[2] - c1[2]) * f.mix;
  const pressed = Math.max(c1[4], c2[4] * (f.mix > 0 ? 1 : 0));
  const kind = f.mix > 0.5 ? c2[3] : c1[3];
  const s = p.s;
  // in the context intro the component starts flat in its page (no shadow) and gains its stage shadow as it lifts out
  const lift = st.intro ? st.intro.lift : 1;
  const sh = o.shadow * (light ? 0.7 : 1) * lift;
  const hh = p.h;
  const shadowCol = light ? '40,44,52' : '0,0,0';
  const filt = [
    `drop-shadow(0 ${(hh * 0.012).toFixed(1)}px ${(hh * 0.02).toFixed(1)}px rgba(${shadowCol},${(0.34 * sh).toFixed(3)}))`,
    `drop-shadow(0 ${(hh * 0.07).toFixed(1)}px ${(hh * 0.075).toFixed(1)}px rgba(${shadowCol},${(0.22 * sh).toFixed(3)}))`,
    `drop-shadow(0 ${(hh * 0.16).toFixed(1)}px ${(hh * 0.19).toFixed(1)}px rgba(${shadowCol},${(0.30 * sh).toFixed(3)}))`,
  ].join(' ');
  const cards = (m.cards?.[Math.min(m.cards.length - 1, f.frame)] ?? []);
  const edge = m.theme === 'light'
    ? 'inset 0 0 0 1px rgba(0,0,0,0.06)'
    : 'inset 0 0 0 1px rgba(255,255,255,0.09), inset 0 1px 0 rgba(255,255,255,0.16)';
  const glowCol = o.glow || null;
  const rot = p.rot;
  // click ripple: clicks within the last 650 ms
  const ripples = o.cursor.ripple ? m.clicks.filter((c) => c.kind === 'down' && tMs - c.tMs >= 0 && tMs - c.tMs < 650) : [];
  const pressF = pressed ? 0.86 : 1;
  // the reflection hangs from the component's current bottom edge (not the union box), mirrored about that line
  const bb = m.bbox[Math.min(m.bbox.length - 1, f.frame)];
  const Bl = (bb ? bb[1] + bb[3] : m.image.cssH) * s;
  const refl = {top: Bl + 6 * u, inner: Bl - p.h};
  const plate = needsPlate(m, o);
  const rrect = m.rootRect?.[Math.min(m.rootRect.length - 1, f.frame)] ?? null;
  const plateBg = m.pageBg || ((m.ink ?? 0.8) > 0.5 ? '#0c0c0d' : '#ffffff');
  return (
    <div style={{position: 'absolute', left: p.x - p.w / 2, top: p.y - p.h / 2, width: p.w, height: p.h, transform: `translateZ(${p.z}px) rotateZ(${rot}deg)`, filter: blurPx > 0.3 ? `blur(${blurPx.toFixed(2)}px)` : undefined}}>
      {reflection && (
        <div style={{position: 'absolute', left: 0, top: refl.top, width: p.w, height: p.h * 0.55, overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0) 85%)', maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0) 85%)', filter: `blur(${2.2 * u}px)`}}>
          <div style={{position: 'absolute', left: 0, top: refl.inner, width: p.w, height: p.h, transform: 'scaleY(-1)'}}>
            {shot(f.frame, {width: '100%', height: '100%', display: 'block'})}
          </div>
        </div>
      )}
      {plate && rrect && (
        <div style={{position: 'absolute', left: (rrect[0] - PLATE_PX) * s, top: (rrect[1] - PLATE_PY) * s, width: (rrect[2] + 2 * PLATE_PX) * s, height: (rrect[3] + 2 * PLATE_PY) * s, borderRadius: Math.min((rrect[3] + 2 * PLATE_PY) / 2, 26) * s, background: plateBg, boxShadow: `${(m.ink ?? 0.8) > 0.5 ? 'inset 0 0 0 1px rgba(255,255,255,0.09), inset 0 1px 0 rgba(255,255,255,0.16)' : 'inset 0 0 0 1px rgba(0,0,0,0.06)'}, 0 ${hh * 0.012}px ${hh * 0.02}px rgba(${shadowCol},${(0.34 * sh).toFixed(3)}), 0 ${hh * 0.06}px ${hh * 0.07}px rgba(${shadowCol},${(0.2 * sh).toFixed(3)}), 0 ${hh * 0.12}px ${hh * 0.15}px rgba(${shadowCol},${(0.24 * sh).toFixed(3)})`}} />
      )}
      {shot(f.frame, {position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', filter: plate ? undefined : filt})}
      {f.mix > 0.001 && shot(f.frame2, {position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', opacity: f.mix, filter: filt})}
      {cards.map((c, n) => (
        <div key={n} style={{position: 'absolute', left: c[0] * s, top: c[1] * s, width: c[2] * s, height: c[3] * s, borderRadius: c[4] * s, boxShadow: `${plate ? `0 ${hh * 0.012}px ${hh * 0.02}px rgba(${shadowCol},${(0.34 * sh).toFixed(3)}), 0 ${hh * 0.08}px ${hh * 0.1}px rgba(${shadowCol},${(0.26 * sh).toFixed(3)}), ` : ''}${edge}${glowCol ? `, 0 0 0 ${Math.max(1, 1.2 * u)}px ${glowCol}55, 0 0 ${60 * u}px ${glowCol}40` : ''}`, pointerEvents: 'none'}} />
      ))}
      {o.cursor.visible && st.cursorAlpha > 0.01 && hero && (
        <div style={{position: 'absolute', left: cxl * s, top: cyl * s, opacity: st.cursorAlpha}}>
          {ripples.map((r, n) => {
            const t = (tMs - r.tMs) / 650, e = 1 - Math.pow(1 - clamp(t, 0, 1), 3), rad = (10 + 44 * e) * s * 0.9;
            return <div key={n} style={{position: 'absolute', left: (r.x - cxl) * s - rad, top: (r.y - cyl) * s - rad, width: 2 * rad, height: 2 * rad, borderRadius: '50%', border: `${Math.max(1.4, 2.2 * s)}px solid ${dark ? 'rgba(255,255,255,0.7)' : 'rgba(20,22,26,0.45)'}`, opacity: Math.pow(1 - t, 1.5) * 0.8, boxSizing: 'border-box'}} />;
          })}
          <SpotCursor kind={kind} s={o.cursor.size * Math.max(1, s) * 0.92} press={pressF} theme={o.cursor.theme} opacity={1} />
        </div>
      )}
    </div>
  );
};

export {backgroundIsDark};
