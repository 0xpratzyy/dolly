import React, {useMemo} from 'react';
import {OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Timeline} from '../camera.ts';
import type {FacecamTrack, Plan, Style} from '../types.ts';
import {facecamDefaults, facecamGeo, facecamLook, facecamPose, planCorners, type Geo} from '../facecam.ts';
export {facecamDefaults, planCorners} from '../facecam.ts';

// Face-cam bubble for Narrate mode: the speaker's clip in a circle (or rounded rectangle) in a corner, with a soft shadow and a
// subtle border. In `auto` mode the bubble sits in its preferred corner and glides to a free corner when the cursor, or a click
// that is about to happen, gets near it, so it never covers the thing being shown. Time is output time: facecam media time =
// output time + track.startMs (Narrate renders at normal speed, so the clip stays in sync with the voice).
// The geometry and the corner schedule live in ../facecam.ts (shared with the native renderer).

const resolveSrc = (v: string) => (/^(https?:|blob:|data:|\/)/.test(v) ? v : staticFile(v));

export const Facecam: React.FC<{track: FacecamTrack; style: Style; tl: Timeline; plan: Plan}> = ({track, style, tl, plan}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fc = {...facecamDefaults, ...(style.facecam ?? {})} as Required<NonNullable<Style['facecam']>>;
  const L = tl.layout;
  const W = L.canvasW, H = L.canvasH;
  const geo = useMemo<Geo>(() => facecamGeo(W, H, style), [W, H, fc.size, fc.shape, style.captions.enabled, style.captions.position]);
  const sched = useMemo(() => planCorners(tl, plan, fc, geo, fps), [tl, plan, fc.corner, fc.prefer, geo, fps]);
  if (fc.enabled === false) return null;
  const n = tl.frames.length;
  const {x, y, opacity: o} = facecamPose(sched, geo, frame, n, fps);
  const u = L.u;
  const look = facecamLook(style, geo, u);
  const radius = look.radius;
  const rgba = (c: number[]) => `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;
  const ring = look.ring ? `0 0 0 ${look.ring.width}px ${rgba(look.ring.color)}` : 'none';
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: geo.bw, height: geo.bh, borderRadius: radius, opacity: o,
        transform: `scale(${0.86 + 0.14 * o})`, transformOrigin: 'center',
        boxShadow: `${ring === 'none' ? '' : ring + ', '}${look.shadows.map((sh) => `0 ${sh.dy}px ${sh.blur}px ${rgba(sh.color)}`).join(', ')}`,
        overflow: 'hidden', background: '#111',
      }}
    >
      <OffthreadVideo
        src={resolveSrc(track.src)}
        startFrom={Math.round(((track.startMs ?? 0) / 1000) * fps)}
        muted
        style={{width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: fc.mirror ? 'scaleX(-1)' : undefined}}
      />
    </div>
  );
};
