import {Suspense, lazy, useDeferredValue, useMemo} from 'react';
import {POSTER} from '../data';
import {buildPrompt, styleJson} from '../prompt';
import {useCopy} from '../copy';
import {useEdit} from './state';

const Editor = lazy(() => import('./Editor'));

function Skeleton() {
  return (
    <div className="ed ed-skel" aria-busy="true" aria-label="Loading the editor">
      <div className="ed-main"><div className="stage"><img className="stage-ph" src={POSTER} alt="" /></div><div className="tl" /></div>
      <aside className="insp" />
    </div>
  );
}

/** The Record tab: the editor over the demo recording. */
export default function RecordTab() {
  const ed = useEdit();
  const deferred = useDeferredValue(ed.edit);
  const prompt = useMemo(() => buildPrompt(deferred.style, deferred.lines, deferred.zooms), [deferred]);
  const json = useMemo(() => styleJson(deferred.style), [deferred.style]);
  const {CopyBtn} = useCopy(() => ({aspect: ed.edit.style.aspect, frame: ed.edit.style.frame, captions: ed.edit.style.captions.enabled ? ed.edit.style.captions.style : 'off'}));
  return (
    <section className="editor-sec" id="editor" aria-label="Editor">
      <Suspense fallback={<Skeleton />}>
        <Editor ed={ed} CopyBtn={CopyBtn} prompt={prompt} json={json} />
      </Suspense>
    </section>
  );
}
