export interface NarrateInputs {url: string; input: 'voice' | 'facecam'; login: 'public' | 'login'; vertical: boolean}
export const NARRATE_PROMPT_DEFAULTS: NarrateInputs = {url: 'https://your.product', input: 'voice', login: 'public', vertical: true};

/** The prompt the Narrate section copies: it names the input, the URL, the sign-in choice and the cuts, and carries the commands. */
export function buildNarratePrompt(o: NarrateInputs): string {
  const url = o.url.trim() || 'https://your.product';
  const memo = o.input === 'voice' ? 'memo.m4a' : 'clip.mp4';
  const flags = [`--voice ${memo}`, `--url ${url}`, '--out ~/demos/launch', ...(o.login === 'login' ? ['--storage autopilot/.auth/state.json'] : []), ...(o.vertical ? ['--vertical'] : [])];
  return [
    `Use the Dolly skill (Narrate) to turn my talk into a launch video of ${url}.`,
    '',
    `My ${o.input === 'voice' ? 'voice memo' : 'face-cam clip'} is ${memo} (I talk about what I launched; I will not touch the screen).`,
    `1. Run narrate.mjs once, read the transcript, and fill in narration-plan.json: map each thing I said to a real click, scroll or type on the product, anchored to the word I say it on.`,
    `2. Run check, fix every target that did not match, then run the same command again to record and render.`,
    o.login === 'login'
      ? `3. The product needs a sign-in. I will run login.mjs myself and sign in by hand: never type my password, never read or print the saved session. Use --storage autopilot/.auth/state.json, avoid Pay, Buy, Delete and Subscribe, and prefer a test account.`
      : `3. The product is public (or a local or staging URL), so no login is needed. Avoid Pay, Buy, Delete and Subscribe.`,
    `4. Give me out.mp4 (16:9)${o.vertical ? ' and vertical.mp4 (9:16)' : ''} with my voice${o.input === 'facecam' ? ', my face in a bubble' : ''}, zooms, a smooth cursor and captions, plus sheet.jpg so I can check each click against its word.`,
    '',
    ...(o.login === 'login' ? ['# once, by me, in a window of my own', 'node autopilot/login.mjs ' + url, ''] : []),
    `node autopilot/narrate.mjs ${flags.join(' ')}`,
  ].join('\n');
}
