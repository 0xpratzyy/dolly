# Dolly studio: planner + renderer

Turns a raw screen recording and its `events.json` ([../CONTRACT.md](../CONTRACT.md)) into a polished product demo:
auto zooms that follow the action, a smooth synthetic cursor, click ripples, background + frame, motion blur,
keystroke overlay, Subtle captions, idle speed-up. Remotion 4.0.534 (pinned), React 19, Node 22+ (the planner runs as plain
TypeScript through Node's type stripping, no build step).

```
npm install
node dolly.mjs plan   demo/refs-tour            # events.json -> plan.json (+ plan.README.md)
node dolly.mjs render demo/refs-tour            # plans if plan.json is missing, then remotion render -> out.mp4
node dolly.mjs render demo/refs-tour --style ice --set zoom.amount=1.4 --set aspect=9:16 --set fit=crop \
     --captions caps.json --out vertical.mp4 [--frames 0-300] [--concurrency 6]
node scripts/make-demo.mjs [name]               # regenerate the Playwright test footage of refs.video
scripts/sheet.sh demo/refs-tour 6 10.4 17.4 ... # contact sheet (sheet.jpg) of out.mp4 at those seconds
```

`<dir>` = `recording.*` + `events.json`. Written there: `plan.json`, `plan.README.md` (every field explained; also in
[docs/plan-fields.md](docs/plan-fields.md)), `out.mp4`. Large media is git-ignored.

## How it works
- **Planner** ([src/plan.ts](src/plan.ts)): clusters clicks and typing (gap < 2.5 s, near each other, no scroll in between); a
  cluster with a click (or 3+ keys) becomes a shot. The zoom-in (900 ms) has landed 160 ms before the first action, so it starts
  while the cursor is still on its way; the pull-out (1000 ms) starts 1.3 s after the last action. Two shots less than 2.2 s apart
  are joined: one wider shot when both fit, otherwise the camera stays in and glides to the next (0.85-1.5 s by distance). The
  camera is not zoomed in while the page scrolls, and the first 0.7 s and last 0.8 s have no camera move (a shot too close to
  the end is held instead of cut mid pull-out). Target rect around the action (default 1.9x, never above 2.2x, kept in bounds).
  Cursor path: one-euro filtered at frame rate (plus the raw path). Idle stretches (no input, still cursor, > 4 s) are played at
  most 2x with the skipped frames blended in, or cut with `--idle cut`.
- **Camera** ([src/camera.ts](src/camera.ts)) runs at render time on top of plan.json: the planned track is a list of eased moves
  (smootherstep, no overshoot) timed in OUTPUT time, so a speed-up never shortens a move; on top, a follow offset that only wakes
  when the cursor leaves the middle 56% of the view, chased by a critically damped spring and clamped to the recording. So zoom
  amount / speed / follow / cursor smoothing / idle speed-up are live style knobs; no re-plan.
- **Motion numbers** live in one place: `motionDefaults` in [src/types.ts](src/types.ts) (camera, cursor, pacing). Measure a plan
  or a file with `scripts/motion-camera.mjs <dir>`, `scripts/motion-video.mjs <video>`, `scripts/motion-spotlight.mjs <capture>`;
  what the numbers mean and where they started: [../docs/motion-audit.md](../docs/motion-audit.md).
- **Renderer** ([src/remotion/Dolly.tsx](src/remotion/Dolly.tsx)): composition `Dolly` with inputs `{video, plan, style, captions}`.
  Video as `<OffthreadVideo>` pieces (one per constant-speed stretch). Motion blur is a cheap directional SVG blur driven by camera
  speed (`@remotion/motion-blur` re-renders every frame several times, too slow with video).

## Render engines: native (default on macOS) and Remotion
`render` has two engines that draw the same video from the same plan and style:

- **native** (`recorder`'s `dolly-render`, macOS): the recording is decoded on the hardware decoder, composited on the GPU
  (Core Image on Metal) and encoded on the hardware encoder, one frame at a time. It is the default once the binary exists:
  `cd ../recorder && swift build -c release --product dolly-render`.
- **remotion**: every frame is a web page in headless Chrome, screenshotted and piped to ffmpeg. Used on other systems, when
  the binary is missing, and for what the native engine does not draw yet (it falls back by itself and says why).

`--engine native|remotion` forces one. Native-only flags: `--codec h264|hevc`, `--bitrate <Mbit/s>`, `--stats`.
`--quality lite|normal|max` (picked from the machine's memory and cores when absent) sets how hard a run works the
machine: capture scale, Chrome tabs, motion blur, encoder settings; the table and the measured memory of every step are in
[../docs/performance.md](../docs/performance.md). `node dolly.mjs clean [--dry-run]` frees Dolly's caches and temp files
and moves old runs to the Trash.

Measured on the same 10 s clip (1920x1080, 60 fps, 605 frames; AI wallpaper, window frame, shadow, cursor, two zooms, glass
captions; Apple M5, 16 GB, both runs at `nice 10`):

| | native | Remotion (`--concurrency 2`) |
|---|---|---|
| wall time | **2.8 s** (5.8 s the first time new captions are drawn, 7.4 s with an empty cache) | 30.9 s |
| peak memory (all processes) | **0.2 GB** (0.7-0.8 GB for those first runs: one short Chrome) | 2.9 GB |
| CPU | 1.5 CPU-seconds (about half of one core) | 101 CPU-seconds (3.3 cores busy) |
| file | 5.1 MB | 6.9 MB |

The two outputs match: SSIM 0.989 over all frames (lowest frame 0.985), PSNR 41 dB, same judder numbers from
`scripts/motion-video.mjs`. Known differences: Remotion darkens the recording's shadows by about 2 levels and writes BT.601
colour without tagging it; the native file is tagged BT.709 and stays closer to the recording.

How the native engine stays in step with the Remotion one: `scripts/camera-track.mjs <dir> [same flags as render]` writes a
render spec (JSON) with the per-frame camera, cursor, click and caption track from the SAME code (`src/camera.ts`,
`src/track.ts`); `dolly-render` only applies it. Pictures it cannot draw itself (caption states, keystroke pills, gradient /
SVG backgrounds) are drawn once by the `DollyStill` composition in one short headless Chrome and cached in `studio/.cache`,
so the second render with the same captions starts no browser at all.

The native engine also draws the face-cam bubble, `background.type: "video"` (the blurred recording) and every cursor
(SSIM against Remotion 0.989-0.990 for each). Only `--frames` still goes to Remotion. Captions are cut into states (one per spoken word) that
cross-fade, so styles that animate continuously inside a word (karaoke sweeps, bounces) are simplified; use
`--engine remotion` when that matters. Spotlight (`dolly.mjs spotlight`) always uses Remotion.

## The `style` object (one serialisable object; defaults in [default-style.json](default-style.json))
`background {type: preset|solid|image, value}` (presets: graphite, ice, aurora, midnight, dusk, sand, mist), `padding` (% of short
side), `radius`, `shadow` 0..1, `frame` none|browser|window + `frameLabel`, `aspect` source|16:9|9:16|1:1|4:5, `fit`
letterbox|crop (crop = window fills the canvas and the camera pans), `resolution` source|1080p|4k,
`zoom {auto, amount (multiplier on the planned zoom), speed (multiplier on ease times), follow 0..1}`,
`cursor {visible, size, smoothing 0..1, hideWhenIdle}`, `clickEffect` ripple|highlight|none, `motionBlur` 0..1,
`keystrokes` (labelled shortcuts from `events.keys`), `idleSpeedup`, `captions {enabled, style, position, size}`.
Merge order: defaults < `plan.style` < render-time style. CLI presets: see `stylePresets` in src/types.ts.

## Embedding (website)
[src/lib.ts](src/lib.ts) exports `Dolly`, `defaultStyle`, `stylePresets`, `buildTimeline`, `computeLayout`, `outFrameCount`, types.
For a Remotion `<Player>` use `component={Dolly}`, `inputProps={{video: url, plan, style, captions, captionStyle}}`, and take the size and duration from
`buildTimeline(plan, style, fps).layout` / `.frames.length` (that is what `calculateMetadata` does in Root.tsx).
A full URL or root-relative path in `video` is used as is; a bare file name goes through `staticFile`.

## Captions (Subtle's caption engine)
Captions are drawn by Subtle's engine, vendored unchanged in `vendor/subtle` (engine, styles, fonts, MIT; see its README) and
imported through the webpack alias `@subtle` (`remotion.config.ts`; set `SUBTLE_DIR` to use your own Subtle checkout; the site's
`vite.config.ts` has the same alias). Input, in OUTPUT time (after idle speed-up):
- `captions.json` = `[{startMs, endMs, text}]`. Words are spread evenly over the line; `*word*` marks a highlight. Optional `words: [{text,startMs,endMs}]` per line.
- or a Subtle captions file (`pages` with word timings), used as is.
`style.captions = {enabled, style: '<Subtle style name>', position: bottom|middle|top, size}`. Default `glass`; any of Subtle's
`styles/*.json` works (`glide`, `karaoke`, `accent`, `chip`, `hype`, ...; `name:variant` for colourways, or a path to a style JSON).
The CLI loads the style JSON and passes it as the `captionStyle` prop (`Dolly` falls back to a plain bar without it) and links the
Subtle fonts into the render's public dir. Example: `demo/refs-tour/captions.example.json`, result `demo/refs-tour/captions-sheet.jpg`.
In a browser Player pass `captionStyle` (from your own glob of the styles), and serve `subtle/fonts/*` at the site root (the engine loads the style's fonts itself via `staticFile`;
`loadCaptionFonts` from lib.ts preloads them).

## Test footage and timing alignment
`scripts/make-demo.mjs` drives headless Chromium over refs.video (eased mouse paths, logs every cursor sample, click and scroll) and
records video. Playwright's video has no cursor and its clock starts at page creation, so the script flashes the page white at the
start and the end, finds both flashes in the video with ffmpeg, and maps wall-clock to video time linearly (offset and drift);
output t=0 is the first frame of the trimmed `recording.mp4`. Accuracy is about one video frame.

## Known rough edges
- Motion blur is a 2D approximation (pan + zoom speed), not subframe sampling.
- In `crop` mode zoom is relative to the already tight base view (amount is damped to 60%).
- Idle speed-up changes the output timeline; `captions` are in output time, so re-time them if you toggle it.
- Keystroke overlay and idle speed-up are covered by unit-level checks only (the demo has no shortcuts or idle gaps).
- Window chrome is simple (traffic lights + URL pill/title), not pixel-exact macOS.
