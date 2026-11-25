import {useEffect, useMemo, useRef, useState} from 'react';
import {media} from '../media';
import {Icon} from '../ui';
import {track} from '../analytics';
import {useCopy} from '../copy';
import {Field, Seg, Slider, Toggle} from '../editor/controls';
import {Credits, Group, InspShell, PhoneNote, SIcon, TopSlot, type Section} from '../editor/shell';
import {ExportButton, PromptPreview} from '../editor/Export';
import {SPOT_DEFAULTS, buildSpotlightPrompt, type SceneId, type SpotAspect, type SpotInputs} from './prompt';

// Pre-rendered with studio/spotlight.mjs from ONE capture (Subtle's Tweak cover panel, looped): every scene at every aspect, 60 fps, 7 s seamless loop.
// The Spotlight composition draws a 60 fps PNG sequence per component, which no browser plays smoothly, so the preview swaps between real renders.
const SCENES: [SceneId, string][] = [['wallpaper', 'Wallpaper'], ['studio', 'Studio'], ['curtain', 'Curtain'], ['void', 'Void']]; // wallpaper leads and is the default
const ASPECTS: SpotAspect[] = ['3:2', '16:9', '1:1', '4:5', '9:16'];
const WALLS: [string, string, string][] = [['ai-hills-golden', 'Golden meadow', 'meadow'], ['ai-alpine-dawn', 'Alpine dawn', 'alpine'], ['ai-silk-night', 'Night silk', 'silk']];
const OTHER_BG = [
  ['AI wallpapers', ['ai-alpine-dawn', 'ai-cloud-sea', 'ai-coast-golden', 'ai-curtain-light', 'ai-desert-stars', 'ai-dunes-bluehour', 'ai-forest-fog', 'ai-glass-graphite', 'ai-hills-golden', 'ai-ocean-pastel', 'ai-paper-window', 'ai-silk-night']],
  ['Space (NASA)', ['photo-earthset-artemis', 'photo-earthrise-apollo11', 'photo-cosmic-cliffs', 'photo-blue-marble']],
  ['Animated', ['liquid-dusk', 'liquid-ice', 'aurora-night', 'silk-navy', 'caustics', 'bokeh-dusk', 'hills', 'ocean']],
] as const;
const RATIO: Record<SpotAspect, number> = {'3:2': 3 / 2, '16:9': 16 / 9, '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16};
const key = (a: SpotAspect) => a.replace(':', 'x');
const clipName = (s: SceneId, bg: string) => (s === 'wallpaper' ? WALLS.find((w) => w[0] === bg)?.[2] ?? 'meadow' : s);
type SpotTab = 'scene' | 'product' | 'motion';
const TABS: Section<SpotTab>[] = [{id: 'scene', name: 'Scene', icon: SIcon.scene}, {id: 'product', name: 'Product', icon: SIcon.product}, {id: 'motion', name: 'Motion', icon: SIcon.motion}];
const clip = (s: SceneId, bg: string, a: SpotAspect) => media(`spot/${clipName(s, bg)}-${key(a)}.mp4`);

export default function SpotlightSection() {
  const [o, setO] = useState<SpotInputs>(SPOT_DEFAULTS);
  const [tab, setTab] = useState<SpotTab>('scene');
  const set = (p: Partial<SpotInputs>, what: string) => { setO((s) => ({...s, ...p})); track('dolly_spotlight_set', {what}); };
  const prompt = useMemo(() => buildSpotlightPrompt(o), [o]);
  const {CopyBtn} = useCopy(() => ({section: 'spotlight', scene: o.scene, aspect: o.aspect, tilt: o.tilt, dof: o.dof, glow: o.glow, loop: o.loop, sound: o.sound}));

  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const [hear, setHear] = useState(false); // preview audio: starts muted, because browsers block sound before a click
  const [playing, setPlaying] = useState(true);
  const visible = useRef(false);
  const want = useRef(true); // the visitor's play/pause choice
  const keep = useRef(2.6); // the moment to resume at when the clip swaps; the first view starts on the open menu (the loop itself starts closed)

  const src = clip(o.scene, o.bg, o.aspect);
  const previewBg = o.scene === 'wallpaper' && !WALLS.some((w) => w[0] === o.bg);

  // load only near the viewport; play only while it is on screen
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
      if (e.isIntersecting) setNear(true);
      const v = video.current; if (!v) return;
      if (e.isIntersecting && want.current) v.play().catch(() => {}); else v.pause();
    }, {rootMargin: '400px 0px', threshold: 0.2});
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // swapping the scene or aspect keeps the loop position, so it reads as one shot changing look
  useEffect(() => {
    const v = video.current; if (!v || !near) return;
    keep.current = v.currentTime || keep.current;
    setReady(false);
    v.src = src;
    const go = () => { try { v.currentTime = keep.current % (v.duration || 7); } catch { /* not seekable yet */ } setReady(true); if (want.current && visible.current) v.play().catch(() => {}); };
    v.addEventListener('loadeddata', go, {once: true});
    v.load();
    return () => v.removeEventListener('loadeddata', go);
  }, [src, near]);

  useEffect(() => { const v = video.current; if (v) v.muted = !hear; }, [hear, near]);
  useEffect(() => {
    const v = video.current; if (!v) return;
    const on = () => setPlaying(true), off = () => setPlaying(false);
    v.addEventListener('play', on); v.addEventListener('pause', off);
    return () => { v.removeEventListener('play', on); v.removeEventListener('pause', off); };
  }, []);
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) { want.current = true; v.play().catch(() => {}); } else { want.current = false; v.pause(); } };
  // sound needs a gesture: turning it on is one, so start playing from it
  const listen = (on: boolean) => { setHear(on); track('dolly_spotlight_set', {what: 'hear'}); const v = video.current; if (v) { v.muted = !on; if (on && v.paused) { want.current = true; v.play().catch(() => {}); } } };

  const r = RATIO[o.aspect];
  const sceneName = o.scene === 'wallpaper' ? WALLS.find((w) => w[0] === o.bg)?.[1] ?? 'Wallpaper' : SCENES.find((s) => s[0] === o.scene)![1];
  const copy = <CopyBtn id="prompt-spotlight" text={prompt} label="Copy prompt for Spotlight" primary big />;
  return (
    <div className="ws ws-sub spot">
      <TopSlot at="left"><span className="fm-title">Spotlight<em>Demo · a real settings panel, one capture</em></span></TopSlot>
      <TopSlot at="right">
        <ExportButton>
          {() => (
            <div className="exp-sec">
              <h3>Hand it to Claude Code</h3>
              <p className="hint">The prompt carries the repo, the install, your URL and component, the scene and every setting. Paste it into Claude Code.</p>
              {copy}
              <PromptPreview text={prompt} />
            </div>
          )}
        </ExportButton>
      </TopSlot>
      <div className="ws-stage" ref={box}>
        <div className="stage" style={{'--stage-r': String(Math.max(r, 1))} as React.CSSProperties}>
          <div className="spot-frame" style={{'--r': r} as React.CSSProperties} data-aspect={o.aspect} data-scene={o.scene}>
            <video ref={video} loop playsInline muted preload="none" poster={near ? undefined : media('spot/poster.jpg')} onClick={toggle} className={ready ? 'rdy' : ''}
              aria-label={`A settings panel filmed by Spotlight, ${o.scene} scene, ${o.aspect}`} />
          </div>
        </div>
      </div>
      <div className="ws-bar">
        <button type="button" className="ibtn play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} data-tip={playing ? 'Pause' : 'Play'}>{playing ? Icon.pause : Icon.play}</button>
        <p className="bar-cap"><b>{sceneName}</b><i /><span>{o.aspect}</span><i /><span>60 fps loop</span></p>
        <span className="tl-sp" />
        <button type="button" className="ibtn" onClick={() => listen(!hear)} aria-pressed={hear} aria-label={hear ? 'Mute the UI sounds' : 'Hear the UI sounds'} data-tip={hear ? 'Mute' : 'Hear it'}>{hear ? Icon.sound : Icon.mute}</button>
      </div>
      <InspShell sections={TABS} tab={tab} setTab={setTab} footer={<Credits />}>
        {tab === 'scene' && (
          <>
            <Group title="Scene">
              <div className="chips" role="radiogroup" aria-label="Scene">
                {SCENES.map(([id, name]) => <button key={id} type="button" role="radio" aria-checked={o.scene === id} className={`chip${o.scene === id ? ' on' : ''}`} onClick={() => set({scene: id}, 'scene')}>{name}</button>)}
              </div>
            </Group>
            {o.scene === 'wallpaper' && (
              <Group title="Wallpaper" hint={previewBg ? <>The preview keeps the golden meadow. Your render uses <code>{o.bg}</code>.</> : undefined}>
                <div className="chips" role="radiogroup" aria-label="Wallpaper">
                  {WALLS.map(([id, name]) => <button key={id} type="button" role="radio" aria-checked={o.bg === id} className={`chip${o.bg === id ? ' on' : ''}`} onClick={() => set({bg: id}, 'wallpaper')}>{name}</button>)}
                  <label className={`chip sel${previewBg ? ' on' : ''}`}>
                    <select value={previewBg ? o.bg : ''} onChange={(e) => e.target.value && set({bg: e.target.value}, 'wallpaper-any')} aria-label="Any other background, for your render">
                      <option value="">More for your render</option>
                      {OTHER_BG.map(([g, ids]) => <optgroup key={g} label={g}>{ids.map((id) => <option key={id} value={id}>{id.replace(/^(ai|photo)-/, '')}</option>)}</optgroup>)}
                    </select>
                  </label>
                </div>
              </Group>
            )}
            <Group title="Aspect"><Seg value={o.aspect} options={ASPECTS.map((a) => [a, a] as [SpotAspect, string])} onChange={(v) => set({aspect: v}, 'aspect')} /></Group>
          </>
        )}
        {tab === 'product' && (
          <Group hint="What Claude Code opens, finds and drives for the render.">
            <Field label="URL" value={o.url} onChange={(v) => setO((s) => ({...s, url: v}))} placeholder="https://your.product/pricing" />
            <Field label="Component" value={o.target} onChange={(v) => setO((s) => ({...s, target: v}))} placeholder="the pricing toggle" />
            <Field label="What it does" value={o.actions} onChange={(v) => setO((s) => ({...s, actions: v}))} placeholder="click Yearly, then Monthly" />
          </Group>
        )}
        {tab === 'motion' && (
          <>
            <Group title="Camera">
              <Slider label="Tilt" value={o.tilt} min={0} max={15} step={1} onChange={(v) => set({tilt: v}, 'tilt')} fmt={(v) => (v === 0 ? 'flat' : `${v}°`)} />
              <Slider label="Depth of field" value={o.dof} min={0} max={1} step={0.05} onChange={(v) => set({dof: v}, 'dof')} fmt={(v) => (v === 0 ? 'off' : v.toFixed(2))} />
              <Slider label="Hero size" value={o.hero} min={0} max={0.7} step={0.05} onChange={(v) => set({hero: v}, 'hero')} fmt={(v) => (v === 0 ? 'auto' : `${Math.round(v * 100)}%`)} />
            </Group>
            <Group title="Finish">
              <Toggle label="Edge glow" hint="Ice cyan, on the card edges" on={o.glow} onChange={(v) => set({glow: v}, 'glow')} />
              <Toggle label="Seamless loop" hint="6 to 12 s, made for X and reels" on={o.loop} onChange={(v) => set({loop: v}, 'loop')} />
              <Toggle label="UI sounds" hint="Procedural hover, press and toggle sounds" on={o.sound} onChange={(v) => set({sound: v}, 'sound')} />
              <Toggle label="Hear it here" hint="The UI sounds, from the render you are watching" on={hear} onChange={listen} />
            </Group>
          </>
        )}
      </InspShell>
      <PhoneNote>{copy}</PhoneNote>
    </div>
  );
}
