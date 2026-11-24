# Dolly: the events.json contract (recorder → planner → renderer)

Dolly turns a raw screen recording into a polished product demo (a free, open-source Screen Studio alternative driven by Claude Code). Three parts share one file per recording folder:

```
<recording>/
  recording.mov      screen video, system cursor NOT drawn (showsCursor = false)
  events.json        this contract
  plan.json          written by the planner, read by the renderer (Claude may edit it)
  out.mp4            the render
```

## events.json (version 1)
```json
{
  "version": 1,
  "video": "recording.mov",
  "width": 2880, "height": 1800,          // video pixels
  "fps": 60,
  "durationMs": 41250,
  "pointScale": 2,                          // video pixels per screen point
  "cursor": [[0, 1440.0, 900.0], [16, 1442.5, 901.0]],   // [tMs, x, y] in video pixels, origin top-left, ~every frame
  "clicks": [{"tMs": 2310, "x": 812.0, "y": 403.0, "button": "left", "kind": "down"},
             {"tMs": 2390, "x": 812.0, "y": 403.0, "button": "left", "kind": "up"}],
  "keys":   [{"tMs": 5120, "mods": []}, {"tMs": 9000, "mods": ["cmd"], "label": "⌘K"}],
  "scroll": [{"tMs": 7000, "dy": -120}]
}
```
Rules:
- All times are ms from the first video frame. All coordinates are video pixels, origin top-left.
- **Privacy:** `keys` never holds the characters typed. Plain typing is timing only (`mods: []`, no label). A label is written only for shortcuts with a modifier (⌘K, ⌘⇧P).
- `cursor` is sampled at least at the video fps while recording; the planner smooths it.
- Optional fields may be absent: `scroll`, `keys`, `windows`.

## Optional: `loading` (route-change shells)
```json
"loading": [{"startMs": 5357, "endMs": 5759}]
```
`loading` is an optional list of `{startMs, endMs}` windows in video time: from the click that started a navigation until the page's
loading shell (skeleton / spinner / unloaded images) was gone and real content was there. The autopilot driver writes it. The renderer
holds the last good frame (just before `startMs`) over each window and crossfades to the loaded page, so timeline length and audio sync
do not change and the cursor and ripple stay on top. `--set loadingCover=false` turns that off.
