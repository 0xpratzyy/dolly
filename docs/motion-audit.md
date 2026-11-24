# Motion audit (2026-11-24)

After reviewing the v5 renders the motion looked janky (Spotlight especially, and the waits were too long or short). This is what was measured, what caused it, and what changed. Every number below comes from a
script in `studio/scripts/` and can be re-run:

```
node studio/scripts/motion-video.mjs <video> [--from s --to s] [--crop w:h:x:y]     duplicate frames in motion, judder index
node studio/scripts/motion-camera.mjs <recording dir | plan.json> [--style ..] [--set a.b=v] [--csv out.csv]   camera, cursor, pacing
node studio/scripts/motion-spotlight.mjs <capture dir> [--aspect 16:9] [--loop]     Spotlight camera
```

"Before" camera numbers were taken with the engine at commit `b0c499e` on the plans the renders were made from. Speeds are
on-screen pixels of the 1920x1080 output.

## 1. What was wrong

### Source judder: the recording itself stuttered
The window capture (ScreenCaptureKit) and the page behind it deliver 30-50 distinct frames a second; converting that to 60 fps
with the `fps` filter repeats frames. During the page scroll of the autopilot hero take the frame-to-frame change read
`12.4 0.0 10.7 12.4 13.2 ... 14.3 0.0 0.0 14.5 13.4 ... 11.5 0.0 10.8 0.2 10.0 0.0` (0.0 = the same picture again).

| recording (60 fps file) | repeated frames while something moves | judder index (0 = even, 1 = every other frame repeated) |
|---|---|---|
| `runs/v5/auto` page scroll, 0.6-2.2 s | 25.7% | 0.97 |
| `runs/v5/auto` whole take | 23.4% | 0.55 |
| `runs/v5/record` | 59.4%, runs of up to 4 | 0.98 |
| `runs/narrate-refs` | 49.3% | 1.00 |
| `runs/refs-test` | 26.7%, runs of up to 4 | 0.98 |
| a raw VFR capture (a local capture of a browser window, 50 fps average) through `fps=60` | 71.8% | 0.99 |

(The share includes frames where only a 30 fps video inside the page moves; the scroll window is the clean measure, because the
whole picture moves there.) The renders inherit it: `site/public/hero/autopilot.mp4` 12.5% repeats with 11 hitches of two or
more, `narrate.mp4` 20.9%.

### Camera: moves far too fast, and at the wrong time
| | autopilot hero (`runs/v5/auto`) | record hero (`runs/v5/record`) | narrate (`runs/narrate-refs`) |
|---|---|---|---|
| peak pan speed | 7,049 px/s | 9,474 px/s | 1,029 px/s |
| peak pan acceleration | 243,933 px/s² | 446,321 px/s² | 68,619 px/s² |
| peak pan jerk | 18.0 M px/s³ | 47.2 M px/s³ | 4.6 M px/s³ |
| peak zoom rate (log scale, 0.69 = doubling per second) | 10.2 /s | 13.3 /s | 1.7 /s |
| shortest zoom move on screen | **133 ms** (a pull-out) | **100 ms** (two pull-outs) | 667 ms |
| quick pan reversals (direction flips within 0.5 s) | 8 | 5 | 7 |
| zoom still moving at the click | 2 of 2 | 3 of 3 | 3 of 3 |
| zoom landed, relative to the click | 300 ms **after** | 283 ms **after** | 300 ms **after** |

Causes, all in `camera.ts` / `plan.ts`:
- Eases were timed in source time, so a pull-out that fell inside a 6x or 8x idle speed-up took 700 / 6 = 117 ms on screen.
- The zoom started 400 ms before a click and took 700 ms: it was never there when the click happened.
- Two zooms a second apart pulled all the way out and pushed straight back in ("strongest envelope wins"), and the focus point
  jumped between them; the spring (stiffness 10.3 /s) then chased that jump.
- The follow spring ran all the time, also while the zoom envelope moved its anchor, so pan and zoom were out of step.
- Nothing kept the first and last second calm, and a pull-out could be cut off by the end of the clip.

### Cursor
- Path: an ease mixed with a linear part ("fast start"), a 7-18 px overshoot on long moves with a second corrective segment, and
  a 1-2 px tremor while waiting. Duration 480-1500 ms.
- On screen the cursor peaked at 21,830 px/s in the autopilot hero (the move sat inside a 6x ramp) and 11,386 px/s page speed in
  the narrate take (a 240 ms forced move across the page when the script ran late).
- In the narrate take the smoothed cursor was still moving 33-50 ms before each press (966-1,294 px/s into the click).

### Pacing
- Idle time was sped up 6x (autopilot: 2.6 s and 5.1 s of source) and 8x (record: 5.3 s and 5.1 s), with frames simply skipped.
- The driver slept a fixed 250 ms after a click, whatever the page did; reading time was hand-written `wait`s per script.
- The camera's hold after an action was 1.2 s from the action, not from the result.

### Spotlight (versus professional showcase videos we studied)
| | before | references |
|---|---|---|
| capture resolution | **1x** (608x540 for the dropdown, labelled 2x: with a clip, the CDP screenshot ignores the device scale), then upscaled 1.3-2.4x: soft text and edges | crisp |
| hero width on screen | 27% of the frame (median), 26-48% | 45-90% |
| opening | starts at 1.9x on the first touch point and zooms OUT to 1.0 | push-ins |
| depth-of-field blur | driven by camera speed: 38% of frames blurred, 3 separate pulses in 7.9 s (30% and 2 pulses in the loop) | entrances, exits and transitions only |
| tilt | follows the cursor (4.1° and 1.9° swings, direction changes with every pointer move) plus a 0.3° roll wobble | one slow, steady drift |
| camera spring | under-damped (0.88): overshoots and comes back | never bouncy |
| framing | centred on the padded image, 90% follow of the changing box: the whole component slides when a menu opens | the panel holds still and grows |

## 2. What changed

**Capture.** `autopilot/smooth.mjs` (new, the default for autopilot takes; `drive.mjs --capture smooth`): headless Chromium on a
virtual clock (`autopilot/vclock.js`: Date, timers, requestAnimationFrame, CSS and Web animations, `<video>`), one screenshot per
1/60 s at device scale 2, piped straight into the encoder. Scrolling is set per frame, the cursor is placed per frame, and the
clock stands still while a request is in flight, so loads take no time on camera. A full page navigation is settled off camera and
cross-faded (`events.loading`). Real-time window capture stays as `--capture window` for real apps and own footage; its VFR to
60 fps conversion now drops repeats and blends the gaps by timestamp (`toCfr` in `autopilot/capture.mjs`) instead of repeating
frames. That repair takes the judder index of a raw VFR capture from 0.99 to 0.32; it softens, it does not cure.

**Camera** (`studio/src/camera.ts`, `plan.ts`). The planned track is a list of eased moves (smootherstep: zero speed and
acceleration at both ends, cannot overshoot) timed in output time. Zoom-in 900 ms, landed 160 ms before the click; pull-out
1000 ms, starting 1.3 s after the last action; shots less than 2.2 s apart are joined (one wider shot, or a glide of 0.85-1.5 s
by distance with a slight widen in the middle); no zoom while the page scrolls; calm first 0.7 s and last 0.8 s; a shot too close
to the end is held. Follow is an offset on top: it wakes only when the cursor leaves the middle 56% of the view, its target is
eased and clamped to the recording, a critically damped spring (2.2-5.2 /s) chases it, and it yields to a planned move.
Old plans are joined at render time too, so re-rendering an old `plan.json` already fixes the 100 ms pull-outs.

**Cursor** (`autopilot/motion.mjs`, `Dolly.tsx`). Fitts-style duration `clamp(450, 900, 260 + 185 * log2(1 + d / 60))` ms, one
gentle arc (8% bow, max 46 px), minimum-jerk speed, no overshoot, 120-220 ms rest before the press, 70-110 ms press, a trail only
above 1,500 px/s on screen, fade out after 1.8 s idle (450 ms) and back in (180 ms). No tremor.

**Pacing.** After every action the driver waits until the animations that action started have finished (at most 2.5 s), then
holds 0.8 s (1.5 s for a new page or panel). `{"wait": n}` now means "at least n after the last action", not extra. Lead-in and
lead-out 1 s. Idle stretches: at most 2x with the skipped frames blended in (`style.maxSpeed`), or cut.

**Spotlight.** Captures are really 2-4x (scale picked from the component's size). Hero 52-76% of the frame, framed on its union
box; one steady tilt sweep; critically damped camera; depth of field scheduled on entrance, exit and transitions; a gentle
push-in instead of the pull-back; the loop has no blur and its seam step equals the step before it.

**One place for the numbers:** `motionDefaults` in `studio/src/types.ts` (camera, cursor, pacing). `defaultPlanParams` derives
from it; a plan can override per recording in `plan.params`, a render per style (`zoom.speed`, `zoom.follow`, `maxSpeed`,
`cursor.motionBlur`, `cursor.idleMs`).

## 3. After (clips rendered locally, not shipped)

| | before | after |
|---|---|---|
| **(a) autopilot hero**, subtle.refs.video, 10.1 s | `before-autopilot-hero.mp4` | `a-autopilot-hero.mp4` |
| source: repeated frames during the page scroll | 25.7%, judder 0.97 | 0 real repeats (4.5% counted at the ease ends, where the scroll moves less than a pixel), judder 0.015 |
| source: frame rate | VFR to 60 with repeats, 2560x1600 | exactly 60, 2880x1800 |
| render: repeats in motion / hitches of 2+ / judder p90 | 12.5% / 11 / 0.99 | 5.5% (the 30 fps videos inside the page) / 6 / 0.21 |
| peak pan speed / acceleration / jerk | 7,049 / 243,933 / 18.0 M | 2,143 / 6,414 / 57 k |
| peak zoom rate, shortest zoom move | 10.2 /s, 133 ms | 1.35 /s, 850 ms |
| zoom at the clicks | moving at both, lands 300 ms late | landed 167 ms before the first; glide landed before the second |
| quick pan reversals | 8 | 0 |
| cursor peak speed on screen, rest before press | 21,830 px/s, 267-417 ms | 1,901 px/s, 250-267 ms |
| speed ramps | 6x twice | none (nothing idle to skip) |
| **(b) Spotlight dropdown**, wallpaper, 7.0 s loop | `before-spotlight.mp4` | `b-spotlight-dropdown.mp4` (and `b-spotlight-pricing.mp4`, refs.video's toggle) |
| capture | 608x540 (1x) | 2432x2160 (4x) |
| hero width (median) | 27% | 50% (53% for the pricing toggle) |
| frames blurred / blur pulses | 38% / 3 | 0% / 0 in the loop; 12-18% / entrance and exit only otherwise |
| zoom | 1.9 to 1.0 (pulls back) | 0.955 to 1.03 (pushes in); 0.99-1.01 in the loop |
| tilt direction changes | with every cursor move | one sweep (0 reversals); one slow orbit in the loop |
| loop seam step vs the step before | 15.7 px vs 0.2 px | 1.80 px vs 1.84 px |
| **(c) narrate, re-composed** from the same recording | `before-narrate.mp4` | `c-narrate-recomposed.mp4` |
| peak pan acceleration / jerk | 68,619 / 4.6 M | 11,481 / 184 k |
| zoom at the clicks | moving at all 3, lands 300 ms late | landed 150-167 ms before all 3 |
| render judder index (median) | 0.88 | 0.34 |

Still limited in (c), because the footage is the old real-time take: its source repeats 49% of its frames, the cursor crosses the
page at 11,386 px/s and reaches each target 33-50 ms before the press, and two zoom-ins have only 533 ms between the end of a
scroll and the click. Re-shooting it (`narrate.mjs ... --capture smooth`, or the new driver in window mode) fixes those; that
path is built (`atMs` pacing is exact to the frame in smooth capture) but has not been run against a voice track yet.

## 4. Not done / rough edges
- Smooth capture drives the window's own scroll only (not a scroller inside the page), and a page that draws on its own clock
  outside the hooks (WebGL video textures, WebRTC, cross-origin iframes) will not advance.
- The planner zooms 1.9x on any click, including a nav link at the top of a page, where the headline gets cropped.
- The frame blend for speed-ups is a two-frame average: fine at 2x, it would ghost at more (hence the cap).
- Carousel / collage / grid Spotlight layouts got the new spring, the scheduled blur and no cursor tilt, but were not re-shot.
