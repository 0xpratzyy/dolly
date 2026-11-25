import {useEffect, useState} from 'react';
import {track} from './analytics';

/** Refs' Black Friday offer, a bar above the header. Shows only during the sale (it ends Mon 30 Nov 23:59 PT, the same
 *  window refs.video uses) and disappears by itself after, with no deploy. Links to Refs' pricing page. */
const BF_END = Date.parse('2026-12-01T07:59:59Z');
const URL = 'https://refs.video/pricing?from=dolly-bf';

function left(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m` : `${h}h ${String(m).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`;
}

export function RefsBF() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (now == null || now > BF_END) return null;
  return (
    <div className="rbf">
      <a href={URL} target="_blank" rel="noopener" onClick={() => track('dolly_refs_bf', {})}>
        <span className="rbf-tag">Black Friday on Refs</span>
        <span className="rbf-deal"><b>59%</b> off Refs Pro<span className="rbf-long">, your first year</span></span>
        <span className="rbf-time">Ends in <b>{left(BF_END - now)}</b></span>
        <span className="rbf-go">Claim now</span>
      </a>
    </div>
  );
}
