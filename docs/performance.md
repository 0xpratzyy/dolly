# Performance: how heavy each step is, and the three quality modes

Every Dolly command takes `--quality lite|normal|max`. Without the flag the mode is picked from the machine
(`studio/scripts/lib/env.mjs`): **lite** on 8 GB of memory or less (or 4 cores or fewer), **max** on 32 GB+ with 10+ cores,
**normal** otherwise. `DOLLY_QUALITY=lite` sets the default for a shell. The mode is printed at the start of each run.

| | lite | normal | max |
|---|---|---|---|
| Autopilot / Narrate capture scale | 1.5x (a 1440x900 page records at 2160x1350) | 2x (2880x1800) | 2x |
| Spotlight capture scale | 2x at most | 2x-4x by the component's size | 2x-4x |
| Output | 1080p at most | as the style says | as the style says |
| Camera motion blur, Spotlight depth of field | off | on | on |
| Animated (shader) backgrounds in Spotlight | drawn as a still | animated | animated |
| Native encoder quality (`dolly-render`) | 0.62 | 0.72 | 0.85 |
| Remotion (the fallback, and Spotlight): Chrome tabs | 1 | 3 (Spotlight 2) | 6 (Spotlight 4) |
| Remotion encoder | crf 20, x264 veryfast | crf 16 | crf 14 |
| Capture encoder (x264, JPEG frames in) | veryfast crf 17, 2 threads | veryfast crf 12, 4 threads | veryfast crf 10, 8 threads |

`--concurrency`, `--dsf`, `--scale` and `--set motionBlur=...` still override a single setting.

The steps of a run are separate processes. In lite they run one after the other (capture, then plan, then render), so the
peaks never add up. In normal and max an autopilot run records the phone take next to the desktop take (two headless Chromes)
and each take goes on to its own plan and render as soon as it is recorded: at most two jobs at once (see "Speed pass" below).

## Measured (Apple M5, 10 cores, 16 GB, macOS 27; every command at `nice 10`, one at a time)

Peak memory is the summed resident size of the command's whole process tree (node, Chrome and its helpers, ffmpeg,
`dolly-render`), sampled with `ps` every 0.2 s. CPU is the tree's CPU time divided by wall time (100 % = one core busy).

| Step | lite | normal | max |
|---|---|---|---|
| **Capture** (autopilot smooth capture, 10 s take, 1440x900 page) | 1.64 GB, 65 s, 123 % | 2.23 GB, 89 s, 162 % | as normal |
| **Render, native** (10 s, 1080p60, wallpaper + window + captions) | 0.24 GB, 2.6 s, 44 % | 0.24 GB, 2.8 s, 49 % (0.57 GB and 4.6 s the first time new captions are drawn) | 0.25 GB, 2.8 s, 46 % |
| **Render, Remotion fallback** (same clip) | 2.55 GB, 173 % | 2.97 GB, 407 % | 4.72 GB, 515 % |
| **Spotlight capture** (dropdown example, 455 frames) | 0.76 GB, 38 s, 79 % | 1.35 GB, 58 s, 165 % | as normal |
| **Spotlight render** (wallpaper scene, animated background) | 1.50 GB, 98 % | 1.81 GB, 196 % | 3.65 GB, 255 % |

- The Remotion and Spotlight render rows are the first 180 frames of the clip (`--frames 0-179`): memory peaks within the
  first seconds and stays flat, so a short range gives the peak without heating the machine for minutes. Wall time for a
  full Remotion render of the 10 s clip is about 31 s at 2 tabs (see `studio/README.md`).
- lite stays at or under about 2.5 GB in every step. The one row at the line is the Remotion fallback, which a normal Dolly
  render no longer uses on macOS (the native engine draws the face-cam bubble, the blurred-recording background and every
  cursor now); it remains for `--frames`, for other systems, and for Spotlight.
- The capture is the heaviest step that always runs. Real 2x capture costs more than before: until this change the smooth
  capture wrote 1440x900 pictures labelled 2x (see "What changed" below).
- Native output size for the 10 s clip: 3.8 MB (lite), 6.1 MB (normal), 15.4 MB (max).

## Disk

| What | Before | Now |
|---|---|---|
| Remotion's own Chrome (`studio/node_modules/.remotion`) | 570 MB, downloaded on first render | not needed: Remotion drives Playwright's `chromium_headless_shell` (already installed for the autopilot). Remove the old copy with `node studio/dolly.mjs clean`, or `rm -rf studio/node_modules/.remotion` |
| A Spotlight capture | a PNG per frame: 152 MB for 455 frames at 4x | one alpha video, `frames.webm` (VP9): 1.1 MB. The PNGs are deleted after encoding; `--keep-frames` keeps them |
| Remotion's temp files (webpack bundle, extracted assets) | 30-60 MB left in the system temp folder per run | each Remotion run gets a private temp folder that is deleted when it ends (`--keep` leaves it) |
| Remotion's webpack cache (`studio/node_modules/.cache`) | grew without limit (360 MB seen) | capped at 300 MB: the oldest entries go after each render |
| Caption stills and their bundle (`studio/.cache`) | - | about 40 MB, rebuilt on demand |

Every run prints the disk it used. `node studio/dolly.mjs clean --dry-run` lists what Dolly keeps on disk; without
`--dry-run` it deletes Dolly's own caches and temp files and moves runs under `autopilot/runs` (and any `--runs <dir>`) that
were not touched for 14 days (`--older-than <days>`) to the macOS Trash. It never deletes a run; `--no-runs` leaves runs alone.

## What changed in the capture
`autopilot/smooth.mjs` asked Chrome for a screenshot without a clip, and Chrome then returns a CSS-pixel-sized (1x) picture
whatever the device scale factor: every smooth take was 1440x900 although events.json said 2880x1800, so zooms were
upscaled. The screenshot now carries the scale (as the Spotlight capture already did), so normal really records 2x and lite
1.5x. A real 2x take needs 2.2 GB and about 1.4x the time of the old 1x one (89 s against 54 s for the 10 s example).

## Speed pass, 2026-11-24

Every run can now time itself: `node autopilot/make.mjs ... --profile` (also `narrate.mjs --profile`, or `DOLLY_PROFILE=1`)
writes `profile.json` next to the outputs: wall time of every phase of every step (launch, first load, settles, per-frame
screenshot / page step / encoder wait, phone take, plan, caption stills, native render, sheets) and the peak memory of the whole
process tree. The phases come from `studio/scripts/lib/profile.mjs`; Spotlight's capture writes the same lines under `DOLLY_PROFILE`.

Measured on the M5 (10 cores, 16 GB), everything at `nice 10`, one run at a time. "Before" is commit e047d90 run the same day
on the same inputs (the old `dolly-render` binary for its renders).

| What | Before | After | Peak memory after |
|---|---|---|---|
| Autopilot end to end, normal, with the phone take (`subtle-hero.json`, a 10 s video + 9:16 cut) | 139.4 s | **52.3 s** | 2.77 GB (2.22 GB before) |
| Autopilot end to end, lite (same script) | 121.1 s | **70.7 s** | 1.53 GB |
| One smooth take, normal (10 s, 2880x1800, desktop take alone) | 87.2 s | **44-46 s** | 2.2 GB |
| Spotlight capture, normal (dropdown example, 455 frames at 4x) | 55.2 s | **37.4 s** | as before |
| Spotlight render (wallpaper scene, Remotion) | 28.3 s | 28.2 s (unchanged) | as before |
| Narrate compose, normal (15.5 s refs example, face-cam, 16:9 + 9:16, stills cached) | ~10 s | 10.2 s (encoder-bound) | 0.49 GB |
| Native render, 10 s 1080p60 (`dolly-render`) | 2.5 s | 2.4 s (GPU wait 1.34 s -> 0.01 s) | 0.14 GB |
| Benchmark film, native, cold: look prep + render (`~/dolly-test/bench`) | 11.3 + 4.2 = 15.5 s | **0.4-0.5 + 4.2-4.6 = 4.6-5.1 s** | 0.25 GB |
| Benchmark film, native, warm (looks cached by content hash) | 3.9 s | 0.02 + 4.3 s | 0.25 GB |

Where a 10 s normal take's time went (per frame, from `profile.json`):

| | before | after |
|---|---|---|
| `Page.captureScreenshot` at 2880x1800 | 119 ms (PNG) | 56 ms alone, 64 ms next to the phone take (JPEG q92) |
| page clock step (`__vt.step`) | 12 ms (Playwright evaluate; a playing video polled every 4 ms) | 3 ms (raw CDP; seeks waited on events; off-screen video not seeked) |
| network, cursor, encoder back-pressure | ~5 ms | ~4 ms |

What changed:
- **JPEG frames** (`autopilot/smooth.mjs`): Chrome encodes a 2880x1800 JPEG in half the time of a PNG. Same frame, PNG vs JPEG
  q92 after the identical x264 pass: SSIM 0.986-0.987 (the x264 pass alone costs the PNG 0.990); text identical at 100 %.
  `--image png` keeps the lossless path; `failure.png` is still a PNG.
- **Capture encoder** x264 veryfast at CRF 12 instead of medium at CRF 14: same SSIM against a lossless encode (0.9802 vs 0.9808)
  at 2.3x less CPU, which Chrome gets back (screenshot 62 -> 56 ms).
- **Repeat unchanged frames**: `vclock.js` reports whether anything visible changed in a step (DOM mutation, an on-screen
  animation that moved, an on-screen playing video, load / scroll / font events, a canvas page running rAF); the driver adds input,
  network and a 4-frame tail, and still takes a real screenshot at least every 12 frames. Checked with `DOLLY_SKIP_VERIFY=1`
  (screenshots every frame and compares) on the 31 s refs.video script: of 298 skips none was visible (181 differed by at most 152
  pixels, from a real-time image animation outside the virtual clock). Both test pages animate all the time (reels, motes, videos),
  so the desktop takes skip little; the phone take of refs.video repeated 503 of 1,819 frames. `--no-skip` turns it off.
- **Media**: a seeked video is waited on with its `seeked` / `loadeddata` events instead of a 4 ms poll; a video off screen is not
  seeked until it comes back (no decode), audio is never waited on (it is not recorded).
- **Overlap** (`make.mjs`, normal / max, smooth takes only): the phone take records next to the desktop take, each take renders as
  soon as it lands. lite stays sequential. `--sequential` turns it off. Narrate does the same for two `--capture smooth` takes;
  its renders stay one after the other (two native renders share the hardware encoder: 9.9 s side by side vs 10.2 s in turn).
- **Spotlight capture**: frames stream into the VP9 alpha encoder while the take runs (the encode used to start after it: 11.6 s),
  and an unchanged pointer sends no mouse event (each waited 7-14 ms for a frame). frames.webm is identical (SSIM 1.000).
- **dolly-render**: frames are composited asynchronously, three in flight (`CIRenderTask`); output identical (SSIM 1.000). Wall
  time barely moves: the hardware H.264 encoder (~285 fps at 1080p60) is the limit. (A buffer pool and a single `CIContext` were
  already in place; RGBA8 working format and VideoToolbox's speed-over-quality flag made no difference.)
- **Benchmark look prep without Chrome** (`~/dolly-test/bench/native/Sources/look-snap`): rects and images are drawn with Core
  Graphics, text and SVG are laid out by WebKit (WKWebView, part of macOS) on one atlas page that is snapshotted once and cut into
  the 214 sprites (Chrome took one screenshot per sprite, ~50 ms each). Looks are cached by a content hash. The film rendered from
  WebKit looks matches the Chrome-look film at SSIM 0.997 (0.811 vs 0.809 against the original).

Quality checks of the final normal run: smoothness (`motion-video.mjs`) of recording.mp4 10 duplicates in motion, 4 hitches,
judder 0.019 / 0.182 against 11, 5, 0.023 / 0.183 before; two takes of the same script differ by about that much on their own (the
old code's lite take: 13 duplicates, 4 hitches).

Targets that were not reached, and why:
- **One take under 25 s** (now 44-46 s): 85 % of the take is `Page.captureScreenshot`, whose floor is about 50 ms at 2880x1800
  even on a blank page (frame production, GPU readback and encode inside Chrome). The ways around it did not work on this Mac:
  `HeadlessExperimental.beginFrame` (render + capture in one step) fails with "BeginFrameControl is not supported on MacOS yet";
  `--disable-gpu-vsync --disable-frame-rate-limit` and GPU-raster flags change nothing; `Page.startScreencast` hands out frames at
  1440x900 only and not in step with the virtual clock (1 of 60 frames matched its step); splitting a take over two Chromes needs
  identical takes, and two runs of the same script differ (604 vs 603 frames, mutation counts from the first load on), because
  holds wait for the network in real time. What is left is repeating unchanged frames, which pays off on calm pages.
- **End to end under ~90 s**: reached (52 s); the remaining time is the desktop take.
- **The caption / key stills** are still drawn by Remotion in headless Chrome (1.6-1.9 s the first time a caption set is seen,
  cached after): they are React compositions from Subtle, not plain HTML, so the WebKit atlas does not apply without porting them.
