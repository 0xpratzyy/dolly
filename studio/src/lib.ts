// Library entry for the website (Vite) and other consumers: the composition, the default style and
// the camera helpers from one module.
//   import {Dolly, defaultStyle, stylePresets, buildTimeline, computeLayout} from '../studio/src/lib.ts';
export {Dolly, CaptionsLayer, resolveStyle} from './remotion/Dolly.tsx';
export type {DollyProps} from './remotion/Dolly.tsx';
export {backgroundPresets, backgroundCatalog, colorSwatches, backgroundStyle, backgroundIsDark, grainStyle, vignetteStyle, luminance} from './remotion/backgrounds.ts';
export type {BackgroundInfo} from './remotion/backgrounds.ts';
export {defaultStyle, defaultPlanParams, motionDefaults, stylePresets, mergeStyle} from './types.ts';
export type {Style, Plan, Zoom, SpeedSegment, Caption, CaptionsInput, SubtleCaptionsFile, SubtleCPage, SubtleCWord, Events, Aspect} from './types.ts';
export {toSubtleCaptions, isSubtleFile} from './captions.ts';
// Subtle's caption engine (alias `@subtle` -> subtle/template/src). A browser Player must call this once so the style's fonts
// load from /<file> (staticFile); put subtle/fonts/* at the site root.
export {loadFonts as loadCaptionFonts} from '@subtle/engine';
export type {Timeline, Frame, Layout} from './camera.ts';
export {buildTimeline, cameraMoves, computeLayout, outFrameCount, smoothCursor} from './camera.ts';
export {planFromEvents} from './plan.ts';
// Backgrounds: animated shader wallpapers and photos (docs/backgrounds.md)
export {BackgroundField} from './remotion/BackgroundField.tsx';
export type {BackgroundFieldProps} from './remotion/BackgroundField.tsx';
export {isAnimatedBackground, isPhotoBackground, isAiBackground, photoUrl, photoDefs, aiWallpaperDefs, aiWallpaperUrl, shaderDefs, shaderById} from './remotion/backgrounds.ts';
export type {PhotoDef, ShaderDef} from './remotion/backgrounds.ts';
// Spotlight (isolated component showcase): see docs/spotlight.md
export {Spotlight, resolveOptions as resolveSpotlightOptions} from './remotion/spotlight/Spotlight.tsx';
export {buildTimeline as buildSpotlightTimeline} from './remotion/spotlight/timeline.ts';
export {defaultSpotlightOptions, aspectSize as spotlightAspectSize} from './remotion/spotlight/types.ts';
export type {SpotlightProps, SpotlightOptions, SpotlightItem, SpotlightMeta, SceneId, LayoutId, SpotAspect} from './remotion/spotlight/types.ts';
export {renderSounds as renderSpotlightSounds, wavBytes as spotlightWavBytes} from './spotlight-sound.ts';
