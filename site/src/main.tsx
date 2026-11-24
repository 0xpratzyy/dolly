import {Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import './base.css';
import './landing.css';
import App from './App';
import {initAnalytics, trackScrollDepth} from './analytics';

const EditorPage = lazy(() => import('./EditorPage'));
const isEditor = (location.pathname.replace(/\/+$/, '') || '/') === '/editor';

// The editor used to live on this page. Old deep links (#spotlight, #narrate, #editor, a shared #e=… edit) go to the new route.
if (!isEditor) {
  const h = location.hash;
  const to = /^#spotlight\b/.test(h) ? '/editor?tab=spotlight' : /^#narrate\b/.test(h) ? '/editor?tab=narrate' : /^#(editor\b|e=)/.test(h) ? `/editor${h.startsWith('#e=') ? h : ''}` : '';
  if (to) location.replace(to);
}

createRoot(document.getElementById('root')!).render(isEditor ? <Suspense fallback={null}><EditorPage /></Suspense> : <App />);
initAnalytics();
trackScrollDepth();
