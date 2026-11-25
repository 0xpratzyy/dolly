import React from 'react';
import {Composition} from 'remotion';
import {Spotlight, resolveOptions} from './Spotlight.tsx';
import {buildTimeline} from './timeline.ts';
import {aspectSize, type SpotlightProps} from './types.ts';

const defaults: SpotlightProps = {
  items: [], scene: 'graphite', layout: 'single', aspect: '3:2', tilt: 3, intro: 'auto', push: 1.35, dof: 0.6, motionBlur: 0.55, loop: false, shadow: 0.75,
  cursor: {visible: true, size: 1.25, theme: 'mac', ripple: true},
};

export const SpotlightRoot: React.FC = () => (
  <Composition
    id="Spotlight"
    component={Spotlight as React.FC<any>}
    width={1620}
    height={1080}
    fps={60}
    durationInFrames={60}
    defaultProps={defaults}
    calculateMetadata={({props}) => {
      const p = props as unknown as SpotlightProps;
      if (!p.items.length) return {};
      const o = resolveOptions(p);
      const fps = p.items[0].meta.fps;
      const tl = buildTimeline(p.items, o, fps);
      const {w, h} = aspectSize(o.aspect);
      return {fps, durationInFrames: tl.frames, width: w, height: h};
    }}
  />
);
