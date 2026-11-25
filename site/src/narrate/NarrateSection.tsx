import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import data from './narrate-data.json';
import {media} from '../media';
import {Icon, fmtTime} from '../ui';
import {track} from '../analytics';
import {useCopy} from '../copy';
import {NARRATE_PROMPT_DEFAULTS, buildNarratePrompt} from './prompt';
import {Credits, Group, InspShell, PhoneNote, SIcon, TopSlot, type Section} from '../editor/shell';
import {ExportButton, PromptPreview} from '../editor/Export';
import {Field, Seg, Toggle} from '../editor/controls';

type Mark = (typeof data.marks)[number];
type Aspect = '16x9' | '9x16';

const SRC: Record<Aspect, string> = {'16x9': media('narrate/narrate-16x9.mp4'), '9x16': media('narrate/narrate-9x16.mp4')};
const POSTER: Record<Aspect, string> = {'16x9': media('narrate/poster-16x9.jpg'), '9x16': media('narrate/poster-9x16.jpg')};
const marksByWord = new Map<number, Mark>(data.marks.map((m) => [m.w, m]));
type NarTab = 'transcript' | 'film';
const TABS: Section<NarTab>[] = [{id: 'transcript', name: 'Transcript', icon: SIcon.text}, {id: 'film', name: 'Your film', icon: SIcon.prompt}];
const fmtOff = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)} ms`;

/** The words-to-clicks view: the real narrate demo (a computer voice and a test-card face) with its transcript beside it. */
export default function NarrateSection() {
  const [aspect, setAspect] = useState<Aspect>('16x9');
  const [tab, setTab] = useState<NarTab>('transcript');
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

  const seekTrack = (e: React.MouseEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * data.durationMs, 'track'); };
  const copy = <CopyBtn id="prompt-narrate" text={prompt} label="Copy prompt for Narrate" primary big />;
  const r = aspect === '16x9' ? 16 / 9 : 9 / 16;

  return (
    <div className="ws ws-sub nar">
      <TopSlot at="left"><span className="fm-title">Narrate<em>Demo · a sample voice drives the product</em></span></TopSlot>
      <TopSlot at="right">
        <ExportButton>
          {() => (
            <div className="exp-sec">
              <h3>Hand it to Claude Code</h3>
              <p className="hint">The prompt carries the repo, the install, your URL, what your talk is and the commands. Set them under Your film, then paste it into Claude Code.</p>
              {copy}
              <PromptPreview text={prompt} />
            </div>
          )}
        </ExportButton>
      </TopSlot>
      <div className="ws-stage" ref={box}>
        <div className="stage">
          <div className="nar-screen" style={{'--r': r} as React.CSSProperties}>
            <video ref={video} key="v" src={near ? SRC[aspect] : undefined} poster={POSTER[aspect]} playsInline muted={false} preload="metadata" loop={false}
              onClick={toggle} aria-label="The Narrate demo: a spoken launch video with the product driven by the words" />
          </div>
        </div>
      </div>
      <div className="ws-bar">
        <button type="button" className="ibtn play" onClick={toggle} aria-label={playing ? 'Pause the demo' : 'Play the demo'} data-tip={playing ? 'Pause' : 'Play'}>{playing ? Icon.pause : Icon.play}</button>
        <div className="nar-time" aria-live="off">{fmtTime(t / 1000)} <em>/ {fmtTime(data.durationMs / 1000)}</em></div>
        <div className="nar-track" onClick={seekTrack} role="presentation">
          <i style={{width: `${pct}%`}} />
          {data.marks.map((m, i) => <u key={i} className={m.kind} style={{left: `${(m.at / data.durationMs) * 100}%`}} />)}
        </div>
        <div className="seg slim" role="radiogroup" aria-label="Aspect ratio">
          {([['16x9', '16:9'], ['9x16', '9:16']] as [Aspect, string][]).map(([k, n]) => (
            <button key={k} type="button" role="radio" aria-checked={aspect === k} className={aspect === k ? 'on' : ''} onClick={() => pickAspect(k)}>{n}</button>
          ))}
        </div>
      </div>
      <InspShell sections={TABS} tab={tab} setTab={setTab} footer={<><Credits /><span className="foot-sp" /><span className="foot-meta">Sample voice</span></>}>
        {tab === 'transcript' && (
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
        )}
        {tab === 'film' && (
          <>
            <Group>
              <Field label="Your product URL" value={inputs.url} onChange={(v) => set({url: v})} />
              <Seg label="Your talk is" value={inputs.input} options={[['voice', 'A voice memo'], ['facecam', 'A face-cam clip']]} onChange={(v) => set({input: v})} />
            </Group>
            <Group title="Options">
              <Seg label="Sign-in" value={inputs.login} options={[['public', 'None needed'], ['login', 'My own session']]} onChange={(v) => set({login: v})} />
              <Toggle label="Also make the 9:16 cut" on={inputs.vertical} onChange={(v) => set({vertical: v})} />
            </Group>
          </>
        )}
      </InspShell>
      <PhoneNote>{copy}</PhoneNote>
    </div>
  );
}
