// Shared types and defaults. Pure TypeScript (no enums, no JSX) so Node can import it directly
// (the planner CLI) and Remotion / Vite can bundle it.

/** One recording's events.json, see ../../CONTRACT.md. */
export interface Events {
  version: 1;
  video: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  pointScale?: number;
  cursor: [number, number, number][];
  clicks: {tMs: number; x: number; y: number; button: string; kind: 'down' | 'up'}[];
  keys?: {tMs: number; mods?: string[]; label?: string}[];
  scroll?: {tMs: number; dy: number}[];
  /** Route-change loading shells: [{startMs,endMs}] from the click that navigated until real content was there (Narrate/autopilot). */
  loading?: {startMs: number; endMs: number}[];
}

export interface Zoom {
  id: string;
  /** When the zoom-in ease begins (source ms). */
  startMs: number;
  /** When the zoom-out ease finishes (source ms). Hold lasts from startMs+inMs to endMs-outMs. */
  endMs: number;
  inMs: number;
  outMs: number;
  /** Magnification at full zoom, relative to the unzoomed view (1 = none). */
  scale: number;
  /** Source pixel the camera is centred on at full zoom (before cursor-follow). */
  center: {x: number; y: number};
  /** The action area the zoom was built around (informational). */
  bbox: {x: number; y: number; w: number; h: number};
  why: string;
}

export interface SpeedSegment {
  startMs: number;
  endMs: number;
  /** Playback speed (e.g. 3). Ignored when cut is true. */
  speed: number;
  /** Remove the stretch instead of speeding it up. */
  cut?: boolean;
}

export interface PlanParams {
  clusterGapMs: number;
  clusterDistFrac: number;
  zoomLeadMs: number;
  zoomInMs: number;
  zoomOutMs: number;
  zoomHoldAfterMs: number;
  baseScale: number;
  maxScale: number;
  minScale: number;
  mergeGapMs: number;
  idleThresholdMs: number;
  idleKeepMs: number;
  idleSpeed: number;
  idleMode: 'speed' | 'cut';
  cursorSmoothing: number;
  /** The zoom-in has landed this long before the first click of the shot (ms). Optional in old plans. */
  zoomLandMs?: number;
  /** Two zooms closer than this stay zoomed and glide from one focus to the next instead of pulling out and pushing in again (ms). */
  minDwellMs?: number;
  /** Duration of that glide between two focus points (ms). */
  panMs?: number;
  /** The first / last stretch of the video in which the camera does not move (ms). */
  calmLeadMs?: number;
  calmTailMs?: number;
  /** The least time the result of an action stays on screen before the camera leaves it (ms). */
  holdMinMs?: number;
}

export interface Plan {
  version: 1;
  source: {video: string; width: number; height: number; fps: number; durationMs: number; pointScale: number};
  params: PlanParams;
  /** Partial style defaults for this recording; the render merges them under any style it is given. */
  style: Partial<Style>;
  zooms: Zoom[];
  speed: SpeedSegment[];
  clicks: {tMs: number; x: number; y: number; button: string}[];
  keys: {tMs: number; label: string}[];
  /** Smoothed cursor path, one sample per source frame: [tMs, x, y]. */
  cursor: [number, number, number][];
  /** Raw cursor resampled to the same frame times (lets the renderer re-smooth). */
  cursorRaw: [number, number, number][];
}

export interface Caption {
  startMs: number;
  endMs: number;
  text: string;
  /** Optional real word timings (output ms). Without them the words are spread evenly over the line. */
  words?: {text: string; startMs: number; endMs: number}[];
}

/** Subtle's captions file (pages of timed words), see ~/code/subtle/docs/ARCHITECTURE.md. */
export interface SubtleCWord {text: string; startMs: number; endMs: number; line?: number; emphasis?: boolean; reason?: string}
export interface SubtleCPage {startMs: number; endMs: number; words: SubtleCWord[]}
export interface SubtleCaptionsFile {
  version: number;
  video: {width: number; height: number; fps: number; durationMs: number};
  style: string;
  pages: SubtleCPage[];
  big?: {text: string; startMs: number; endMs: number; front?: boolean}[];
}
/** What `captions` accepts: simple lines in output time, or a Subtle captions file with word timings. */
export type CaptionsInput = Caption[] | SubtleCaptionsFile;

export type Aspect = 'source' | '16:9' | '9:16' | '1:1' | '4:5';

export interface Style {
  /**
   * type preset: a named background (value = its id, see backgroundCatalog in remotion/backgrounds.ts).
   * solid: value is a colour. gradient: value is any CSS gradient string. image: value is a path / URL.
   * video: a heavily blurred, darkened copy of the recording itself (value ignored).
   * blur (px at 1080p), grain and vignette (0..1) apply to any type; all three are optional (default 0, video blur 40).
   */
  background: {type: 'preset' | 'solid' | 'image' | 'gradient' | 'video'; value: string; blur?: number; grain?: number; vignette?: number; /** 0..1 darkening for photo / AI wallpapers */ dim?: number; /** 0..1 slow Ken Burns drift of an image background (BackgroundField) */ drift?: number};
  /** Padding around the window, percent of the canvas' short side. */
  padding: number;
  /** Corner radius, px at 1080p (scales with the canvas). */
  radius: number;
  /** Drop shadow strength, 0 to 1. */
  shadow: number;
  frame: 'none' | 'browser' | 'window';
  /** Text shown in the browser URL pill / window title. */
  frameLabel: string;
  /** Window chrome colours. auto: light on light backgrounds, dark otherwise. */
  frameTheme?: 'auto' | 'light' | 'dark';
  /** An edge around the window: a hairline, or a soft coloured glow (borderColor). */
  border?: 'none' | 'hairline' | 'glow';
  borderColor?: string;
  /** Colour of the drop shadow (shadow is its strength). */
  shadowColor?: string;
  aspect: Aspect;
  /** letterbox: whole recording visible inside the window. crop: window fills the canvas and the camera pans. */
  fit: 'letterbox' | 'crop';
  resolution: 'source' | '1080p' | '4k';
  zoom: {
    auto: boolean;
    /** Multiplier on the planned zoom (scale-1). 1 = as planned, 0.5 = half as deep, 1.5 = deeper. */
    amount: number;
    /** Multiplier on the planned ease times. 2 = twice as fast. */
    speed: number;
    /** 0..1: how strongly the camera chases the cursor while zoomed (also its spring stiffness). */
    follow: number;
  };
  cursor: {
    visible: boolean; size: number; smoothing: number; hideWhenIdle: boolean; /** arrow (default), hand, dot or ring. */ style?: 'arrow' | 'hand' | 'dot' | 'ring';
    /** 0..1 trail on fast cursor moves only (default motionDefaults.cursor.blur). 0 = always crisp. */
    motionBlur?: number;
    /** Fade the cursor out after this long without a move or click, ms (default motionDefaults.cursor.idleHideMs). */
    idleMs?: number;
  };
  clickEffect: 'ripple' | 'highlight' | 'none';
  /** 0..1. Directional blur driven by camera speed. */
  motionBlur: number;
  keystrokes: boolean;
  idleSpeedup: boolean;
  /** Cap on any speed-up in plan.speed (default motionDefaults.pacing.maxSpeed = 2; faster ramps smear and look janky). Sped-up frames are blended. */
  maxSpeed?: number;
  /** style: a Subtle caption style name (any of subtle/styles/*.json). position: where on the canvas. size: multiplier. */
  captions: {enabled: boolean; style: string; position: 'bottom' | 'middle' | 'top' | 'below'; size: number};
  /**
   * Face-cam bubble (Narrate mode). Only drawn when the render is given a facecam video (DollyProps.facecam).
   * corner `auto` parks it in the default corner (`prefer`) and slides it to a free corner when the cursor or a click gets near it.
   * size = diameter (or height) as a fraction of the canvas' short side.
   */
  /** Hide route-change loading shells: freeze the last good frame over each events.loading window, then crossfade to the loaded page (default on). */
  loadingCover?: boolean;
  facecam?: {enabled?: boolean; shape?: 'circle' | 'rounded'; corner?: 'auto' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; prefer?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; size?: number; border?: 'none' | 'subtle' | 'ice'; mirror?: boolean};
}

/** Narrate mode: the user's voice as the audio track, and the face-cam clip (file names inside the render's public dir, or URLs). */
export interface LoadingWindow {startMs: number; endMs: number}
export interface AudioTrack {src: string; volume?: number; /** where the voice starts in the output, ms (default 0) */ offsetMs?: number}
export interface FacecamTrack {src: string; /** media time that lines up with output 0, ms (default 0) */ startMs?: number}

export const defaultStyle: Style = {
  background: {type: 'preset', value: 'graphite'},
  padding: 7,
  radius: 20,
  shadow: 0.7,
  frame: 'none',
  frameLabel: '',
  frameTheme: 'auto',
  border: 'none',
  borderColor: '#86E4F0',
  shadowColor: '#000000',
  aspect: '16:9',
  fit: 'letterbox',
  resolution: '1080p',
  zoom: {auto: true, amount: 1, speed: 1, follow: 0.7},
  cursor: {visible: true, size: 1, smoothing: 0.6, hideWhenIdle: true, style: 'arrow'},
  clickEffect: 'ripple',
  motionBlur: 0.5,
  keystrokes: true,
  idleSpeedup: true,
  captions: {enabled: true, style: 'clean', position: 'bottom', size: 1},
};

/**
 * THE motion numbers, in one place. Everything that decides how Dolly moves reads these: the planner (plan.ts), the camera
 * (camera.ts), the composition (remotion/Dolly.tsx) and the autopilot drivers (autopilot/drive.mjs, autopilot/smooth.mjs).
 * Tune here (or per plan in plan.params / per render in the style); docs/motion-audit.md explains where each number came from.
 */
export const motionDefaults = {
  camera: {
    /** Zoom-in / zoom-out ease, ms on screen (smootherstep: ease-in-out, cannot overshoot). */
    zoomInMs: 900,
    zoomOutMs: 1000,
    /** The zoom-in is finished this long before the click it was made for. */
    zoomLandMs: 160,
    /** The pull-out starts this long after the last action of the shot (the result is on screen by then). */
    holdAfterMs: 1300,
    /** Zoom changes closer together than this are merged: the camera stays in and glides (panMs) to the next focus. */
    minDwellMs: 2200,
    panMs: 850,
    /** Never leave a result sooner than this. */
    holdMinMs: 700,
    /** No camera move in the first / last stretch of the video. */
    calmLeadMs: 700,
    calmTailMs: 800,
    /** Follow: the camera only moves when the cursor leaves the middle `1 - 2*safeMargin` of the view (0.22 = the outer 22% each side). */
    safeMargin: 0.22,
    /** Follow spring, 1/s at follow = 0 and at follow = 1 (critically damped: it eases onto its target and never passes it). */
    followOmega: [2.2, 5.2] as [number, number],
  },
  cursor: {
    /** Fitts-style move time: clamp(minMs, maxMs, a + b * log2(1 + distance / 60 px)). */
    minMs: 450, maxMs: 900, fittsA: 260, fittsB: 185,
    /** Sideways bow of the path, as a fraction of the distance (capped in px). */
    arc: 0.08, arcMaxPx: 46,
    /** Rest on the target before the press, ms (min, max), and how long the button is held. */
    settleMs: [120, 220] as [number, number],
    pressMs: [70, 110] as [number, number],
    /** Trail on fast moves only: starts above this on-screen speed (canvas px/s at 1080p), strength 0..1. */
    blur: 0.6, blurFromPxS: 1500,
    /** Fade out after this long without a move or click; fade times. */
    idleHideMs: 1800, fadeOutMs: 450, fadeInMs: 180,
  },
  pacing: {
    /** After an action: wait for the visual change to finish, then hold at least this long (small change / new page or panel). */
    holdSmallMs: 800,
    holdPageMs: 1500,
    /** How long the visual change may take before the driver stops waiting for it. */
    changeMaxMs: 2500,
    /** Calm first and last second: nothing moves. */
    leadInMs: 1000,
    leadOutMs: 1000,
    /** Scroll: ms = clamp(min, max, a + b * |px|), eased in and out. */
    scrollMinMs: 700, scrollMaxMs: 1800, scrollA: 520, scrollB: 0.9,
    /** Idle stretches are cut or, at most, played this fast (with frame blending). 6-8x ramps smear. */
    maxSpeed: 2,
  },
};

export const defaultPlanParams: PlanParams = {
  clusterGapMs: 2500,
  clusterDistFrac: 0.3,
  zoomLeadMs: motionDefaults.camera.zoomInMs + motionDefaults.camera.zoomLandMs, // kept for old tools: when the zoom-in starts, before the click
  zoomInMs: motionDefaults.camera.zoomInMs,
  zoomOutMs: motionDefaults.camera.zoomOutMs,
  zoomHoldAfterMs: motionDefaults.camera.holdAfterMs,
  baseScale: 1.9,
  maxScale: 2.2,
  minScale: 1.25,
  mergeGapMs: 600,
  idleThresholdMs: 4000,
  idleKeepMs: 700,
  idleSpeed: motionDefaults.pacing.maxSpeed,
  idleMode: 'speed',
  cursorSmoothing: 0.6,
  zoomLandMs: motionDefaults.camera.zoomLandMs,
  minDwellMs: motionDefaults.camera.minDwellMs,
  panMs: motionDefaults.camera.panMs,
  calmLeadMs: motionDefaults.camera.calmLeadMs,
  calmTailMs: motionDefaults.camera.calmTailMs,
  holdMinMs: motionDefaults.camera.holdMinMs,
};

/** Deep-merge plain objects (arrays and primitives replace). */
export function mergeStyle<T>(base: T, ...over: any[]): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : {...(base as any)};
  for (const o of over) {
    if (!o || typeof o !== 'object') continue;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v === undefined) continue;
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] ? mergeStyle(out[k], v) : v;
    }
  }
  return out;
}

export const stylePresets: Record<string, Partial<Style>> = {
  default: {},
  ice: {background: {type: 'preset', value: 'ice'}, frame: 'window', radius: 18},
  browser: {background: {type: 'preset', value: 'graphite'}, frame: 'browser', padding: 6},
  aurora: {background: {type: 'preset', value: 'aurora'}, frame: 'window', shadow: 0.8},
  dusk: {background: {type: 'preset', value: 'dusk'}, frame: 'none', radius: 24},
  sand: {background: {type: 'preset', value: 'sand'}, frame: 'window', shadow: 0.35},
  bare: {background: {type: 'solid', value: '#0C0C0D'}, padding: 0, radius: 0, shadow: 0, frame: 'none'},
  vertical: {aspect: '9:16', fit: 'crop', padding: 5, frame: 'none'},
  square: {aspect: '1:1', fit: 'crop', padding: 5},
  ribbons: {background: {type: 'preset', value: 'ribbons'}, frame: 'window', shadow: 0.85},
  dunes: {background: {type: 'preset', value: 'ai-dunes-bluehour'}, frame: 'window', shadow: 0.4, radius: 22},
  noir: {background: {type: 'preset', value: 'grid', vignette: 0.4}, frame: 'browser', padding: 6},
  glass: {background: {type: 'preset', value: 'shards'}, frame: 'window', border: 'hairline', radius: 22},
  // wallpaper looks (added 2026-11: each is an AI wallpaper or animated background in a macOS window; backward-compatible additions)
  alpine: {background: {type: 'preset', value: 'ai-alpine-dawn'}, frame: 'window', shadow: 0.45, radius: 22, padding: 6},
  ocean: {background: {type: 'preset', value: 'ai-ocean-pastel'}, frame: 'window', shadow: 0.4, radius: 22, padding: 6},
  meadow: {background: {type: 'preset', value: 'ai-hills-golden'}, frame: 'window', shadow: 0.5, radius: 22, padding: 6},
  night: {background: {type: 'preset', value: 'ai-glass-graphite'}, frame: 'window', shadow: 0.8, radius: 22, padding: 6, border: 'hairline'},
  liquid: {background: {type: 'preset', value: 'liquid-dusk'}, frame: 'window', shadow: 0.8, radius: 22, padding: 6},
  plain: {background: {type: 'preset', value: 'graphite'}, frame: 'none', radius: 20, shadow: 0.7, padding: 7},
  focus: {background: {type: 'video', value: '', blur: 40, grain: 0.25, vignette: 0.35}, padding: 8, radius: 22},
};
