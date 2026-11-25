import {useState} from 'react';
import {Icon} from './ui';
import {copyText} from './copy';
import {track} from './analytics';

/** A command block you can click to copy. */
export function Cmd({lines, label = 'Copy command', copy}: {lines: string[]; label?: string; copy?: string}) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="cmdbox" aria-label={label} onClick={async () => { if (await copyText(copy ?? lines.join('\n'))) { setOk(true); setTimeout(() => setOk(false), 1500); } track('dolly_copied', {what: 'cmd'}); }}>
      <code>{lines.map((l, i) => <span key={i} className={l.startsWith('#') ? 'c' : ''}>{l.startsWith('#') ? l : <><b>$</b>{l}</>}{'\n'}</span>)}</code>
      <span className="cmd-copy" aria-hidden>{ok ? Icon.check : Icon.copy}</span>
    </button>
  );
}
