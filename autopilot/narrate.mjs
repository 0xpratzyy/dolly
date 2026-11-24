#!/usr/bin/env node
// Dolly Narrate: the user only TALKS (a voice memo, or a quick face-cam clip) about what they launched. Dolly transcribes it,
// maps what is said onto the real product, opens the product itself, shows each thing exactly when it is mentioned (clicks, typing,
// scrolling, hovering, all automated, paced to the words), and renders the finished video: their voice, their face in a bubble
// (when they gave video), Dolly zooms, cursor and Subtle subtitles. Nobody records the screen or clicks anything.
//
//   node narrate.mjs --voice <audio|video> --url <product url> [--out dir] [--vertical] [options]     the whole pipeline
//   node narrate.mjs explore --url <url> [--out dir] [--shots]       what is on the product: links, buttons, inputs (for the plan)
//   node narrate.mjs plan    --voice <f> --url <u> --out dir         transcribe + write narration-plan.json (the bridge), nothing else
//   node narrate.mjs check   --out dir                               dry run of the plan in headless Chromium: every target there?
//   node narrate.mjs compose --out dir                               re-render from an existing recording (new style, captions, bubble)
//
// The pipeline stops after writing narration-plan.json when it has no actions yet (exit 3): Claude fills in `actions`
// (SKILL.md, "Narrate") and runs the same command again. `--auto` skips that and maps words to visible links/buttons itself.
// Options: --lang en|hi.. --hinglish --vocab "Refs, Dolly" (names Whisper should spell right)   --denoise
//   --no-facecam --facecam-corner auto|top-left|.. --facecam-shape circle|rounded --facecam-size 0.24 --facecam-border subtle|ice|none
//   --facecam-focus 0.5,0.35 (where the face is in the clip: x,y 0..1)   --style ice --set a.b=v   --captions-style glass|glide|..
//   --viewport 1440x900 --capture auto|window|screencast --storage <storageState.json> --force (record even if the check found problems)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const studio = path.join(root, 'studio');
const subtleDir = path.resolve(process.env.SUBTLE_DIR ?? path.join(root, 'studio/vendor/subtle')); // the vendored copy; SUBTLE_DIR = your own checkout
const argv = process.argv.slice(2);
const SUBS = ['explore', 'plan', 'check', 'compose'];
const sub = SUBS.includes(argv[0]) ? argv.shift() : 'all';
const flags = {}, sets = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--set') sets.push(argv[++i]);
  else if (a.startsWith('--') && a.includes('=')) flags[a.slice(2, a.indexOf('='))] = a.slice(a.indexOf('=') + 1);
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
}
const die = (m, code = 1) => { console.error(m); process.exit(code); };
const log = (...a) => console.error('[narrate]', ...a);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const stepName = (cmd, args) => `${path.basename(args[0] ?? cmd).replace(/\.m?js$/, '')} ${args[1] && !args[1].startsWith('/') ? args[1] : ''}`.trim();
const run = (cmd, args, opt = {}, name = stepName(cmd, args)) => {
  const end = prof.phase(`step.${name}`);
  const r = spawnSync(cmd, args, {stdio: 'inherit', ...opt});
  end();
  if (r.status !== 0) die(`${cmd} ${args.slice(0, 3).join(' ')} failed (${r.status})`, r.status === 2 ? 2 : 1);
};
/** The same, without blocking: two steps may overlap in normal / max (docs/performance.md, "Speed pass"). */
const kids = new Set();
const runAsync = (cmd, args, opt = {}, name = stepName(cmd, args)) => new Promise((res) => {
  const end = prof.phase(`step.${name}`);
  const child = spawn(cmd, args, {stdio: 'inherit', ...opt});
  kids.add(child);
  child.on('exit', (code) => { kids.delete(child); end(); if (code !== 0) { for (const k of kids) try { k.kill('SIGTERM'); } catch {} die(`${cmd} ${args.slice(0, 3).join(' ')} failed (${code})`, code === 2 ? 2 : 1); } res(); });
});
const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, '');
const DEFAULT_AVOID = ['checkout', 'get pro', 'upgrade', 'subscribe', 'buy', 'purchase', 'pay\\b', 'log ?out', 'sign ?out', 'log ?in', 'sign ?(in|up)', 'delete', 'remove account'];
const TAIL_MS = 1000;

const dir = path.resolve(flags.out ?? (flags.voice ? path.join(os.homedir(), 'demos', path.basename(flags.voice).replace(/\.[^.]+$/, '') + '-narrate') : ''));
const planPath = path.join(dir, 'narration-plan.json');
// --profile (or DOLLY_PROFILE=1): phase timings of every step in <dir>/profile.json (studio/scripts/lib/profile.mjs)
const PROFILE = (flags.profile === 'true' || process.env.DOLLY_PROFILE === '1') && !!flags.out;
const profFile = path.join(dir, '.profile.jsonl');
if (PROFILE) { fs.mkdirSync(dir, {recursive: true}); fs.rmSync(profFile, {force: true}); process.env.DOLLY_PROFILE = profFile; } // before the import: it reads the variable once
else if (process.env.DOLLY_PROFILE === '1') delete process.env.DOLLY_PROFILE;
const prof = await import(path.join(studio, 'scripts/lib/profile.mjs'));
const tRun = Date.now();
const mem = PROFILE ? prof.treeMemory() : null;
process.on('exit', () => {
  if (!PROFILE) return;
  const json = prof.writeProfile(profFile, path.join(dir, 'profile.json'), {totalMs: Date.now() - tRun, peakRss: mem.stop(), meta: {command: `narrate ${sub}`, date: new Date().toISOString()}});
  fs.rmSync(profFile, {force: true});
  prof.printProfile(json, (m) => console.error(m));
});

// ======================================================================== explore
async function explore(url, outDir, {shots = false, maxPages = 6, storage} = {}) {
  const {chromium} = await import('playwright');
  fs.mkdirSync(outDir, {recursive: true});
  const browser = await chromium.launch({headless: true});
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, locale: 'en-US', storageState: storage ? path.resolve(storage) : undefined});
  const page = await ctx.newPage();
  const avoid = DEFAULT_AVOID.map((r) => new RegExp(r, 'i'));
  const origin = new URL(url).origin;
  const scan = async () => page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 3 && r.height > 3 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const txt = (el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    const out = {title: document.title, headings: [], links: [], buttons: [], inputs: [], navLinks: []};
    for (const h of document.querySelectorAll('h1,h2,h3')) if (vis(h) && txt(h)) out.headings.push(txt(h).slice(0, 100));
    for (const a of document.querySelectorAll('a[href]')) if (vis(a) && txt(a)) out.links.push({text: txt(a).slice(0, 60), href: a.getAttribute('href'), nav: !!a.closest('header, nav')});
    for (const b of document.querySelectorAll('button, [role=button], [role=tab], summary')) if (vis(b) && txt(b)) out.buttons.push({text: txt(b).slice(0, 60), role: b.getAttribute('role') || b.tagName.toLowerCase()});
    for (const i of document.querySelectorAll('input:not([type=hidden]), textarea, select')) if (vis(i)) out.inputs.push({kind: i.type || i.tagName.toLowerCase(), placeholder: i.placeholder || '', label: i.getAttribute('aria-label') || ''});
    return out;
  });
  const dedupe = (arr, key) => { const seen = new Set(); return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const risky = (t) => avoid.some((r) => r.test(t));
  const pages = {};
  const visit = async (u, shotName) => {
    await page.goto(u, {waitUntil: 'domcontentloaded', timeout: 20000}).catch(() => {});
    await page.waitForLoadState('load', {timeout: 8000}).catch(() => {});
    await page.waitForLoadState('networkidle', {timeout: 4000}).catch(() => {});
    await page.waitForTimeout(600);
    const info = await scan();
    info.links = dedupe(info.links, (l) => l.text + '|' + l.href).map((l) => ({...l, avoid: risky(l.text + ' ' + l.href)}));
    info.buttons = dedupe(info.buttons, (b) => b.text).map((b) => ({...b, avoid: risky(b.text)}));
    info.url = page.url();
    if (shots) { const f = path.join(outDir, `${shotName}.png`); await page.screenshot({path: f}); info.screenshot = f; }
    pages[new URL(page.url()).pathname || '/'] = info;
    return info;
  };
  const home = await visit(url, 'page-0-home');
  const next = dedupe(home.links.filter((l) => l.nav && !l.avoid && /^(\/|https?:\/\/)/.test(l.href) && (l.href.startsWith('/') || l.href.startsWith(origin))), (l) => l.href).slice(0, maxPages);
  let n = 1;
  for (const l of next) { await visit(new URL(l.href, url).href, `page-${n++}-${norm(l.text) || 'page'}`); }
  await browser.close();
  const result = {url, origin, pages};
  fs.writeFileSync(path.join(outDir, 'explore.json'), JSON.stringify(result, null, 2));
  return result;
}

// ======================================================================== prepare: audio, transcript, face-cam, plan skeleton
function ffprobeInfo(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,disposition:format=duration', '-of', 'json', file], {encoding: 'utf8'});
  const d = JSON.parse(r.stdout || '{}');
  const v = (d.streams ?? []).find((s) => s.codec_type === 'video' && !(s.disposition?.attached_pic));
  return {hasVideo: !!v, hasAudio: (d.streams ?? []).some((s) => s.codec_type === 'audio'), width: v?.width, height: v?.height, durationMs: Math.round(Number(d.format?.duration ?? 0) * 1000)};
}

function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {encoding: 'utf8'});
  const m = /I:\s+(-?[\d.]+) LUFS[\s\S]*?Peak:\s+(-?[\d.]+) dBFS/.exec(r.stderr.split('Summary:').pop() ?? '');
  return m ? {lufs: Number(m[1]), peakDb: Number(m[2])} : null;
}

function prepareInputs() {
  const input = path.resolve(flags.voice);
  if (!fs.existsSync(input)) die(`no such file: ${input}`);
  fs.mkdirSync(dir, {recursive: true});
  const info = ffprobeInfo(input);
  if (!info.hasAudio) die(`${input} has no audio track`);
  const wav = path.join(dir, 'voice-raw.wav');
  const voice = path.join(dir, 'voice.m4a');
  const fresh = (f) => fs.existsSync(f) && fs.statSync(f).mtimeMs > fs.statSync(input).mtimeMs && !flags.fresh;
  if (!fresh(voice)) {
    // loudness-normalise to about -16 LUFS (EBU R128, single pass, true peak -1.5 dB). --denoise adds a high-pass and gentle spectral denoise.
    const pre = flags.denoise ? 'highpass=f=70,afftdn=nr=12:nf=-30,' : 'highpass=f=60,';
    const raw = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '48000', '-af', pre.replace(/,$/, ''), wav]);
    if (raw.status !== 0) die('could not read the audio: ' + raw.stderr);
    // two-pass loudnorm: measure, then apply the measured values for an accurate -16 LUFS
    const pass1 = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], {encoding: 'utf8'});
    const j = /\{[\s\S]*"target_offset"[\s\S]*?\}/.exec(pass1.stderr)?.[0];
    let ln = 'loudnorm=I=-16:TP=-1.5:LRA=11';
    if (j) { const m = JSON.parse(j); ln += `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`; }
    run('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', ln, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', voice], {}, 'voice.loudnorm');
  }
  const lo = loudness(voice);
  info.durationMs = ffprobeInfo(voice).durationMs; // the voice track's own length (a video's container can be longer than its audio)
  log(`voice: ${(info.durationMs / 1000).toFixed(1)} s${lo ? `, ${lo.lufs} LUFS, peak ${lo.peakDb} dB` : ''} -> ${voice}`);
  let facecam = null;
  if (info.hasVideo && !flags['no-facecam']) {
    facecam = path.join(dir, 'facecam.mp4');
    if (!fresh(facecam)) {
      // a square crop around the face (default: centred horizontally, a bit above the middle), 720 px, capped at 30 fps, no audio
      const [fx, fy] = (flags['facecam-focus'] ?? '0.5,0.35').split(',').map(Number);
      const vf = `crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))*${fx}':'(ih-min(iw,ih))*${fy ?? 0.35}',scale=720:720,fps=30`;
      run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-an', '-vf', vf, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', facecam], {}, 'facecam.crop');
    }
    log(`face-cam: ${info.width}x${info.height} -> square 720 px ${facecam}`);
  }
  // transcript with word timings, local (Subtle's mlx-whisper); the audio never leaves this Mac
  const tPath = path.join(dir, 'transcript.json');
  if (!fresh(tPath) || !fs.existsSync(tPath)) {
    const targs = ['run', path.join(subtleDir, 'scripts/transcribe.py'), wav, '--out', tPath];
    if (flags.lang) targs.push('--lang', flags.lang);
    if (flags.hinglish) targs.push('--hinglish');
    if (flags.vocab) targs.push('--vocab', flags.vocab);
    run('uv', targs, {stdio: ['ignore', 'inherit', 'inherit']}, 'transcribe');
  }
  const transcript = readJson(tPath);
  return {info, voice, facecam, transcript};
}

/** Sentences: break after . ! ? or at a pause > 650 ms; a piece under 0.6 s, or a single word, joins the one before it. */
function segmentWords(words) {
  const segs = [];
  let cur = [];
  const flush = () => { if (cur.length) segs.push(cur); cur = []; };
  words.forEach((w, i) => {
    cur.push(w);
    const gap = i + 1 < words.length ? words[i + 1].startMs - w.endMs : Infinity;
    if (/[.!?…]["')]*$/.test(w.text) || gap > 650) flush();
  });
  flush();
  const merged = [];
  for (const s of segs) {
    const dur = s[s.length - 1].endMs - s[0].startMs;
    if (merged.length && (dur < 600 || s.length < 2)) merged[merged.length - 1].push(...s); else merged.push(s);
  }
  return merged;
}

function skeletonPlan(prep) {
  const segs = segmentWords(prep.transcript.words);
  return {
    version: 1,
    status: 'draft',
    url: flags.url,
    viewport: flags.viewport ?? '1440x900',
    avoid: DEFAULT_AVOID,
    voice: 'voice.m4a',
    facecam: prep.facecam ? 'facecam.mp4' : null,
    durationMs: prep.info.durationMs,
    language: prep.transcript.language,
    _help: 'Fill each segment.actions (see SKILL.md, Narrate). `at` = a word from `timing` (e.g. "pricing", "pricing#2" for the 2nd one, "end:pricing") or ms. Actions: click|hover|type(+into)|press|scroll(+to)|wait|goto, plus optional mobile override. Set status to "ready" when done.',
    segments: segs.map((s, i) => ({
      id: `s${i + 1}`,
      startMs: s[0].startMs,
      endMs: s[s.length - 1].endMs,
      said: s.map((w) => w.text).join(' '),
      timing: s.map((w) => `${w.text}@${w.startMs}-${w.endMs}`).join(' '),
      intent: '',
      actions: [],
    })),
  };
}

// ======================================================================== anchors and compile
const parseTiming = (t) => t.split(/\s+/).filter(Boolean).map((tok) => {
  const m = /^(.*)@(\d+)-(\d+)$/.exec(tok);
  return m ? {text: m[1], n: norm(m[1]), startMs: Number(m[2]), endMs: Number(m[3])} : null;
}).filter(Boolean);

/** "pricing" | "pricing#2" | "here's pricing" | "end:pricing" | ms | "4.2s" -> ms on the narration clock, or throws. */
function anchorMs(spec, segIndex, segs) {
  if (typeof spec === 'number') return spec;
  let s = String(spec).trim();
  if (/^\d+(\.\d+)?s$/.test(s)) return Math.round(parseFloat(s) * 1000);
  let end = false;
  if (/^end:/i.test(s)) { end = true; s = s.slice(4); }
  let occ = 1;
  const m = /^(.*)#(\d+)$/.exec(s);
  if (m) { s = m[1]; occ = Number(m[2]); }
  const toks = s.split(/\s+/).map(norm).filter(Boolean);
  if (!toks.length) throw new Error(`empty anchor "${spec}"`);
  const order = [segIndex, segIndex + 1, segIndex - 1, ...segs.map((_, i) => i)].filter((i, k, a) => i >= 0 && i < segs.length && a.indexOf(i) === k);
  for (const si of order) {
    const ws = segs[si].parsed;
    let seen = 0;
    for (let i = 0; i + toks.length <= ws.length; i++) {
      if (toks.every((t, k) => ws[i + k].n === t || (t.length >= 4 && ws[i + k].n.startsWith(t)))) {
        if (++seen === occ) return end ? ws[i + toks.length - 1].endMs : ws[i].startMs;
      }
    }
  }
  throw new Error(`anchor "${spec}" is not a word in the transcript (see each segment's "timing")`);
}

function compile(plan) {
  const segs = plan.segments.map((s) => ({...s, parsed: parseTiming(s.timing)}));
  const warnings = [];
  const scenes = [];
  let ambientDir = 1;
  segs.forEach((seg, si) => {
    const actions = [];
    for (const a of seg.actions ?? []) {
      const out = {...a};
      delete out.at; delete out.to; delete out.after;
      try {
        if (a.at !== undefined) out.atMs = anchorMs(a.at, si, segs) + (a.after ?? 0);
        if (a.to !== undefined) { // scroll that ends on a word
          const toMs = anchorMs(a.to, si, segs);
          out.ms = Math.max(400, toMs - (out.atMs ?? seg.startMs));
        }
      } catch (e) { throw new Error(`segment ${seg.id}: ${e.message}`); }
      actions.push(out);
    }
    const dur = seg.endMs - seg.startMs;
    if (!actions.length && seg.ambient !== false && dur >= 2500) {
      // nothing to do while this is being said: a slow scroll so the screen is never frozen (alternates down and up)
      const dy = Math.min(420, Math.round(dur / 10)) * ambientDir;
      actions.push({scroll: dy, atMs: seg.startMs + 200, ms: Math.round(dur * 0.85), _ambient: true});
      ambientDir = -ambientDir;
    }
    scenes.push({goal: seg.intent || seg.said.slice(0, 50), narration: seg.said, actions});
  });
  for (const sc of scenes) for (const a of sc.actions) if (a.atMs != null) a.wordMs = a.atMs;
  // plan backwards from the anchors: a cursor action needs ~1.1 s before the next one (page load + a move that is on its target 260 ms
  // early). If the gap is shorter, press the earlier one a little before its word (up to 450 ms) rather than let the later one land late.
  {
    const cur = scenes.flatMap((sc) => sc.actions).filter((a) => a.atMs != null && ('click' in a || 'hover' in a)).sort((a, b) => a.atMs - b.atMs);
    for (let i = cur.length - 2; i >= 0; i--) {
      const gap = cur[i + 1].atMs - cur[i].atMs;
      const prev = i > 0 ? cur[i - 1].atMs : -Infinity;
      const shift = Math.min(1700 - gap, 600, cur[i].atMs - prev - 1150, cur[i].atMs - 300);
      if (gap < 1700 && shift > 40) { cur[i].wordMs ??= cur[i].atMs; cur[i].atMs -= Math.round(shift); warnings.push(`nudged "${cur[i].click ?? cur[i].hover}" ${Math.round(shift)} ms before its word (the next action is only ${gap} ms later)`); }
    }
  }
  // a click that loads a new page may only wait as long as the next anchored action leaves room for (move >= 500 ms + the lead)
  const anchored = scenes.flatMap((sc) => sc.actions).filter((a) => a.atMs != null).sort((a, b) => a.atMs - b.atMs);
  for (const a of anchored) {
    if (!('click' in a)) continue;
    const next = anchored.find((b) => b.atMs > a.atMs + 50);
    a.settleMs = next ? Math.min(a.atMs + 2500, next.atMs - 260 - 400) : a.atMs + 2500; // absolute narration time up to which the click may wait for the new page
  }
  // pacing sanity: two anchored cursor actions on different things less than ~700 ms apart cannot both land on their words
  const flat = scenes.flatMap((sc, i) => sc.actions.filter((a) => a.atMs != null && ('click' in a || 'hover' in a)).map((a) => ({...a, seg: segs[i].id})));
  flat.sort((a, b) => a.atMs - b.atMs);
  for (let i = 1; i < flat.length; i++) {
    const gap = flat[i].atMs - flat[i - 1].atMs;
    if (gap < 700) warnings.push(`${flat[i - 1].seg} -> ${flat[i].seg}: two cursor actions only ${gap} ms apart; the second will land late. Anchor it to a later word or drop one.`);
  }
  const script = {
    url: plan.url, viewport: plan.viewport, avoid: plan.avoid ?? DEFAULT_AVOID, paced: true,
    endMs: (plan.durationMs ?? segs.at(-1).endMs) + TAIL_MS, settleMs: 1200, // the page's own intro animations (JS-driven ones are invisible to the driver's settle check)
    ...(plan.mobileViewport ? {mobileViewport: plan.mobileViewport} : {}),
    scenes,
  };
  return {script, warnings};
}

// ======================================================================== --auto: map words onto visible links and buttons
function autoActions(plan, ex) {
  const labelsOf = (p) => [...(p?.links ?? []), ...(p?.buttons ?? [])].filter((l) => !l.avoid && norm(l.text).length >= 3 && l.text.length <= 30);
  const home = ex.pages[Object.keys(ex.pages)[0]];
  let current = home;
  const STOP = new Set(['this', 'that', 'here', 'with', 'from', 'your', 'every', 'more', 'what', 'have', 'just', 'like']);
  for (const seg of plan.segments) {
    const ws = parseTiming(seg.timing);
    const used = new Set();
    for (const w of ws) {
      if (STOP.has(w.n) || w.n.length < 4) continue;
      const pool = [...labelsOf(current), ...labelsOf(home)];
      const hit = pool.find((l) => norm(l.text) === w.n || norm(l.text).split(/\s+/).includes(w.n) || (w.n.length >= 5 && norm(l.text).startsWith(w.n)));
      if (!hit || used.has(norm(hit.text))) continue;
      used.add(norm(hit.text));
      seg.actions.push({click: hit.text, at: `${w.text.replace(/[^\p{L}\p{N}%]+$/u, '')}#${ws.filter((x) => x.n === w.n).indexOf(w) + 1}`});
      if (hit.href) { const key = Object.keys(ex.pages).find((k) => k === hit.href || hit.href.endsWith(k)); if (key) current = ex.pages[key]; }
    }
    seg.intent ||= seg.actions.length ? `show ${seg.actions.map((a) => a.click).join(', ')}` : 'ambient';
  }
  plan.status = 'ready';
  plan._auto = 'Actions were guessed from visible link/button labels (--auto). Review them.';
}

// ======================================================================== check
function runCheck(script, label = '') {
  const cdir = path.join(dir, 'check');
  fs.mkdirSync(cdir, {recursive: true});
  const sp = path.join(dir, 'script.json');
  fs.writeFileSync(sp, JSON.stringify(script, null, 2));
  const extra = [];
  if (flags.storage) extra.push('--storage', flags.storage);
  const results = {};
  for (const mobile of flags.vertical ? [false, true] : [false]) {
    const a = [path.join(here, 'drive.mjs'), sp, '--out', cdir, '--check', ...extra, ...(mobile ? ['--mobile'] : [])];
    const endC = prof.phase(`step.check.${mobile ? 'phone' : 'desktop'}`);
    const r = spawnSync('node', a, {stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8'});
    endC();
    if (r.stderr) for (const l of r.stderr.split('\n')) if (/MISSING|refusing|FAILED|WARNING/.test(l)) console.error(l);
    results[mobile ? 'mobile' : 'desktop'] = r.status === 0;
  }
  return results;
}

// ======================================================================== compose (+ the check sheet)
const {resolveQuality, dirSize, mb} = await import(path.join(studio, 'scripts/lib/env.mjs'));
const quality = resolveQuality(flags.quality); // lite | normal | max, auto from this machine (docs/performance.md)
const styleArgs = () => [...(flags.style ? ['--style', flags.style] : []), ...sets.flatMap((s) => ['--set', s]), '--quality', quality.mode, ...(flags.engine ? ['--engine', flags.engine] : [])];
function facecamSets() {
  const o = [];
  const f = (k, v) => v !== undefined && o.push('--set', `facecam.${k}=${v}`);
  f('corner', flags['facecam-corner']); f('shape', flags['facecam-shape']); f('size', flags['facecam-size']); f('border', flags['facecam-border']);
  if (flags['facecam-mirror']) f('mirror', 'true');
  return o;
}
function linkInto(file, d) {
  const to = path.join(d, path.basename(file));
  if (path.resolve(file) === path.resolve(to)) return;
  fs.rmSync(to, {force: true});
  try { fs.linkSync(file, to); } catch { fs.copyFileSync(file, to); }
}

function captionsFor(plan) {
  const out = [];
  const tail = /[^\p{L}\p{N}%]+$/u;
  for (const seg of plan.segments) {
    const ws = parseTiming(seg.timing);
    const mark = new Set(); // word indexes to highlight
    for (const e of seg.emphasize ?? []) {
      const toks = String(e).split(/\s+/).map(norm).filter(Boolean);
      for (let i = 0; i + toks.length <= ws.length; i++) if (toks.every((t, k) => ws[i + k].n === t)) toks.forEach((_, k) => mark.add(i + k));
    }
    const words = ws.map((w, i) => ({text: mark.has(i) ? `*${w.text.replace(tail, '')}*${(tail.exec(w.text) ?? [''])[0]}` : w.text, startMs: w.startMs, endMs: w.endMs}));
    if (words.length) out.push({startMs: words[0].startMs, endMs: words.at(-1).endMs, text: words.map((w) => w.text).join(' '), words});
  }
  return out;
}

async function compose(plan, prep) {
  const takes = [{d: dir, vertical: false}];
  if (fs.existsSync(path.join(dir, 'mobile', 'events.json'))) takes.push({d: path.join(dir, 'mobile'), vertical: true});
  const caps = captionsFor(plan);
  const voiceFile = path.join(dir, plan.voice ?? 'voice.m4a');
  const camFile = plan.facecam && !flags['no-facecam'] ? path.join(dir, plan.facecam) : null;
  const capStyle = flags['captions-style'];
  // one after the other: two native renders side by side share the one hardware encoder and finish no sooner (9.9 s vs 10.2 s
  // for this example, with 1.3x the memory; docs/performance.md "Speed pass")
  const one = async (t) => {
    fs.writeFileSync(path.join(t.d, 'captions.json'), JSON.stringify(caps, null, 2));
    // plan without idle speed-up: output time must equal recording time so the voice and the face-cam stay locked to the screen
    run('node', [path.join(studio, 'dolly.mjs'), 'plan', t.d, '--idle', 'off'], {}, `plan.${t.vertical ? 'phone' : 'desktop'}`);
    linkInto(voiceFile, t.d);
    if (camFile) linkInto(camFile, t.d);
    const common = ['--captions', path.join(t.d, 'captions.json'), '--audio', path.join(t.d, path.basename(voiceFile)), ...(camFile ? ['--facecam', path.join(t.d, path.basename(camFile))] : []),
      '--set', 'idleSpeedup=false', ...(capStyle ? ['--set', `captions.style=${capStyle}`] : [])];
    if (!t.vertical) {
      await runAsync('node', [path.join(studio, 'dolly.mjs'), 'render', t.d, ...styleArgs(), ...common, ...facecamSets(), '--out', path.join(dir, 'out.mp4')], {}, 'render.16x9');
    } else {
      // the phone take is already 9:16: full frame, no synthetic cursor, no auto zoom; the face bubble glides away from the taps
      const phone = ['--set', 'aspect=9:16', '--set', 'fit=crop', '--set', 'padding=0', '--set', 'radius=0', '--set', 'shadow=0', '--set', 'frame=none', '--set', 'cursor.visible=false', '--set', 'zoom.auto=false', '--set', 'facecam.size=0.26'];
      await runAsync('node', [path.join(studio, 'dolly.mjs'), 'render', t.d, ...phone, ...styleArgs(), ...common, ...facecamSets(), '--out', path.join(dir, 'vertical.mp4')], {}, 'render.9x16');
    }
  };
  for (const t of takes) await one(t);
  return takes;
}

function frameAt(video, sec, out, w = 640) {
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, sec)), '-i', video, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '3', out]);
  return fs.existsSync(out);
}

/** A contact sheet with the spoken words under every frame: one card per anchored action (the frame just after it landed) and one
 *  per segment that had none. The word being said at the action is marked. Flags actions that landed late and targets that matched
 *  something other than what the plan named. */
async function makeSheet(plan, video, timingFile, name) {
  const timing = fs.existsSync(timingFile) ? readJson(timingFile) : [];
  const segs = plan.segments.map((s) => ({...s, parsed: parseTiming(s.timing)}));
  const tmp = path.join(dir, `.sheet-${name}`);
  fs.rmSync(tmp, {recursive: true, force: true});
  fs.mkdirSync(tmp, {recursive: true});
  const cards = [];
  const mark = (seg, ms) => {
    const ws = seg.parsed;
    let k = -1;
    ws.forEach((w, i) => { if (w.startMs <= ms + 60) k = i; });
    return ws.map((w, i) => (i === k ? `<b>${w.text}</b>` : w.text)).join(' ');
  };
  const segOf = (ms) => segs.findIndex((s, i) => ms < (segs[i + 1]?.startMs ?? Infinity));
  timing.forEach((t) => {
    if (t.atMs == null || !['click', 'hover', 'scroll', 'type', 'press', 'goto'].includes(t.kind)) return;
    const seg = segs[Math.max(0, segOf(t.atMs))];
    const lateMs = t.wordMs != null ? t.actualMs - t.wordMs : t.lateMs ?? 0; // vs the WORD, even if the plan pressed a little early
    const sec = (t.actualMs + (t.kind === 'click' ? 220 : t.kind === 'scroll' ? Math.min(2200, (t.ms ?? 900) * 0.8) : 150)) / 1000;
    const file = path.join(tmp, `c${cards.length}.jpg`);
    if (!frameAt(video, sec, file)) return;
    const notes = [];
    if (Math.abs(lateMs) > 250) notes.push(`<span class="bad">landed ${lateMs > 0 ? '+' : ''}${lateMs} ms from its word</span>`);
    if (t.kind === 'click' && t.target && t.matched !== undefined && !norm(t.matched).includes(norm(t.target)) && !/^[#.\[]|^text=|^role=|\/\//.test(t.target)) notes.push(`<span class="warn">matched "${t.matched}"</span>`);
    cards.push({file, sec, head: `${(t.atMs / 1000).toFixed(1)} s &middot; ${t.kind}${t.target ? ' "' + t.target + '"' : ''} <span class="d">${lateMs >= 0 ? '+' : ''}${lateMs} ms</span>`, said: mark(seg, t.atMs), notes});
  });
  segs.forEach((seg) => {
    if (timing.some((t) => t.atMs != null && t.atMs >= seg.startMs - 300 && t.atMs <= seg.endMs && !t._ambient)) return; // already has its action card
    const sec = (seg.startMs + seg.endMs) / 2000;
    const file = path.join(tmp, `c${cards.length}.jpg`);
    if (frameAt(video, sec, file)) cards.push({file, sec, head: `${sec.toFixed(1)} s &middot; ${seg.intent || 'no action'}`, said: seg.said, notes: []});
  });
  cards.sort((a, b) => a.sec - b.sec);
  const html = `<!doctype html><meta charset=utf-8><style>
  body{margin:0;background:#0C0C0D;color:#F2F3F4;font:13px/1.35 -apple-system,Figtree,sans-serif;padding:14px}
  .g{display:grid;grid-template-columns:repeat(${name === 'vertical' ? 5 : 3},1fr);gap:12px}
  .c{background:#161718;border-radius:12px;overflow:hidden}.c img{width:100%;display:block}
  .t{padding:8px 10px}.h{font:500 12px ui-monospace,Menlo,monospace;color:#86E4F0}.d{color:#8a8f94}.s{margin-top:4px;font-size:14px}
  .s b{background:#86E4F0;color:#0C0C0D;border-radius:4px;padding:0 3px}.bad{color:#ff8a80}.warn{color:#ffd180}.n{margin-top:4px;font-size:12px}
  </style><div class=g>${cards.map((c) => `<div class=c><img src="file://${c.file}"><div class=t><div class=h>${c.head}</div><div class=s>${c.said}</div>${c.notes.length ? `<div class=n>${c.notes.join(' ')}</div>` : ''}</div></div>`).join('')}</div>`;
  const hp = path.join(tmp, 'sheet.html');
  fs.writeFileSync(hp, html);
  const {chromium} = await import('playwright');
  const b = await chromium.launch({headless: true});
  const pg = await b.newPage({viewport: {width: name === 'vertical' ? 1500 : 1380, height: 800}});
  await pg.goto('file://' + hp);
  await pg.waitForTimeout(400);
  const out = path.join(dir, name === 'vertical' ? 'vertical-sheet.jpg' : 'sheet.jpg');
  await pg.screenshot({path: out, fullPage: true, type: 'jpeg', quality: 85});
  await b.close();
  fs.rmSync(tmp, {recursive: true, force: true});
  const flagged = cards.filter((c) => c.notes.length).length;
  return {out, cards: cards.length, flagged, late: timing.filter((t) => t.lateMs != null && Math.abs(t.lateMs) > 250).length};
}

// ======================================================================== main
if (sub === 'explore') {
  if (!flags.url) die('usage: node narrate.mjs explore --url <url> [--out dir] [--shots] [--storage state.json]');
  const out = flags.out ? dir : path.join(os.tmpdir(), 'dolly-explore');
  const ex = await explore(flags.url, out, {shots: !!flags.shots, storage: flags.storage});
  for (const [p, info] of Object.entries(ex.pages)) {
    console.log(`\n${p}  "${info.title}"`);
    console.log('  headings: ' + info.headings.slice(0, 8).join(' | '));
    console.log('  links:    ' + info.links.slice(0, 25).map((l) => (l.avoid ? '(' + l.text + ')' : l.text)).join(' | '));
    console.log('  buttons:  ' + info.buttons.slice(0, 25).map((b) => (b.avoid ? '(' + b.text + ')' : b.text)).join(' | '));
    if (info.inputs.length) console.log('  inputs:   ' + info.inputs.map((i) => i.placeholder || i.label || i.kind).join(' | '));
  }
  console.log(`\n(items in parentheses match the avoid list and will not be touched)\nsaved ${path.join(out, 'explore.json')}`);
  process.exit(0);
}

if (sub === 'check' || sub === 'compose') {
  if (!fs.existsSync(planPath)) die(`no ${planPath}`);
  const plan = readJson(planPath);
  if (sub === 'check') {
    const {script, warnings} = compile(plan);
    warnings.forEach((w) => console.log('WARN ' + w));
    const r = runCheck(script);
    process.exit(Object.values(r).every(Boolean) ? 0 : 2);
  }
  await compose(plan);
  const s1 = await makeSheet(plan, path.join(dir, 'out.mp4'), path.join(dir, 'timing.json'), 'sheet');
  console.log(`sheet: ${s1.out}`);
  if (fs.existsSync(path.join(dir, 'vertical.mp4'))) console.log(`vertical sheet: ${(await makeSheet(plan, path.join(dir, 'vertical.mp4'), path.join(dir, 'mobile', 'timing.json'), 'vertical')).out}`);
  process.exit(0);
}

// ---- plan / all
if (!flags.voice || !flags.url) die('usage: node narrate.mjs --voice <audio|video file> --url <product url> [--out dir] [--vertical] [--auto]   (see the header of this file)');
if (!fs.existsSync(planPath) || flags.fresh) {
  const prep = prepareInputs();
  const plan = skeletonPlan(prep);
  if (flags.auto || sub === 'plan') {
    log('exploring the product to suggest actions...');
    const ex = await explore(flags.url, dir, {storage: flags.storage});
    if (flags.auto) autoActions(plan, ex);
    else plan._explore = 'explore.json lists what is on the product';
  }
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(`\nwrote ${planPath}  (${plan.segments.length} segments, ${(plan.durationMs / 1000).toFixed(1)} s)`);
  if (!flags.auto) {
    console.log('Fill in each segment\'s "actions" (SKILL.md, Narrate), set "status": "ready", then run the same command again.');
    process.exit(sub === 'plan' ? 0 : 3);
  }
}
const plan = readJson(planPath);
if (plan.status !== 'ready' && !flags.force) die(`${planPath} has status "${plan.status}". Edit it and set "status": "ready" (or pass --force).`, 3);
const prep = prepareInputs();
if (sub === 'plan') process.exit(0);

// 1. compile + check
const {script, warnings} = compile(plan);
warnings.forEach((w) => console.log('WARN ' + w));
const scriptPath = path.join(dir, 'script.json');
fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
log('checking every target in headless Chromium (nothing recorded)...');
const chk = runCheck(script);
if (!Object.values(chk).every(Boolean) && !flags.force) die(`the check found problems (see above and ${dir}/check/). Fix the plan, or pass --force.`, 2);

// 2. record, paced to the words
const dflags = [];
for (const k of ['dsf', 'capture', 'pos', 'viewport', 'storage']) if (flags[k]) dflags.push(`--${k}`, flags[k]);
dflags.push('--quality', quality.mode);
log('recording: a Chromium window plays for about ' + Math.round(script.endMs / 1000 + 8) + ' s on this screen (only that window is captured)');
{
  const desk = () => runAsync('node', [path.join(here, 'drive.mjs'), scriptPath, '--out', dir, ...dflags], {}, 'take.desktop');
  const phone = () => runAsync('node', [path.join(here, 'drive.mjs'), scriptPath, '--out', path.join(dir, 'mobile'), '--mobile', ...dflags.filter((x, i, a) => !(a[i - 1] === '--viewport' || x === '--viewport'))], {}, 'take.phone');
  // two headless (smooth) takes can record side by side in normal / max; a window capture records a real window, one at a time
  if (flags.vertical && flags.capture === 'smooth' && quality.mode !== 'lite' && flags.sequential !== 'true') await Promise.all([desk(), phone()]);
  else { await desk(); if (flags.vertical) await phone(); }
}

// 3. compose + 4. check sheets
await compose(plan);
const outs = [path.join(dir, 'out.mp4')];
const sheetInfo = [await makeSheet(plan, path.join(dir, 'out.mp4'), path.join(dir, 'timing.json'), 'sheet')];
if (flags.vertical && fs.existsSync(path.join(dir, 'vertical.mp4'))) {
  outs.push(path.join(dir, 'vertical.mp4'));
  sheetInfo.push(await makeSheet(plan, path.join(dir, 'vertical.mp4'), path.join(dir, 'mobile', 'timing.json'), 'vertical'));
}
const lo = loudness(path.join(dir, 'out.mp4'));
console.log(`disk: ${mb(dirSize(dir))} in ${dir}`);
console.log(`\ndone: ${outs.join(', ')}${lo ? `   (audio ${lo.lufs} LUFS)` : ''}`);
for (const s of sheetInfo) console.log(`sheet: ${s.out}  ${s.cards} cards, ${s.late} action(s) landed >250 ms from their word, ${s.flagged} flagged`);
console.log('LOOK at the sheet: the highlighted word under each frame is what was being said when that action landed.');
