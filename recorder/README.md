# dolly-record

The recorder for Dolly: records the screen (cursor hidden) to `recording.mov` and writes
`events.json` (cursor, clicks, keys, scroll) exactly as in `../CONTRACT.md`.
macOS 14+, Apple Silicon, Swift 6.

## Build and test
```sh
swift build -c release      # binary: .build/release/dolly-record
swift test                  # coordinate conversion, key labels, events.json shape
```

## Permissions (once)
Grant these to the terminal app you run it from (Terminal, iTerm, Ghostty, VS Code...),
in System Settings → Privacy & Security, then quit and reopen that app:
- Screen Recording (video)
- Accessibility (the listen-only mouse/key tap)
- Microphone, only with `--mic`

`dolly-record --check` shows what is missing. Without a permission, recording exits at once
with a one-line message; it never hangs.

## Usage
```sh
dolly-record --check
dolly-record --list                                   # displays and windows
dolly-record --out ~/demos/first                      # main display, 60 fps, Ctrl-C to stop
dolly-record --out ~/demos/first --window "Safari" --fps 30 --mic --duration 20
```
Options: `--out <dir>`, `--display main|<id>`, `--window "<text>"` (title or app name contains text),
`--fps`, `--mic`, `--duration <sec>`, `--countdown <sec>` (default 3).

Output folder: `recording.mov` (H.264 High, native pixel size, optional AAC mic track) and `events.json`.

## How it lines up
- Time 0 is the first complete video frame (its ScreenCaptureKit timestamp, host clock). The movie file
  starts at that timestamp, and every event time is `hostTime - t0`. Events before it are dropped.
- Cursor: sampled on a timer on the t0 + k/fps grid, read with `CGEvent(source: nil).location`.
  Clicks, scroll and keys come from a listen-only `CGEventTap`.
- Coordinates: Quartz global points (top-left origin; secondary displays may be negative) minus the
  display/window origin, times the backing scale. Window recordings follow the window if it moves.
  Cursor samples are clamped to the video; clicks outside the captured area are dropped.
- Privacy: plain typing is timing only. The key's character is read only when cmd, ctrl or alt is
  held, and only to build a label like `⌘K`.
- `scroll.dy` is the raw point delta of the scroll event (sign as macOS reports it).
- A still screen sends no frames, so the video can be variable frame rate; the file still ends at the
  moment you stop, and `durationMs` matches it.

## Files
`Sources/dolly-record`: `main.swift` (flow), `Args.swift`, `Permissions.swift`, `Capture.swift`
(ScreenCaptureKit, mic, clock alignment), `Writer.swift` (AVAssetWriter), `Events.swift` (log and tap).
`Sources/DollyCore`: pure logic (`Geometry.swift`, `EventsFile.swift`), covered by `Tests/`.

# dolly-render
The native renderer (same package): `swift build -c release --product dolly-render`. It reads the render spec written by
`studio/scripts/camera-track.mjs` (per-frame camera and cursor track, layout, look), decodes the recording with AVAssetReader
on the hardware decoder (frames at their real timestamps; neighbours are blended only across a gap longer than 1.5 frames),
composites on the GPU with Core Image on Metal, and encodes with AVAssetWriter on the VideoToolbox hardware encoder
(H.264 High or HEVC, moov at the front, optional AAC voice). Two or three frames are in flight at any time.
```sh
dolly-render --spec spec.json --out out.mp4 [--codec h264|hevc] [--quality 0..1 | --bitrate <Mbit/s>] [--stats]
dolly-render <recording-dir> --style style.json --captions captions.json --out out.mp4   # runs camera-track.mjs with node
```
Normally you do not call it yourself: `node studio/dolly.mjs render <dir>` does. Numbers and limits: `../studio/README.md`.
