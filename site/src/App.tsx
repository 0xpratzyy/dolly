import {useEffect} from 'react';
import {REPO_URL} from './consts';
import {OfferBar, RefsStrip, SiteFooter} from './RefsFooter';
import {track} from './analytics';
import {Icon} from './ui';
import {CopyPrompt} from './landing-copy';
import {HeroPlayer} from './HeroPlayer';
import {LooksTeaser} from './LooksTeaser';
import {HowItWorks, Install, Why} from './sections';

export function Header({editor = false}: {editor?: boolean}) {
  const toInstall = (e: React.MouseEvent) => {
    const el = document.getElementById('install'); if (!el) return;
    e.preventDefault(); track('dolly_install_pill');
    el.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
  };
  return (
    <header className={`top${editor ? ' wide' : ''}`}>
      <a className="brand" href="/" aria-label="Dolly"><span className="mark" aria-hidden /> <span className="wm">dolly</span></a>
      <nav aria-label="Main">
        {!editor && <a className="n-ed" href="/editor" onClick={() => track('dolly_open_editor', {where: 'header'})}>Editor</a>}
        <a className="n-gh" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" onClick={() => track('dolly_github', {where: 'header'})}>{Icon.gh}<span>GitHub</span></a>
        {!editor && <a className="pill ghost sm n-in" href="#install" onClick={toInstall}>Install</a>}
      </nav>
    </header>
  );
}

export default function App() {
  useEffect(() => { document.title = 'Dolly: screen recordings that edit themselves'; }, []);
  return (
    <>
      <OfferBar />
      <Header />
      <main>
        <section className="lp-hero" aria-labelledby="hero-h">
          <h1 id="hero-h">Screen recordings that edit themselves.</h1>
          <p className="lp-lede">Free and open source. Claude Code records, zooms and captions it for you.</p>
          <div className="lp-cta">
            <CopyPrompt mode="record" label="Copy prompt for Claude Code" variant="primary" where="hero" />
            <a className="lp-link" href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={() => track('dolly_github', {where: 'hero'})}>View on GitHub</a>
          </div>
          <HeroPlayer />
        </section>
        <HowItWorks />
        <LooksTeaser />
        <Why />
        <Install />
        <RefsStrip />
      </main>
      <SiteFooter />
    </>
  );
}
