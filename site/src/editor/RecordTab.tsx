import {Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
import {POSTER} from '../data';
import {buildPrompt, styleJson} from '../prompt';
import {useCopy} from '../copy';
import {track} from '../analytics';
import {ClipCtx, DEMO_CLIP, OpenError, clipFromFiles, makeStrip, type Clip} from '../clip';
import {useEdit} from './state';
import type {OpenApi} from './Open';

const Editor = lazy(() => import('./Editor'));

function Skeleton() {
  return (
    <div className="ws ws-rec ws-skel" aria-busy="true" aria-label="Loading the editor">
      <div className="ws-stage"><div className="stage"><img className="stage-ph" src={POSTER} alt="" /></div></div>
      <aside className="insp" />
      <div className="tl" />
    </div>
  );
}

/** One document: the editor state, prompt and Export for one clip. Re-mounted (fresh undo history) when the clip changes. */
function ClipEditor({clip, open}: {clip: Clip; open: OpenApi}) {
  const ed = useEdit(clip);
  const deferred = useDeferredValue(ed.edit);
  const prompt = useMemo(() => buildPrompt(deferred.style, deferred.lines, deferred.zooms, clip), [deferred, clip]);
  const json = useMemo(() => styleJson(deferred.style), [deferred.style]);
  const {CopyBtn} = useCopy(() => ({aspect: ed.edit.style.aspect, frame: ed.edit.style.frame, captions: ed.edit.style.captions.enabled ? ed.edit.style.captions.style : 'off'}));
  return (
    <ClipCtx.Provider value={clip}>
      <Editor ed={ed} CopyBtn={CopyBtn} prompt={prompt} json={json} open={open} />
    </ClipCtx.Provider>
  );
}

/** The Record tab: the editor over the demo recording, or over one the visitor opened (never uploaded: object URLs only). */
export default function RecordTab() {
  const [clip, setClip] = useState<Clip>(DEMO_CLIP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OpenApi['error']>(null);
  const [note, setNote] = useState<string | null>(null);
  const live = useRef<Clip>(DEMO_CLIP);

  const release = (c: Clip) => { if (!c.demo) URL.revokeObjectURL(c.video); };
  useEffect(() => () => release(live.current), []);

  const open = useCallback(async (files: File[]) => {
    setBusy(true); setError(null); setNote(null);
    try {
      const next = await clipFromFiles(files);
      release(live.current); live.current = next; setClip(next);
      track('dolly_open_recording', {planned: !!next.planned});
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sandboxed */ } // drop the demo's share-link hash
      setNote(next.planned ? `Opened ${next.name}. No plan.json in the folder, so the zooms were planned here from events.json.` : `Opened ${next.name} with its plan.json.`);
      void makeStrip(next.video, next.plan.source.durationMs).then((strip) => { if (strip && live.current === next) { const n = {...next, strip}; live.current = n; setClip(n); } });
    } catch (e) {
      setError(e instanceof OpenError ? {text: e.message, cmd: e.cmd} : {text: "Couldn't open that. Open the Dolly recording folder (video + events.json)."});
    } finally { setBusy(false); }
  }, []);
  const back = useCallback(() => { release(live.current); live.current = DEMO_CLIP; setClip(DEMO_CLIP); setError(null); setNote(null); }, []);
  const api: OpenApi = {open, back, busy, error, note, dismiss: () => { setError(null); setNote(null); }};

  return (
    <Suspense fallback={<Skeleton />}>
      <ClipEditor key={clip.id} clip={clip} open={api} />
    </Suspense>
  );
}
