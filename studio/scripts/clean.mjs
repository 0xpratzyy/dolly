#!/usr/bin/env node
// node studio/dolly.mjs clean [--dry-run] [--older-than <days, default 14>] [--runs <dir> ...] [--no-runs]
// Reports what Dolly keeps on disk and frees it:
//   - Dolly's own caches and temp files are deleted (they are rebuilt on demand):
//       studio/.cache (caption stills, still bundle), studio/node_modules/.cache (Remotion's webpack cache),
//       studio/node_modules/.remotion (Remotion's own Chrome download, unused once Playwright's headless shell is found),
//       temp dirs in the system temp folder: dolly-* older than an hour, Remotion's leftovers (remotion-*, react-motion-*) older than a day,
//       leftovers inside run folders (.public-*, .sp-public-*, .sheet-tmp, .props.tmp, .spec-*.tmp) and PNG frames of a
//       Spotlight capture that already has its frames.webm;
//   - old runs (folders under autopilot/runs and any --runs <dir>, untouched for --older-than days) are MOVED TO THE TRASH,
//     never deleted: open the Trash to get one back.
// --dry-run only prints.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {dirSize, headlessShell, mb, studioDir} from './lib/env.mjs';

const argv = process.argv.slice(2).filter((a) => a !== 'clean');
const dry = argv.includes('--dry-run');
const days = Number(argv[argv.indexOf('--older-than') + 1]) > 0 && argv.includes('--older-than') ? Number(argv[argv.indexOf('--older-than') + 1]) : 14;
const runRoots = [path.join(studioDir, '../autopilot/runs')];
argv.forEach((a, i) => { if (a === '--runs' && argv[i + 1]) runRoots.push(path.resolve(argv[i + 1])); });
const noRuns = argv.includes('--no-runs');
const now = Date.now();
let freed = 0, trashed = 0;
const rows = [];

const del = (p, what) => {
  if (!fs.existsSync(p)) return;
  const size = dirSize(p);
  rows.push([dry ? 'would delete' : 'deleted', mb(size), what, p]);
  freed += size;
  if (!dry) fs.rmSync(p, {recursive: true, force: true});
};
const trash = (p, what) => {
  const size = dirSize(p);
  rows.push([dry ? 'would trash' : 'trashed', mb(size), what, p]);
  trashed += size;
  if (dry) return;
  const bin = path.join(os.homedir(), '.Trash');
  let to = path.join(bin, path.basename(p));
  if (fs.existsSync(to)) to = path.join(bin, `${path.basename(p)} ${new Date().toISOString().replace(/[:.]/g, '-')}`);
  try { fs.renameSync(p, to); } catch (e) { rows.push(['skipped', '', `cannot move to the Trash (${e.code ?? e.message}); left in place`, p]); trashed -= size; }
};
const newest = (p) => { // latest change anywhere inside
  let t = 0;
  try { const st = fs.lstatSync(p); t = st.mtimeMs; if (st.isDirectory()) for (const e of fs.readdirSync(p)) t = Math.max(t, newest(path.join(p, e))); } catch { /* gone */ }
  return t;
};

// ---- caches (Dolly's own, rebuilt on demand)
del(path.join(studioDir, '.cache'), 'caption stills + still bundle');
del(path.join(studioDir, 'node_modules/.cache'), "Remotion's webpack cache");
if (headlessShell()) del(path.join(studioDir, 'node_modules/.remotion'), "Remotion's own Chrome (unused: Playwright's headless shell is used)");
else rows.push(['kept', mb(dirSize(path.join(studioDir, 'node_modules/.remotion'))), "Remotion's Chrome (no Playwright headless shell found: run `npx playwright install chromium` in autopilot/)", path.join(studioDir, 'node_modules/.remotion')]);

// ---- temp dirs in the system temp folder, older than an hour (a render may be running)
for (const base of new Set([os.tmpdir(), '/tmp'])) {
  let list = [];
  try { list = fs.readdirSync(base); } catch { continue; }
  for (const e of list) {
    const mine = /^(dolly-drive-|dolly-remotion-|dolly-explore$|dolly-spec-)/.test(e), remotion = /^(remotion-webpack-bundle-|remotion-v[\d.]+-assets|react-motion-render)/.test(e);
    if (!mine && !remotion) continue;
    const p = path.join(base, e);
    // Remotion's own leftovers (older Dolly runs made them; any Remotion project can) only when a day old
    if (now - newest(p) > (mine ? 3600e3 : 86400e3)) del(p, mine ? 'temp' : 'Remotion temp, over a day old');
  }
}

// ---- run folders: leftovers, and old runs to the Trash
const leftovers = (d, depth = 0) => {
  let list = [];
  try { list = fs.readdirSync(d, {withFileTypes: true}); } catch { return; }
  for (const e of list) {
    const p = path.join(d, e.name);
    if (/^(\.public-|\.sp-public-|\.sheet-tmp$)/.test(e.name) && e.isDirectory()) { if (now - newest(p) > 3600e3) del(p, 'leftover temp'); continue; }
    if (/^(\.props\.tmp|\.spec-\d+\.tmp)$/.test(e.name)) { if (now - newest(p) > 3600e3) del(p, 'leftover temp'); continue; }
    if (e.name === 'frames' && e.isDirectory() && fs.existsSync(path.join(d, 'frames.webm')) && fs.existsSync(path.join(d, 'spotlight.json'))) { del(p, 'PNG frames (frames.webm exists)'); continue; }
    if (e.isDirectory() && depth < 3 && e.name !== 'node_modules') leftovers(p, depth + 1);
  }
};
for (const root of runRoots) {
  if (!fs.existsSync(root)) continue;
  for (const e of fs.readdirSync(root, {withFileTypes: true})) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    const age = (now - newest(p)) / 86400e3;
    if (!noRuns && age > days) trash(p, `run, untouched for ${Math.round(age)} days`);
    else { leftovers(p); rows.push(['kept', mb(dirSize(p)), `run, ${age < 1 ? 'used today' : `${Math.round(age)} days old`}`, p]); }
  }
}

const w = [Math.max(...rows.map((r) => r[0].length), 4), Math.max(...rows.map((r) => r[1].length), 4)];
for (const r of rows) console.log(`${r[0].padEnd(w[0])}  ${r[1].padStart(w[1])}  ${r[3]}  (${r[2]})`);
console.log(`\n${dry ? 'would free' : 'freed'} ${mb(freed)}${trashed ? `, ${dry ? 'would move' : 'moved'} ${mb(trashed)} of old runs to the Trash` : ''}.${dry ? ' Run without --dry-run to do it.' : ''}`);
