# plan.json: field reference

plan.json is written by `node dolly.mjs plan <dir>` and read by the renderer. Edit it by hand (or ask Claude) and re-render;
the planner is not re-run unless plan.json is missing. All times are milliseconds from the first video frame (source time),
all coordinates are source video pixels, origin top-left.

| field | meaning |
|---|---|
| `version` | always 1 |
| `source` | what was planned from: `video` file name, `width`/`height` px, `fps`, `durationMs`, `pointScale` (video px per screen point) |
| `params` | the planner settings used (cluster gap, zoom in/out/hold/land times, `minDwellMs`, `panMs`, calm lead and tail, base/max/min scale, idle threshold and speed). Defaults: `motionDefaults` in `studio/src/types.ts`. Change them and re-run `plan` to regenerate |
| `style` | optional partial style defaults for this recording (merged under the style given at render time). Same fields as the style object, see README.md |
| `zooms[]` | the auto zoom segments, in time order |
| `zooms[].id` | label, free text |
| `zooms[].startMs` | when the zoom-in ease begins (about 1.06 s before the first click or keystroke: 900 ms ease + 160 ms on target). The ease always ENDS at `startMs+inMs`, whatever the style's zoom speed |
| `zooms[].endMs` | when the zoom-out ease has finished. The hold lasts from `startMs+inMs` to `endMs-outMs`. A zoom whose `endMs` is the next zoom's `startMs` does not pull out: the camera glides to the next one over that zoom's `inMs` |
| `zooms[].inMs` / `outMs` | ease durations on screen (smootherstep; a speed-up never shortens them). The style's `zoom.speed` divides them at render time. `outMs: 0` = stay zoomed (held to the end, or gliding to the next) |
| `zooms[].scale` | magnification at full zoom (1.9 = the camera sees 1/1.9 of the width). The style's `zoom.amount` scales `scale-1` at render time |
| `zooms[].center` | source pixel the camera aims at when fully zoomed; the camera still follows the cursor (dead zone + spring) around it |
| `zooms[].bbox` | the action area the zoom was built around (informational, not used by the renderer) |
| `zooms[].why` | what triggered it (informational) |
| `speed[]` | idle stretches. `speed: 2` plays that stretch 2x faster with the skipped frames blended in; `cut: true` removes it. Only used when the style's `idleSpeedup` is on. Anything above the style's `maxSpeed` (default 2) is capped: 6-8x ramps smear |
| `clicks[]` | mouse-down points: `tMs`, `x`, `y`, `button`. Drive the click effect (ripple / highlight) and cursor press |
| `keys[]` | keyboard shortcuts with a label (e.g. "⌘K"), shown by the keystroke overlay. Plain typing never appears (privacy) |
| `cursor[]` | smoothed cursor path, one `[tMs, x, y]` per source frame |
| `cursorRaw[]` | the recorded cursor resampled to the same frames; the renderer re-smooths it when the style's `cursor.smoothing` differs from `params.cursorSmoothing` |

Common edits: delete a `zooms` entry to remove it; change `scale` (e.g. 2.4) or `center` to retarget; lengthen `endMs` to hold
longer; add a `speed` entry (`{"startMs": 12000, "endMs": 16000, "speed": 4}`) to skip a slow stretch.
