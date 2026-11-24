import {useCallback, useRef, useState} from 'react';
import {INSTALL, REPO_URL} from './consts';
import {copyText} from './copy';
import {track} from './analytics';
import {Icon} from './ui';
import {buildSpotlightPrompt, SPOT_DEFAULTS} from './spotlight/prompt';
import {buildNarratePrompt, NARRATE_PROMPT_DEFAULTS} from './narrate/prompt';

export type Mode = 'record' | 'autopilot' | 'narrate' | 'spotlight';

/** The Record prompt is the editor's own (plan, styles and all), so it lives in a chunk fetched when the page is idle; a click before that waits for it. */
let recordP: Promise<string> | null = null;
let recordNow: string | null = null;
export const warmRecordPrompt = () => (recordP ??= import('./record-prompt').then((m) => (recordNow = m.default)));

const AUTOPILOT = [
  'Use the Dolly skill (Autopilot) to record my product from a URL and turn it into a launch video.',
  '',
  'Product URL: https://your.product',
  '(If that is still the placeholder, ask me for the real URL before doing anything else.)',
  '',
  '## 1. Set up (skip whatever is already done)',
  `- Install: \`${INSTALL}\`. If ~/.claude/skills/dolly exists, update it with \`git -C ~/.claude/skills/dolly pull\`.`,
  '- Needs Node 22+ and ffmpeg (`brew install node ffmpeg`). The repo: ' + REPO_URL,
  '',
  '## 2. Record and render',
  '1. Open the product in a real Chromium window, explore the main flow, and write script.json: the steps, with a human-paced cursor.',
  '2. Anything behind a sign-in needs a test account from me. Never log in with mine, and never click Pay, Buy, Delete or Subscribe.',
  '3. Run it, look at the contact sheet it writes, and re-run any scene where a click landed in the wrong place.',
  '4. Give me out.mp4 (16:9) and vertical.mp4 (9:16), with zooms, a smooth cursor and captions.',
  '',
  'node autopilot/make.mjs script.json --out ~/demos/launch',
].join('\n');

/** A prompt for one tab: instant for the three small ones, a promise for Record until its chunk has arrived. */
export function promptFor(mode: Mode): string | Promise<string> {
  if (mode === 'spotlight') return buildSpotlightPrompt({...SPOT_DEFAULTS, scene: 'void'});
  if (mode === 'narrate') return buildNarratePrompt(NARRATE_PROMPT_DEFAULTS);
  if (mode === 'autopilot') return AUTOPILOT;
  return recordNow ?? warmRecordPrompt();
}

/** Copy text that may still be loading. A promise goes to the clipboard as a ClipboardItem, which keeps Safari's "must be inside the click" rule happy. */
export async function copyLazy(text: string | Promise<string>): Promise<boolean> {
  if (typeof text === 'string') return copyText(text);
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({'text/plain': text.then((t) => new Blob([t], {type: 'text/plain'}))})]);
      return true;
    }
  } catch { /* fall through */ }
  try { return copyText(await text); } catch { return false; }
}

/** A button that copies a prompt and says "Copied" for a moment. `variant` is the pill the page's one filled button uses, or a quiet text link. */
export function CopyPrompt({mode, label, variant = 'link', where}: {mode: Mode; label: string; variant?: 'primary' | 'link'; where: string}) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  const onClick = useCallback(async () => {
    const ok = await copyLazy(promptFor(mode));
    if (ok) { setDone(true); clearTimeout(timer.current); timer.current = window.setTimeout(() => setDone(false), 1700); }
    track('dolly_copied', {what: `prompt-${mode}`, where, ok});
  }, [mode, where]);
  const cls = variant === 'primary' ? 'pill primary big' : 'lp-link';
  return (
    <button type="button" className={cls} onClick={onClick} onPointerEnter={mode === 'record' ? () => { warmRecordPrompt().catch(() => {}); } : undefined} onFocus={mode === 'record' ? () => { warmRecordPrompt().catch(() => {}); } : undefined} data-copied={done}>
      {variant === 'primary' && (done ? Icon.check : Icon.copy)}
      {done ? 'Copied' : label}
    </button>
  );
}
