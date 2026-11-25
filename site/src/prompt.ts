import {CAPTION_STYLES, INSTALL, PLAN, REPO_URL, SUBTLE_URL, exportStyle, toCaptions} from './data';
import {backgroundCatalog} from '@studio/remotion/backgrounds.ts';
import type {Style, Zoom} from '@studio/types.ts';
import {zoomsChanged} from './editor/state';
import type {Clip} from './clip';

const pct = (v: number) => `${Math.round(v * 100)}%`;
export const styleJson = (s: Style) => JSON.stringify(exportStyle(s), null, 2) + '\n';

/** A sentence per choice, so the prompt reads as a brief and the JSON is the exact settings. */
function describe(s: Style): string[] {
  const L: string[] = [];
  const bg = s.background;
  const nm = (id: string) => backgroundCatalog.find((b) => b.id === id)?.name ?? id;
  const fx = [bg.blur ? `${bg.blur}px blur` : '', bg.grain ? `${pct(bg.grain)} grain` : '', bg.vignette ? `${pct(bg.vignette)} vignette` : ''].filter(Boolean).join(', ');
  L.push(`Background: ${bg.type === 'preset' ? `the "${bg.value}" ${backgroundCatalog.find((b) => b.id === bg.value)?.category ?? 'background'} (${nm(bg.value)})` : bg.type === 'solid' ? `solid ${bg.value}` : bg.type === 'gradient' ? `a custom gradient (${bg.value})` : bg.type === 'video' ? 'a heavily blurred, darkened copy of the recording itself' : 'my own image (~/Pictures/background.jpg, replace with the real file)'}${fx ? `, with ${fx}` : ''}; padding ${s.padding}% of the short side, corner radius ${s.radius}, shadow ${pct(s.shadow)} in ${s.shadowColor ?? '#000000'}${s.border && s.border !== 'none' ? `, ${s.border} edge${s.border === 'glow' ? ` in ${s.borderColor}` : ''}` : ''}.`);
  L.push(`Frame: ${s.frame === 'none' ? 'none' : s.frame === 'browser' ? 'browser window' : 'macOS window'}${s.frame !== 'none' && s.frameTheme && s.frameTheme !== 'auto' ? `, ${s.frameTheme} chrome` : ''}${s.frame !== 'none' && s.frameLabel ? ` titled "${s.frameLabel}"` : ''}. Canvas ${s.aspect}, ${s.fit === 'crop' ? 'window fills the canvas and the camera pans' : 'whole recording visible'}.`);
  L.push(s.zoom.auto
    ? `Auto zoom: on, ${(1 + 0.9 * s.zoom.amount).toFixed(1)}x deep (zoom.amount ${s.zoom.amount}), eases at ${s.zoom.speed}x speed, camera follow ${pct(s.zoom.follow)}.`
    : 'Auto zoom: off (the camera stays put).');
  L.push(`Cursor: ${s.cursor.visible ? `${s.cursor.style ?? 'arrow'} style, ${s.cursor.size}x size, ${pct(s.cursor.smoothing)} smoothing, ${s.cursor.hideWhenIdle ? 'hidden when idle' : 'always visible'}` : 'hidden'}. Click effect: ${s.clickEffect}. Motion blur ${pct(s.motionBlur)}.`);
  L.push(`Keystroke overlay: ${s.keystrokes ? 'on' : 'off'}. Idle speed-up: ${s.idleSpeedup ? 'on' : 'off'}.`);
  L.push(s.captions.enabled
    ? `Subtitles: on, Subtle's "${s.captions.style}" style (${CAPTION_STYLES[s.captions.style]?.description ?? 'see subtle/styles'}), ${s.captions.position}, size ${s.captions.size}x.`
    : 'Subtitles: off.');
  return L;
}

/** The zoom list the visitor edited on the demo clip, as the planner's own zoom objects. */
export const zoomsJson = (zooms: Zoom[]) => JSON.stringify({zooms: zooms.map(({id, startMs, endMs, inMs, outMs, scale, center, bbox, why}) => ({id, startMs, endMs, inMs, outMs, scale, center, bbox, why}))}, null, 2) + '\n';

export function buildPrompt(s: Style, lines: string[], zooms: Zoom[] = PLAN.zooms, clip?: Clip): string {
  const own = !!clip && !clip.demo;
  const edited = zoomsChanged(zooms, clip?.plan.zooms ?? PLAN.zooms);
  const caps = s.captions.enabled ? toCaptions(lines, clip?.lineTimes) : [];
  const L: string[] = [
    `Polish a screen recording with Dolly, the open-source Screen Studio alternative that Claude Code runs: ${REPO_URL}`,
    'It renders on this Mac with Remotion. Nothing is uploaded and no account is needed.',
    '',
    'Recording: ~/Movies/my-demo (a folder with recording.mp4 and events.json, as the recorder writes them)',
    '(If that folder is still the placeholder above or is missing, ask me which recording to use, or whether to record one, before doing anything else.)',
    '',
    '## 1. Set up (skip whatever is already done)',
    `- Install: \`${INSTALL}\`. If ~/.claude/skills/dolly exists, update it with \`git -C ~/.claude/skills/dolly pull\`.`,
    '- Needs Node 22+ and ffmpeg (`brew install node ffmpeg`).',
    ...(s.captions.enabled ? [`- Subtitles use Subtle's caption engine: \`git clone ${SUBTLE_URL} ~/code/subtle\` (or point SUBTLE_DIR at your checkout).`] : []),
    '- To record a new take: build the recorder (`cd ~/.claude/skills/dolly/recorder && swift build -c release`), grant Screen Recording and Accessibility to the terminal, then run `.build/release/dolly-record --out ~/Movies/my-demo`.',
    '',
    '## 2. Make it look like this',
    ...describe(s).map((d) => `- ${d}`),
    '',
    'Save these settings exactly as ~/dolly-style.json (this is the Style object the renderer reads):',
    '```json',
    styleJson(s).trimEnd(),
    '```',
    '',
    '## 3. Plan and render',
    '```bash',
    'cd ~/.claude/skills/dolly/studio',
    ...(own ? [] : ['node dolly.mjs plan ~/Movies/my-demo']),
    `node dolly.mjs render ~/Movies/my-demo --style ~/dolly-style.json${caps.length ? ' --captions ~/Movies/my-demo/captions.json' : ''} --out ~/Movies/my-demo/polished.mp4`,
    '```',
    ...(caps.length
      ? [
          'Subtitles: write ~/Movies/my-demo/captions.json as `[{"startMs":0,"endMs":3000,"text":"..."}]` in OUTPUT time (what the viewer sees), from my narration or what is on screen. Wrap a word in *stars* to highlight it. For reference, the demo on the site uses:',
          '```json',
          JSON.stringify(caps, null, 2),
          '```',
        ]
      : []),
    '',
    ...(own
      ? [
          '## Camera edits',
          'My zooms are already in ~/Movies/my-demo/plan.json (saved from the Dolly web editor). Do not run `plan` again, it would overwrite them; render uses plan.json as it is.',
          '',
        ]
      : edited
      ? [
          '## Camera edits',
          'I edited the zooms by hand on the demo clip (times are from that clip). After `plan`, open plan.json and keep my intent for the zooms: depth (`scale`), ease (`inMs` / `outMs`) and focus (`center`). Retime them to my own recording\'s click clusters, or, if the recording is the demo itself, replace the `zooms` array with:',
          '```json',
          zoomsJson(zooms).trimEnd(),
          '```',
          '',
        ]
      : []),
    '## 4. Check before you hand it over',
    'Make a contact sheet of the render (`scripts/sheet.sh`) and look at it: the cursor is on its target at each click, nothing important is cut off at the edges, and any subtitles are readable. If something is off, say "zoom less on the settings panel" style edits to plan.json (or change the style) and render again.',
    'Then give me the path to polished.mp4 and one line on what you set up.',
  ];
  return L.join('\n');
}
