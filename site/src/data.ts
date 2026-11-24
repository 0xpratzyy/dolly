import {defaultStyle, mergeStyle, stylePresets, type Caption, type Plan, type Style} from '@studio/types.ts';
import rawPlan from '@demo/plan.json';

export {REPO_URL, SUBTLE_URL, INSTALL} from './consts';

/** The site's copy of the demo video may start TRIM_MS in (scripts/prep-media.sh TRIM, same value), so the plan moves by the same amount. The current take (a 2x smooth capture of refs.video) needs no trim. */
export const TRIM_MS = 0;
function trimPlan(p: Plan, t: number): Plan {
  const path = (a: [number, number, number][]) => a.filter((r) => r[0] >= t).map((r) => [r[0] - t, r[1], r[2]] as [number, number, number]);
  return {
    ...p,
    source: {...p.source, durationMs: p.source.durationMs - t},
    zooms: p.zooms.map((z) => ({...z, startMs: z.startMs - t, endMs: z.endMs - t})),
    speed: p.speed.map((s) => ({...s, startMs: s.startMs - t, endMs: s.endMs - t})),
    clicks: p.clicks.map((c) => ({...c, tMs: c.tMs - t})),
    keys: p.keys.map((k) => ({...k, tMs: k.tMs - t})),
    cursor: path(p.cursor), cursorRaw: path(p.cursorRaw),
  };
}
export const PLAN = trimPlan(rawPlan as unknown as Plan, TRIM_MS);
export const VIDEO = '/demo/demo.mp4?v=73fa95b9';
export const POSTER = '/demo/poster.jpg?v=73fa95b9';
/** A frame with the headline in view, for small previews (look cards, the blurred-recording tile). */
export const LOOK = '/demo/look.jpg?v=73fa95b9';
export const FPS = PLAN.source.fps;
export const SRC_ASPECT = PLAN.source.width / PLAN.source.height;

/** The editor opens in Dunes (a dark page on a warm wallpaper reads as a product shot; plain graphite read as dark on dark). */
export const BASE: Style = mergeStyle(defaultStyle, PLAN.style, stylePresets.dunes);

// ---- subtitles: Subtle's styles, straight from its styles/*.json (the files `--style <name>` reads)
const files = import.meta.glob('@subtle-styles/*.json', {eager: true, import: 'default'}) as Record<string, any>;
export const CAPTION_STYLES: Record<string, any> = {};
for (const [p, v] of Object.entries(files)) CAPTION_STYLES[p.split('/').pop()!.replace('.json', '')] = v;
// Strongest first, as on the Subtle site; "behind the speaker" styles need a person cut-out and song styles are for lyrics, so neither is offered.
const TOP = ['outline', 'magazine', 'stack', 'rise', 'sticker', 'duo', 'editorial', 'cinema', 'impact', 'block', 'highlighter', 'numeral', 'split', 'glide', 'serif', 'shine', 'newsroom', 'cards', 'punch', 'flip', 'accent', 'glass', 'chip', 'quiet'];
const usable = (n: string) => !CAPTION_STYLES[n]?.behind?.enabled && CAPTION_STYLES[n]?.group !== 'music';
export const CAPTION_NAMES: string[] = [...TOP.filter((n) => CAPTION_STYLES[n]), ...Object.keys(CAPTION_STYLES).filter((n) => !TOP.includes(n))].filter(usable);

// ---- three demo caption lines, in OUTPUT time (this clip has no speed-ups, so output = source time). Words in *stars* are highlighted.
export const DEFAULT_LINES = ['Every film, *taken apart.*', 'Start free. Pay *when you want more.*', 'Open a channel, and see how it is *built.*'];
export const LINE_TIMES: [number, number][] = [[1300, 4400], [5200, 9200], [16300, 20300]];
export const toCaptions = (lines: string[]): Caption[] =>
  lines.flatMap((text, i) => (text.trim() ? [{startMs: LINE_TIMES[i][0], endMs: LINE_TIMES[i][1], text: text.trim()}] : []));

export const ASPECTS: Style['aspect'][] = ['16:9', '9:16', '1:1', '4:5'];
export const LOOKS: [string, string][] = [['dunes', 'Dunes'], ['alpine', 'Alpine dawn'], ['ocean', 'Pastel ocean'], ['meadow', 'Golden meadow'], ['night', 'Glass graphite'], ['liquid', 'Liquid dusk'], ['ribbons', 'Ribbons'], ['glass', 'Glass'], ['sand', 'Sand'], ['dusk', 'Dusk'], ['ice', 'Ice'], ['browser', 'Browser'], ['noir', 'Noir'], ['focus', 'Focus'], ['plain', 'Graphite'], ['bare', 'Bare'], ['vertical', 'Vertical'], ['square', 'Square']];

/** The style exactly as the CLI reads it: an image upload stays on the visitor's device, so the file is a placeholder path. */
export function exportStyle(s: Style): Style {
  const out = JSON.parse(JSON.stringify(s)) as Style;
  if (out.background.type === 'image') out.background.value = '~/Pictures/background.jpg';
  return out;
}
