// Spotlight: types shared by the CLI (studio/spotlight.mjs), the timeline maths and the composition. Pure TypeScript.
import type {Style} from '../../types.ts';

/** spotlight/capture.mjs output (spotlight.json). Coordinates are CSS px in the capture image (origin top-left). */
export interface SpotlightMeta {
  version: 1;
  fps: number;
  frames: number;
  durationMs: number;
  scale: number;
  /** pattern: the PNG sequence (frames/%05d.png, 1-based). video: the same frames as one alpha video (VP9 WebM) next to spotlight.json; when set the PNGs are gone. */
  image: {w: number; h: number; cssW: number; cssH: number; pattern: string; video?: string};
  theme: 'dark' | 'light' | 'unknown';
  radius: number;
  /** average luminance (0..1) of the component's text, and the page colour behind it (capture.mjs) */
  ink?: number | null;
  /** median / interaction font size in CSS px, and the component's own box per frame (x, y, w, h) */
  font?: number | null;
  hitFont?: number | null;
  rootRect?: ([number, number, number, number] | null)[];
  pageBg?: string | null;
  bbox: ([number, number, number, number] | null)[];
  roots: number[][][];
  /** Real boxes (x, y, w, h, radius) per frame: where the edge highlight and glow go. */
  cards?: number[][][];
  /** [tMs, x, y, kind (arrow|hand|text|grab), pressed 0|1] */
  cursor: [number, number, number, string, number][];
  clicks: {tMs: number; x: number; y: number; kind: 'down' | 'up'}[];
  hovers?: {tMs: number; x: number; y: number; label?: string}[];
  keys?: {tMs: number}[];
  states?: {tMs: number; name: string}[];
  sounds?: {tMs: number; kind: string}[];
  target?: string;
  resolved?: string;
  url?: string;
  /** where the capture image sits in the page viewport (CSS px) */
  clip?: {x: number; y: number; width: number; height: number};
  /** The untouched page before isolation (capture.mjs --context): a viewport screenshot next to spotlight.json. rect = the
   * component's element box in it (CSS px). The capture image sits at `clip` in the same coordinates. */
  context?: {image: string; w: number; h: number; scale: number; rect: [number, number, number, number]};
}

export interface SpotlightItem {
  id: string;
  /** URL prefix of this item's frames: `<base>/frames/00001.png` (the CLI links it into the public dir; a website passes a URL). */
  base: string;
  meta: SpotlightMeta;
  label?: string;
}

export type SceneId = 'graphite' | 'void' | 'studio' | 'wallpaper';
export type LayoutId = 'single' | 'carousel' | 'collage' | 'grid';
export type SpotAspect = '3:2' | '16:9' | '1:1' | '4:5' | '9:16';

export interface SpotlightOptions {
  scene: SceneId;
  /** Background for the wallpaper scene (any Dolly background, shader / photo / AI wallpaper included). */
  background?: Style['background'];
  layout: LayoutId;
  aspect: SpotAspect;
  /** Width of the hero as a fraction of the frame (0.2..0.9). Default: automatic, small components get lots of negative space. */
  hero?: number;
  /** 3D tilt of the hero in degrees (0 = flat). Default 3 (a slow symmetric sweep, never an off-centre lean). */
  tilt: number;
  /** Context intro (beat 1): open on the real page, ring the component, lift it out. auto = on when the capture has a
   * context screenshot and this is not a loop; on in a loop = the intro plays every cycle (the end lowers it back in). */
  intro?: 'auto' | 'on' | 'off';
  /** Action push-in: the camera eases in toward the control being used (about this factor), holds, eases back out. 0 = off. */
  push?: number;
  /** Depth of field and entrance blur, 0..1. */
  dof: number;
  /** Directional motion blur on camera moves, 0..1. */
  motionBlur: number;
  /** Seamless loop: the end state matches the start (short single components). */
  loop: boolean;
  /** Reflection under the hero (default: on for void). */
  reflection?: boolean;
  /** Colour of an edge glow around the component, or false. */
  glow?: string | false;
  /** Shadow strength 0..1. */
  shadow: number;
  cursor: {visible: boolean; size: number; theme: 'mac' | 'light'; ripple: boolean};
  title?: string;
  /** Tiny eyebrow above the title / wordmark at the bottom-left. */
  wordmark?: string;
  /** A rounded plate in the page colour behind a text-only component (a nav row on a light stage). auto: when it would be invisible. */
  plate?: 'auto' | 'on' | 'off';
  /** index of the item the grid layout pushes into (default 0) */
  focus?: number;
  /** Camera slowness 0.6..2 (1 = default) */
  pace?: number;
  /** Rendered wav of the synthesised UI sounds (public-dir relative), or none. */
  sound?: string | null;
}

export interface SpotlightProps extends SpotlightOptions {
  items: SpotlightItem[];
}

export const defaultSpotlightOptions: SpotlightOptions = {
  scene: 'graphite', layout: 'single', aspect: '3:2', tilt: 3, intro: 'auto', push: 1.35, dof: 0.6, motionBlur: 0.55, loop: false, shadow: 0.75,
  cursor: {visible: true, size: 1.25, theme: 'mac', ripple: true},
};

export const aspectSize = (a: SpotAspect): {w: number; h: number} =>
  ({'3:2': {w: 1620, h: 1080}, '16:9': {w: 1920, h: 1080}, '1:1': {w: 1080, h: 1080}, '4:5': {w: 1080, h: 1350}, '9:16': {w: 1080, h: 1920}})[a] ?? {w: 1620, h: 1080};
