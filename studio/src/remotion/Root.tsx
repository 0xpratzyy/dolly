import React from 'react';
import {Composition} from 'remotion';
import {Dolly, resolveStyle, type DollyProps} from './Dolly.tsx';
import {buildTimeline} from '../camera.ts';
import {defaultStyle} from '../types.ts';
import type {Plan} from '../types.ts';
import {DollyStill, type StillProps} from './Stills.tsx';

const emptyPlan: Plan = {
  version: 1,
  source: {video: 'recording.mp4', width: 1440, height: 900, fps: 30, durationMs: 1000, pointScale: 1},
  params: {} as any, style: {}, zooms: [], speed: [], clicks: [], keys: [], cursor: [], cursorRaw: [],
};

export const Root: React.FC = () => (
  <>
  <Composition
    id="DollyStill"
    component={DollyStill as React.FC<any>}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={30}
    defaultProps={{mode: 'bg', width: 1920, height: 1080, fps: 30, frames: 30, style: defaultStyle} as StillProps}
    calculateMetadata={({props}) => {
      const p = props as unknown as StillProps;
      return {fps: p.fps, durationInFrames: Math.max(1, p.frames), width: p.width, height: p.height};
    }}
  />
  <Composition
    id="Dolly"
    component={Dolly as React.FC<any>}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={30}
    defaultProps={{video: 'recording.mp4', plan: emptyPlan, style: defaultStyle, captions: [], captionStyle: undefined} as DollyProps}
    calculateMetadata={({props}) => {
      const p = props as unknown as DollyProps;
      const style = resolveStyle(p.plan, p.style);
      const fps = p.plan.source.fps;
      const tl = buildTimeline(p.plan, style, fps);
      return {fps, durationInFrames: tl.frames.length, width: tl.layout.canvasW, height: tl.layout.canvasH};
    }}
  />
</>
);
