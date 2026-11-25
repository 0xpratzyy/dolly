import {useRef, useState} from 'react';
import {aiWallpaperDefs, backgroundCatalog, backgroundStyle, colorSwatches, photoDefs, mergeStyle, stylePresets, type Style, type Zoom} from '@studio/lib.ts';
import {ASPECTS, CAPTION_NAMES, CAPTION_STYLES, LOOKS} from '../data';
import {useClip} from '../clip';
import {Icon} from '../ui';
import {Colors, Field, Seg, Slider, Toggle} from './controls';
import {Credits, Group, InspShell, SIcon, type Section} from './shell';

export type TabId = 'look' | 'frame' | 'camera' | 'cursor' | 'captions';
export const TABS: Section<TabId>[] = [
  {id: 'look', name: 'Look', icon: SIcon.look},
  {id: 'frame', name: 'Frame', icon: Icon.frame},
  {id: 'camera', name: 'Camera', icon: Icon.camera},
  {id: 'cursor', name: 'Cursor', icon: Icon.cursor},
  {id: 'captions', name: 'Captions', icon: Icon.captions},
];
const pct = (v: number) => `${Math.round(v * 100)}%`;

export type SetStyle = (p: Record<string, any>, key: string) => void;

// ------------------------------------------------------------------ looks
const ratios = (w: number, h: number): Record<string, number> => ({'16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, source: w / h});
const lookStyle = (base: Style, name: string, keep: Style) => mergeStyle(base, stylePresets[name] ?? {}, {captions: keep.captions});
const sig = (s: Style) => JSON.stringify({...s, captions: 0});

function LookThumb({style}: {style: Style}) {
  const {look: LOOK, plan: {source: S}} = useClip();
  const r = ratios(S.width, S.height)[style.aspect] ?? 16 / 9;
  const BW = 128, BH = 80, pad = (Math.min(BW, BH) * style.padding) / 100 + 4;
  let w = BW - 2 * pad, h = w / r;
  if (h > BH - 2 * pad) { h = BH - 2 * pad; w = h * r; }
  const bg = style.background;
  return (
    <span className="lt" style={bg.type === 'video' ? undefined : backgroundStyle(bg)}>
      {bg.type === 'video' && <img className="lt-vid" src={LOOK} alt="" loading="lazy" />}
      <span className="lt-win" style={{width: `${(w / BW) * 100}%`, height: `${(h / BH) * 100}%`, borderRadius: Math.max(2, style.radius / 6), boxShadow: style.shadow ? `0 4px 10px rgba(0,0,0,${0.5 * style.shadow})` : undefined}}>
        {style.frame !== 'none' && <span className={`lt-bar ${style.frame}`}><i /><i /><i />{style.frame === 'browser' && <b />}</span>}
        <img src={LOOK} alt="" loading="lazy" />
      </span>
    </span>
  );
}

const MAIN_LOOKS = ['dunes', 'alpine', 'ocean', 'meadow', 'night', 'liquid'];
const QUICK_BG = ['ai-dunes-bluehour', 'ai-alpine-dawn', 'ai-ocean-pastel', 'ai-hills-golden', 'ai-glass-graphite', 'liquid-dusk', 'ribbons', 'graphite'];
const QUICK_ASPECTS: Style['aspect'][] = ['16:9', '9:16', '1:1'];

function LookPanel({style, set, onLook}: {style: Style; set: SetStyle; onLook: (name: string) => void}) {
  const clip = useClip();
  const cur = sig(style);
  const [more, setMore] = useState(false);
  const [all, setAll] = useState(false);
  const shown = more ? LOOKS : LOOKS.filter(([k]) => MAIN_LOOKS.includes(k));
  const bg = style.background;
  return (
    <>
      <Group>
        <div className="looks" role="list" aria-label="Looks">
          {shown.map(([k, name]) => {
            const ls = lookStyle(clip.base, k, style);
            const on = sig(ls) === cur;
            return (
              <button key={k} type="button" role="listitem" className={`look${on ? ' on' : ''}`} onClick={() => onLook(k)} aria-pressed={on} aria-label={`Look: ${name}`}>
                <LookThumb style={ls} /><span>{name}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="disc" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Fewer looks' : `All ${LOOKS.length} looks`}{SIcon.chev}</button>
      </Group>
      <Group title="Aspect">
        <Seg value={style.aspect} options={QUICK_ASPECTS.map((a) => [a, a] as [Style['aspect'], string])} onChange={(v) => set({aspect: v}, 'aspect')} />
      </Group>
      <Group title="Background">
        <div className="sw8">
          {QUICK_BG.map((id) => {
            const on = bg.type === 'preset' && bg.value === id;
            const name = backgroundCatalog.find((b) => b.id === id)?.name ?? id;
            return <button key={id} type="button" className={`bgt${on ? ' on' : ''}`} style={backgroundStyle({type: 'preset', value: id})} onClick={() => set({background: {type: 'preset', value: id}}, 'bg')} aria-pressed={on} aria-label={name} title={name} />;
          })}
        </div>
        <button type="button" className="disc" onClick={() => setAll(!all)} aria-expanded={all}>All backgrounds{SIcon.chev}</button>
      </Group>
      {all && <BackgroundPanel style={style} set={set} />}
    </>
  );
}

// ------------------------------------------------------------------ background
function BackgroundPanel({style, set}: {style: Style; set: SetStyle}) {
  const LOOK = useClip().look;
  const bg = style.background;
  const wall = backgroundCatalog.filter((b) => b.category === 'wallpaper');
  const grad = backgroundCatalog.filter((b) => b.category === 'gradient');
  const anim = backgroundCatalog.filter((b) => b.category === 'animated');
  const file = useRef<HTMLInputElement>(null);
  const gm = /linear-gradient\((\d+)deg,\s*(#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i.exec(bg.type === 'gradient' ? bg.value : '');
  const [g, setG] = useState({a: gm ? +gm[1] : 135, c1: gm?.[2] ?? '#1a1530', c2: gm?.[3] ?? '#86E4F0'});
  const applyG = (n: Partial<typeof g>) => { const v = {...g, ...n}; setG(v); set({background: {type: 'gradient', value: `linear-gradient(${v.a}deg, ${v.c1}, ${v.c2})`}}, 'bg-grad'); };
  const tile = (id: string, name: string) => (
    <button key={id} type="button" className={`bgt${bg.type === 'preset' && bg.value === id ? ' on' : ''}`} style={backgroundStyle({type: 'preset', value: id})}
      onClick={() => set({background: {type: 'preset', value: id}}, 'bg')} aria-pressed={bg.type === 'preset' && bg.value === id} aria-label={name} title={name}><span>{name}</span></button>
  );
  // photo tiles: a small lazy thumbnail (public/backgrounds and public/wallpapers, see scripts/prep-media.sh), the full image only loads once picked
  const photoTile = (id: string, name: string, thumb: string) => (
    <button key={id} type="button" className={`bgt${bg.type === 'preset' && bg.value === id ? ' on' : ''}`}
      onClick={() => set({background: {type: 'preset', value: id}}, 'bg')} aria-pressed={bg.type === 'preset' && bg.value === id} aria-label={name} title={name}>
      <img src={thumb} alt="" loading="lazy" decoding="async" width={240} height={150} /><span>{name}</span>
    </button>
  );
  const liveTile = (id: string, name: string) => (
    <button key={id} type="button" className={`bgt live${bg.type === 'preset' && bg.value === id ? ' on' : ''}`} style={backgroundStyle({type: 'preset', value: id})}
      onClick={() => set({background: {type: 'preset', value: id}}, 'bg')} aria-pressed={bg.type === 'preset' && bg.value === id} aria-label={`${name}, animated`} title={`${name} (animated)`}><span><i className="live-dot" aria-hidden />{name}</span></button>
  );
  return (
    <>
      <Group title="Adjust">
        <Slider label="Blur" value={bg.blur ?? 0} min={0} max={40} step={1} onChange={(v) => set({background: {blur: v}}, 'bg-blur')} fmt={(v) => `${v}px`} />
        <Slider label="Grain" value={bg.grain ?? 0} min={0} max={1} step={0.05} onChange={(v) => set({background: {grain: v}}, 'bg-grain')} fmt={pct} />
        <Slider label="Vignette" value={bg.vignette ?? 0} min={0} max={1} step={0.05} onChange={(v) => set({background: {vignette: v}}, 'bg-vig')} fmt={pct} />
      </Group>
      <Group title="Your footage and images">
        <div className="bggrid wide">
          <button type="button" className={`bgt vid${bg.type === 'video' ? ' on' : ''}`} onClick={() => set({background: {type: 'video', value: '', blur: bg.type === 'video' ? bg.blur : 40}}, 'bg')} aria-pressed={bg.type === 'video'}>
            <img src={LOOK} alt="" loading="lazy" /><span>Blurred recording</span>
          </button>
          <button type="button" className={`bgt up${bg.type === 'image' ? ' on' : ''}`} style={bg.type === 'image' ? backgroundStyle(bg) : undefined} onClick={() => file.current?.click()} aria-pressed={bg.type === 'image'}>
            <span>{bg.type === 'image' ? 'Replace image' : <>{Icon.upload} Upload image</>}</span>
          </button>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) set({background: {type: 'image', value: URL.createObjectURL(f)}}, 'bg'); e.target.value = ''; }} />
        </div>
        <p className="hint">Images stay on this device; the prompt uses a placeholder path.</p>
      </Group>
      <Group title="Animated"><div className="bggrid">{anim.map((b) => liveTile(b.id, b.name))}</div><p className="hint">These move behind the video.</p></Group>
      <Group title="AI wallpapers"><div className="bggrid">{aiWallpaperDefs.map((d) => photoTile(d.id, d.name, `/wallpapers/ai/thumbs/${d.file}`))}</div></Group>
      <Group title="Space (NASA)"><div className="bggrid">{photoDefs.map((d) => photoTile(`photo-${d.id}`, d.name, `/backgrounds/thumbs/${d.file}`))}</div><p className="hint">NASA images, public domain. See Credits below.</p></Group>
      <Group title="Wallpapers"><div className="bggrid">{wall.map((b) => tile(b.id, b.name))}</div></Group>
      <Group title="Gradients">
        <div className="bggrid">{grad.map((b) => tile(b.id, b.name))}</div>
        <div className="grad-custom">
          <span className="ctl-l"><span>Custom gradient</span></span>
          <div className="gc-row">
            <label className="swatch" style={{background: g.c1}}><input type="color" value={g.c1} onChange={(e) => applyG({c1: e.target.value})} aria-label="Gradient start colour" /></label>
            <label className="swatch" style={{background: g.c2}}><input type="color" value={g.c2} onChange={(e) => applyG({c2: e.target.value})} aria-label="Gradient end colour" /></label>
            <input type="range" min={0} max={360} step={5} value={g.a} onChange={(e) => applyG({a: +e.target.value})} aria-label="Gradient angle" style={{'--p': `${(g.a / 360) * 100}%`} as React.CSSProperties} />
            <b className="mono">{g.a}°</b>
          </div>
        </div>
      </Group>
      <Group title="Colours">
        <Colors label="Flat colour" value={bg.type === 'solid' ? bg.value : '#0C0C0D'} swatches={colorSwatches} onChange={(c) => set({background: {type: 'solid', value: c}}, 'bg-solid')} />
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ frame
function FramePanel({style, set}: {style: Style; set: SetStyle}) {
  const glow = style.border === 'glow';
  return (
    <>
      <Group title="Window">
        <Seg label="Frame" value={style.frame} options={[['none', 'None'], ['window', 'macOS'], ['browser', 'Browser']]} onChange={(v) => set({frame: v}, 'frame')} />
        {style.frame !== 'none' && (
          <>
            <Seg label="Chrome" value={style.frameTheme ?? 'auto'} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => set({frameTheme: v}, 'theme')} />
            <Field label={style.frame === 'browser' ? 'Address' : 'Title'} value={style.frameLabel} placeholder={style.frame === 'browser' ? 'yourproduct.com' : 'App name'} onChange={(v) => set({frameLabel: v}, 'label')} />
          </>
        )}
        <Slider label="Padding" value={style.padding} min={0} max={16} step={0.5} onChange={(v) => set({padding: v}, 'padding')} fmt={(v) => `${v}%`} />
        <Slider label="Corner radius" value={style.radius} min={0} max={48} step={1} onChange={(v) => set({radius: v}, 'radius')} fmt={(v) => `${v}px`} />
      </Group>
      <Group title="Shadow and edge">
        <Slider label="Shadow size" value={style.shadow} min={0} max={1} step={0.05} onChange={(v) => set({shadow: v}, 'shadow')} fmt={pct} />
        <Colors label="Shadow colour" value={style.shadowColor ?? '#000000'} swatches={['#000000', '#0e1a3a', '#3b1d5a', '#5a1d2d', '#12332a']} onChange={(c) => set({shadowColor: c}, 'shadow-c')} />
        <Seg label="Edge" value={style.border ?? 'none'} options={[['none', 'None'], ['hairline', 'Hairline'], ['glow', 'Glow']]} onChange={(v) => set({border: v}, 'border')} />
        {glow && <Colors label="Glow colour" value={style.borderColor ?? '#86E4F0'} swatches={['#86E4F0', '#ffffff', '#9a6bff', '#ff7fb0', '#3be0c6']} onChange={(c) => set({borderColor: c}, 'border-c')} />}
      </Group>
      <Group title="Canvas">
        <Seg label="Aspect ratio" value={style.aspect} options={ASPECTS.map((a) => [a, a] as [Style['aspect'], string])} onChange={(v) => set({aspect: v}, 'aspect')} />
        <Seg label="Recording fits" value={style.fit} options={[['letterbox', 'Whole screen'], ['crop', 'Fill and pan']]} onChange={(v) => set({fit: v}, 'fit')} />
        <Seg label="Resolution" value={style.resolution} options={[['1080p', '1080p'], ['4k', '4K'], ['source', 'Source']]} onChange={(v) => set({resolution: v}, 'res')} />
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ camera (+ the selected zoom)
function ZoomCard({z, patch, onPick, onRemove, onAfter}: {z: Zoom; patch: (p: Partial<Zoom>, key: string) => void; onPick: () => void; onRemove: () => void; onAfter: () => void}) {
  const DUR = useClip().plan.source.durationMs;
  const len = z.endMs - z.startMs;
  const ease = Math.round((z.inMs + z.outMs) / 2);
  const t = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  return (
    <section className="g zed" aria-label="Selected zoom">
      <div className="g-h"><h3>Selected zoom</h3><span className="g-meta">{t(z.startMs)} – {t(z.endMs)}</span></div>
      <div className="g-in">
        <Slider label="Depth" value={z.scale} min={1.1} max={3.2} step={0.05} onChange={(v) => patch({scale: +v.toFixed(2)}, 'zd:' + z.id)} fmt={(v) => `${v.toFixed(2)}×`} />
        <Slider label="Ease in and out" value={ease} min={200} max={1500} step={50} onChange={(v) => patch({inMs: v, outMs: v}, 'ze:' + z.id)} fmt={(v) => `${v} ms`} />
        <Slider label="Starts at" value={z.startMs} min={0} max={Math.max(0, DUR - len)} step={100} onChange={(v) => patch({startMs: v, endMs: v + len}, 'zs:' + z.id)} fmt={t} />
        <Slider label="Length" value={len} min={z.inMs + z.outMs + 200} max={Math.min(12000, DUR - z.startMs)} step={100} onChange={(v) => patch({endMs: z.startMs + v}, 'zl:' + z.id)} fmt={t} />
        <div className="ctl">
          <span className="ctl-l" title="Where the camera looks at full zoom"><span>Focus</span><b>{Math.round(z.center.x)}, {Math.round(z.center.y)}</b></span>
          <div className="btnrow">
            <button type="button" className="chip grow" onClick={onPick}>{Icon.target}Set on the frame</button>
            <button type="button" className="ibtn" onClick={onRemove} aria-label="Remove this zoom" data-tip="Remove">{Icon.trash}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CameraPanel({style, set, zoom, patchZoom, onPick, onRemove, onAdd}: {style: Style; set: SetStyle; zoom: Zoom | undefined; patchZoom: (id: string, p: Partial<Zoom>, key: string) => void; onPick: () => void; onRemove: () => void; onAdd: () => void}) {
  const off = !style.zoom.auto;
  return (
    <>
      {zoom ? (
        <ZoomCard z={zoom} patch={(p, k) => patchZoom(zoom.id, p, k)} onPick={onPick} onRemove={onRemove} onAfter={() => {}} />
      ) : (
        <section className="g zed empty">
          <p className="hint">Select a zoom on the timeline to edit its depth, ease and focus. Drag a block to move it, its edges to retime it.</p>
          <button type="button" className="chip grow" onClick={onAdd}>{Icon.plus}Add zoom at playhead<kbd>Z</kbd></button>
        </section>
      )}
      <Group title="Auto zoom">
        <Toggle label="Auto zoom" hint="Planned from where you click." on={style.zoom.auto} onChange={(v) => set({zoom: {auto: v}}, 'zoom-auto')} />
        <Slider label="Zoom depth" hint="Multiplies every zoom." value={style.zoom.amount} min={0.3} max={1.6} step={0.05} disabled={off} onChange={(v) => set({zoom: {amount: v}}, 'zoom-amount')} fmt={(v) => `${(1 + 0.9 * v).toFixed(1)}×`} />
        <Slider label="Zoom speed" value={style.zoom.speed} min={0.5} max={2.5} step={0.1} disabled={off} onChange={(v) => set({zoom: {speed: v}}, 'zoom-speed')} fmt={(v) => `${v.toFixed(1)}×`} />
        <Slider label="Follow the cursor" value={style.zoom.follow} min={0} max={1} step={0.05} disabled={off} onChange={(v) => set({zoom: {follow: v}}, 'zoom-follow')} fmt={pct} />
      </Group>
      <Group title="Motion">
        <Slider label="Motion blur" value={style.motionBlur} min={0} max={1} step={0.05} onChange={(v) => set({motionBlur: v}, 'mblur')} fmt={pct} />
        <Toggle label="Skip the idle bits" hint="Speeds up long pauses." on={style.idleSpeedup} onChange={(v) => set({idleSpeedup: v}, 'idle')} />
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ cursor
const CURSORS: [NonNullable<Style['cursor']['style']>, string, React.ReactNode][] = [
  ['arrow', 'Arrow', <svg key="a" viewBox="0 0 16 23" width="18" height="26"><path d="M1 1 L1 18.2 L5.3 14.3 L8.2 21 L11 19.8 L8.1 13.3 L13.9 13.3 Z" fill="#fff" stroke="#0C0C0D" strokeWidth="1.5" strokeLinejoin="round" /></svg>],
  ['hand', 'Hand', <svg key="h" viewBox="0 0 22 24" width="22" height="24"><path d="M8.2 1.3c-1 0-1.7.8-1.7 1.8v8.1l-1.3-1.4c-.7-.7-1.8-.7-2.5 0-.6.6-.6 1.5-.1 2.2l4.6 5.9c.9 1.2 2.3 1.9 3.8 1.9h2.6c2.6 0 4.7-2.1 4.7-4.7V10c0-.9-.7-1.6-1.6-1.6s-1.6.7-1.6 1.6V9c0-.9-.7-1.6-1.6-1.6S11.9 8.1 11.9 9V8c0-.9-.7-1.6-1.6-1.6-.4 0-.7.1-.9.3V3.1c0-1-.2-1.8-1.2-1.8z" fill="#fff" stroke="#0C0C0D" strokeWidth="1.3" strokeLinejoin="round" /></svg>],
  ['dot', 'Dot', <svg key="d" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="7" fill="#F2F3F4" stroke="#0C0C0D" strokeOpacity=".75" strokeWidth="2" /></svg>],
  ['ring', 'Ring', <svg key="r" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="8" fill="rgba(242,243,244,.12)" stroke="#F2F3F4" strokeWidth="2.6" /></svg>],
];
function CursorPanel({style, set}: {style: Style; set: SetStyle}) {
  const c = style.cursor;
  return (
    <>
      <Group title="Pointer">
        <Toggle label="Show the cursor" on={c.visible} onChange={(v) => set({cursor: {visible: v}}, 'cursor-vis')} />
        <div className="ctl" role="radiogroup" aria-label="Cursor style">
          <span className="ctl-l"><span>Style</span></span>
          <div className="curs">
            {CURSORS.map(([k, name, svg]) => (
              <button key={k} type="button" role="radio" aria-checked={(c.style ?? 'arrow') === k} className={`cur${(c.style ?? 'arrow') === k ? ' on' : ''}`} onClick={() => set({cursor: {style: k}}, 'cursor-style')}>
                <span>{svg}</span>{name}
              </button>
            ))}
          </div>
        </div>
        <Slider label="Size" value={c.size} min={0.6} max={2.4} step={0.1} disabled={!c.visible} onChange={(v) => set({cursor: {size: v}}, 'cursor-size')} fmt={(v) => `${v.toFixed(1)}×`} />
        <Slider label="Smoothing" hint="Turns a shaky hand into a glide." value={c.smoothing} min={0} max={1} step={0.05} disabled={!c.visible} onChange={(v) => set({cursor: {smoothing: v}}, 'cursor-smooth')} fmt={pct} />
        <Toggle label="Hide when idle" on={c.hideWhenIdle} onChange={(v) => set({cursor: {hideWhenIdle: v}}, 'cursor-idle')} />
      </Group>
      <Group title="Clicks and keys">
        <Seg label="Click effect" value={style.clickEffect} options={[['ripple', 'Ripple'], ['highlight', 'Highlight'], ['none', 'None']]} onChange={(v) => set({clickEffect: v}, 'click')} />
        <Toggle label="Show keyboard shortcuts" hint="Labels like ⌘K appear on screen." on={style.keystrokes} onChange={(v) => set({keystrokes: v}, 'keys')} />
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ subtitles
function SubtitlesPanel({style, set, lines, setLines}: {style: Style; set: SetStyle; lines: string[]; setLines: (l: string[]) => void}) {
  const c = style.captions;
  return (
    <>
      <Group hint="Drawn by Subtle's caption engine, so every Subtle style works.">
        <Toggle label="Show captions" on={c.enabled} onChange={(v) => set({captions: {enabled: v}}, 'caps-on')} />
        <div className={`ctl${c.enabled ? '' : ' off'}`}>
          <span className="ctl-l"><span>Style</span><b>{c.style}</b></span>
          <div className="styles" role="radiogroup" aria-label="Subtitle style">
            {CAPTION_NAMES.map((n) => <button key={n} type="button" role="radio" aria-checked={c.style === n} className={`chip${c.style === n ? ' on' : ''}`} title={CAPTION_STYLES[n]?.description} onClick={() => set({captions: {style: n}}, 'caps-style')}>{n}</button>)}
          </div>
        </div>
        <Seg label="Position" value={c.position} options={[['bottom', 'Bottom'], ['middle', 'Middle'], ['top', 'Top']]} onChange={(v) => set({captions: {position: v}}, 'caps-pos')} />
        <Slider label="Size" value={c.size} min={0.6} max={1.6} step={0.05} onChange={(v) => set({captions: {size: v}}, 'caps-size')} fmt={(v) => `${v.toFixed(2)}×`} disabled={!c.enabled} />
      </Group>
      <Group title="Lines" hint="Wrap a word in *stars* to highlight it.">
        {lines.map((l, i) => <Field key={i} label={`Line ${i + 1}`} value={l} onChange={(v) => setLines(lines.map((x, j) => (j === i ? v : x)))} />)}
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ the inspector
export interface InspectorProps {
  tab: TabId; setTab: (t: TabId) => void; style: Style; sel: Zoom | undefined;
  set: SetStyle; patchZoom: (id: string, p: Partial<Zoom>, key: string) => void; onPick: () => void; onRemove: () => void; onAdd: () => void;
  lines: string[]; setLines: (l: string[]) => void; onLook: (n: string) => void; onReset: () => void;
}
export function Inspector(p: InspectorProps) {
  const {tab, setTab, style} = p;
  return (
    <InspShell sections={TABS} tab={tab} setTab={setTab}
      action={tab === 'look' && <button type="button" className="ibtn sm" onClick={p.onReset} aria-label="Reset everything to the original" data-tip="Reset all">{SIcon.reset}</button>}
      footer={<Credits />}>
      {tab === 'look' && <LookPanel style={style} set={p.set} onLook={p.onLook} />}
      {tab === 'frame' && <FramePanel style={style} set={p.set} />}
      {tab === 'camera' && <CameraPanel style={style} set={p.set} zoom={p.sel} patchZoom={p.patchZoom} onPick={p.onPick} onRemove={p.onRemove} onAdd={p.onAdd} />}
      {tab === 'cursor' && <CursorPanel style={style} set={p.set} />}
      {tab === 'captions' && <SubtitlesPanel style={style} set={p.set} lines={p.lines} setLines={p.setLines} />}
    </InspShell>
  );
}
