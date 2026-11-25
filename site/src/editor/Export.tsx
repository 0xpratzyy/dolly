import type {Style, Zoom} from '@studio/lib.ts';
import {useClip} from '../clip';
import {Icon} from '../ui';
import type {CopyBtn} from '../copy';
import {zoomsChanged} from './state';
import {Popover} from './shell';

/** The top bar's Export button, shared by the three modes: a primary button that opens a sheet. */
export function ExportButton({children, label = 'Export'}: {children: (close: () => void) => React.ReactNode; label?: string}) {
  return (
    <Popover label={label} className="exp" button={({open, toggle, id}) => (
      <button type="button" className="pill primary sm ep-export" onClick={toggle} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}>
        {Icon.share}<span>{label}</span>
      </button>
    )}>
      {children}
    </Popover>
  );
}

/** A collapsible "the full prompt" preview, for the modes whose prompt is short enough to read. */
export function PromptPreview({text}: {text: string}) {
  return (
    <details className="exp-pre">
      <summary>Show the prompt</summary>
      <pre aria-label="The prompt">{text}</pre>
    </details>
  );
}

export interface RecordExportProps {
  style: Style; zooms: Zoom[]; canvas: string; frames: number; CopyBtn: CopyBtn;
  prompt: string; json: string; link: () => string; onDownload: () => void;
}

/** Record's Export sheet: the prompt first; for an opened recording, plan.json and the render command; for the demo, a share link. */
export function RecordExport({style, zooms, canvas, frames, CopyBtn, prompt, json, link, onDownload}: RecordExportProps) {
  const clip = useClip();
  const edited = zoomsChanged(zooms, clip.plan.zooms);
  const cmd = 'node ~/.claude/skills/dolly/studio/dolly.mjs render <your recording folder>';
  return (
    <ExportButton>
      {() => (
        <>
          <div className="exp-sec">
            <h3>Hand it to Claude Code</h3>
            <p className="hint">The prompt carries the repo, the install, your choices{edited ? ', your zoom edits' : ''} and the commands. Paste it into Claude Code.</p>
            <CopyBtn id="prompt" text={prompt} label="Copy prompt for Claude Code" primary big />
          </div>
          {!clip.demo && (
            <div className="exp-sec">
              <h3>Render your edits yourself</h3>
              <p className="hint">Put plan.json in your recording folder (replace the old one), then run the command.</p>
              <div className="btnrow">
                <button type="button" className="pill ghost sm" onClick={onDownload}>{Icon.download}Download plan.json</button>
                <CopyBtn id="rendercmd" text={cmd} label="Copy command" icon={Icon.copy} small />
              </div>
              <code className="cmd">{cmd}</code>
            </div>
          )}
          <div className="exp-sec">
            <h3>More</h3>
            <div className="btnrow">
              {clip.demo && <CopyBtn id="link" text={link} label="Copy share link" icon={Icon.link} small />}
              <CopyBtn id="json" text={json} label="Style JSON" icon={Icon.copy} small />
              {clip.demo && edited && <button type="button" className="pill ghost sm" onClick={onDownload}>{Icon.download}plan-edits.json</button>}
            </div>
            <p className="exp-spec">{canvas} · {(frames / clip.fps).toFixed(1)} s · {style.zoom.auto ? `${zooms.length} zoom${zooms.length === 1 ? '' : 's'}${edited ? ' (edited)' : ''}` : 'zooms off'} · captions {style.captions.enabled ? style.captions.style : 'off'}</p>
            <p className="hint">A vertical cut too: add <code>--set aspect=9:16 --set fit=crop</code> to the render command.</p>
          </div>
        </>
      )}
    </ExportButton>
  );
}
