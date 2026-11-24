// Synthesised UI sounds for Spotlight: hover tick, press, release, toggle, open / close whoosh, success chime, key tick.
// Procedural and deterministic (seeded noise, no samples), written to a wav in node. Mixed at a tasteful level: the loudest
// event peaks around -9 dBFS and nothing is harsh (the top end is rolled off).

const SR = 48000;
export type SoundMode = 'off' | 'subtle' | 'full';
export interface SoundEvent {tMs: number; kind: string}

const mulberry = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

class Biquad {
  b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0; x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  set(type: 'bp' | 'lp' | 'hp', f: number, q: number) {
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; } else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; } else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  p(x: number) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}

const env = (t: number, att: number, dec: number) => (t < att ? Math.sin((t / att) * Math.PI / 2) : Math.exp(-(t - att) / dec));

/** One sound as mono samples, peak about 1 before gain. */
function voice(kind: string, rnd: () => number): Float32Array {
  const dur = ({tick: 0.06, press: 0.14, release: 0.07, toggle: 0.2, open: 0.44, close: 0.32, success: 1.0, key: 0.05} as Record<string, number>)[kind] ?? 0.1;
  const n = Math.floor(dur * SR), o = new Float32Array(n);
  const bp = new Biquad(), lp = new Biquad().set('lp', 9000, 0.7);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, noise = rnd() * 2 - 1;
    let v = 0;
    switch (kind) {
      case 'tick': {
        v = bp.set('bp', 3400, 2.2).p(noise) * 1.2 * env(t, 0.0004, 0.003);
        ph += (2 * Math.PI * 2300) / SR; v += Math.sin(ph) * 0.45 * env(t, 0.0005, 0.007);
        break;
      }
      case 'press': {
        const f = 90 + 130 * Math.exp(-t / 0.026); ph += (2 * Math.PI * f) / SR;
        v = Math.sin(ph) * 0.95 * env(t, 0.0008, 0.034) + bp.set('bp', 1900, 1.6).p(noise) * 0.85 * env(t, 0.0003, 0.0035);
        break;
      }
      case 'release': {
        const f = 900 + 520 * Math.exp(-t / 0.012); ph += (2 * Math.PI * f) / SR;
        v = Math.sin(ph) * 0.5 * env(t, 0.0005, 0.011) + bp.set('bp', 4200, 2).p(noise) * 0.4 * env(t, 0.0003, 0.002);
        break;
      }
      case 'toggle': {
        const a = t, b = t - 0.058;
        ph += (2 * Math.PI * 560) / SR; ph2 += (2 * Math.PI * 840) / SR;
        v = Math.sin(ph) * 0.8 * env(a, 0.001, 0.02) + (b > 0 ? Math.sin(ph2) * 0.8 * env(b, 0.001, 0.028) : 0) + bp.set('bp', 2600, 1.4).p(noise) * 0.25 * (env(a, 0.0003, 0.003) + (b > 0 ? env(b, 0.0003, 0.003) : 0));
        break;
      }
      case 'open': { // airy swell, sweeping up, with a soft low bloop
        const k = Math.min(1, t / 0.26), f = 500 * Math.pow(6.4, k);
        v = bp.set('bp', f, 0.9).p(noise) * 2.2 * (t < 0.15 ? Math.pow(Math.sin((t / 0.15) * Math.PI / 2), 2) : Math.exp(-(t - 0.15) / 0.09));
        ph += (2 * Math.PI * (330 + 110 * Math.min(1, t / 0.12))) / SR; v += Math.sin(ph) * 0.45 * env(t, 0.004, 0.05);
        break;
      }
      case 'close': {
        const k = Math.min(1, t / 0.2), f = 3000 * Math.pow(0.17, k);
        v = bp.set('bp', f, 0.9).p(noise) * 2.0 * env(t, 0.018, 0.075);
        ph += (2 * Math.PI * (430 - 120 * Math.min(1, t / 0.12))) / SR; v += Math.sin(ph) * 0.4 * env(t, 0.003, 0.045);
        break;
      }
      case 'success': { // a soft major triad, staggered, with a little second harmonic
        const notes = [[880, 0], [1108.7, 0.07], [1318.5, 0.14]];
        for (let q = 0; q < notes.length; q++) {
          const tt = t - notes[q][1]; if (tt < 0) continue;
          const f = notes[q][0], e = env(tt, 0.004, 0.24 - q * 0.02);
          v += (Math.sin(2 * Math.PI * f * tt) + 0.22 * Math.sin(2 * Math.PI * f * 2 * tt) + 0.06 * Math.sin(2 * Math.PI * f * 3 * tt)) * 0.42 * e;
        }
        break;
      }
      case 'key': {
        const f = 1500 + 800 * (rnd() * 0 + 0.5);
        ph += (2 * Math.PI * f) / SR; v = bp.set('bp', 2800, 1.8).p(noise) * 0.9 * env(t, 0.0003, 0.0025) + Math.sin(ph) * 0.2 * env(t, 0.0004, 0.004);
        break;
      }
    }
    o[i] = lp.p(v);
  }
  return o;
}

const GAIN: Record<string, number> = {tick: 0.2, press: 0.46, release: 0.2, toggle: 0.4, open: 0.34, close: 0.28, success: 0.3, key: 0.14};

/** Mix the events onto a stereo timeline of `durationMs`. `events[].tMs` is output time. */
export function renderSounds(events: SoundEvent[], durationMs: number, mode: SoundMode, seed = 1): {left: Float32Array; right: Float32Array} {
  const n = Math.ceil((durationMs / 1000 + 0.6) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  if (mode === 'off') return {left: L, right: R};
  const master = mode === 'subtle' ? 0.55 : 1;
  const skip = mode === 'subtle' ? new Set(['release', 'key', 'tick']) : new Set<string>();
  const last: Record<string, number> = {};
  const rnd = mulberry(seed);
  for (const e of [...events].sort((a, b) => a.tMs - b.tMs)) {
    if (skip.has(e.kind) || !GAIN[e.kind]) continue;
    if (last[e.kind] !== undefined && e.tMs - last[e.kind] < (e.kind === 'key' ? 30 : 60)) continue;
    last[e.kind] = e.tMs;
    const v = voice(e.kind, mulberry(Math.floor(e.tMs * 7) + seed));
    const pan = (rnd() - 0.5) * 0.24, gl = Math.cos((pan + 0.5) * Math.PI / 2) * 1.414 * 0.75, gr = Math.sin((pan + 0.5) * Math.PI / 2) * 1.414 * 0.75;
    const g = GAIN[e.kind] * master * (0.92 + rnd() * 0.16);
    const start = Math.max(0, Math.floor((e.tMs / 1000) * SR));
    for (let i = 0; i < v.length && start + i < n; i++) { L[start + i] += v[i] * g * gl; R[start + i] += v[i] * g * gr; }
  }
  // gentle soft clip and a ceiling at about -4 dBFS
  for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * 1.1) * 0.85; R[i] = Math.tanh(R[i] * 1.1) * 0.85; }
  return {left: L, right: R};
}

export function wavBytes(l: Float32Array, r: Float32Array): Buffer {
  const n = l.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), 44 + i * 4); buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), 46 + i * 4); }
  return buf;
}
