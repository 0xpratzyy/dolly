import {useCallback, useRef, useState} from 'react';
import {Icon} from './ui';
import {track} from './analytics';

export async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* fall through */ }
  try {
    const a = document.createElement('textarea');
    a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select();
    const ok = document.execCommand('copy'); a.remove(); return ok;
  } catch { return false; }
}

export interface CopyProps {id: string; text: string | (() => string); label: string; primary?: boolean; big?: boolean; icon?: React.ReactNode; small?: boolean}
export type CopyBtn = (p: CopyProps) => React.ReactElement;

/** A copy button that says "Copied" for a moment and reports the click. */
export function useCopy(meta: () => Record<string, unknown>) {
  const [copied, setCopied] = useState('');
  const m = useRef(meta); m.current = meta;
  const doCopy = useCallback(async (id: string, text: string) => {
    const ok = await copyText(text);
    if (ok) { setCopied(id); setTimeout(() => setCopied((c) => (c === id ? '' : c)), 1700); }
    track('dolly_copied', {what: id, ok, ...m.current()});
    return ok;
  }, []);
  const CopyBtn: CopyBtn = useCallback(({id, text, label, primary, big, icon, small}) => (
    <button type="button" className={`pill${primary ? ' primary' : ' ghost'}${big ? ' big' : ''}${small ? ' sm' : ''}`} onClick={() => doCopy(id, typeof text === 'function' ? text() : text)} data-copied={copied === id}>
      {copied === id ? Icon.check : icon ?? Icon.copy}{copied === id ? 'Copied' : label}
    </button>
  ), [copied, doCopy]);
  return {CopyBtn, doCopy, copied};
}
