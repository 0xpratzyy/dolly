// UI sounds for Spotlight and the demo renderer: real recorded clicks only (a mouse button's press and release, a key
// tap). No synthesised whooshes, chimes or hover ticks: a capture's other sound hints (tick, open, close, toggle,
// success) are ignored. The samples are CC0 recordings in ../assets/sounds (see CREDITS.md there), mono 48 kHz,
// trimmed and peak-normalised; they are mixed quietly, with a little per-click variation in level, pitch and pan so
// repeated clicks don't sound machine-gunned.

const SR = 48000;
export type SoundMode = 'off' | 'subtle' | 'full';
export interface SoundEvent {tMs: number; kind: string}

const mulberry = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** The sample each event kind plays, and its level before the mode's master gain. Anything else is silent. */
const KINDS: Record<string, {file: string; gain: number}> = {
  // press and release are cut from one recording and keep their natural balance (the release ~10 dB softer)
  press: {file: 'press.wav', gain: 0.45},
  release: {file: 'release.wav', gain: 0.45},
  key: {file: 'key.wav', gain: 0.2},
};

const cache = new Map<string, Float32Array>();
/** A 16-bit mono 48 kHz wav from assets/sounds as floats (read once). */
function sample(file: string): Float32Array {
  const hit = cache.get(file);
  if (hit) return hit;
  // node only (the renderers run there); getBuiltinModule keeps this file importable by the browser bundle
  const fs = (process as unknown as {getBuiltinModule(id: string): typeof import('node:fs')}).getBuiltinModule('node:fs');
  const buf = fs.readFileSync(new URL(`../assets/sounds/${file}`, import.meta.url));
  let off = 12, data: Buffer | undefined;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'data') { data = buf.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size & 1);
  }
  if (!data) throw new Error(`no audio data in ${file}`);
  const out = new Float32Array(data.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  cache.set(file, out);
  return out;
}

/** Mix the events onto a stereo timeline of `durationMs`. `events[].tMs` is output time. */
export function renderSounds(events: SoundEvent[], durationMs: number, mode: SoundMode, seed = 1): {left: Float32Array; right: Float32Array} {
  const n = Math.ceil((durationMs / 1000 + 0.6) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  if (mode === 'off') return {left: L, right: R};
  const master = mode === 'subtle' ? 0.6 : 1;
  const last: Record<string, number> = {};
  const rnd = mulberry(seed);
  for (const e of [...events].sort((a, b) => a.tMs - b.tMs)) {
    const k = KINDS[e.kind];
    if (!k) continue;
    // a burst of identical events (key repeat, a drag's repeated presses) plays once per 30-60 ms
    if (last[e.kind] !== undefined && e.tMs - last[e.kind] < (e.kind === 'key' ? 30 : 60)) continue;
    last[e.kind] = e.tMs;
    const v = sample(k.file);
    const rate = 0.96 + rnd() * 0.08; // ±4 % pitch, by resampling
    const pan = (rnd() - 0.5) * 0.2, gl = Math.cos((pan + 0.5) * Math.PI / 2) * 1.414, gr = Math.sin((pan + 0.5) * Math.PI / 2) * 1.414;
    const g = k.gain * master * (0.9 + rnd() * 0.2);
    const start = Math.max(0, Math.floor((e.tMs / 1000) * SR));
    const len = Math.floor((v.length - 1) / rate);
    for (let i = 0; i < len && start + i < n; i++) {
      const p = i * rate, j = Math.floor(p), f = p - j, s = v[j] + (v[j + 1] - v[j]) * f;
      L[start + i] += s * g * gl;
      R[start + i] += s * g * gr;
    }
  }
  // a ceiling at about -3 dBFS for the rare pile-up (a press landing on a key tap)
  for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i]) * 0.7; R[i] = Math.tanh(R[i]) * 0.7; }
  return {left: L, right: R};
}

export function wavBytes(l: Float32Array, r: Float32Array): Buffer {
  const n = l.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), 44 + i * 4); buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), 46 + i * 4); }
  return buf;
}
