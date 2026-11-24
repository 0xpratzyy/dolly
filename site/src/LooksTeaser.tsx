import {useEffect, useRef, useState} from 'react';
import {media} from './media';
import {track} from './analytics';

// Six looks of the same moment, each rendered with the real composition (studio/dolly.mjs render --style <look>), so the landing page
// never pulls the Remotion player in. Clicking a chip swaps the clip; the editor has the other eight and every control.
const LOOKS: [string, string][] = [['dunes', 'Dunes'], ['alpine', 'Alpine dawn'], ['ocean', 'Pastel ocean'], ['meadow', 'Golden meadow'], ['night', 'Glass graphite'], ['liquid', 'Liquid dusk']];
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function LooksTeaser() {
  const [k, setK] = useState(0);
  const [near, setNear] = useState(false);
  const [live, setLive] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const visible = useRef(false);
  const still = useRef(reduced());
  const [id, name] = LOOKS[k];

  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
      if (e.isIntersecting) setNear(true);
      const v = video.current; if (!v || still.current) return;
      if (e.isIntersecting) v.play().catch(() => {}); else v.pause();
    }, {rootMargin: '300px 0px', threshold: 0.2});
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const v = video.current; if (!v || !near || still.current) return;
    setLive(false);
    v.src = media(`hero/looks/${id}.mp4`); v.load();
    if (visible.current) v.play().catch(() => {});
  }, [id, near]);

  return (
    <section className="lp-sec lp-looks" id="looks" aria-labelledby="lk-h">
      <h2 id="lk-h">Make it yours.</h2>
      <p className="lp-sub">Pick a look. Change anything else by asking Claude.</p>
      <div className="lp-looks-stage" ref={box}>
        <img key={id} className="hp-poster" src={media(`hero/looks/${id}.jpg`)} alt={`The same recording in the ${name} look`} loading="lazy" decoding="async" width={1920} height={1080} />
        {!still.current && <video ref={video} className={live ? 'on' : ''} muted loop playsInline preload="none" onPlaying={() => setLive(true)} aria-hidden />}
      </div>
      <div className="lp-chips" role="radiogroup" aria-label="Look">
        {LOOKS.map(([lid, n], i) => (
          <button key={lid} type="button" role="radio" aria-checked={i === k} className={`lp-chip${i === k ? ' on' : ''}`} onClick={() => { setK(i); track('dolly_look_teaser', {look: lid}); }}>{n}</button>
        ))}
      </div>
      <a className="pill ghost big" href="/editor" onClick={() => track('dolly_open_editor', {where: 'looks'})}>Open the editor</a>
    </section>
  );
}
