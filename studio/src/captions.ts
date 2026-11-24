// Turns the simple captions input into a Subtle CaptionsFile (pages of timed words) that Subtle's caption engine draws.
// Pure TypeScript, no Remotion imports: the CLI and the website both use it.
//
// Accepted input (all times are OUTPUT time in ms, i.e. what the viewer sees):
//   [{startMs, endMs, text}]                      one line per caption; word timings are spread evenly over the line
//   [{startMs, endMs, text, words:[{text,startMs,endMs}]}]   same, with real word timings
//   a Subtle captions file ({version, pages:[{startMs,endMs,words}]})  used as is
// In `text`, wrap a word in *asterisks* to highlight it (styles with an emphasis look).
import type {Caption, CaptionsInput, SubtleCaptionsFile, SubtleCPage, SubtleCWord} from './types.ts';

interface PageRules {
  maxWords: number;
  maxCharsPerLine: number;
  maxLines: number;
}

export const isSubtleFile = (c: unknown): c is SubtleCaptionsFile => !!c && !Array.isArray(c) && Array.isArray((c as any).pages);

function wordsOf(c: Caption): SubtleCWord[] {
  if (c.words?.length) return c.words.map((w) => ({text: w.text, startMs: w.startMs, endMs: w.endMs, emphasis: false}));
  const toks = c.text.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const span = Math.max(1, c.endMs - c.startMs);
  // weight by length so long words get a little more time
  const wts = toks.map((t) => 1 + t.replace(/[*]/g, '').length * 0.35);
  const sum = wts.reduce((a, b) => a + b, 0);
  let t = c.startMs;
  return toks.map((tok, i) => {
    const s = t;
    t += (span * wts[i]) / sum;
    return {text: tok, startMs: Math.round(s), endMs: Math.round(i === toks.length - 1 ? c.endMs : t), emphasis: false};
  });
}

function markEmphasis(words: SubtleCWord[]) {
  for (const w of words) {
    const m = /^(\W*)\*+([^*]+?)\*+(\W*)$/.exec(w.text);
    if (m) { w.text = m[1] + m[2] + m[3]; w.emphasis = true; }
    else w.text = w.text.replace(/\*/g, '');
  }
}

/** Split one caption's words into pages that fit the style's rules, assigning each word a line index. */
function paginate(words: SubtleCWord[], r: PageRules): SubtleCPage[] {
  const pages: SubtleCPage[] = [];
  let cur: SubtleCWord[] = [];
  let nLines = 1;
  const flush = () => {
    if (cur.length) pages.push({startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs, words: cur});
    cur = []; nLines = 1;
  };
  for (const w of words) {
    let line = nLines - 1;
    const lineLen = cur.filter((x) => x.line === line).reduce((a, x) => a + x.text.length + 1, 0);
    if (cur.length && lineLen + w.text.length > r.maxCharsPerLine) {
      if (nLines < r.maxLines) { nLines++; line++; }
      else { flush(); line = 0; }
    }
    if (cur.length >= r.maxWords) { flush(); line = 0; }
    w.line = line;
    cur.push(w);
  }
  flush();
  return pages;
}

/** Build the Subtle captions file for a Dolly render. `style` is the Subtle style JSON (styles/<name>.json). */
export function toSubtleCaptions(
  input: CaptionsInput | undefined,
  style: {name?: string; page?: {maxWords?: number; maxCharsPerLine?: number; maxCharsPerLineWide?: number; maxLines?: number}},
  frame: {width: number; height: number; fps: number; durationMs: number},
): SubtleCaptionsFile {
  const base = {version: 1, video: {width: frame.width, height: frame.height, fps: frame.fps, durationMs: frame.durationMs}, style: style.name ?? 'glide'};
  if (!input || (Array.isArray(input) && !input.length)) return {...base, pages: []};
  if (isSubtleFile(input)) return {...input, video: base.video, style: base.style};
  const wide = frame.width > frame.height;
  const pg = style.page ?? {};
  const rules: PageRules = {
    maxWords: pg.maxWords ?? 6,
    maxCharsPerLine: (wide ? pg.maxCharsPerLineWide ?? pg.maxCharsPerLine : pg.maxCharsPerLine) ?? (wide ? 40 : 24),
    maxLines: pg.maxLines ?? 2,
  };
  const pages: SubtleCPage[] = [];
  for (const c of [...input].sort((a, b) => a.startMs - b.startMs)) {
    const ws = wordsOf(c);
    markEmphasis(ws);
    pages.push(...paginate(ws, rules));
  }
  // pages never overlap; a page holds a beat after its last word when there is room
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1]?.startMs ?? Infinity;
    const hold = pages[i].words.some((w) => w.emphasis) ? 700 : 400;
    pages[i].endMs = Math.min(next, pages[i].endMs + hold);
  }
  return {...base, pages};
}
