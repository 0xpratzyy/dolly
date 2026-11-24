---
name: dolly
description: Make a polished product demo or launch video from a URL, a feature, an existing screen recording, or just a voice memo. Narrate mode - the user only talks (voice memo or face-cam clip) about what they launched; Claude transcribes it, maps each thing said onto the real product, opens it, clicks/types/scrolls exactly when each thing is mentioned, and renders the video with their voice, their face in a bubble, zooms, cursor and Subtle captions. Autopilot mode records a script from a URL. Outputs 16:9 plus a 9:16 cut. Free, local, a Screen Studio alternative.
---

# Dolly: Screen Studio, run by Claude

You turn "make a launch video for <URL>", "here is my voice memo about what I launched", "show the new <feature> on <URL>" or "polish this recording" into a finished
`out.mp4` (16:9) and `vertical.mp4` (9:16). Everything runs on the user's Mac. Run commands from this folder (the one
holding this file). Needs: Node 22+, ffmpeg (the caption engine, styles and fonts are vendored in `studio/vendor/subtle`; `SUBTLE_DIR` points at your own Subtle checkout instead), and for window
capture the built recorder `recorder/.build/release/dolly-record` (`swift build -c release` in `recorder/`).

```
autopilot/   narrate.mjs (voice memo -> video), drive.mjs (record), make.mjs (script -> video), login.mjs (save a signed-in session)
studio/      dolly.mjs plan|render, the Remotion composition, README.md, docs/plan-fields.md
recorder/    dolly-record (ScreenCaptureKit, for Mac apps and own footage), dolly-render (native renderer)
spotlight/   capture.mjs: a short animated clip of one piece of UI (see docs/spotlight.md)
CONTRACT.md  events.json format
```

First time: `cd autopilot && npm install && npx playwright install chromium`, and `cd ../studio && npm install`.

## Autopilot: URL -> video

1. **Explore.** Open the URL yourself (Playwright, or any browser tool you have), click through the real product, and learn what
   a first-time viewer should see. Pick 3 to 6 scenes. Prefer stable targets: link and button texts or CSS selectors.
   Never pay, log in, or submit forms with the user's data. If the flow needs a login, ask the user for a test account.
2. **Write `script.json`** (format below). One short narration line per scene (under 12 words, plain words). The narration
   becomes the captions.
3. **Make it:** `node autopilot/make.mjs script.json --out ~/demos/<name> [--style ice] [--set captions.style=glide]`
   This records, plans, captions and renders both cuts, then writes contact sheets. Add `--viewport 1280x720` for a smaller
   window. The take plays in a headed Chromium window on the user's screen for about a minute: tell them first, and
   never record the full display.
4. **Check.** Open `<out>/sheet.jpg` and `<out>/vertical-sheet.jpg` (frames at every click, at the middle of each caption, first
   and last). Look at them. Confirm: the cursor sits on the clicked thing, nothing important is cut off, captions are readable and
   do not hide what is being clicked, no leftover loading states. Fix and re-render:
   - wrong or missed target: fix the selector in `script.json`, re-run `make.mjs` (re-records);
   - zoom/style tweaks need no re-record: edit `plan.json` (see `studio/docs/plan-fields.md`) or run
     `node studio/dolly.mjs render <out> --style ice --set zoom.amount=1.4 --set captions.style=karaoke --captions <out>/captions.json`;
   - a caption sits over the thing being clicked: `--set captions.position=top` is the workaround for now;
   - the 9:16 cut is a SECOND take of the same script at a phone viewport (390x693, mobile layout, touch user agent), rendered
     full-frame with no synthetic cursor and the click ripple as the tap, and no auto zoom (a portrait page would pan sideways and clip
     text). Look at `vertical-sheet.jpg` too. `--vertical=letterbox` renders the desktop take letterboxed instead (a small strip in the
     frame); `--vertical=no` skips it. Phone take files live in `<out>/mobile/`;
   - a caption is missing: its scene was too short to read. Add `"minMs"` to the scene or a `{"wait": ms}` action.
5. **Hand over** the paths of `out.mp4`, `vertical.mp4`, the sheets, and the one-line command to change style.

### script.json

```json
{
  "url": "https://refs.video",
  "viewport": "1440x900",
  "avoid": ["checkout", "get pro", "log ?in", "sign ?(in|up)"],
  "scenes": [
    {
      "goal": "Show the plans",
      "narration": "Start free. Pay only when you want every film.",
      "actions": [
        {"click": "Pricing"},
        {"scroll": 240},
        {"click": "Monthly"},
        {"wait": 700},
        {"click": "Yearly"}
      ]
    }
  ]
}
```

Top level: `url` (required), `viewport` (default `1440x900`, shrunk to fit the display), `avoid` (regexes; the driver refuses to touch a
control whose text or href matches), `settleMs`, `tailMs`. A full example: `autopilot/examples/refs-script.json`.

Scene: `goal` (for you), `narration` (one short line, becomes the caption; `*word*` highlights a word), `actions`, optional `minMs`.
After the actions the driver waits so the line can be read (about 0.3 s a word).

Phone take: on mobile a text target that is not visible makes the driver open the hamburger menu once (a real tap) and look again.
For anything the text match cannot handle, an action may carry a `mobile` override: an action object (replaces it), an array of
actions (replaces it with a sequence), or `false` (skip it on the phone). A scene may also give `mobileActions` for the whole scene.
Top level `mobileViewport` (default `390x693`, exactly 9:16).
`{"click": "Pricing", "mobile": [{"click": "Menu"}, {"click": "Pricing"}]}`

Actions (a scene runs them in order):

| action | meaning |
|---|---|
| `{"click": "Pricing"}` | click a visible button/link/text. Plain text prefers an exact button or link name, then a substring. A CSS or Playwright selector (`#id`, `.cls`, `a[href^="/x"]`, `text=...`, `role=...`) is used as is |
| `{"hover": target}` | move to it and rest |
| `{"type": "hello", "into": target}` | optionally click `into` first, then type with human timing. Characters are never stored in events |
| `{"press": "Meta+K"}` | a key or shortcut; shortcuts show in the keystroke overlay (`⌘K`) |
| `{"scroll": 400}` | scroll down by px (negative = up) with the wheel, eased. `"ms"` sets the duration |
| `{"wait": 600}` | pause |
| `{"goto": "/pricing"}` | navigate (relative to `url`) |

A scene that opens with `goto` (or says `"independent": true`) does not need the scenes before it: at normal / max a take records
such scenes in a second headless Chrome at the same time and stitches them (`--scenes-parallel false` turns it off). Give a `goto`
scene `"independent": false` when its page depends on what earlier scenes did (a login, a setting kept in the browser).

Targets off screen are scrolled into view with the wheel, not jumped to. A scene that cannot find its target stops the take with
`failure.png` and exit code 2.

The driver also waits (up to 5 s) before every target and at the end of every scene until nothing visible looks like loading: no
skeleton / shimmer / placeholder / spinner / `aria-busy` element in the viewport and every image in view loaded.
The driver waits for the page to settle before the take starts (load, network idle, then no running finite animation for 600 ms), so
intro curtains and reveal effects are not recorded; `settleMs` in script.json adds extra wait after that. Pages reached by a click wait
up to 2.5 s the same way.

### How recording works (so you can debug it)
`drive.mjs` moves the mouse on one gentle arc with a minimum-jerk speed profile (450-900 ms by distance, no overshoot), rests
120-220 ms on the target before pressing, waits after each action until the visual change is over and then holds (0.8 s, 1.5 s for
a new page), and keeps the first and last second calm. All of these numbers are `motionDefaults` in `studio/src/types.ts`. Video:
- **smooth** (the default for a normal script; `--capture smooth`): `smooth.mjs` plays the script in a HEADLESS Chromium on a
  virtual clock and screenshots every frame at 2x. The page's timers, animations, scrolling and video only advance 1/60 s per
  frame, so `recording.mp4` is exactly 60 fps with no repeated frames, the cursor and scroll are exact, and page loads and
  network waits take no time on camera. Nothing appears on screen. About 4-6 s of work per second of video. It cannot drive real
  desktop apps or anything that needs a visible window; Narrate scripts (`paced: true`) keep the window capture unless you pass
  `--capture smooth`.
- **window** (`--capture window`, real time; needs Screen Recording, see `recorder/.build/release/dolly-record --check`): `dolly-record --window <id>`
  records only that window. A full-viewport `#ff00ff` flash at the start and the end of the take is found in the frames: it gives the
  viewport rectangle to crop to and a two-point wall-clock to video-time map. Output is cropped, 60 fps constant frame rate,
  `recording.mp4` + `events.json`, `t=0` at the first scene. ScreenCaptureKit delivers 30-50 real frames a second with repeats;
  the repeats are dropped and the gaps blended by timestamp, which softens the stutter but does not remove it (use smooth).
- **screencast** (fallback, no permission needed, `--capture screencast`): CDP `Page.startScreencast` frames to mp4; events are
  already in viewport coordinates.
The browser is always ended by the driver itself (also on Ctrl-C, SIGTERM or an error); don't leave Chrome for Testing running.

### Captions timing
`make.mjs` writes `captions.json` in OUTPUT time: each scene's `[start, end]` in the recording is mapped through the studio's own
timeline (`mapTime` in `studio/src/camera.ts`), so idle speed-up and cuts are accounted for. If you change `idleSpeedup` or the plan's
`speed` after the fact, re-run `make.mjs --polish <out>` (it keeps `plan.json` and recomputes captions from `scenes.json`).
Style: `style.captions = {enabled, style, position, size}`; `style` is any Subtle caption style (`glass` default, `glide`, `karaoke`,
`accent`, `chip`, `hype`...). `captions.json` can also be a Subtle captions file with word timings.

### Voiceover
Autopilot scripts have no voice. For a real voice track use Narrate (above), which times the screen to the voice. When you only have a voice file for an autopilot take, put it at `<out>/voice.mp3` and mux it after rendering:
`ffmpeg -i out.mp4 -i voice.mp3 -c:v copy -c:a aac -shortest out-voiced.mp4`. Time the narration to the scenes in `scenes.json`
(recording ms; map to output time as `make.mjs` does).

## Rendering is native on macOS (fast and cool)
`node studio/dolly.mjs render` uses the native renderer (`recorder/.build/release/dolly-render`: hardware decode, GPU
composite, hardware encode) when it is built, and Remotion (headless Chrome) otherwise. Build it once:
`cd recorder && swift build -c release -j 2 --product dolly-render`. A 10 s 1080p60 clip renders in about 3 s with about
0.2 GB of memory (Remotion at `--concurrency 2`: 31 s and 2.9 GB), with the same picture (SSIM 0.99), face-cam bubble
included. `--engine remotion` or `--engine native` forces one. Details and numbers: `studio/README.md`.

Every command (`make.mjs`, `narrate.mjs`, `dolly.mjs render`, `dolly.mjs spotlight`, `spotlight/capture.mjs`) takes
`--quality lite|normal|max`; without it the mode is picked from the machine (lite on 8 GB). On a small or hot laptop pass
`--quality lite`: 1.5x capture, 1080p, one Chrome tab, no motion blur; every step stays near or under 2.5 GB
(`docs/performance.md`). `node studio/dolly.mjs clean --dry-run` shows what Dolly keeps on disk; without `--dry-run` it
frees caches and temp files and moves runs older than 14 days to the Trash.

## Narrate: the user only talks

The user records a voice memo (m4a/mp3/wav) or a quick face-cam clip (mp4/mov) about the features they launched and never touches
the screen. You turn the talk into a finished video: their voice (loudness-normalised to -16 LUFS), their face in a bubble when the
input has video, the product opened and driven by Dolly with each thing shown exactly when it is said, Dolly zooms, cursor, Subtle
captions built from the real transcript words. Audio and video stay on this Mac (transcription is Subtle's local mlx-whisper).

```
node autopilot/narrate.mjs --voice memo.m4a --url https://their.product --out ~/demos/launch [--vertical]
```
Run it once: it transcribes, writes `<out>/narration-plan.json` and **stops (exit 3)**. That file is the bridge. You fill it in (below),
set `"status": "ready"`, and run the exact same command again: it checks every target headless, records the take paced to the words,
composes, and writes `sheet.jpg` (and `vertical-sheet.jpg`). `--auto` skips the bridge and guesses actions from visible link and button
labels (a baseline: review it). Handy extras: `--vocab "Refs, Dolly"` so Whisper spells the names right, `--lang hi --hinglish`,
`--denoise`, `--style ice`, `--captions-style glide`, `--viewport 1280x800`, `--storage <state.json>`, `--force`.
Sub-commands: `explore --url U [--shots]` (what is on the product), `plan` (transcribe + write the plan only), `check --out dir`
(headless dry run of the plan), `compose --out dir` (re-render with a new style or bubble, no re-record).

### Your job: fill in narration-plan.json
1. **Read the plan.** Each segment is one sentence: `said` is what the user said, `timing` is every word with its start-end ms
   (`pricing.@5200-5680`). Read all of `said` first: what features, in what order, which are shown where?
2. **Explore the product for real.** `node autopilot/narrate.mjs explore --url <url> --shots` prints links, buttons and inputs per page
   (parentheses = on the avoid list, never touched) and saves screenshots you can open. For anything deeper use Playwright or any
   browser tool you have: open the page, find the exact control for each thing the user mentions. For a local dev server use
   `http://localhost:3000`; for a staging site its URL; for a signed-in app see "Signed-in apps" below.
3. **Map every segment to the UI.** For each segment write `intent` (one line: "show the new filters dropdown") and `actions`.
   Prefer stable targets: the visible text of a button or link, or a CSS selector / `role=` / `text=` selector.
4. **Anchor each action to the word that triggers it** with `at`. The cursor arrives about 260 ms before the word and the click
   lands on it:
   - `"at": "pricing"` the first "pricing" in this segment (it also looks in the neighbouring segments); `"pricing#2"` the second one;
     `"here's pricing"` a phrase (the time of its first word); `"end:pricing"` the moment the word ends; `4200` raw ms; `"4.2s"`;
   - `"after": 150` nudges an anchor by that many ms;
   - a scroll can end on a word: `{"scroll": 480, "at": "every", "to": "end:shot#2"}` (the scroll spans exactly those two words);
   - actions without `at` run right after the previous one.
5. **Never leave the screen frozen.** If a segment is longer than about 3 s and has no action, the driver adds a slow ambient scroll
   (`"ambient": false` on the segment turns it off). Better: write a real scroll, or a hover on the thing being described.
6. **Respect the pace.** A cursor move needs about 0.6 to 1.2 s and a page navigation about 0.5 s. Two cursor actions on different
   things less than ~1.5 s apart will land late (the compile step prints a WARN for gaps under 700 ms, and the sheet flags any action
   that landed more than 250 ms from its word). Fix a late one by anchoring to a later word (`"after": 300`) or by dropping the
   scroll before it. If a page is scrolled and the next click is in the header, the driver scrolls back first: end the scroll earlier
   or add a `{"scroll": -480}` anchored to a word before the click.
7. **Say what to emphasise.** `"emphasize": ["fifty percent"]` on a segment highlights those caption words (use the word as written in
   `timing`, e.g. "50%").
8. **Phone take (`--vertical`).** The 9:16 cut is a second take at a phone viewport with the same plan. A target that is hidden behind
   a hamburger is found automatically (the driver taps the menu once). For anything else give an action a `"mobile"` override
   (an action, an array of actions, or `false` to skip it) or a segment `"mobileActions"`.

Action fields (same as the autopilot script, plus `at`): `{"click": target}`, `{"hover": target}`, `{"type": "text", "into": target}`
(typed characters are never stored), `{"press": "Meta+K"}`, `{"scroll": px, "ms": n}`, `{"wait": ms}`, `{"goto": "/path"}`.
Example (the one in `autopilot/examples/narrate/`, about refs.video):
```json
{"id": "s4", "intent": "Flip the plan toggle to yearly", "emphasize": ["50%"],
 "said": "Flip to yearly, and it's 50% off.",
 "actions": [{"click": "Yearly", "at": "yearly"}, {"scroll": 240, "at": "50%", "ms": 1100}]}
```

### Timing, warm-up and loading covers (what the driver does for you)
- **Warm-up.** Before anything is recorded the driver visits every page of the plan in the same browser context (hovering and clicking
  the targets, fast, off camera), so images, scripts and data are cached. `"warm": false` in the script turns it off.
- **Backward planning.** The cursor must be on its target 260 ms before the word. If two cursor actions are closer than about 1.7 s the
  compile step presses the earlier one up to 600 ms before its word (printed as `WARN nudged ...`) instead of letting the later one land
  late. After a navigating click the driver waits for the new page only until the next action needs it, then goes straight for the
  next target. The sheet measures every action against the spoken word, not the nudged time.
- **Loading cover.** A navigation shows the site's own loading shell for a few hundred ms. The driver logs each one as
  `events.json` `loading: [{startMs, endMs}]` (CONTRACT.md) and the renderer holds the last good frame over it, then crossfades to the
  loaded page: no skeleton on camera, same length, same audio sync, cursor and ripple still drawn on top. On by default;
  `--set loadingCover=false` turns it off.

### Check before you record, and after
- `narrate.mjs check --out <dir>` runs the whole plan in headless Chromium (nothing recorded, no pacing) and prints what each click
  target actually matched (`click "Pricing" -> "Pricing /pricing"`) and every target it could not find. It runs automatically before a
  recording and stops the run on a problem (`--force` overrides). Cloudflare-style bot walls may block headless runs of some pages even
  when the real window works; then use `--force`.
- After the render **look at `<out>/sheet.jpg`**: one card per action with the frame just after it landed, the spoken sentence under it
  with the word being said highlighted, and the measured offset (`+119 ms`). Red = landed over 250 ms from its word, yellow = the
  target matched something other than its name. The frame should show the thing the highlighted word names. Also look at
  `vertical-sheet.jpg` and that the face bubble never covers a click. `<out>/timing.json` has the raw numbers (planned vs actual).
- Fix the plan and re-run the same command (transcript and audio are cached), or `compose` to only restyle.

### Face-cam bubble
If the input is video, Dolly crops a square around the face (`--facecam-focus 0.5,0.35` = where the face sits in the clip, x,y 0..1),
and shows it as a bubble with a soft shadow and a subtle border. Style flags: `--facecam-shape circle|rounded`,
`--facecam-corner auto|top-left|top-right|bottom-left|bottom-right` (auto: stays in the preferred corner and glides to a free corner
when the cursor or an upcoming click gets near, never overlapping the action), `--facecam-size 0.24` (diameter as a fraction of the
canvas' short side), `--facecam-border subtle|ice|none`, `--facecam-mirror`, `--no-facecam`. Or `--set facecam.corner=top-right`.
There is no background removal or blur (it would need a local segmentation model); frame the clip yourself.
Voice: the memo's own audio is the track. Output time equals recording time (no idle speed-up in Narrate), so voice, bubble and screen
stay locked.

### No-login use cases
- **Public marketing pages, a local dev server (`http://localhost:3000`), a staging URL**: just pass the URL. Nothing to set up.
- **Signed-in apps**: the user logs in once, by hand, in a window of their own, and the session is saved locally:
  `node autopilot/login.mjs https://app.their.product` opens a Chromium window; the user types their own password and passes any 2FA,
  then closes the window (or presses Enter in the terminal). The session lands in `autopilot/.auth/state.json` (mode 600, git-ignored).
  Then add `--storage autopilot/.auth/state.json` to `narrate.mjs` (or `"storageState"` in a script.json). **You never type
  passwords and never read or print the file or any browser cookie store.** It is a login: keep it private and delete it after the video.
  Prefer a test account. Add destructive buttons to `avoid` (the default list already covers checkout, upgrade, pay, delete, log in/out).

### Safety (Narrate)
Only the driven Chromium window is captured, never the full display. Typed characters are never written to events.json. Do not click
Pay, Buy, Delete or Subscribe in a take. Nothing is uploaded: audio, transcript, video all stay on disk.

## Polish my own recording
Footage recorded with `dolly-record` (events.json from the real mouse): put `recording.mov|mp4` and `events.json` in a folder, then
`node autopilot/make.mjs --polish <dir> --style ice`. Add `captions.json` to the folder if it needs captions. Without an
events.json, record again with `dolly-record` (or write one: CONTRACT.md); never invent click positions without looking at frames.

## Mac apps
`dolly-record --list` finds the window id; `dolly-record --window <id|text> --out <dir> --countdown 0 [--duration n]` records only
that window with the real cursor hidden and writes events.json from the real mouse and keys. Drive the app with computer use (that
moves the user's real cursor, so say so first), then `make.mjs --polish <dir>`. The recorder never records the full display unless
asked with `--display`.

## Safety rules
- Only record your own Chromium window. No full-display capture, no system cursor movement in browser takes.
- Typed characters are never written to events.json. Do not type real credentials into a take.
- Never publish or post anything (a repo, a site, social) on the user's behalf without their explicit yes.
