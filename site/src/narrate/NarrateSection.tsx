import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import data from './narrate-data.json';
import {media} from '../media';
import {Icon, fmtTime} from '../ui';
import {track} from '../analytics';
import {useCopy} from '../copy';
import {NARRATE_PROMPT_DEFAULTS, buildNarratePrompt} from './prompt';

type Mark = (typeof data.marks)[number];
type Aspect = '16x9' | '9x16';

const SRC: Record<Aspect, string> = {'16x9': media('narrate/narrate-16x9.mp4'), '9x16': media('narrate/narrate-9x16.mp4')};
const POSTER: Record<Aspect, string> = {'16x9': media('narrate/poster-16x9.jpg'), '9x16': media('narrate/poster-9x16.jpg')};
const marksByWord = new Map<number, Mark>(data.marks.map((m) => [m.w, m]));
const fmtOff = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)} ms`;

/** The words-to-clicks view: the real narrate demo (a computer voice and a test-card face) with its transcript beside it. */
export default function NarrateSection() {
  const [aspect, setAspect] = useState<Aspect>('16x9');
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const resume = useRef<{t: number; play: boolean}>({t: 0, play: false});
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);

  // load the clip once the section is close to the viewport; pause it when it leaves
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setNear(true);
      setVisible(e.isIntersecting);
      if (!e.isIntersecting) video.current?.pause();
    }, {rootMargin: '300px 0px', threshold: 0.01});
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // smooth word clock while it plays (timeupdate only fires about 4 times a second)
  useEffect(() => {
    const v = video.current; if (!v || !near) return;
    let id = 0;
    const tick = () => { setT((p) => { const n = v.currentTime * 1000; return Math.abs(n - p) < 4 ? p : n; }); id = requestAnimationFrame(tick); };
    const start = () => { cancelAnimationFrame(id); id = requestAnimationFrame(tick); setPlaying(true); };
    const stop = () => { cancelAnimationFrame(id); setT(v.currentTime * 1000); setPlaying(false); };
    v.addEventListener('play', start); v.addEventListener('pause', stop); v.addEventListener('seeked', () => setT(v.currentTime * 1000)); v.addEventListener('ended', stop);
    return () => { cancelAnimationFrame(id); v.removeEventListener('play', start); v.removeEventListener('pause', stop); v.removeEventListener('ended', stop); };
  }, [near, aspect]);

  // switching the cut keeps the moment you are on
  useEffect(() => {
    const v = video.current; if (!v) return;
    const r = resume.current;
    const go = () => { v.currentTime = r.t; if (r.play && visible) v.play().catch(() => {}); };
    if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, {once: true});
  }, [aspect]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = useCallback((ms: number, from: string) => {
    const v = video.current; if (!v) return;
    v.currentTime = Math.max(0, ms / 1000);
    setT(ms);
    v.play().catch(() => {});
    track('dolly_narrate_seek', {from});
  }, []);
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); };
  const pickAspect = (a: Aspect) => { const v = video.current; resume.current = {t: v?.currentTime ?? 0, play: !!v && !v.paused}; setAspect(a); track('dolly_narrate_aspect', {a}); };

  const activeWord = useMemo(() => {
    let a = -1;
    for (let i = 0; i < data.words.length; i++) if (data.words[i].s <= t + 20) a = i; else break;
    // a word stays lit through short gaps, then lets go
    return a >= 0 && (t > 0 || playing) && t <= data.words[a].e + 380 ? a : -1;
  }, [t, playing]);
  const lastMark = useMemo(() => { let m = -1; data.marks.forEach((x, i) => { if (x.at <= t) m = i; }); return m; }, [t]);

  const [inputs, setInputs] = useState(NARRATE_PROMPT_DEFAULTS);
  const prompt = useMemo(() => buildNarratePrompt(inputs), [inputs]);
  const {CopyBtn} = useCopy(() => ({section: 'narrate', input: inputs.input, vertical: inputs.vertical, login: inputs.login}));
  const set = (p: Partial<typeof inputs>) => setInputs((s) => ({...s, ...p}));

  // group the transcript by what was said, one line per spoken segment
  const lines = useMemo(() => data.segments.map((s) => ({...s, words: data.words.map((w, i) => ({w, i})).filter(({w}) => w.s >= s.from - 5 && w.s < s.to)})), []);
  const pct = Math.min(100, (t / data.durationMs) * 100);

  return (
    <div className="nar">
      <div className="nar-grid">
        <div className={`nar-stage a-${aspect}`} ref={box}>
          <div className="nar-screen">
            <video ref={video} key="v" src={near ? SRC[aspect] : undefined} poster={POSTER[aspect]} playsInline muted={false} preload="metadata" loop={false}
              onClick={toggle} aria-label="The Narrate demo: a spoken launch video with the product driven by the words" />
            <button type="button" className={`nar-play${playing ? ' on' : ''}`} onClick={toggle} aria-label={playing ? 'Pause the demo' : 'Play the demo'}>{playing ? Icon.pause : Icon.play}</button>
          </div>
          <div className="nar-bar">
            <div className="seg slim" role="radiogroup" aria-label="Aspect ratio">
              {([['16x9', '16:9'], ['9x16', '9:16']] as [Aspect, string][]).map(([k, n]) => (
                <button key={k} type="button" role="radio" aria-checked={aspect === k} className={aspect === k ? 'on' : ''} onClick={() => pickAspect(k)}>{n}</button>
              ))}
            </div>
            <div className="nar-time mono" aria-live="off">{fmtTime(t / 1000)} / {fmtTime(data.durationMs / 1000)}</div>
          </div>
          <p className="nar-honest mono">Demo voice: a computer voice. Face bubble: a colour-bar test card.</p>
        </div>

        <div className="nar-tr">
          <div className="nar-lines" role="group" aria-label="Transcript with the actions it triggers">
            {lines.map((l) => (
              <p key={l.id} className="nar-line">
                {l.words.map(({w, i}) => {
                  const m = marksByWord.get(i);
                  const on = i === activeWord;
                  const done = m && data.marks.indexOf(m) <= lastMark;
                  return (
                    <span key={i} className="nar-wd">
                      <button type="button" className={`nar-w${on ? ' on' : ''}${m ? ' has' : ''}${t > w.e ? ' past' : ''}`} data-w={i} onClick={() => seek(w.s, 'word')} title={`${(w.s / 1000).toFixed(2)} s`}>{w.t}</button>
                      {m && (
                        <button type="button" className={`nar-mk${done ? ' done' : ''}`} data-mark={m.label} onClick={() => seek(m.at, 'marker')}
                          aria-label={`${m.label}, ${fmtOff(m.off)} from the word. Jump to it.`}>
                          <i aria-hidden />{m.label}<b>{fmtOff(m.off)}</b>
                        </button>
                      )}
                    </span>
                  );
                })}
              </p>
            ))}
          </div>
          <div className="nar-track" aria-hidden>
            <i style={{width: `${pct}%`}} />
            {data.marks.map((m, i) => <u key={i} className={m.kind} style={{left: `${(m.at / data.durationMs) * 100}%`}} />)}
          </div>
        </div>
      </div>

      <div className="nar-lower">
        <div className="nar-prompt">
          <div className="nar-fields">
            <label className="ctl txt"><span className="ctl-l"><span>Your product URL</span></span><input value={inputs.url} onChange={(e) => set({url: e.target.value})} spellCheck={false} autoComplete="off" /></label>
            <div className="ctl"><span className="ctl-l"><span>Your talk is</span></span>
              <div className="seg" role="radiogroup" aria-label="Input type">
                {([['voice', 'A voice memo'], ['facecam', 'A face-cam clip']] as const).map(([k, n]) => (
                  <button key={k} type="button" role="radio" aria-checked={inputs.input === k} className={inputs.input === k ? 'on' : ''} onClick={() => set({input: k})}>{n}</button>
                ))}
              </div>
            </div>
          </div>
          <CopyBtn id="prompt-narrate" text={prompt} label="Copy prompt for Narrate" primary big />
          <details className="adv sub-adv">
            <summary>Advanced<span aria-hidden>{Icon.plus}</span></summary>
            <div className="adv-in">
              <div className="ctl"><span className="ctl-l"><span>Sign-in</span></span>
                <div className="seg" role="radiogroup" aria-label="Sign-in">
                  {([['public', 'None needed'], ['login', 'My own session']] as const).map(([k, n]) => (
                    <button key={k} type="button" role="radio" aria-checked={inputs.login === k} className={inputs.login === k ? 'on' : ''} onClick={() => set({login: k})}>{n}</button>
                  ))}
                </div>
              </div>
              <button type="button" role="switch" aria-checked={inputs.vertical} className="ctl tg" onClick={() => set({vertical: !inputs.vertical})}>
                <span className="ctl-l"><span>Also make the 9:16 cut</span></span><span className={`sw${inputs.vertical ? ' on' : ''}`} aria-hidden />
              </button>
              <pre className="nar-pre" aria-label="The prompt">{prompt}</pre>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
