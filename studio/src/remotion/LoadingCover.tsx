import React, {useMemo} from 'react';
import {Freeze, OffthreadVideo, Sequence, staticFile} from 'remotion';
import type {Timeline} from '../camera.ts';
import type {LoadingWindow, Plan} from '../types.ts';

// Hides route-change loading shells. For every window in events.loading (from the navigating click until real content was there)
// the last good frame, taken just before the click, is held over the live video, then crossfaded to the loaded page. The video
// underneath keeps playing, so the timeline length and the audio sync do not change; the cursor and click ripple are drawn by the
// parent AFTER this component, so they stay on top. Mount it inside the transformed source-space layer, after the video pieces.

const resolveSrc = (v: string) => (/^(https?:|blob:|data:|\/)/.test(v) ? v : staticFile(v));
const FADE_MS = 260;
const HOLD_AFTER_MS = 60;

export const LoadingCover: React.FC<{video: string; plan: Plan; tl: Timeline; windows: LoadingWindow[]; fps: number}> = ({video, plan, tl, windows, fps}) => {
  const {width: SW, height: SH} = plan.source;
  const wins = useMemo(() => {
    // source ms -> output frame (the timeline's src[] is monotonic)
    const toFrame = (ms: number) => {
      let lo = 0, hi = tl.src.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tl.src[mid] >= ms) hi = mid; else lo = mid + 1; }
      return lo;
    };
    return windows
      .filter((w) => w.endMs > w.startMs)
      .map((w) => {
        const from = toFrame(w.startMs);
        const hold = Math.max(1, toFrame(w.endMs + HOLD_AFTER_MS) - from);
        const fade = Math.max(2, Math.round((FADE_MS / 1000) * fps));
        return {from, hold, fade, still: Math.max(0, Math.round(((w.startMs - 50) / 1000) * fps))};
      });
  }, [windows, tl, fps]);
  return (
    <>
      {wins.map((w, i) => (
        <Sequence key={i} from={w.from} durationInFrames={w.hold + w.fade} layout="none">
          <FadeOut hold={w.hold} fade={w.fade}>
            <Freeze frame={0}>
              <OffthreadVideo src={resolveSrc(video)} startFrom={w.still} muted style={{width: SW, height: SH, display: 'block'}} />
            </Freeze>
          </FadeOut>
        </Sequence>
      ))}
    </>
  );
};

import {useCurrentFrame} from 'remotion';
const FadeOut: React.FC<{hold: number; fade: number; children: React.ReactNode}> = ({hold, fade, children}) => {
  const f = useCurrentFrame(); // relative to the window's Sequence
  const o = f < hold ? 1 : Math.max(0, 1 - (f - hold) / fade);
  return <div style={{position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: o}}>{children}</div>;
};
