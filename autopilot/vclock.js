// Dolly virtual clock for whole-page capture (autopilot/smooth.mjs). Injected before any page script (addInitScript), plain script.
// Date, performance.now, setTimeout/Interval, requestAnimationFrame, requestIdleCallback, every CSS transition / CSS animation /
// Web Animation and every <video>/<audio> advance ONLY when the driver calls __vt.step(dt). One step = one captured frame, so the
// recording is exactly 60 fps whatever the machine, the network or the screenshot cost. Same clock as spotlight/inject.js (kept in
// sync by hand: this file is that clock without the component isolation, plus media and a "busy" signal).
(() => {
  if (window.__vt) return;
  const realSetTimeout = window.setTimeout.bind(window);
  let markT = 0;
  const EPOCH = 1767225600000; // 2026-01-01T00:00:00Z, fixed so Date is deterministic
  const realNow = performance.now.bind(performance);
  const RealDate = Date;
  let vnow = 0; // virtual ms since page start
  let seq = 1;
  const timers = new Map(); // id -> {t, fn, args, every}
  let rafQ = [];
  let rafId = 1;
  let virtual = true;

  // ---- seeded random
  let rs = 0x9e3779b9;
  const rnd = () => { rs |= 0; rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  Math.random = rnd;

  // ---- clock overrides
  performance.now = () => vnow;
  class VDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(EPOCH + vnow); else super(...a); }
    static now() { return EPOCH + vnow; }
  }
  window.Date = VDate;
  const addTimer = (fn, ms, args, every) => {
    if (typeof fn !== 'function') { const src = String(fn); fn = () => (0, eval)(src); }
    const id = seq++;
    const d = Math.max(0, Number(ms) || 0);
    timers.set(id, {t: vnow + (every ? Math.max(1, d) : d), fn, args: args || [], every: every ? Math.max(1, d) : 0, id});
    return id;
  };
  window.setTimeout = (fn, ms, ...a) => addTimer(fn, ms, a, false);
  window.setInterval = (fn, ms, ...a) => addTimer(fn, ms, a, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (cb) => { const id = rafId++; rafQ.push({id, cb}); return id; };
  window.cancelAnimationFrame = (id) => { rafQ = rafQ.filter((r) => r.id !== id); };
  window.requestIdleCallback = (cb) => addTimer(() => cb({didTimeout: false, timeRemaining: () => 8}), 1, [], false);
  window.cancelIdleCallback = (id) => timers.delete(id);

  // ---- "did anything visible change?" (smooth.mjs skips the screenshot of a frame where nothing did and repeats the last one).
  // Conservative: any DOM mutation, an animation that moved, playing media, a canvas page running rAF, a load / scroll / font event.
  let dirty = true;
  let muts = 0; // mutation records so far: part of the frame fingerprint two capture workers compare (smooth.mjs --workers)
  const mo = new MutationObserver((rs) => { dirty = true; muts += rs.length; });
  const observe = () => { try { mo.observe(document, {subtree: true, childList: true, attributes: true, characterData: true}); } catch {} };
  if (document.documentElement) observe(); else document.addEventListener('DOMContentLoaded', observe);
  const touch = () => { dirty = true; };
  for (const e of ['load', 'scroll', 'error', 'input', 'focus', 'blur', 'transitionrun', 'animationstart', 'toggle']) window.addEventListener(e, touch, true);
  try { document.fonts && document.fonts.addEventListener('loadingdone', touch); } catch {}

  // ---- animations (CSS transitions, CSS animations, WAAPI): paused and seeked from the virtual clock
  const AM = new WeakMap();
  const moved = new Set(); // animations that changed this step: they only count as a visible change when on screen (onScreen below)
  const live = new Set(); // animations still running (finite ones make the page "busy")
  const syncAnims = () => {
    let all;
    try { all = document.getAnimations(); } catch { return; }
    for (const a of all) {
      let r = AM.get(a);
      if (!r) {
        const ct = typeof a.currentTime === 'number' ? a.currentTime : (a.currentTime && a.currentTime.value) || 0;
        r = {t0: vnow - ct, done: false};
        AM.set(a, r); live.add(a);
        try { a.pause(); } catch {}
      }
      if (r.done) { live.delete(a); continue; }
      if (a.playState === 'finished') { r.done = true; live.delete(a); continue; }
      let end = Infinity;
      try { end = a.effect.getComputedTiming().endTime; } catch {}
      const rate = a.playbackRate || 1;
      const t = (vnow - r.t0) * rate;
      try {
        if (rate > 0 && Number.isFinite(end) && t >= end) { a.currentTime = end; a.finish(); r.done = true; moved.add(a); }
        else if (rate < 0 && t <= 0) { a.currentTime = 0; a.finish(); r.done = true; moved.add(a); }
        else { const c = Math.max(0, t); if (r.last !== c) { r.last = c; moved.add(a); } a.currentTime = c; }
      } catch {}
    }
  };

  const runDueTimers = (target) => {
    let guard = 0;
    for (;;) {
      let best = null;
      for (const tm of timers.values()) if (tm.t <= target && (!best || tm.t < best.t || (tm.t === best.t && tm.id < best.id))) best = tm;
      if (!best || ++guard > 5000) break;
      vnow = Math.max(vnow, best.t);
      if (best.every) best.t += best.every; else timers.delete(best.id);
      try { best.fn(...best.args); } catch (e) { console.error('[sp timer]', e); }
    }
  };


  // An element counts as on screen if its box meets the viewport now or did at the last check (so leaving the screen is a change).
  // Elements are only measured on a frame that is otherwise unchanged; a box that cannot be measured counts as on screen.
  const seen = new WeakMap(); // element -> was on screen at the last check
  const onScreen = (el) => {
    if (!el || !el.getBoundingClientRect) return true;
    let vis = true;
    try { const b = el.getBoundingClientRect(); vis = b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight && (b.width > 0 || b.height > 0); } catch {}
    const was = seen.get(el);
    seen.set(el, vis);
    return vis || was !== false;
  };

  const inView = (el) => {
    try { const b = el.getBoundingClientRect(); return b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight && b.width > 0 && b.height > 0; } catch { return true; }
  };

  // ---- media: a playing <video>/<audio> is paused for real and seeked to the virtual time on every step
  const MS = new WeakMap();
  const media = new Set();
  const HME = window.HTMLMediaElement && HTMLMediaElement.prototype;
  const st = (el) => { let s = MS.get(el); if (!s) { s = {playing: false, t0: 0, last: -1}; MS.set(el, s); } return s; };
  let realPlay, realPause, pausedGet;
  if (HME) {
    realPlay = HME.play; realPause = HME.pause;
    pausedGet = Object.getOwnPropertyDescriptor(HME, 'paused').get;
    const start = (el) => { const s = st(el); s.playing = true; s.t0 = vnow - (el.currentTime * 1000) / (el.playbackRate || 1); s.last = s.applied = el.currentTime; media.add(el); };
    HME.play = function () {
      if (!st(this).playing) { start(this); try { this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); } catch {} }
      return Promise.resolve();
    };
    HME.pause = function () {
      const s = st(this);
      if (s.playing) { s.playing = false; try { this.dispatchEvent(new Event('pause')); } catch {} }
      try { realPause.call(this); } catch {}
    };
    Object.defineProperty(HME, 'paused', {configurable: true, get() { return !st(this).playing; }});
    HME.__vtStart = start;
  }
  const syncMedia = () => {
    if (!HME) return [];
    // media the browser started by itself (autoplay): take it over
    for (const el of document.querySelectorAll('video, audio')) {
      if (!media.has(el) && !pausedGet.call(el)) { try { realPause.call(el); } catch {} HME.__vtStart(el); }
    }
    const seeking = [];
    for (const el of media) {
      const s = st(el);
      if (!el.isConnected) { media.delete(el); continue; }
      if (!s.playing) continue;
      const rate = el.playbackRate || 1, dur = el.duration;
      if (Math.abs(el.currentTime - (s.applied ?? s.last)) > 0.08) s.t0 = vnow - (el.currentTime * 1000) / rate; // the page seeked it
      let t = ((vnow - s.t0) / 1000) * rate;
      if (Number.isFinite(dur) && dur > 0) {
        if (el.loop) t %= dur;
        else if (t >= dur) { t = dur; s.playing = false; try { el.dispatchEvent(new Event('ended')); } catch {} }
      }
      // A video off screen is not seeked (a seek decodes a frame: ~8 ms a step); it catches up when it comes back into view. Audio is
      // seeked but never waited for: it is not recorded.
      const isVideo = el.tagName === 'VIDEO';
      if (isVideo && !inView(el)) { s.last = t; try { el.dispatchEvent(new Event('timeupdate')); } catch {} continue; }
      if (Math.abs(el.currentTime - t) > 0.004) { try { el.currentTime = t; s.applied = t; if (isVideo) seeking.push(el); } catch {} }
      s.last = t;
      try { el.dispatchEvent(new Event('timeupdate')); } catch {}
    }
    return seeking;
  };
  // wait for every seeked element's frame: woken by its 'seeked' / 'loadeddata' event (polling every 4 ms cost ~10 ms a step on a page
  // with one playing video), at most 400 ms
  const ready = (el) => !el.seeking && el.readyState >= 2;
  const mediaReady = (els) => new Promise((res) => {
    let left = els.filter((el) => !ready(el));
    if (!left.length) return res();
    let over = false;
    const finish = () => { if (over) return; over = true; for (const el of els) for (const e of ['seeked', 'loadeddata', 'canplay', 'error']) el.removeEventListener(e, check); res(); };
    const check = () => { left = left.filter((el) => !ready(el)); if (!left.length) finish(); };
    for (const el of left) for (const e of ['seeked', 'loadeddata', 'canplay', 'error']) el.addEventListener(e, check);
    realSetTimeout(finish, 400);
    check();
  });

  const style = document.createElement('style');
  style.textContent = 'html{scroll-behavior:auto!important}';
  const addStyle = () => { try { (document.head || document.documentElement).appendChild(style); } catch {} };
  if (document.documentElement) addStyle(); else document.addEventListener('DOMContentLoaded', addStyle);

  window.__vt = {
    get vnow() { return vnow; },
    /** Advance the virtual clock by dt ms (timers, animations, rAF callbacks, media). Resolves when every seeked video shows its frame. */
    async step(dt) {
      syncAnims();
      const target = vnow + dt;
      runDueTimers(target);
      vnow = target;
      syncAnims();
      const q = rafQ; rafQ = [];
      for (const r of q) { try { r.cb(vnow); } catch (e) { console.error('[vt raf]', e); } }
      if (q.length && document.querySelector('canvas')) dirty = true; // a canvas drawn from rAF changes no DOM
      syncAnims();
      const seeking = syncMedia();
      if (seeking.length) await mediaReady(seeking);
      { const rs = mo.takeRecords(); if (rs.length) { dirty = true; muts += rs.length; } }
      if (!dirty) for (const el of media) if (st(el).playing && el.tagName === 'VIDEO' && onScreen(el)) { dirty = true; break; }
      if (!dirty) for (const a of moved) { let el = null; try { el = a.effect && a.effect.target; } catch {} if (onScreen(el)) { dirty = true; break; } }
      moved.clear();
      const changed = dirty;
      dirty = false;
      return {vnow, busy: this.busy(), changed, fp: `${muts}/${Math.round(scrollX)},${Math.round(scrollY)}/${live.size}/${location.pathname.length}`};
    },
    /** Call at an action: from now on `busy` means "an animation that this action started is still running". */
    mark() { markT = vnow; },
    /**
     * True while a finite animation or transition that started within half a second after the last mark() is still running.
     * Looping animations, and whatever the page animates on its own all the time (a ticker, a live preview), do not count.
     */
    busy() {
      for (const a of live) {
        const r = AM.get(a);
        if (!r || r.t0 < markT - 20 || r.t0 > markT + 500) continue;
        let it = 1;
        try { it = a.effect.getComputedTiming().iterations; } catch {}
        if (it !== Infinity && a.playState !== 'finished' && a.playState !== 'idle') return true;
      }
      return false;
    },
  };
})();
