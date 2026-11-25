import {createContext, useContext, useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {SUBTLE_URL} from '../consts';

/* The /editor app shell: the top bar's slots (each mode portals its file label and its Export into them), a popover,
   the inspector with its icon rail, and the small shared pieces (credits, the phone note). */

const svg = (d: React.ReactNode, w = 16) => <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
export const SIcon = {
  lock: svg(<><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, 14),
  chev: svg(<path d="m6 9 6 6 6-6" />, 14),
  folder: svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />),
  file: svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>),
  back: svg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-2" /></>),
  look: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none" /></>, 18),
  keys: svg(<><rect x="2.5" y="6" width="19" height="12" rx="3" /><path d="M6.5 10h1M10.5 10h1M14.5 10h1M8 14h8" /></>, 16),
  reset: svg(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>, 14),
  scene: svg(<><rect x="3" y="4" width="18" height="16" rx="4" /><path d="M7 16l3.5-4 3 3 2-2.5L19 16" /></>, 18),
  product: svg(<><path d="M4 7h16M4 12h16M4 17h10" /></>, 18),
  motion: svg(<><path d="M4 12c4-8 12 8 16 0" /></>, 18),
  text: svg(<><path d="M5 6h14M12 6v13M9 19h6" /></>, 18),
  prompt: svg(<><path d="m5 8 4 4-4 4M12 16h7" /></>, 18),
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>, 14),
  ext: svg(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>, 14),
};

// ---------------------------------------------------------------- top bar slots
export const SlotCtx = createContext<{left: HTMLElement | null; right: HTMLElement | null}>({left: null, right: null});
/** Render children into the top bar (left: next to the logo; right: the Export corner). */
export function TopSlot({at, children}: {at: 'left' | 'right'; children: React.ReactNode}) {
  const el = useContext(SlotCtx)[at];
  return el ? createPortal(children, el) : null;
}

// ---------------------------------------------------------------- popover
/** A button that opens a small floating panel. Closes on Escape, on a click outside, or when the panel calls close(). */
export function Popover({button, label, className = '', align = 'end', children, onOpen}: {
  button: (p: {open: boolean; toggle: () => void; id: string}) => React.ReactNode; label: string; className?: string; align?: 'start' | 'end';
  children: (close: () => void) => React.ReactNode; onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); (root.current?.querySelector('[aria-haspopup]') as HTMLElement | null)?.focus(); } };
    addEventListener('pointerdown', down, true); addEventListener('keydown', key, true);
    return () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); };
  }, [open]);
  const toggle = () => setOpen((o) => { if (!o) onOpen?.(); return !o; });
  return (
    <div className="pop-root" ref={root}>
      {button({open, toggle, id})}
      {open && <div className={`pop ${align} ${className}`} id={id} role="dialog" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- inspector
export interface Section<T extends string> {id: T; name: string; icon: React.ReactNode}
/** The right panel: a vertical icon rail and ONE section at a time, with a header (title + optional action) and a footer. */
export function InspShell<T extends string>({sections, tab, setTab, action, children, footer}: {
  sections: Section<T>[]; tab: T; setTab: (t: T) => void; action?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const cur = sections.find((s) => s.id === tab) ?? sections[0];
  const onKey = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const i = sections.findIndex((s) => s.id === tab), d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    const n = sections[(i + d + sections.length) % sections.length];
    setTab(n.id); requestAnimationFrame(() => document.getElementById(`rail-${n.id}`)?.focus());
  };
  return (
    <aside className="insp" aria-label="Inspector">
      {sections.length > 1 && (
        <nav className="rail" role="tablist" aria-orientation="vertical" aria-label="Inspector sections" onKeyDown={onKey}>
          {sections.map((s) => (
            <button key={s.id} id={`rail-${s.id}`} type="button" role="tab" aria-selected={tab === s.id} aria-controls="insp-panel" tabIndex={tab === s.id ? 0 : -1}
              className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)} data-tip={s.name}>
              {s.icon}<span>{s.name}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="insp-col">
        <div className="insp-h"><h2>{cur.name}</h2>{action}</div>
        <div className="insp-body" id="insp-panel" role="tabpanel" aria-labelledby={`rail-${cur.id}`} key={cur.id}>{children}</div>
        {footer !== undefined && <div className="insp-foot">{footer}</div>}
      </div>
    </aside>
  );
}

/** A titled group inside an inspector section. */
export function Group({title, action, children, hint}: {title?: string; action?: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode}) {
  return (
    <section className="g">
      {(title || action) && <div className="g-h">{title && <h3>{title}</h3>}{action}</div>}
      <div className="g-in">{children}</div>
      {hint && <p className="hint">{hint}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- credits, phone note
export function Credits() {
  return (
    <Popover label="Image credits" align="start" className="credits-pop" button={({open, toggle, id}) => (
      <button type="button" className="foot-link" onClick={toggle} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog">{SIcon.info}Credits</button>
    )}>
      {() => (
        <p>
          Space photos in the background picker are NASA images, public domain, shown with credit: Artemis II "A Breathtaking Earthset from Orion" (NASA, 2026), Apollo 11 earthrise (NASA, AS11-44-6549),
          the Webb "Cosmic Cliffs" (NASA, ESA, CSA, STScI) and Blue Marble 2012 (NASA Earth Observatory, NOAA, Suomi NPP). NASA does not endorse Dolly. The 12 AI wallpapers are original images generated for Dolly.
          Subtitles use <a href={SUBTLE_URL} target="_blank" rel="noopener noreferrer">Subtle</a>'s caption engine.
        </p>
      )}
    </Popover>
  );
}

/** On phones the editor is a preview: this replaces the inspector and timeline. */
export function PhoneNote({children}: {children: React.ReactNode}) {
  return (
    <div className="m-note">
      <p>The editor works best on a laptop. Here you can watch the preview and copy the prompt.</p>
      {children}
    </div>
  );
}
