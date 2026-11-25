# Rehearsal: landing bento ("Everything a demo needs.")

Component: `Bento.tsx` + `bento.css`, kit copied to `stageshow/kit` (Stageshow 1.1.1, unmodified).

Gold: `bento` (structure: tile + run-in copy at page size, one Stage per picture pinned to the tile's foot at 1:1,
measured picture width, grid by container query, one beat per tile played once in view, staggered 110 ms) in
`dark-bento`'s material (depth from lighter surfaces on graphite, hairlines, no glow). Borrowed: `device-pair`
for 16:9 + 9:16 (mirrored, phone a gutter in from the left over the frame's wallpaper margin), `ai-chat` for the
Claude Code turn (typed, sent, answer rows arriving with `Collapse` drop, status on one `States` slot).
Changed: Dolly's tokens (graphite #0C0C0D page, #141516 tiles, ivory ink, Figtree + DM Mono), one accent
(ice, on the caption playhead only), real Dolly media for the two clip tiles, no light-theme parts.

Tiles (3 columns at a 1040+ container; 2 below; 1 under 640):
- Zooms, 2x1 hero: the real `bento/zoom.mp4`, a gutter in from top-left, ~10% off the right and ~25% off the foot;
  the row height follows the film's size (cqw) so the crop stays ~25% at every width.
- Fast and light, stat: "2.8 s" run as a stopwatch for 2.8 real seconds, a 20-frame filmstrip of the 10 s clip
  filling on the same clock; 240 MB in the label.
- Spotlight, 1x2 tall: the real `hero/spotlight.mp4` as the tile's ground, panel centered, sky masked into the tile.
- Edit by asking: typed ask, sent, "Update plan.json / Settings zoom 2.0x -> 1.4x", Rendering… -> "Re-rendered in 3 s.",
  a fresh prompt opens below.
- 16:9 and 9:16: `hero/poster-record.jpg` as the 16:9 frame (off the right, off the foot when wide), a phone-take frame
  rises in front (the 9:16 cut is a second take at phone viewport, per Dolly's SKILL.md).
- Pick a look: a cursor clicks a wallpaper in the editor's look picker; the frame's ground crossfades to it.
- Captions in one line: the caption pill over the waveform it was cut from; the line changes in the silence.
- Free and open source: strip with Open the editor + GitHub (kept the two tracked links from the old bento).

Beats: every Stage tile plays once on entering view (LEAD 350 ms + 110 ms per tile); the two clips loop while in view.
Posters are the payoffs (reduced motion shows them; the stat shows 2.8 with the strip full).

Captured: film.mjs `--gate` on each Stage tile at 1440, 1024, 768 and 390 on the real page; full-section stills of the
reduced-motion posters at 1440/1024/768/375 (`/tmp/dolly-bento-shots/final-*.png`), contact sheets in
`/tmp/dolly-bento-shots/film/`. No horizontal overflow at any width.

Gate: `rehearsal passed` for ask, shape, looks and caps at all four widths (last runs on http://127.0.0.1:5193).

Film (candidates judged by eye):
- ask `near-empty frames` ~3.5 s: the Rendering…/Re-rendered `States` crossfade; the rows above stay; stands.
- ask `touching` caret vs typed text (3 px): the block caret sits a hair after the last glyph, as a terminal draws it.
- ask `manual: same-box content change`: typing into the prompt line; intended.
- caps `jump` 8 px at script start (~0.9 s): `States` re-measuring as the scene leaves its poster; first frame only.
- Fixed from earlier runs: shapes `uneven gutters` (geometry now computed from the tile), looks `framing` (window runs
  past the edge, picker on the 36 px gutter), caption `Swap` clipping the old line (now `States`, lines of equal length),
  terminal mark column touching its text (2ch -> 3ch), phone `lands on a transform` (will-change).

Review: no separate fresh-eye reviewer agent was run (cost); the builder reviewed each sheet against the gold stills.

Assumptions: "Re-rendered in 3 s." and the plan.json edit wording are illustrative of an Edit-by-asking turn.
Unresolved: the stat tile keeps a band above its filmstrip in the 3-column layout (the hero row sets the height).
Not checked: Safari / Firefox, real touch devices, live frame pacing on a slow machine, the dark/light toggle
(the page is dark only), the clip tiles with film.mjs (they are <video>, not Stages).
