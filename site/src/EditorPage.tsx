import {Suspense, lazy, useEffect, useState} from 'react';
import './editor.css';
import {track} from './analytics';
import {SlotCtx} from './editor/shell';

const RecordTab = lazy(() => import('./editor/RecordTab'));
const SpotlightSection = lazy(() => import('./spotlight/SpotlightSection'));
const NarrateSection = lazy(() => import('./narrate/NarrateSection'));

const TABS = [['record', 'Record'], ['spotlight', 'Spotlight'], ['narrate', 'Narrate']] as const;
type TabId = (typeof TABS)[number][0];
const fromUrl = (): TabId => { const t = new URLSearchParams(location.search).get('tab'); return TABS.some(([id]) => id === t) ? (t as TabId) : 'record'; };

/** /editor: a full-screen app. A top bar (logo, the file, Record / Spotlight / Narrate, Export) over one workspace per mode. */
export default function EditorPage() {
  const [tab, setTab] = useState<TabId>(fromUrl);
  const [left, setLeft] = useState<HTMLElement | null>(null);
  const [right, setRight] = useState<HTMLElement | null>(null);
  useEffect(() => { document.title = 'Editor · Dolly'; }, []);
  useEffect(() => {
    const h = document.documentElement; h.classList.add('ep-root');
    return () => h.classList.remove('ep-root');
  }, []);
  useEffect(() => { const on = () => setTab(fromUrl()); addEventListener('popstate', on); return () => removeEventListener('popstate', on); }, []);
  const pick = (t: TabId) => {
    setTab(t); track('dolly_editor_tab', {tab: t});
    try { history.replaceState(null, '', `/editor${t === 'record' ? '' : `?tab=${t}`}${t === 'record' ? location.hash : ''}`); } catch { /* sandboxed */ }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault(); e.stopPropagation();
    const i = TABS.findIndex(([id]) => id === tab), n = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length][0];
    pick(n); requestAnimationFrame(() => document.getElementById(`ep-tab-${n}`)?.focus());
  };
  return (
    <div className="ep">
      <header className="ep-top">
        <div className="ep-l">
          <a className="ep-brand" href="/" aria-label="Dolly home"><span className="mark" aria-hidden /><span className="wm">dolly</span></a>
          <span className="ep-div" aria-hidden />
          <div className="ep-slot" ref={setLeft} />
        </div>
        <div className="ep-modes" role="tablist" aria-label="Mode" onKeyDown={onKey}>
          {TABS.map(([id, name]) => (
            <button key={id} id={`ep-tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls="ep-panel" tabIndex={tab === id ? 0 : -1} className={tab === id ? 'on' : ''} onClick={() => pick(id)}>{name}</button>
          ))}
        </div>
        <div className="ep-r" ref={setRight} />
      </header>
      <SlotCtx.Provider value={{left, right}}>
        <main id="ep-panel" className="ep-main" role="tabpanel" aria-labelledby={`ep-tab-${tab}`}>
          <Suspense fallback={<div className="ws ws-skel" aria-busy="true"><div className="stage" /><aside className="insp" /></div>}>
            {tab === 'record' && <RecordTab />}
            {tab === 'spotlight' && <SpotlightSection />}
            {tab === 'narrate' && <NarrateSection />}
          </Suspense>
        </main>
      </SlotCtx.Provider>
    </div>
  );
}
