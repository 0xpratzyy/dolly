// Dolly phase profiler. Off unless DOLLY_PROFILE names a file (make.mjs / narrate.mjs / spotlight set it for `--profile`).
// Every process of a run (make, smooth capture, dolly plan/render, stills) appends one JSON line per phase to that file:
//   {"name": "capture.shot", "ms": 1234.5, "n": 600, "pid": 123, "proc": "smooth", "t": <epoch ms at the end>}
// writeProfile() folds the lines into profile.json: wall time per phase, the run's total and the peak memory of the process tree.
import fs from 'node:fs';
import {execFile} from 'node:child_process';

const FILE = process.env.DOLLY_PROFILE || '';
export const profiling = !!FILE;
const PROC = process.env.DOLLY_PROFILE_PROC || process.argv[1]?.split('/').pop()?.replace(/\.m?js$/, '') || 'node';

/** Append one phase (ms of wall time; n = how many times it ran when it is a sum, e.g. per frame). */
export function record(name, ms, extra = {}) {
  if (!FILE) return;
  try { fs.appendFileSync(FILE, JSON.stringify({name, ms: Math.round(ms * 10) / 10, pid: process.pid, proc: PROC, t: Date.now(), ...extra}) + '\n'); } catch {}
}
/** Start a phase; call the returned function to end it. */
export function phase(name, extra) {
  const t0 = performance.now();
  return (more) => record(name, performance.now() - t0, {...extra, ...more});
}
/** Time an async function as one phase. */
export async function timed(name, fn, extra) {
  const end = phase(name, extra);
  try { return await fn(); } finally { end(); }
}
/** Sums for hot loops (per frame): acc.add('shot', ms) ... acc.flush('capture.') writes one line per key with its count. */
export function accumulator() {
  const sum = new Map(), cnt = new Map();
  return {
    add(k, ms) { sum.set(k, (sum.get(k) ?? 0) + ms); cnt.set(k, (cnt.get(k) ?? 0) + 1); },
    async time(k, p) { const t0 = performance.now(); try { return await p; } finally { this.add(k, performance.now() - t0); } },
    flush(prefix = '') { for (const [k, v] of sum) record(prefix + k, v, {n: cnt.get(k)}); sum.clear(); cnt.clear(); },
  };
}

/** Sample the summed RSS of this process and all its descendants every `everyMs`; stop() returns the peak in bytes. */
export function treeMemory(everyMs = 250) {
  let peak = 0, stopped = false, timer;
  const tick = () => {
    execFile('ps', ['-axo', 'pid=,ppid=,rss='], {maxBuffer: 8 << 20}, (err, out) => {
      if (!err) {
        const kids = new Map(), rss = new Map();
        for (const line of out.split('\n')) {
          const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
          if (!pid) continue;
          rss.set(pid, kb * 1024);
          if (!kids.has(ppid)) kids.set(ppid, []);
          kids.get(ppid).push(pid);
        }
        let sum = 0;
        const stack = [process.pid];
        while (stack.length) { const p = stack.pop(); sum += rss.get(p) ?? 0; stack.push(...(kids.get(p) ?? [])); }
        peak = Math.max(peak, sum);
      }
      if (!stopped) { timer = setTimeout(tick, everyMs); timer.unref?.(); } // never keeps the process alive
    });
  };
  tick();
  return {stop() { stopped = true; clearTimeout(timer); return peak; }, get peak() { return peak; }};
}

/** Fold the JSON lines of `file` into `out` (profile.json). */
export function writeProfile(file, out, {totalMs, peakRss, meta = {}} = {}) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  const phases = lines.map(({name, ms, n, proc, ...rest}) => ({name, ms, ...(n ? {n, perMs: Math.round((ms / n) * 100) / 100} : {}), proc, ...Object.fromEntries(Object.entries(rest).filter(([k]) => !['pid', 't'].includes(k)))}));
  const json = {...meta, totalMs: Math.round(totalMs ?? 0), peakRssMB: peakRss ? Math.round(peakRss / 2 ** 20) : undefined, phases};
  fs.writeFileSync(out, JSON.stringify(json, null, 2));
  return json;
}

/** One line per phase, for the console. */
export function printProfile(json, log = console.log) {
  log(`\nprofile: ${(json.totalMs / 1000).toFixed(1)} s total, peak memory ${json.peakRssMB ?? '?'} MB`);
  for (const p of json.phases) log(`  ${p.name.padEnd(34)} ${(p.ms / 1000).toFixed(2).padStart(7)} s${p.n ? `  (${p.n} x ${p.perMs} ms)` : ''}${p.proc ? `  [${p.proc}]` : ''}`);
}
