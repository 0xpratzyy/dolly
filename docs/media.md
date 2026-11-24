# Media that is not in the repository

The public repository holds code, small fixtures and original or public-domain wallpapers only. These folders are git-ignored
because they contain recordings of other people's products or of a real person:

| Path | What it is | How to get it back |
|---|---|---|
| `site/public/demo/` | web copy of the demo recording used by the playground | `cd site && scripts/prep-media.sh` (needs `studio/demo/refs-tour/recording.mp4`, made by `node studio/scripts/make-demo.mjs`) |
| `site/public/hero/`, `site/public/narrate/`, `site/public/spot/` | landing-page clips and posters: Dolly's own renders of each mode | Render your own with Dolly and drop them at the same file names (`hero/record.mp4`, `autopilot.mp4`, `narrate.mp4`, `spotlight.mp4`, `poster-*.jpg`, `spot/<scene>-<aspect>.mp4`, `narrate/narrate-16x9.mp4` ...), then `node site/scripts/media-manifest.mjs` |
| `autopilot/examples/**/*.mp4`, `*.m4a`, `*.jpg` | example recordings, a voice memo and contact sheets from real runs | Run `autopilot/make.mjs` or `narrate.mjs` on `autopilot/examples/*.json` against your own product |
| `studio/demo/*/recording.*`, `*.jpg` | the test recording and its sheets | `node studio/scripts/make-demo.mjs` |

Without the landing clips the playground site builds but shows empty video slots. The editor and the renderer do not need them.

Kept in the repository on purpose:
- `studio/public/wallpapers/ai/` and `studio/assets/backgrounds/`: AI-generated originals and NASA photos, credited in `docs/backgrounds-credits.md` and `studio/public/wallpapers/ai/manifest.json`.
- `site/public/og.jpg`: a rendered wallpaper frame with the wordmark.
