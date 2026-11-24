import {useEffect, useState} from 'react';
import {ctaClick, refsUrl, track} from './analytics';
import {REPO_URL} from './consts';

/** The offer bar above the header: Refs Pro's first year at 50% off (REFS50, applied at checkout with no code) and a quiet,
 *  real countdown to when the offer ends. Fixed height, tabular figures, so the ticking never moves anything. Gone once it has ended. */
const OFFER_ENDS = Date.parse('2026-11-30T18:29:59Z'); // end of 30 Nov in India, as FIRST_YEAR_OFFER_UNTIL on refs.video
const two = (n: number) => String(n).padStart(2, '0');
export function OfferBar() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = OFFER_ENDS - now;
  if (left <= 0) return null;
  const d = Math.floor(left / 864e5), h = Math.floor(left / 36e5) % 24, m = Math.floor(left / 6e4) % 60, s = Math.floor(left / 1e3) % 60;
  return (
    <div className="ob">
      <span>Refs Pro is 50% off<span className="ob-long"> · ends in </span><span className="ob-sep"> · </span><time className="ob-clock" role="timer" aria-label={`${d} days ${h} hours ${m} minutes left`}>{d}d {two(h)}:{two(m)}:{two(s)}</time></span>
      <a href={refsUrl('/pricing') + '#yearly'} onClick={() => ctaClick('header')}>Claim →</a>
    </div>
  );
}

/** One clean hand-off to Refs: a hairline, a sentence, one button. */
export function RefsStrip() {
  return (
    <section className="lp-refs" aria-label="Refs">
      <p><b>Dolly polishes the recording. Refs plans the whole film.</b><br /><span>5,400+ launch videos, taken apart for Claude.</span></p>
      <a className="pill ghost" href={refsUrl('/')} onClick={() => ctaClick('footer')}>Explore Refs</a>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="lp-foot">
      <span>© 2026 Refs · Dolly is open source</span>
      <nav aria-label="Footer">
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={() => track('dolly_github', {where: 'footer'})}>GitHub</a>
        <a href={refsUrl('/')} onClick={() => ctaClick('footer')}>Refs</a>
        <a href="https://refs.video/privacy">Privacy</a>
        <a href="https://x.com/pratyushrungta" target="_blank" rel="noopener noreferrer">Contact</a>
      </nav>
    </footer>
  );
}
