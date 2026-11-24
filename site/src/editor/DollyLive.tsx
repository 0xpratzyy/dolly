import {AbsoluteFill, useVideoConfig} from 'remotion';
import {BackgroundField, Dolly, backgroundIsDark, isAnimatedBackground} from '@studio/lib.ts';

/**
 * The composition, plus animated (shader) backgrounds in the Player. Dolly itself paints a background as one static CSS layer, so for a
 * shader preset the site draws the real BackgroundField underneath and hands Dolly a flat colour of the right tone (so its window chrome,
 * shadows and keys pick the right theme); the CSS in `.live-bg` hides Dolly's own background layer. Everything else renders as before.
 */
export function DollyLive(props: any) {
  const bg = props.style?.background;
  const {width, height} = useVideoConfig();
  if (!bg || !isAnimatedBackground(bg)) return <Dolly {...props} />;
  const dark = backgroundIsDark(bg);
  const style = {...props.style, background: {type: 'solid', value: dark ? '#0C0C0D' : '#F2F3F4'}};
  return (
    <AbsoluteFill>
      <BackgroundField bg={bg} width={width} height={height} />
      <div className="live-bg"><Dolly {...props} style={style} /></div>
    </AbsoluteFill>
  );
}
