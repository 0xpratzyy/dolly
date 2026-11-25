# Dolly

A free, open-source [Screen Studio](https://screen.studio) alternative that Claude Code runs for you. Give it a URL, a voice memo or a
screen recording and it hands back a polished product video: smooth auto-zoom that follows the action, a synthetic cursor, click
ripples, a wallpaper and window frame, motion blur and word-timed captions. 16:9 and a 9:16 cut.

Everything runs on your Mac. No account, no upload, no API key.

Dolly is a [Claude Code skill](SKILL.md): Claude explores your product, writes the script, records, checks contact sheets of the
result and fixes what is off.

Playground: dolly.refs.video (coming soon) · Made by [Refs](https://refs.video), the library of launch videos Claude can read.

## Four modes

| Mode | What you give it | What you get | Status |
|---|---|---|---|
| **Record** | A screen recording from `dolly-record` (or your own with an `events.json`) | A polished render of your own footage | Stable |
| **Autopilot** | A product URL (or a feature to show) | Claude drives a real browser at 60 fps and renders the demo with captions | Beta |
| **Narrate** | A voice memo or face-cam clip about what you launched | The product is opened and clicked at the exact word you say it; your voice, your face in a bubble, captions | Beta |
| **Spotlight** | A page or HTML snippet and a component selector | A feed-ready loop of one piece of UI lifted out of its page onto a stage (Graphite, Studio, Wallpaper), with an action push-in | Beta |

Autopilot, Narrate and Spotlight work well on public marketing pages, local dev servers and staging sites. Expect to look at the
contact sheet and ask Claude for a fix or two.

## Install

```bash
git clone https://github.com/0xpratzyy/dolly ~/.claude/skills/dolly
cd ~/.claude/skills/dolly && ./setup.sh
```

Then, in Claude Code, ask for a video (below). `setup.sh` checks your tools, runs `npm install` in `studio/` and `autopilot/`,
installs Playwright's Chromium and, on a Mac with Swift, builds the recorder and native renderer.

### Requirements
- **Node 22+** and **ffmpeg** (`brew install ffmpeg`)
- **macOS 14+ on Apple Silicon** for window recording (`dolly-record`) and the native renderer. Linux and Windows can run
  Autopilot and the Remotion renderer, but not window capture or native rendering.
- Swift 6 toolchain (Xcode or the command-line tools) to build the recorder
- Captions use [Subtle](https://github.com/0xpratzyy/subtle)'s caption engine, styles and fonts, vendored in `studio/vendor/subtle`
  (MIT and SIL OFL, licences included). Set `SUBTLE_DIR` to use your own Subtle checkout instead.
- Voice transcription for Narrate uses Subtle's local mlx-whisper (Apple Silicon), also vendored.

## Quick start

Ask Claude Code:

- "Make a launch video for https://your.product with Dolly."
- "Show the new filters dropdown on https://your.product" (Autopilot, or Spotlight for a single component)
- "Here's a voice memo about what we shipped, make the launch video" (Narrate; attach the memo and give the URL)
- "Polish this screen recording" (point it at a folder with `recording.mov` and `events.json`)

Or run the pieces yourself:

```bash
node autopilot/make.mjs autopilot/examples/refs-script.json --out ~/demos/refs    # script -> recorded -> rendered
node studio/dolly.mjs render ~/demos/refs --style ice --set zoom.amount=1.4        # restyle without re-recording
node autopilot/narrate.mjs --voice memo.m4a --url https://your.product --out ~/demos/launch
node spotlight/capture.mjs --html spotlight/examples/dropdown.html --target "#card" --out caps/card
```

Everything the skill does and every flag is in [SKILL.md](SKILL.md). Style fields: [studio/README.md](studio/README.md).

## Native renderer

On macOS, `dolly render` uses `dolly-render` (in `recorder/`): the recording is decoded on the hardware decoder, composited on the GPU
(Core Image on Metal) and encoded on the hardware encoder. It is the default once built; Remotion (headless Chrome) is the fallback
and handles the few things the native path does not draw yet (face-cam bubble, video backgrounds, hand cursor).

Measured on one 10 s, 1920x1080, 60 fps clip (wallpaper, window frame, shadow, cursor, two zooms, glass captions; Apple M5, 16 GB):

| | native | Remotion (`--concurrency 2`) |
|---|---|---|
| wall time | **2.8 s** | 30.9 s |
| peak memory | **0.2 GB** | 2.9 GB |
| CPU | 1.5 CPU-seconds | 101 CPU-seconds |

The pictures match (SSIM 0.989). Details, caveats and flags (`--engine`, `--codec`, `--quality`): [studio/README.md](studio/README.md).

## Lite mode

Every command takes `--quality lite|normal|max`. Without the flag Dolly picks lite on a Mac with 8 GB of memory or less (or 4 cores
or fewer), max on 32 GB+ with 10+ cores, and normal otherwise; `DOLLY_QUALITY=lite` sets it for a shell. Lite records at 1.5x instead of
2x, outputs 1080p at most, draws no camera motion blur, renders on one Chrome tab and encodes a little smaller.

Measured on an Apple M5 (16 GB), one command at a time, peak memory of the whole process tree ([details](docs/performance.md)):

| Step | lite | normal |
|---|---|---|
| Autopilot capture (10 s take) | 1.6 GB, 65 s | 2.2 GB, 89 s |
| Native render (10 s, 1080p60) | 0.24 GB, 2.6 s | 0.24 GB, 2.8 s |
| Spotlight capture (dropdown example) | 0.8 GB, 38 s | 1.4 GB, 58 s |

Lite stays at or under about 2.5 GB in every step, so it is the mode to use on a small or hot laptop.
`node studio/dolly.mjs clean --dry-run` shows what Dolly keeps on disk.

## Layout

```
autopilot/   narrate.mjs, drive.mjs, make.mjs: record a script or a voice memo, then render
studio/      planner + renderer (Remotion composition, camera and cursor math), docs/plan-fields.md
recorder/    dolly-record (ScreenCaptureKit) and dolly-render (native renderer), Swift
spotlight/   capture.mjs: isolate one component and capture it as a transparent frame sequence
site/        the playground site (Vite + React); see site/README.md
docs/        backgrounds, Spotlight, motion measurements, media notes
CONTRACT.md  the events.json format between recorder, planner and renderer
```

## Media and credits
The repo ships original AI-generated wallpapers and public-domain NASA photos ([credits](docs/backgrounds-credits.md)). Demo clips and
example recordings are not included; see [docs/media.md](docs/media.md) for how to regenerate them with your own footage.

## Privacy and safety
Only the Chromium window Dolly drives is captured, never the full display. Typed characters are never written to `events.json`.
Dolly does not click Pay, Buy or Delete, and never types your passwords: for a signed-in app you log in once by hand and the session
stays on disk (git-ignored). Audio, transcripts and video are not uploaded anywhere.

## Contributing and licence
See [CONTRIBUTING.md](CONTRIBUTING.md). MIT, see [LICENSE](LICENSE).

**Remotion licence.** Dolly renders natively by default and needs no Remotion licence for that. The Remotion fallback
(`--engine remotion`), Spotlight and the site's player use [Remotion](https://remotion.dev), which is free for individuals and small
teams and needs a company licence for larger ones: check [remotion.dev/license](https://www.remotion.dev/license) before using those parts commercially. The vendored Subtle code (MIT) and its fonts (SIL OFL 1.1) keep their own
licences: `studio/vendor/subtle/LICENSE` and `THIRD_PARTY.md`.
