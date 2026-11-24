export type SceneId = 'void' | 'studio' | 'curtain' | 'desk' | 'wallpaper';
export type SpotAspect = '3:2' | '16:9' | '1:1' | '4:5' | '9:16';

export interface SpotInputs {
  url: string; target: string; actions: string;
  scene: SceneId; bg: string; aspect: SpotAspect;
  tilt: number; dof: number; glow: boolean; hero: number; loop: boolean; sound: boolean;
}
export const SPOT_DEFAULTS: SpotInputs = {
  url: 'http://localhost:3000/components', target: 'the Components dropdown', actions: 'open it, hover Dropdowns, flip Dark mode, close it',
  scene: 'wallpaper', bg: 'ai-hills-golden', aspect: '16:9', tilt: 9, dof: 0.6, glow: false, hero: 0, loop: true, sound: true,
};

const SCENE_NAME: Record<SceneId, string> = {void: 'Void', studio: 'Studio', curtain: 'Curtain', desk: 'Desk', wallpaper: 'Wallpaper'};

/** The prompt the Spotlight section copies: it names the target and URL, every choice, and the capture and render commands. */
export function buildSpotlightPrompt(o: SpotInputs): string {
  const target = o.target.trim() || 'the component';
  const url = o.url.trim() || 'http://localhost:3000';
  const wall = o.scene === 'wallpaper' || o.scene === 'desk';
  const render = [
    'node ~/.claude/skills/dolly/studio/spotlight.mjs ~/spotlight/caps/target',
    `--scene ${o.scene}${o.scene === 'wallpaper' ? ` --bg ${o.bg}` : ''}`,
    `--tilt ${o.tilt} --dof ${o.dof}`,
    ...(o.hero > 0 ? [`--hero ${o.hero}`] : []),
    ...(o.glow ? ["--glow '#86E4F0'"] : []),
    `--aspect ${o.aspect}`,
    ...(o.loop ? ['--loop'] : []),
    `--sound ${o.sound ? 'subtle' : 'off'}`,
  ].join(' ');
  const choices = [
    `Scene: ${SCENE_NAME[o.scene]}${o.scene === 'wallpaper' ? ` (${o.bg})` : wall ? ' (blurred wallpaper under glass)' : ''}`,
    `Aspect: ${o.aspect}`,
    `Camera tilt: ${o.tilt === 0 ? 'flat' : `${o.tilt} degrees, following the cursor`}`,
    `Depth of field: ${o.dof === 0 ? 'off' : o.dof}`,
    `Edge glow: ${o.glow ? 'ice cyan' : 'off'}`,
    `Hero size: ${o.hero > 0 ? `${Math.round(o.hero * 100)}% of the frame width` : 'automatic'}`,
    `Loop: ${o.loop ? 'seamless 6 to 12 second loop' : 'with intro and outro'}`,
    `Sound: ${o.sound ? 'subtle UI sounds' : 'off'}`,
  ];
  return [
    `Use the Dolly skill (Spotlight) to make a feed-ready animation of ${target} on ${url}.`,
    '',
    `What it should do: ${o.actions.trim() || 'hover it, then click through the main interaction'}.`,
    ...choices.map((c) => `- ${c}`),
    '',
    `1. Capture ${target} on its own (transparent background, 60 fps), driving that interaction with a human cursor. Write actions.json first, then capture, and look at the contact sheet.`,
    `2. Render it with the choices above, check one still, then give me the mp4.`,
    '',
    `node ~/.claude/skills/dolly/spotlight/capture.mjs --url ${url} --target "${target}" --actions actions.json --out ~/spotlight/caps/target --dark`,
    render,
  ].join('\n');
}
