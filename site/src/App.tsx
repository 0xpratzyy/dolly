import {useEffect} from 'react';
import {REPO_URL} from './consts';
import {RefsFooter, RefsUpsell} from './RefsFooter';
import {track} from './analytics';
import {Icon} from './ui';
import {CopyPrompt} from './landing-copy';
import {HeroPlayer} from './HeroPlayer';
import {Bento} from './Bento';
import {HowItWorks, Install} from './sections';
import {RefsBF} from './RefsBF';

export function Header({editor = false}: {editor?: boolean}) {
  return (
    <header className={`top${editor ? ' wide' : ''}`}>
      <a className="brand" href="/" aria-label="Dolly"><span className="mark" aria-hidden /> <span className="wm">dolly</span></a>
      <nav aria-label="Main">
        {!editor && <a className="pill sm n-ed" href="/editor" onClick={() => track('dolly_open_editor', {where: 'header'})}>Editor</a>}
        <a className="n-gh" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" onClick={() => track('dolly_github', {where: 'header'})}>{Icon.gh}<span>GitHub</span></a>
      </nav>
    </header>
  );
}

export default function App() {
  useEffect(() => { document.title = 'Dolly: screen recordings that edit themselves'; }, []);
  return (
    <>
      <RefsBF />
      <Header />
      <main>
        <section className="lp-hero" aria-labelledby="hero-h">
          <h1 id="hero-h">Screen recordings that edit themselves.</h1>
          <p className="lp-lede">Free and open source. Claude Code records, zooms and captions it for you.</p>
          <div className="lp-cta">
            <CopyPrompt mode="record" label="Copy prompt for Claude Code" variant="primary" where="hero" />
            <a className="pill big ghost" href="/editor" onClick={() => track('dolly_open_editor', {where: 'hero'})}>Open the editor</a>
          </div>
          <HeroPlayer />
        </section>
        <HowItWorks />
        <Bento />
        <Install />
        <RefsUpsell />
      </main>
      <RefsFooter />
    </>
  );
}
