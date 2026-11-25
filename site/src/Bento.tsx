import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
// Each kit part straight from its file: the kit's index re-exports every part, and its stylesheets come with it.
import {Stage} from './stageshow/kit/stage';
import {Bar, Window} from './stageshow/kit/window';
import {Collapse} from './stageshow/kit/motion/Collapse';
import {Follow} from './stageshow/kit/motion/Follow';
import {States} from './stageshow/kit/motion/States';
import {useReducedMotion} from './stageshow/kit/reduced-motion';
import type {Act} from './stageshow/kit/act';
import {media} from './media';
import {REPO_URL} from './consts';
import {track} from './analytics';
import {Icon} from './ui';
import './bento.css';

// "Everything a demo needs.", built to Stageshow's bento rules (stageshow references/bento.md), started from the
// `bento` gold (tile + run-in copy + one Stage per picture, pinned to the tile's foot at 1:1) in the
// `dark-bento` gold's material (depth from lighter surfaces on graphite, no glow). See REHEARSAL.md.
//
//   Tile        Span (wide)  Kind        The one thing                                Moves
//   Zooms       2 x 1        Hero clip   the real render, corner-bled off right+foot   the clip, while in view
//   Fast        1 x 1        Stat        "2.8 s", run like a stopwatch                 once, in view
//   Spotlight   1 x 2        Clip        the panel the camera films, on its dunes      the clip, while in view
//   Ask         1 x 1        Component   a Claude Code turn: the ask, then the render  once
//   Shapes      1 x 1        Pair        the 16:9 frame and its phone take             once
//   Looks       1 x 1        Collection  a wallpaper clicked, the ground changes       once
//   Captions    1 x 1        Diagram     one caption line riding its waveform          once
//   Open        strip        Statement   free, local, the repo                         none
//
// One window chrome on the page's own stages (the look preview), one accent (the caption playhead).

const LEAD = 350;
const STEP = 110;

const reducedNow = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The tile owns the crop: an inner Stage matches the picture slot's width at every breakpoint. */
function usePictureWidth(fallback = 360) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  const [pad, setPad] = useState(32);
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    const measure = () => {
      setWidth(Math.max(1, Math.round(node.getBoundingClientRect().width)));
      setPad(parseFloat(getComputedStyle(node).getPropertyValue('--pad')) || 32);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, width, pad] as const;
}

function useInView<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, {threshold});
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

/** Muted looping clip that plays only while on screen; reduced motion keeps its poster. */
function Clip({src, poster, className}: {src: string; poster: string; className?: string}) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = v.current; if (!el) return;
    if (reducedNow()) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.play().catch(() => {}); else el.pause(); }, {threshold: 0.25});
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <video ref={v} className={className} src={src} poster={poster} muted loop playsInline preload="metadata" aria-hidden tabIndex={-1} />;
}

function Tile({area, title, text, children}: {area: string; title?: string; text?: string; children?: ReactNode}) {
  return (
    <article className={`dbn-tile dbn-tile--${area}`} data-crop>
      {title && <p className="dbn-copy"><b>{title}</b> {text}</p>}
      {children}
    </article>
  );
}

/* ---------------- Zooms (hero) ---------------- */

function Zooms() {
  return (
    <Tile area="hero" title="Zooms follow every click." text="Dolly finds each click and glides the camera to it.">
      <div className="dbn-film" aria-hidden>
        <Clip className="dbn-film-vid" src={media('bento/zoom.mp4')} poster={media('bento/zoom.jpg')} />
      </div>
    </Tile>
  );
}

/* ---------------- Fast (stat) ---------------- */

// A stopwatch that runs for the render's real 2.8 s and stops; the filmstrip under it is the 10 s clip, filled
// frame by frame on the same clock.
const CELLS = 20;
function Fast() {
  const [ref, seen] = useInView<HTMLDivElement>(0.5);
  const reduced = useReducedMotion();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (reduced) { setT(2.8); return; }
    let raf = 0; let start = 0;
    const delay = window.setTimeout(() => {
      const tick = (now: number) => {
        if (!start) start = now;
        const s = Math.min(2.8, (now - start) / 1000);
        setT(s);
        if (s < 2.8) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, LEAD + STEP);
    return () => { clearTimeout(delay); cancelAnimationFrame(raf); };
  }, [seen, reduced]);
  const shown = reduced ? 2.8 : t;
  return (
    <Tile area="stat">
      <div ref={ref} className="dbn-stat">
        <span className="dbn-stat-lead">Fast and light.</span>
        <span className="dbn-stat-num" aria-label="2.8 seconds">{shown.toFixed(1)}<span className="dbn-stat-unit">s</span></span>
        <span className="dbn-stat-label">to render 10 s of 1080p. Native Mac renderer, 240 MB of memory.</span>
        <div className="dbn-strip" aria-hidden>
          <div className="dbn-strip-cells">
            {Array.from({length: CELLS}, (_, i) => <i key={i} data-on={i < Math.round((shown / 2.8) * CELLS) || undefined} />)}
          </div>
          <div className="dbn-strip-scale"><span>0 s</span><span>10 s</span></div>
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- Spotlight (tall clip) ---------------- */

function Spotlight() {
  return (
    <Tile area="spot" title="Spotlight one component." text="Dolly films a single panel like a product shot.">
      <div className="dbn-spot" aria-hidden>
        <Clip className="dbn-spot-vid" src={media('hero/spotlight.mp4')} poster={media('hero/poster-spotlight.jpg')} />
      </div>
    </Tile>
  );
}

/* ---------------- Ask (a Claude Code turn) ---------------- */

const ASK = 'Zoom less on the settings panel.';
type AskS = {draft: string; sent: boolean; edit: boolean; render: 'off' | 'busy' | 'done'};
const askStart: AskS = {draft: '', sent: false, edit: false, render: 'off'};
const askEnd: AskS = {draft: ASK, sent: true, edit: true, render: 'done'};

async function askScript(a: Act<AskS>) {
  await a.wait(LEAD + STEP * 2);
  await a.type('draft', ASK, {interval: 34});
  await a.wait(380);
  a.put({sent: true});
  await a.wait(520);
  a.put({edit: true});
  await a.wait(620);
  a.put({render: 'busy'});
  await a.wait(1500);
  a.put({render: 'done'});
  await a.wait(400);
}

function Ask() {
  const [pic, width] = usePictureWidth();
  return (
    <Tile area="ask" title="Edit by asking." text="Say what to change. Claude re-renders.">
      <div ref={pic} className="dbn-pic" aria-hidden>
        <Stage<AskS> width={width} height={224} theme="dark" initial={askStart} poster={askEnd} script={askScript} play="once" className="dbn-stage">
          {(s) => {
            const done = s.render === 'done' ? 'done' : 'busy';
            return (
              <div className="dbn-term">
                <div className="dbn-term-line dbn-term-you" data-sent={s.sent || undefined}>
                  <span className="dbn-term-mark">&gt;</span>
                  <span className="dbn-term-text dbn-strong">{s.draft}<span className="dbn-caret" data-typing data-on={!s.sent || undefined} /></span>
                </div>
                <Collapse open={s.edit} reveal="drop">
                  <div className="dbn-term-line">
                    <span className="dbn-term-mark"><span className="dbn-dot" /></span>
                    <span className="dbn-term-text">Update <span className="dbn-strong">plan.json</span></span>
                  </div>
                  <div className="dbn-term-line dbn-term-sub">
                    <span className="dbn-term-mark dbn-faint">⎿</span>
                    <span className="dbn-term-text dbn-faint">Settings zoom 2.0× → 1.4×</span>
                  </div>
                </Collapse>
                <Collapse open={s.render !== 'off'} reveal="drop">
                  <div className="dbn-term-line">
                    <span className="dbn-term-mark">
                      <States value={done} states={{busy: <span className="dbn-spin">✻</span>, done: <span className="dbn-dot dbn-dot--on" />}} />
                    </span>
                    <span className="dbn-term-text">
                      <States value={done} align="start" states={{busy: <span>Rendering…</span>, done: <span className="dbn-strong">Re-rendered in 3 s.</span>}} />
                    </span>
                  </div>
                </Collapse>
                <Collapse open={s.render === 'done'} reveal="drop">
                  <div className="dbn-term-line dbn-term-you dbn-term-next">
                    <span className="dbn-term-mark">&gt;</span>
                    <span className="dbn-term-text"><span className="dbn-caret dbn-caret--blink" data-on /></span>
                  </div>
                </Collapse>
              </div>
            );
          }}
        </Stage>
      </div>
    </Tile>
  );
}

/* ---------------- Shapes (16:9 and its phone take) ---------------- */

type On = {on: boolean};
const off: On = {on: false};
const onS: On = {on: true};
const once = (i: number) => async (a: Act<On>) => { await a.wait(LEAD + STEP * i); await a.set({on: true}); await a.wait(1200); };

// Device pair, mirrored: the 16:9 frame runs off the right edge (and off the foot when the tile is wide enough
// that a whole frame would end a few px short of it); the phone take stands a gutter in from the left, over the
// frame's wallpaper margin, never its headline, and runs off the foot. Geometry from the measured tile.
function shapeLayout(W: number, pad: number) {
  const pw = W < 420 ? 104 : 118;
  const ph = Math.round(pw * 16 / 9);
  const left = Math.round(pad + pw * 0.6);
  let L = W - left + 36;
  let top = Math.round(224 - pad - L * 0.5625);
  if (top < 8) { L = Math.max(L, 410); top = 20; }
  return {pw, ph, left, L, top, ptop: 256 - ph};
}

function Shapes() {
  const [pic, width, pad] = usePictureWidth();
  const g = shapeLayout(width, pad);
  return (
    <Tile area="shape" title="16:9 and 9:16." text="A second take at phone size, ready for Reels.">
      <div ref={pic} className="dbn-pic" aria-hidden>
        <Stage<On> width={width} height={224} theme="dark" initial={off} poster={onS} script={once(3)} play="once" className="dbn-stage">
          {(s) => (
            <div className="dbn-shapes" data-on={s.on || undefined}>
              <div className="dbn-land" data-crop style={{left: g.left, top: g.top, width: g.L, backgroundImage: `url(${media('hero/poster-record.jpg')})`}}>
                <span className="dbn-ratio" style={{left: Math.round(pw40(g.pw)) }}>16:9</span>
              </div>
              <div className="dbn-port" style={{left: pad, top: g.ptop, width: g.pw}}>
                <div className="dbn-port-page">
                  <div className="dbn-port-nav"><span className="dbn-port-logo" /><Bar w={18} h={4} tone={2} /></div>
                  <span className="dbn-port-h">Give Claude better refs.</span>
                  <Bar w="82%" h={3} tone={2} />
                  <Bar w="64%" h={3} tone={2} />
                  <span className="dbn-port-search" />
                </div>
                <span className="dbn-ratio">9:16</span>
              </div>
            </div>
          )}
        </Stage>
      </div>
    </Tile>
  );
}

/** The 16:9 label sits just past the phone's edge, inside the frame. */
const pw40 = (pw: number) => pw * 0.4 + 10;

/* ---------------- Looks (collection) ---------------- */

const LOOKS = ['wallpapers/ai/thumbs/alpine-dawn', 'wallpapers/ai/thumbs/forest-fog', 'wallpapers/ai/thumbs/coast-golden', 'wallpapers/ai/thumbs/silk-night', 'wallpapers/ai/thumbs/ocean-pastel'];
type LookS = {pick: number};

async function lookScript(a: Act<LookS>) {
  await a.wait(LEAD + STEP * 4);
  await a.click({at: 'look-2', x: 0.55, y: 0.6});
  await a.set({pick: 2});
  await a.wait(500);
  await a.move({at: 'look-2', x: 1.6, y: -1.4});
  await a.wait(1800);
}

function Looks() {
  const [pic, width] = usePictureWidth();
  return (
    <Tile area="looks" title="Pick a look." text="Twelve wallpapers, one click.">
      <div ref={pic} className="dbn-pic" aria-hidden>
        <Stage<LookS> width={width} height={224} theme="dark" initial={{pick: 0}} poster={{pick: 2}} script={lookScript} play="once"
          cursor={{at: {x: Math.round(width * 0.78), y: 186}, style: 'real', idle: 1800}} className="dbn-stage">
          {(s, rect) => {
            const sel = rect(`look-${s.pick}`);
            return (
              <div className="dbn-looks">
                <div className="dbn-preview">
                  {LOOKS.map((p, i) => <img key={p} src={`/${p}.jpg`} alt="" data-on={s.pick === i || undefined} decoding="async" />)}
                  <Window className="dbn-preview-win" lights="color">
                    <div className="dbn-preview-body">
                      <Bar w={54} h={5} tone={2} />
                      <Bar w={120} h={9} tone={4} />
                      <Bar w={92} h={9} tone={4} />
                      <Bar w={78} h={4} tone={2} />
                    </div>
                  </Window>
                  <div className="dbn-picker">
                    {LOOKS.map((p, i) => <span key={p} className="dbn-thumb" data-target={`look-${i}`} data-cursor="pointer" style={{backgroundImage: `url(/${p}.jpg)`}} />)}
                  </div>
                </div>
                {sel.width > 0 && <Follow to={{x: sel.x - 3, y: sel.y - 3, width: sel.width + 6, height: sel.height + 6}} className="dbn-ring" />}
              </div>
            );
          }}
        </Stage>
      </div>
    </Tile>
  );
}

/* ---------------- Captions (diagram) ---------------- */

// Speech, a breath, speech: the line changes in the silence.
const WAVE = [5, 9, 14, 8, 18, 22, 12, 16, 24, 10, 6, 14, 20, 26, 15, 9, 13, 19, 11, 7, 3, 1, 1, 2, 8, 16, 23, 14, 20, 27, 18, 10, 15, 21, 12, 8, 17, 22, 13, 6, 9, 14, 19, 10, 5, 8, 12, 7];
const SPLIT = 22;
const END = 37;
type CapS = {at: number};
const LINES = ["Here's the settings panel.", 'Every click, explained.'];

async function capScript(a: Act<CapS>) {
  await a.wait(LEAD + STEP * 5);
  for (let i = 5; i <= END; i++) { a.put({at: i}); await a.wait(110); }
  await a.wait(600);
}

function Captions() {
  const [pic, width] = usePictureWidth();
  return (
    <Tile area="caps" title="Captions in one line." text="Clean, readable, never in the way.">
      <div ref={pic} className="dbn-pic" aria-hidden>
        <Stage<CapS> width={width} height={224} theme="dark" initial={{at: 4}} poster={{at: END}} script={capScript} play="once" className="dbn-stage">
          {(s) => {
            const line = s.at < SPLIT ? 0 : 1;
            const bars = Math.max(WAVE.length, Math.ceil(width / 8));
            return (
              <div className="dbn-caps">
                <div className="dbn-caption"><States value={String(line) as '0' | '1'} align="start" states={{'0': LINES[0], '1': LINES[1]}} /></div>
                <div className="dbn-wave">
                  {Array.from({length: bars}, (_, i) => <i key={i} data-past={i < s.at || undefined} style={{height: WAVE[i % WAVE.length] + 4}} />)}
                  <span className="dbn-head" style={{left: `calc(${s.at} * var(--pitch))`}} />
                </div>
              </div>
            );
          }}
        </Stage>
      </div>
    </Tile>
  );
}

/* ---------------- Open (statement strip) ---------------- */

function Open() {
  return (
    <article className="dbn-tile dbn-tile--open">
      <p className="dbn-copy"><b>Free and open source.</b> No account, no watermark. Nothing leaves your Mac.</p>
      <div className="dbn-open-actions">
        <a className="pill ghost" href="/editor" onClick={() => track('dolly_open_editor', {where: 'bento'})}>Open the editor</a>
        <a className="pill" href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={() => track('dolly_github', {where: 'bento'})}>{Icon.gh}GitHub</a>
      </div>
    </article>
  );
}

export function Bento() {
  return (
    <section className="lp-sec lp-bento" id="features" aria-labelledby="bn-h">
      <h2 id="bn-h">Everything a demo needs.</h2>
      <div className="dbn">
        <div className="dbn-grid">
          <Zooms />
          <Fast />
          <Spotlight />
          <Ask />
          <Shapes />
          <Looks />
          <Captions />
          <Open />
        </div>
      </div>
    </section>
  );
}
