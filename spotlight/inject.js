// Spotlight in-page runtime. Injected before any page script (addInitScript), as a plain script (no modules).
// 1. A virtual clock: Date, performance.now, setTimeout/Interval, requestAnimationFrame, requestIdleCallback and every CSS
//    transition / CSS animation / Web Animation are driven by __sp.step(dt) only, so capture is exactly 60 fps whatever the machine does.
// 2. Isolation: everything except the component (and the overlays it opens) is made invisible, with a transparent page.
// 3. Measurement: per-frame painted bounds of the component, hover / cursor kind, state hints for the sound track.
(() => {
  if (window.__sp) return;
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

  // ---- animations (CSS transitions, CSS animations, WAAPI): paused and seeked from the virtual clock
  const AM = new WeakMap();
  const syncAnims = () => {
    let all;
    try { all = document.getAnimations(); } catch { return; }
    for (const a of all) {
      let r = AM.get(a);
      if (!r) {
        const ct = typeof a.currentTime === 'number' ? a.currentTime : (a.currentTime && a.currentTime.value) || 0;
        r = {t0: vnow - ct, done: false};
        AM.set(a, r);
        try { a.pause(); } catch {}
      }
      if (r.done) continue;
      if (a.playState === 'finished') { r.done = true; continue; }
      let end = Infinity;
      try { end = a.effect.getComputedTiming().endTime; } catch {}
      const rate = a.playbackRate || 1;
      const t = (vnow - r.t0) * rate;
      try {
        if (rate > 0 && Number.isFinite(end) && t >= end) { a.currentTime = end; a.finish(); r.done = true; }
        else if (rate < 0 && t <= 0) { a.currentTime = 0; a.finish(); r.done = true; }
        else a.currentTime = Math.max(0, t);
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

  // ---------------------------------------------------------------- isolation
  const S = {orig: new WeakMap(), keep: new Set(), known: new WeakSet(), seenHidden: new WeakSet(), flatten: true, kept: [], shown: [], events: []};
  const STYLE = `
    html,body{background:transparent!important}
    [data-sp-chain]{background:transparent!important;background-image:none!important;box-shadow:none!important;border-color:transparent!important;outline:0!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    [data-sp-chain]::before,[data-sp-chain]::after{display:none!important}
    [data-sp-chain]>:not([data-sp-chain]):not([data-sp-keep]),[data-sp-chain]>:not([data-sp-chain]):not([data-sp-keep]) *{visibility:hidden!important}
    *,*::before,*::after{caret-color:currentColor}
    html{scroll-behavior:auto!important}
  `;
  let styleEl = null;
  const OVERLAY_SEL = '[role=menu],[role=listbox],[role=dialog],[role=tooltip],[role=alertdialog],[popover],[data-radix-popper-content-wrapper],[data-radix-portal],[data-floating-ui-portal],[data-headlessui-portal],[data-sonner-toaster],[class*="popover" i],[class*="dropdown" i],[class*="tooltip" i],[class*="modal" i],[class*="toast" i],[class*="menu" i]';

  const visible = (el) => {
    try { return el.checkVisibility({opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true}); } catch { return false; }
  };
  const rectOf = (el) => el.getBoundingClientRect();
  const cs = (el) => getComputedStyle(el);
  const alphaOf = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };

  const paints = (el, st) => {
    const tag = el.tagName;
    if (/^(IMG|SVG|CANVAS|VIDEO|INPUT|TEXTAREA|SELECT|PICTURE|IFRAME)$/i.test(tag)) return true;
    if (alphaOf(st.backgroundColor) > 0.01 || st.backgroundImage !== 'none') return true;
    if ((parseFloat(st.borderTopWidth) > 0 && alphaOf(st.borderTopColor) > 0.01) || (parseFloat(st.borderBottomWidth) > 0 && alphaOf(st.borderBottomColor) > 0.01) || (parseFloat(st.borderLeftWidth) > 0 && alphaOf(st.borderLeftColor) > 0.01)) return true;
    if (st.boxShadow !== 'none') return true;
    return false;
  };
  const textRects = (el) => {
    const out = [];
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) {
        const r = document.createRange(); r.selectNodeContents(n);
        for (const q of r.getClientRects()) if (q.width > 0 && q.height > 0) out.push(q);
      }
    }
    return out;
  };

  /** Painted bounds of a root and everything inside it that is actually visible. */
  const measureRoot = (root) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (r) => { if (r.width <= 0 || r.height <= 0) return; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); };
    const rst = cs(root);
    const clipRoot = /hidden|clip/.test(rst.overflowX + rst.overflowY);
    const rr = rectOf(root);
    if (visible(root) && (paints(root, rst) || true)) { if (paints(root, rst) || !root.children.length) add(rr); }
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      if (!visible(el)) continue;
      const st = cs(el);
      const rects = [];
      if (paints(el, st)) rects.push(rectOf(el));
      for (const q of textRects(el)) rects.push(q);
      for (const q of rects) {
        if (clipRoot) { // never extend beyond a clipping root
          const l = Math.max(q.left, rr.left), t = Math.max(q.top, rr.top), r2 = Math.min(q.right, rr.right), b = Math.min(q.bottom, rr.bottom);
          if (r2 > l && b > t) add({left: l, top: t, right: r2, bottom: b, width: r2 - l, height: b - t});
        } else add(q);
      }
    }
    if (x1 < x0) return null;
    const rad = parseFloat(rst.borderTopLeftRadius) || 0;
    return {x: x0, y: y0, w: x1 - x0, h: y1 - y0, r: Math.min(rad, (x1 - x0) / 2, (y1 - y0) / 2)};
  };

  /** Real boxes (opaque background, rounded) inside the roots: the renderer draws its edge highlight / glow on these only. */
  const cardsOf = () => {
    const found = [];
    for (const root of S.keep) {
      if (!root.isConnected) continue;
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || !visible(el)) continue;
        const st = cs(el);
        const a = alphaOf(st.backgroundColor);
        const rad = parseFloat(st.borderTopLeftRadius) || 0;
        if (a < 0.5 && !(a > 0.12 && rad >= 10)) continue;
        const r = rectOf(el);
        if (r.width < 96 || r.height < 36 || rad < 5) continue;
        found.push({x: r.left, y: r.top, w: r.width, h: r.height, r: Math.min(rad, r.width / 2, r.height / 2), a});
      }
    }
    // keep the outermost only
    return found.filter((c, i) => !found.some((o, j) => j !== i && o.x <= c.x + 1 && o.y <= c.y + 1 && o.x + o.w >= c.x + c.w - 1 && o.y + o.h >= c.y + c.h - 1 && (o.w * o.h > c.w * c.h * 1.0 || (j < i && o.w * o.h === c.w * c.h)))).map((c) => [c.x, c.y, c.w, c.h, c.r]);
  };

  const applyKeep = () => {
    document.querySelectorAll('[data-sp-keep],[data-sp-chain]').forEach((e) => { e.removeAttribute('data-sp-keep'); e.removeAttribute('data-sp-chain'); });
    // (the chain is re-marked below; its original backgrounds were recorded the first time, in S.orig)
    for (const el of S.keep) {
      if (!el.isConnected) continue;
      el.setAttribute('data-sp-keep', '');
      for (let p = el.parentElement; p; p = p.parentElement) if (!p.hasAttribute('data-sp-keep')) { if (!p.hasAttribute('data-sp-chain') && !S.orig.has(p)) S.orig.set(p, getComputedStyle(p).backgroundColor); p.setAttribute('data-sp-chain', ''); }
    }
    // a keep root nested inside another keep root is redundant
    for (const el of [...S.keep]) for (let p = el.parentElement; p; p = p.parentElement) if (S.keep.has(p)) { S.keep.delete(el); el.removeAttribute('data-sp-keep'); break; }
  };

  const parseRgba = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1}; };
  const over = (top, base) => ({r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1});
  /** The colour behind an element: its ancestors' backgrounds composited (the cleared chain uses what it had before isolation). */
  const behindColor = (el) => {
    const layers = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const raw = S.orig.has(p) ? S.orig.get(p) : getComputedStyle(p).backgroundColor;
      const c = parseRgba(raw);
      if (c && c.a > 0.001) { layers.push(c); if (c.a >= 0.999) break; }
    }
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    let c = layers.length && layers[layers.length - 1].a >= 0.999 ? {r: layers[layers.length - 1].r, g: layers[layers.length - 1].g, b: layers[layers.length - 1].b, a: 1} : (dark ? {r: 12, g: 12, b: 13, a: 1} : {r: 255, g: 255, b: 255, a: 1});
    for (let i = layers.length - 1; i >= 0; i--) { if (layers[i].a >= 0.999) continue; c = over(layers[i], c); }
    return c;
  };
  /** A translucent surface (a glass card, a see-through bar) is painted onto what is behind it on the real page, so it keeps its look. */
  const flattenEl = (el) => {
    const st = cs(el), own = parseRgba(st.backgroundColor);
    if (!own || own.a >= 0.985 || own.a < 0.02) return false;
    const c = over(own, behindColor(el));
    el.style.setProperty('background-color', `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`, 'important');
    el.style.setProperty('backdrop-filter', 'none', 'important');
    el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
    el.style.setProperty('transition-property', 'opacity,transform,box-shadow,border-color,color,filter', 'important');
    return true;
  };
  const flattenAll = (root) => {
    if (!S.flatten) return;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.hasAttribute('data-sp-flat')) continue;
      const r = rectOf(el), st = cs(el);
      if (el !== root && (r.width < 80 || r.height < 30 || (parseFloat(st.borderTopLeftRadius) || 0) < 5 && st.backdropFilter === 'none')) continue;
      if (flattenEl(el)) el.setAttribute('data-sp-flat', '');
    }
  };

  const candidates = () => {
    const set = new Set();
    for (const c of document.body.children) if (!/^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(c.tagName)) set.add(c);
    document.querySelectorAll(OVERLAY_SEL).forEach((e) => set.add(e));
    // siblings near the roots (an absolutely positioned dropdown next to the trigger)
    for (const root of S.keep) { let p = root.parentElement; for (let i = 0; i < 3 && p; i++, p = p.parentElement) for (const c of p.children) if (!/^(SCRIPT|STYLE)$/.test(c.tagName)) set.add(c); }
    return set;
  };
  const nearUnion = (rect, u, gap) => !u || (rect.left < u.x + u.w + gap && rect.right > u.x - gap && rect.top < u.y + u.h + gap && rect.bottom > u.y - gap);

  /** Find overlays (menus, popovers, dialogs, tooltips, toasts) that appeared because of the interaction, and keep them. */
  const detect = (u) => {
    let changed = false;
    for (const el of candidates()) {
      if (S.keep.has(el) || el.hasAttribute('data-sp-chain') || el.hasAttribute('data-sp-keep')) continue;
      if (el.closest('[data-sp-keep]')) continue;
      const vis = visible(el);
      if (!vis) { S.seenHidden.add(el); continue; }
      if (S.known.has(el) && !S.seenHidden.has(el)) continue;
      const r = rectOf(el);
      if (r.width < 2 || r.height < 2) continue;
      const st = cs(el);
      const overlayish = el.matches(OVERLAY_SEL) || el.querySelector(OVERLAY_SEL) && (st.position === 'fixed' || st.position === 'absolute');
      const positioned = st.position === 'fixed' || st.position === 'absolute' || st.position === 'sticky';
      if ((overlayish || positioned) && nearUnion(r, u, 200) && r.width < innerWidth * 0.98 + 1) {
        S.keep.add(el); changed = true; S.events.push({kind: 'open', el}); try { flattenAll(el); } catch {}
      }
    }
    for (const el of [...S.keep]) if (!el.isConnected) { S.keep.delete(el); changed = true; }
    if (changed) applyKeep();
    return changed;
  };

  // ---------------------------------------------------------------- component search
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sizeOk = (el) => { const r = rectOf(el); return r.width >= 4 && r.height >= 4; };
  const looksLikeCss = (s) => /^([#.\[:*]|[a-z][a-z0-9-]*([\[.#:>~+ ]|$))/i.test(s) && !/\s{2,}/.test(s) && /[#.\[:>]/.test(s) || /^[a-z][a-z0-9-]*$/i.test(s) && ['nav', 'header', 'footer', 'main', 'aside', 'dialog', 'form', 'table', 'button', 'section', 'article'].includes(s.toLowerCase());
  const interactiveSel = 'a,button,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio],input,select,textarea,summary,label';
  const locate = (spec, within) => {
    if (spec && typeof spec === 'object') spec = spec.selector || spec.text || spec.label;
    spec = String(spec);
    const pool = within ? [...within.querySelectorAll('*'), within] : null;
    const doc = (sel) => (within ? within.querySelectorAll(sel) : document.querySelectorAll(sel));
    if (spec.startsWith('css=')) spec = spec.slice(4);
    let out = [];
    if (/^text=/.test(spec) === false && looksLikeCss(spec)) { try { out = [...doc(spec)].filter((e) => sizeOk(e) && e.checkVisibility()); } catch {} }
    if (out.length) return out[0];
    const want = norm(spec.replace(/^text=/, '').replace(/^["']|["']$/g, ''));
    const els = pool || [...document.querySelectorAll('body *')];
    const scored = [];
    for (const el of els) {
      if (/^(SCRIPT|STYLE|HEAD|META|LINK|NOSCRIPT|PATH|G|DEFS)$/i.test(el.tagName)) continue;
      if (!sizeOk(el) || !el.checkVisibility()) continue;
      const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
      const label = norm(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') || '');
      const full = norm(el.innerText || '');
      let s = 0;
      if (own === want || label === want) s = 100;
      else if (full === want) s = 90;
      else if (own.includes(want) || label.includes(want)) s = 70;
      else if (full.includes(want) && full.length < want.length * 3 + 12) s = 55;
      if (!s) continue;
      const r = rectOf(el);
      s -= Math.min(30, Math.log2(1 + (r.width * r.height) / 400));
      if (el.matches(interactiveSel)) s += 6;
      if (el.closest('[data-sp-keep]')) s += 4;
      scored.push([s, el]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.length ? scored[0][1] : null;
  };

  const VIS = (el) => sizeOk(el) && el.checkVisibility();
  /** The nearest meaningful component around a text hit. */
  const containerFor = (el, maxArea) => {
    const vw = innerWidth, vh = innerHeight;
    const meaningful = (e) => {
      const st = cs(e), r = rectOf(e);
      if (r.width < 60 || r.height < 28) return false;
      if (/^(NAV|HEADER|DIALOG|ASIDE|FORM|TABLE|ARTICLE|FIELDSET|DETAILS)$/.test(e.tagName)) return true;
      if (/^(menu|dialog|navigation|tablist|toolbar|listbox|group|region|alert|tooltip|switch|slider)$/.test(e.getAttribute('role') || '')) return true;
      const border = parseFloat(st.borderTopWidth) > 0 && alphaOf(st.borderTopColor) > 0.05;
      return alphaOf(st.backgroundColor) > 0.04 || border || st.boxShadow !== 'none' || parseFloat(st.borderTopLeftRadius) >= 8 && st.backgroundImage !== 'none';
    };
    let cur = el, best = null;
    for (let i = 0; i < 9 && cur && cur !== document.body && cur !== document.documentElement; i++, cur = cur.parentElement) {
      const r = rectOf(cur);
      const area = (r.width * r.height) / (vw * vh);
      if (area > maxArea && best) break;
      if (r.width > vw * 0.78 && rectOf(el).width < vw * 0.5 && best) break; // a full-bleed bar around a small group: keep the group
      if (meaningful(cur)) { best = cur; if (!/^(NAV|HEADER)$/.test(cur.tagName) && cur !== el) { /* keep climbing one more level if it is tiny */ const r2 = rectOf(cur); if (r2.width > 140 && r2.height > 48) break; } }
    }
    return best || el;
  };

  // ---------------------------------------------------------------- per-frame sample
  const interactiveAt = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.closest(interactiveSel) || e) : null; };
  let elId = 1; const ids = new WeakMap(); const idOf = (e) => { if (!e) return 0; let i = ids.get(e); if (!i) { i = elId++; ids.set(e, i); } return i; };
  const SUCCESS = /(success|sent|done|saved|complete|confirmed|paid|thank|added|copied|✓|✔)/i;
  let prevSig = '';
  const sample = (px, py) => {
    const roots = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of S.keep) {
      if (!el.isConnected) continue;
      const m = measureRoot(el);
      if (m) { roots.push([m.x, m.y, m.w, m.h, m.r]); x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h); }
    }
    const u = x1 > x0 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : null;
    detect(u);
    let rr = null; for (const el of S.keep) { if (el.isConnected) { const q = rectOf(el); rr = [q.left, q.top, q.width, q.height]; break; } }
    const hit = interactiveAt(px, py);
    const under = document.elementFromPoint(px, py);
    let ck = 'arrow';
    if (under) { const c = cs(under).cursor; ck = /pointer/.test(c) ? 'hand' : /text/.test(c) ? 'text' : /grab|move/.test(c) ? 'grab' : 'arrow'; }
    // state hints (sound track)
    let checked = '';
    for (const el of S.keep) for (const c of el.querySelectorAll('[aria-checked],[aria-pressed],[aria-selected],[data-state],input[type=checkbox],input[type=radio]')) checked += (c.getAttribute('aria-checked') || c.getAttribute('aria-pressed') || c.getAttribute('aria-selected') || c.getAttribute('data-state') || (c.checked ? '1' : '0')) + ',';
    let ok = false;
    for (const el of S.keep) { const t = (el.innerText || '').slice(0, 600); if (SUCCESS.test(t)) ok = true; }
    return {u, roots, rr, fs: hit ? parseFloat(cs(hit).fontSize) || 0 : 0, sx: scrollX, sy: scrollY, cards: cardsOf(), ck, hit: idOf(hit), hitLabel: hit ? norm(hit.getAttribute('aria-label') || hit.innerText || hit.tagName).slice(0, 40) : '', checked, ok, nKeep: S.keep.size, text: hit && /^(INPUT|TEXTAREA)$/.test(hit.tagName)};
  };

  window.__sp = {
    get vnow() { return vnow; },
    setFlatten(v) { S.flatten = v; },
    /** Advance the virtual clock by dt ms (timers, animations, rAF callbacks). */
    step(dt) {
      syncAnims();
      const target = vnow + dt;
      runDueTimers(target);
      vnow = target;
      syncAnims();
      const q = rafQ; rafQ = [];
      for (const r of q) { try { r.cb(vnow); } catch (e) { console.error('[sp raf]', e); } }
      syncAnims();
      return vnow;
    },
    install() {
      if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = '__sp_style'; styleEl.textContent = STYLE; document.documentElement.appendChild(styleEl); }
    },
    snapshotKnown() {
      for (const el of candidates()) { S.known.add(el); if (!visible(el)) S.seenHidden.add(el); }
    },
    locate(spec) { const e = locate(spec); return e ? {ok: true, id: idOf(e)} : {ok: false}; },
    /** Resolve the target spec to a component, mark it, return its box. */
    isolate(spec, opts) {
      opts = opts || {};
      let el = null;
      const first = locate(spec);
      if (!first) return {ok: false, why: 'target not found: ' + spec};
      const isCss = looksLikeCss(String(spec)) && !String(spec).startsWith('text=');
      el = isCss ? first : containerFor(first, opts.maxArea || 0.4);
      if (opts.exact) el = first;
      el.scrollIntoView({block: 'center', inline: 'center'});
      S.keep.add(el);
      applyKeep();
      flattenAll(el);
      
      this.install();
      const r = rectOf(el);
      const st = cs(el);
      const tag = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`;
      window.__spRoot = el;
      // text ink luminance and the page colour behind the component (a text-only component gets a plate in the renderer)
      let lum = 0, n = 0;
      for (const t of [el, ...el.querySelectorAll('*')].slice(0, 500)) {
        if (![...t.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
        const m = /rgba?\(([^)]+)\)/.exec(cs(t).color); if (!m) continue;
        const q = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); lum += (0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2]) / 255; n++;
      }
      let pageBg = null;
      for (let p = el.parentElement; p && !pageBg; p = p.parentElement) { const m = /rgba?\(([^)]+)\)/.exec(cs(p).backgroundColor); if (m) { const q = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); if ((q.length < 4 ? 1 : q[3]) > 0.9) pageBg = `rgb(${q[0]},${q[1]},${q[2]})`; } }
      const fonts = [];
      for (const t of [el, ...el.querySelectorAll('*')].slice(0, 600)) { if ([...t.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim().length > 1) && t.checkVisibility()) fonts.push(parseFloat(cs(t).fontSize) || 0); }
      fonts.sort((a, b) => a - b);
      return {ok: true, font: fonts.length ? fonts[Math.floor(fonts.length * 0.35)] : 14, ink: n ? lum / n : null, pageBg, tag, rect: {x: r.left, y: r.top, w: r.width, h: r.height}, radius: parseFloat(st.borderTopLeftRadius) || 0, text: norm(el.innerText).slice(0, 80)};
    },
    /** Centre (or an inner point) of a target, for the cursor. */
    point(spec, at) {
      const e = typeof spec === 'string' || (spec && typeof spec === 'object' && !Array.isArray(spec)) ? locate(spec) : null;
      if (!e) return null;
      const r = rectOf(e);
      const a = at || [0.5, 0.5];
      return {x: r.left + r.width * a[0], y: r.top + r.height * a[1], w: r.width, h: r.height, tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || '', role: e.getAttribute('role') || '', min: e.getAttribute('min'), max: e.getAttribute('max'), value: e.value};
    },
    scrollInside(spec, y) { const e = spec ? locate(spec) : window.__spRoot; if (!e) return false; let t = e; while (t && t.scrollHeight <= t.clientHeight + 1) t = t.parentElement; (t || document.scrollingElement).scrollTop = y; return true; },
    scrollTopOf(spec) { const e = spec ? locate(spec) : window.__spRoot; let t = e; while (t && t.scrollHeight <= t.clientHeight + 1) t = t.parentElement; return (t || document.scrollingElement).scrollTop; },
    setValue(spec, v) { const e = locate(spec); if (!e) return false; const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value'); if (d && d.set) d.set.call(e, v); else e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return true; },
    sample,
    pending() { return {timers: timers.size, raf: rafQ.length}; },
  };
})();
