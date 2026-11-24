# dolly.refs.video

The playground site for Dolly: a live, fully editable demo. Vite + React + TypeScript, and it runs the real composition in the browser:
`@remotion/player` (4.0.534, pinned like the renderer) plays `Dolly` from `../studio/src/lib.ts` over a compressed copy of the demo
recording, with every field of the `Style` object (`../studio/src/types.ts`) on a control. Nothing in `../studio` is edited from here.

```bash
cd site && npm install
npm run dev            # prep + vite (http://127.0.0.1:5173)
npm run build          # prep + type-check + static build into dist/
npm run deploy:dev     # build + wrangler deploy -c wrangler.dev.jsonc  ->  dolly-site-dev on workers.dev (no route)
```

- `scripts/prep-media.sh` (runs before dev and build) makes `public/demo/demo.mp4` (H.264 1440x900, keyframe every 0.5 s, faststart)
  and `poster.jpg` from `../studio/demo/refs-tour/recording.mp4`, and copies Subtle's fonts to `public/fonts`. Both folders are git-ignored.
- The demo plan is `../studio/demo/refs-tour/plan.json`, bundled as is. Demo captions are three editable lines at fixed output times (`src/data.ts`).
- Subtitles use Subtle's caption engine through the studio (`@subtle` alias -> `$SUBTLE_DIR/template/src`); Subtle is vendored in
  `../studio/vendor/subtle`, which is the default, so no extra checkout is needed (set `SUBTLE_DIR` to use your own). The style picker lists its
  `styles/*.json`, minus "behind the speaker" and song styles.
- The repo URL is a placeholder (`REPO_URL` in `src/data.ts`) until the repo is public.
- Analytics: PostHog through our own `/ingest` (worker.js), `site: "dolly"`, events `dolly_*`, only on `dolly.refs.video`.
- `wrangler.dev.jsonc` is the dev worker (`workers_dev`, no route). `wrangler.jsonc` is production with the route commented out;
  attach `dolly.refs.video` only when the owner says so.

## Editor (v2)
`src/editor/`: `Editor.tsx` (state, keyboard), `Stage.tsx` (Player, before/after wipe, zoom focus picker), `Timeline.tsx` (zoom blocks, clicks,
subtitle blocks, playhead), `Inspector.tsx` (Looks + Background / Frame / Camera / Cursor / Subtitles / Export), `state.ts` (undo/redo, `#e=` share hash).
Zoom edits change the plan handed to the Player and are included in the copied prompt. `prep-media.sh` also makes `strip.jpg` (timeline filmstrip) and `look.jpg`.

## Spotlight, Narrate and the new backgrounds (v3)
- **Spotlight** (`src/spotlight/`): a preview that swaps between real renders, plus the prompt builder. The Spotlight composition draws a 60 fps PNG sequence per
  component, which no browser plays smoothly, so the clips in `public/spot/` are pre-rendered with `studio/spotlight.mjs` from one capture
  (`spotlight/examples/dropdown.html` + `dropdown.actions.json`): scenes void, studio, curtain, desk and two wallpapers (`meadow` = ai-hills-golden, `silk` = ai-silk-night)
  at 3:2, 16:9, 1:1, 4:5, 9:16, `--loop --tilt 9 --scale 0.75`/`0.8` (even pixel sizes), H.264 crf 28, with one shared UI-sound track muxed in (`Hear it` unmutes it).
  Scene, wallpaper and aspect change the clip; tilt, depth of field, hero size, glow, loop and UI sounds go into the copied prompt only.
- **Narrate** (`src/narrate/`): a real run of Narrate (computer voice, colour-bar face stand-in), 1280x720 and 608x1080,
  with `narrate-data.json` (words from transcript.json, markers and their measured offsets from timing.json). Words highlight on the video clock, a word or marker click seeks.
- **Media**: `public/spot`, `public/narrate` and `public/hero` are git-ignored (they hold renders of other people's products) and are not in a fresh clone;
  `docs/media.md` says how to regenerate them. Without them the page builds and shows empty video slots. `scripts/media-manifest.mjs` (run by prep) writes `src/media-manifest.json` with content hashes; `src/media.ts` adds them as `?v=`.
  Both sections are code-split and mount only when scrolled within about 900 px (`src/modes.tsx`); clips load when near the viewport and pause when off screen.
- **Backgrounds**: the editor's Background tab has Animated (shaders, played in the Player through `src/editor/DollyLive.tsx`), AI wallpapers and Space (NASA) with lazy thumbnails.
  `prep-media.sh` copies the studio's photos and AI wallpapers to `public/backgrounds` and `public/wallpapers` (git-ignored). NASA credits are in the page footer (`Credits` in `sections.tsx`).
