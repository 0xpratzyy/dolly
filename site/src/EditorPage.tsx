import {Suspense, lazy, useEffect, useState} from 'react';
import './editor.css';
import {Header} from './App';
import {SiteFooter} from './RefsFooter';
import {SUBTLE_URL} from './consts';
import {track} from './analytics';

const RecordTab = lazy(() => import('./editor/RecordTab'));
const SpotlightSection = lazy(() => import('./spotlight/SpotlightSection'));
const NarrateSection = lazy(() => import('./narrate/NarrateSection'));

const TABS = [['record', 'Record'], ['spotlight', 'Spotlight'], ['narrate', 'Narrate']] as const;
type TabId = (typeof TABS)[number][0];
const fromUrl = (): TabId => { const t = new URLSearchParams(location.search).get('tab'); return TABS.some(([id]) => id === t) ? (t as TabId) : 'record'; };

/** /editor: everything interactive. Three tabs (Record, Spotlight, Narrate), each ends in one filled Copy prompt button; the credits sit at the foot. */
export default function EditorPage() {
  const [tab, setTab] = useState<TabId>(fromUrl);
  useEffect(() => { document.title = 'Editor · Dolly'; }, []);
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
    <>
      <Header editor />
      <main className="ep">
        <div className="ep-bar">
          <div className="ep-tabs" role="tablist" aria-label="Editor" onKeyDown={onKey}>
            {TABS.map(([id, name]) => (
              <button key={id} id={`ep-tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls="ep-panel" tabIndex={tab === id ? 0 : -1} className={tab === id ? 'on' : ''} onClick={() => pick(id)}>{name}</button>
            ))}
          </div>
          <p className="ep-note">The editor is easier on a laptop.</p>
        </div>
        <div id="ep-panel" role="tabpanel" aria-labelledby={`ep-tab-${tab}`}>
          <Suspense fallback={<div className="ep-load" aria-busy="true" />}>
            {tab === 'record' && <RecordTab />}
            {tab === 'spotlight' && <SpotlightSection />}
            {tab === 'narrate' && <NarrateSection />}
          </Suspense>
        </div>
        <p className="ep-credits">
          Space photos in the background picker are NASA images, public domain, shown with credit: Artemis II "A Breathtaking Earthset from Orion" (NASA, 2026), Apollo 11 earthrise (NASA, AS11-44-6549), the Webb "Cosmic Cliffs" (NASA, ESA, CSA, STScI) and Blue Marble 2012 (NASA Earth Observatory, NOAA, Suomi NPP). NASA does not endorse Dolly. The 12 AI wallpapers are original images generated for Dolly. Subtitles use <a href={SUBTLE_URL} target="_blank" rel="noopener noreferrer">Subtle</a>'s caption engine.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
