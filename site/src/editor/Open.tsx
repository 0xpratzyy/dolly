import {useRef, useState} from 'react';
import {Icon} from '../ui';
import {filesFromDrop} from '../clip';
import {REPO_URL} from '../consts';
import {track} from '../analytics';
import {Popover, SIcon} from './shell';

export interface OpenApi {
  open: (files: File[]) => void;
  back: () => void;
  busy: boolean;
  error: {text: string; cmd?: string} | null;
  note: string | null;
  dismiss: () => void;
}

/** The file in the top bar: its name, and a menu to open a recording folder, pick files, or go back to the demo. Nothing is uploaded. */
export function FileMenu({open, name, meta, demo}: {open: OpenApi; name: string; meta: string; demo: boolean}) {
  const dir = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) open.open(f); };
  return (
    <div className="fm">
      <Popover label="File" align="start" className="menu" button={({open: o, toggle, id}) => (
        <button type="button" className="fm-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={o} aria-controls={o ? id : undefined} disabled={open.busy} aria-busy={open.busy}>
          <span className="fm-name">{open.busy ? 'Opening…' : name}</span><span className="fm-meta">{meta}</span>{SIcon.chev}
        </button>
      )}>
        {(close) => (
          <div role="menu">
            <button type="button" role="menuitem" onClick={() => { close(); dir.current?.click(); }}>{SIcon.folder}<span>Open your recording…<small>The Dolly folder: video + events.json</small></span></button>
            <button type="button" role="menuitem" onClick={() => { close(); files.current?.click(); }}>{SIcon.file}<span>Pick files…<small>The video, events.json and plan.json</small></span></button>
            {!demo && <button type="button" role="menuitem" onClick={() => { close(); open.back(); }}>{SIcon.back}<span>Back to demo</span></button>}
            <hr />
            <a role="menuitem" href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={() => { close(); track('dolly_github', {where: 'editor'}); }}>{Icon.gh}<span>Dolly on GitHub</span>{SIcon.ext}</a>
          </div>
        )}
      </Popover>
      <span className="fm-lock" tabIndex={0} data-tip="Stays on your computer. Nothing is uploaded." aria-label="Stays on your computer. Nothing is uploaded.">{SIcon.lock}</span>
      <input ref={dir} type="file" hidden onChange={onPick} {...({webkitdirectory: '', directory: ''} as object)} />
      <input ref={files} type="file" hidden multiple accept="video/*,.mov,.mp4,.m4v,.webm,.json" onChange={onPick} />
    </div>
  );
}

export function OpenNotice({open}: {open: OpenApi}) {
  if (!open.error && !open.note) return null;
  return (
    <div className={`open-msg${open.error ? ' err' : ''}`} role={open.error ? 'alert' : 'status'}>
      <span>{open.error ? open.error.text : open.note}{open.error?.cmd && <> <code>{open.error.cmd}</code></>}</span>
      <button type="button" onClick={open.dismiss} aria-label="Dismiss">{Icon.close}</button>
    </div>
  );
}

/** Drop a recording folder (or its files) anywhere on the editor. */
export function DropZone({open, children}: {open: OpenApi; children: React.ReactNode}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const has = (e: React.DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  return (
    <div
      className="drop"
      onDragEnter={(e) => { if (!has(e)) return; depth.current++; setOver(true); }}
      onDragLeave={(e) => { if (!has(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDragOver={(e) => { if (has(e)) e.preventDefault(); }}
      onDrop={(e) => {
        if (!has(e)) return;
        e.preventDefault(); depth.current = 0; setOver(false);
        void filesFromDrop(e.dataTransfer).then((f) => f.length && open.open(f));
      }}
    >
      {children}
      {over && <div className="drop-ov" aria-hidden><span>Drop your recording folder</span><em>Stays on your computer</em></div>}
    </div>
  );
}
