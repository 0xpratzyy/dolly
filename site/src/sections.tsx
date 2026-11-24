import {useState} from 'react';
import {Icon} from './ui';
import {copyText} from './copy';
import {Cmd} from './cmd';
import {INSTALL, REPO_URL} from './consts';
import {track} from './analytics';

/** Three lines, no cards, no code: how the thing is used. The numbers are the only cyan in this block. */
export function HowItWorks() {
  const steps: [string, string, string][] = [
    ['1', 'Install the skill.', 'One command, on your Mac.'],
    ['2', 'Tell Claude what to film.', 'A recording, a URL, your voice or one component.'],
    ['3', 'Get the video.', '16:9 and 9:16, ready to post.'],
  ];
  return (
    <section className="lp-sec lp-how" id="how" aria-label="How it works">
      <ol>
        {steps.map(([n, t, d]) => (
          <li key={n}><span className="lp-n">{n}</span><div><h3>{t}</h3><p>{d}</p></div></li>
        ))}
      </ol>
    </section>
  );
}

/** Three facts and one honest sentence, in place of twelve feature cards and a table. */
export function Why() {
  return (
    <section className="lp-sec lp-why" aria-label="Why Dolly">
      <ul>
        <li><h3>Free and open source.</h3><p>No account, no watermark.</p></li>
        <li><h3>Runs on your Mac.</h3><p>Recording, planning and rendering stay local. Nothing is uploaded.</p></li>
        <li><h3>Edit by asking.</h3><p>"Zoom less on the settings panel." Claude re-renders.</p></li>
      </ul>
      <p className="lp-note">Screen Studio is a polished app for editing by hand. Dolly is for when you would rather ask.</p>
    </section>
  );
}

const FAQS: [string, React.ReactNode][] = [
  ['Is it really free?', 'Yes. Open source, no account, no watermark. It runs inside Claude Code, on your own Claude plan.'],
  ['Does it work on Windows or Linux?', 'The screen recorder is Mac only. The planner and renderer should run anywhere Node, ffmpeg and Chromium do, but we have only tested on a Mac.'],
  ['Where does my recording go?', 'Nowhere. Recording, planning and rendering all happen on your machine.'],
  ['Can it record an app behind a login?', 'Yes, with a test account or a session you sign in to yourself. Claude never sees your password.'],
];

/** The install block (the header's Install button lands here) and four plain questions. */
function InstallPill() {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="pill primary big lp-full" data-copied={ok} onClick={async () => { if (await copyText(INSTALL)) { setOk(true); setTimeout(() => setOk(false), 1500); } track('dolly_copied', {what: 'install-pill'}); }}>
      {ok ? Icon.check : Icon.copy}{ok ? 'Copied' : 'Copy install command'}
    </button>
  );
}

export function Install() {
  return (
    <section className="lp-sec lp-install" id="install" aria-labelledby="in-h">
      <h2 id="in-h">One command, then ask Claude.</h2>
      <Cmd lines={[INSTALL]} label="Copy the install command" />
      <InstallPill />
      <p className="lp-small">Needs macOS, Node 22+, ffmpeg and Claude Code.</p>
      <a className="lp-link" href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={() => track('dolly_github', {where: 'install'})}>View on GitHub</a>
      <div className="lp-faq" id="faq">
        {FAQS.map(([q, a]) => (
          <details key={q} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && track('dolly_faq', {q})}>
            <summary>{q}<span aria-hidden>{Icon.plus}</span></summary>
            <p>{a}</p>
          </details>
        ))}
        <a className="lp-faq-more" href={`${REPO_URL}#readme`} target="_blank" rel="noopener noreferrer">More in the README <span aria-hidden>→</span></a>
      </div>
    </section>
  );
}
