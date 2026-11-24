# Spotlight: isolate one piece of UI and turn it into a feed-ready animation

No recording. Dolly opens the live page (or a local HTML snippet), finds the component, hides everything else, drives its
interactions on a virtual clock and writes the frames as one transparent 60 fps video (`frames.webm`, VP9 with alpha; the PNG frames it is made from are deleted, `--keep-frames` keeps them). The Spotlight composition then films that
component on a stage (Void, Studio, Wallpaper, Desk, Curtain) with a 3D camera, depth of field, a cursor, shadows and UI sounds.

```
# 1. capture (node spotlight/capture.mjs ...)
node spotlight/capture.mjs --url https://refs.video --target ".site-links" --actions actions.json --out caps/nav --dark
node spotlight/capture.mjs --html snippet.html --target "#card" --out caps/card

# 2. render (node studio/spotlight.mjs ...)
node studio/spotlight.mjs caps/nav --scene void --tilt 11 --glow '#86E4F0' --aspect 3:2,1:1,4:5,9:16
node studio/spotlight.mjs caps/nav caps/pricing caps/card --scene studio --layout carousel --aspect 16:9
node studio/spotlight.mjs caps/pricing --scene wallpaper --bg ai-hills-golden
node studio/spotlight.mjs caps/card --loop --scene curtain --sound subtle          # 6-12 s seamless loop for X
node studio/spotlight.mjs caps/nav --still 220 --scale 0.5                           # one frame, fast look
sh spotlight/sheet.sh caps/nav 30 6 4                                                # contact sheet of a capture
```

## Capture
`--target` is a CSS selector, visible text, or a description (`"the pricing toggle"`). Text and description hits climb to the
nearest meaningful component (nav, card, panel, dialog, anything with a background and radius), stopping before a full-bleed
bar. `--exact` keeps the element itself; `--max-area 0.4` limits how far the climb goes.
- **Isolation.** Everything outside the component's ancestor chain is `visibility:hidden`, the chain's own backgrounds, shadows
  and pseudo-elements are cleared, and the page background is transparent (`Emulation.setDefaultBackgroundColorOverride` alpha 0),
  so the PNGs have a real alpha channel, no fringe. A translucent / glass component is flattened onto the colour behind it first
  (`--no-flatten` to keep it see-through).
- **Overlays.** Menus, popovers, dialogs, tooltips and toasts that appear because of the interaction (also portaled to `<body>`)
  are detected every frame (role, popper / portal wrappers, class names, fixed or absolute boxes near the component) and kept.
- **Virtual time.** `Date`, `performance.now`, timers, `requestAnimationFrame`, idle callbacks and every CSS transition, CSS
  animation and Web Animation advance only when the capture steps the clock (1/60 s), so the output is exact 60 fps on any
  machine and `Math.random` is seeded (`--seed`). Pass 1 measures what is ever painted, pass 2 captures that union
  (`--pad 130` px around it for shadows). A page that depends on real time (video, a canvas loop on its own clock) will not move.
- **spotlight.json.** Per frame: union bbox, painted roots, `cards` (the real rounded boxes, used for edge highlights),
  cursor `[tMs,x,y,kind,pressed]`, clicks, hovers, key timings (never the characters), states, sound hints. Coordinates are CSS
  px of the capture image. The cursor itself is not captured; the renderer draws it.
- Flags: `--viewport 1440x900 --scale 2|3|4` (default automatic: 2-4 by the component's size, so a small component is still crisp as a big hero) `--lead 500 --tail 900 --dark|--light --hide "sel" --cursor-start x,y`.

### actions.json
An array, played in order, each with a human cursor (curved, eased, small overshoot, a pause before clicks):
`{"hover": target, "dwell": ms}` · `{"click": target}` · `{"dblclick": target}` · `{"type": "text", "into": target}` ·
`{"press": "Enter"}` · `{"select": trigger, "option": "text"}` · `{"drag": target, "dx": 120, "dy": 0}` or `"to": target` ·
`{"slide": target, "to": 40}` (range input value) or `"dx"` · `{"swipe": target, "dir": "left", "dist": 240}` ·
`{"scroll": {"in": target, "by": 300}}` · `{"move": target | [x,y], "at": [0.5,0.5]}` · `{"wait": ms}` ·
`{"state": "name"}` · `{"sound": "success"}`. A target is a CSS selector or visible text. See `spotlight/examples/`.

## Render
`node studio/spotlight.mjs <dir> [<dir>...]` writes `<dir>/spotlight-<scene>-<layout>.mp4` (h264, audio aac when sound is on).
- **Scenes** `--scene void|studio|wallpaper|desk|curtain`. `--bg <id>` is any Dolly background (CSS, animated shader, photo, AI
  wallpaper; see backgrounds.md); `--bg-blur`, `--bg-dim`, `--bg-grain`, `--bg-drift` (slow Ken Burns), `--bg-image file`.
  Void is near-black with a faint floor sheen and grain; Studio is clean off-white; Desk puts the component on a soft-lit glass
  slab over a blurred wallpaper; Curtain is dark with soft vertical light streaks, brighter top centre, slowly drifting.
- **Layouts** `--layout single|carousel|collage|grid`. Carousel pans along a row, each component plays when the camera reaches
  it; collage is a loose arrangement the camera flies through (with depth, small rotations, zoom dips); grid starts on the
  overview, pushes into `--focus N`, plays, pulls back out.
- **Camera.** Critically damped (it eases onto its target and never passes it). The hero gets ONE slow, steady tilt sweep across
  the clip (`--tilt 9`, 0 = flat; a slow orbit in a loop); it does not follow the cursor. A gentle push-in over the first 1.3 s,
  then a slow creep. Depth-of-field blur (`--dof 0.6`) is scheduled: on the entrance, the exit and while the camera travels
  between components, and on off-focus neighbours; never in the middle of a shot. Directional motion blur on fast moves
  (`--motion-blur 0.55`), `--pace 1.3` for slower. A lone hero is framed on everything it ever paints, so a dropdown opens
  into room that is already there and the frame barely moves.
- **Framing.** `--hero 0.4` = width of the hero as a fraction of the frame. Default is automatic: 52-76 % by the component's
  size (the references show the UI at 45-90 % of the frame). Aspects `--aspect 3:2` (1620x1080), `16:9`, `1:1`, `4:5`, `9:16` (comma list renders
  each); the hero stays centred and is re-fitted for the frame.
- **Polish.** Contact + soft + large drop shadows follow the alpha silhouette; a 1 px inner highlight on the real card boxes
  (dark and light variants); optional edge glow `--glow '#86E4F0'`; reflection on Void/Curtain (`--reflection off`); crisp macOS
  cursor (arrow, hand, I-beam, grab) with a press animation and a click ripple (`--ripple off`, `--cursor light|off`,
  `--cursor-size 1.25`); `--title`, `--wordmark` (tiny eyebrow).
- **Loop.** `--loop` makes a seamless loop of a single component: the last 0.55 s cross-fade into the first, the camera is
  periodic (the step across the seam equals the step before it), there is no intro, outro or blur. Capture it so the interaction ends where it started (close the menu, toggle back) and
  keep it 6-12 s.
- **Sound.** `--sound off|subtle|full` (default subtle). Procedural UI sounds (hover tick, press thock, release, toggle, open /
  close whoosh, success chime, key ticks) are synthesised in `studio/src/spotlight-sound.ts` (deterministic, no samples), placed on
  the exact frames from the capture's state hints, peaks about -9 dBFS, the top end rolled off. The wav is also written next to
  the video as `*.sounds.wav`.

Embedding: `buildTimeline`, `Spotlight`, `defaultSpotlightOptions` are exported from `studio/src/lib.ts`; a Player takes the same
props (`items: [{id, base: <url prefix>, meta: <spotlight.json>}]`).

## Rough edges
- Capture takes about 1 s of wall clock per 2 s of video, and `measureRoot` walks the component subtree every frame (big subtrees
  are slower).
- Real `<video>`, WebGL and canvas loops on a page run on their own clocks: they will not advance with virtual time.
- Backdrop blur and mix-blend-mode over the page cannot survive isolation (the page is gone); glass is flattened to a solid.
- Only the component's own overlays are found by proximity; a toast far from the component needs `--target` to include it.
