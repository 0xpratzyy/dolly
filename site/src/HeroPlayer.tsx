import {useCallback, useEffect, useRef, useState} from 'react';
import {media} from './media';
import {track} from './analytics';
import {Dither} from './Dither';
import {CopyPrompt, warmRecordPrompt, type Mode} from './landing-copy';

interface Tab {id: Mode; name: string; tag?: string; line: string; src: string; poster: string}
const TABS: Tab[] = [
  {id: 'record', name: 'Record', line: 'Drop in a screen recording. Get zooms, a smooth cursor and captions.', src: media('hero/record.mp4'), poster: media('hero/poster-record.jpg')},
  {id: 'autopilot', name: 'Autopilot', tag: 'beta', line: 'Give it a URL. Claude records your product for you.', src: media('hero/autopilot.mp4'), poster: media('hero/poster-autopilot.jpg')},
  {id: 'narrate', name: 'Narrate', tag: 'beta', line: 'Talk. Dolly clicks on the word you say.', src: media('hero/narrate.mp4'), poster: media('hero/poster-narrate.jpg')},
  {id: 'spotlight', name: 'Spotlight', tag: 'new', line: 'Pick one component. Dolly films it like a product shot.', src: media('hero/spotlight.mp4'), poster: media('hero/poster-spotlight.jpg')},
];

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One player, four tabs. Each tab is one clip and one line. The active tab's 2 px line fills over the clip; when the clip ends the next tab starts,
 *  until the visitor picks one (then it loops). Muted, inline, and paused whenever it is off screen. */
export function HeroPlayer() {
  const [i, setI] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [live, setLive] = useState(false); // the video has frames to show
  const still = useRef(reduced());
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const visible = useRef(true);
  const warmed = useRef(-1);
  const tab = TABS[i];

  const go = useCallback((n: number, via: 'tab' | 'auto' | 'swipe' | 'key') => {
    const k = (n + TABS.length) % TABS.length;
    setI(k); setLive(false);
    if (via !== 'auto') setPinned(true);
    track('dolly_hero_tab', {tab: TABS[k].id, via});
  }, []);

  // play / pause with visibility; swap sources with the tab
  useEffect(() => {
    const v = video.current; if (!v || still.current) return;
    v.src = tab.src; v.load();
    if (visible.current && !document.hidden) v.play().catch(() => {});
  }, [tab.src]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const sync = () => { const v = video.current; if (!v || still.current) return; if (visible.current && !document.hidden) v.play().catch(() => {}); else v.pause(); };
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; sync(); }, {threshold: 0.25});
    io.observe(el);
    document.addEventListener('visibilitychange', sync);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, []);
  // idle: warm the Record prompt so the copy links are instant
  useEffect(() => { const t = setTimeout(() => { warmRecordPrompt().catch(() => {}); }, 4000); return () => clearTimeout(t); }, []);

  // the video clock: warms the next tab's clip near the end (no progress line under the tabs: owner, 2026-11-25)
  useEffect(() => {
    const v = video.current; if (!v || still.current) return;
    let raf = 0;
    const tick = () => {
      const d = v.duration || 0, p = d ? v.currentTime / d : 0;
      const next = (i + 1) % TABS.length;
      if (!pinned && p > 0.7 && warmed.current !== next) { warmed.current = next; fetch(TABS[next].src, {priority: 'low'} as RequestInit).catch(() => {}); }
      raf = requestAnimationFrame(tick);
    };
    const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const stop = () => cancelAnimationFrame(raf);
    v.addEventListener('playing', start); v.addEventListener('pause', stop); v.addEventListener('ended', stop);
    if (!v.paused) start();
    return () => { stop(); v.removeEventListener('playing', start); v.removeEventListener('pause', stop); v.removeEventListener('ended', stop); };
  }, [i, pinned]);

  // swipe the player
  const sx = useRef<number | null>(null);
  const onDown = (e: React.PointerEvent) => { sx.current = e.clientX; };
  const onUp = (e: React.PointerEvent) => {
    if (sx.current === null) return;
    const dx = e.clientX - sx.current; sx.current = null;
    if (Math.abs(dx) > 48) go(i + (dx < 0 ? 1 : -1), 'swipe');
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    go(n, 'key');
    requestAnimationFrame(() => document.getElementById(`hp-tab-${TABS[n].id}`)?.focus());
  };

  return (
    <div className="hp">
      <Dither shape="radial" x={0.5} y={0.4} reach={0.55} max={0.6} cell={8} dot={1.5} className="hp-dz" />
      <div className="hp-stage" ref={box} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { sx.current = null; }} style={{touchAction: 'pan-y'}}>
        <img key={tab.id} className="hp-poster" src={tab.poster} alt="" width={1280} height={720} fetchPriority={i === 0 ? 'high' : 'auto'} decoding="async" />
        {!still.current && (
          <video
            ref={video} className={live ? 'on' : ''} muted playsInline preload="metadata" loop={pinned}
            onPlaying={() => setLive(true)} onEnded={() => { if (!pinned) go(i + 1, 'auto'); }}
            aria-label={`${tab.name}: ${tab.line}`}
          />
        )}
      </div>
      <div className="hp-tabs" role="tablist" aria-label="What Dolly does" onKeyDown={onKey}>
        {TABS.map((t, n) => (
          <button key={t.id} id={`hp-tab-${t.id}`} role="tab" type="button" aria-selected={n === i} aria-controls="hp-cap" tabIndex={n === i ? 0 : -1} className={n === i ? 'on' : ''} onClick={() => go(n, 'tab')}>
            <span className="hp-name">{t.name}{t.tag && <i>{t.tag}</i>}</span>
          </button>
        ))}
      </div>
      <div className="hp-cap" id="hp-cap" role="tabpanel" aria-live="polite" aria-labelledby={`hp-tab-${tab.id}`}>
        <p>{tab.line}</p>
        <CopyPrompt mode={tab.id} label="Copy the prompt" where="hero_tab" />
      </div>
    </div>
  );
}
