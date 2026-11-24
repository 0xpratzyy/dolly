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
| Capture encoder (x264) | veryfast, 2 threads | medium, 4 threads | medium, 8 threads |

`--concurrency`, `--dsf`, `--scale` and `--set motionBlur=...` still override a single setting.

The steps of a run are separate processes that run one after the other (capture, then plan, then render): the capture's
Chrome has exited before the renderer starts, so the peaks below never add up.

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
