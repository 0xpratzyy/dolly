#!/usr/bin/env bash
# Regenerates public/demo/ (git-ignored) from the studio's demo recording: an H.264 900p web copy with a keyframe every
# half second (the Player scrubs it) and faststart, plus a poster. Skips work when the files are newer than the source.
set -euo pipefail
cd "$(dirname "$0")/.."
# The site drops the first TRIM seconds (default 0 for the current take; src/data.ts TRIM_MS shifts the plan by the same amount).
SRC="${DOLLY_DEMO:-../studio/demo/refs-tour}/recording.mp4"
OUT=public/demo
mkdir -p "$OUT"
# the caption engine loads its fonts with staticFile(): copy Subtle's fonts to public/fonts (git-ignored too)
SUBTLE="${SUBTLE_DIR:-../studio/vendor/subtle}"
if [ -d "$SUBTLE/fonts" ]; then mkdir -p public/fonts && cp -n "$SUBTLE"/fonts/* public/fonts/ 2>/dev/null || true; fi
# Backgrounds: the studio's NASA photos and AI wallpapers, at the paths its staticFile() calls resolve to at import time
# (/backgrounds and /wallpapers/ai), copied to public/ (git-ignored) with small thumbnails for the picker.
STUDIO=../studio
if [ -d "$STUDIO/assets/backgrounds" ]; then
  mkdir -p public/backgrounds/thumbs
  for f in "$STUDIO"/assets/backgrounds/*.jpg; do
    b=$(basename "$f"); cp -n "$f" public/backgrounds/"$b" 2>/dev/null || true
    [ -f public/backgrounds/thumbs/"$b" ] || ffmpeg -y -loglevel error -i "$f" -vf "scale=240:-2:flags=lanczos" -q:v 5 public/backgrounds/thumbs/"$b"
  done
fi
if [ -d "$STUDIO/public/wallpapers/ai" ]; then
  mkdir -p public/wallpapers/ai/thumbs
  cp -n "$STUDIO"/public/wallpapers/ai/*.jpg public/wallpapers/ai/ 2>/dev/null || true
  cp -n "$STUDIO"/public/wallpapers/ai/thumbs/*.jpg public/wallpapers/ai/thumbs/ 2>/dev/null || true
fi
# content hashes for the new sections' clips (src/media-manifest.json), so a re-rendered clip is never served from an old cache
node scripts/media-manifest.mjs
if [ ! -f "$SRC" ]; then
  [ -f "$OUT/demo.mp4" ] && { echo "prep-media: $SRC missing, keeping the existing $OUT/demo.mp4"; exit 0; }
  # a fresh clone has no demo recording (it is git-ignored): the site still builds, with an empty player until it is made
  echo "prep-media: $SRC not found, skipping the demo clip (make one with: node studio/scripts/make-demo.mjs)" >&2; exit 0
fi
# a filmstrip for the editor timeline: 30 frames side by side (96x60 each), one small jpg
strip() { [ -f "$OUT/look.jpg" ] || ffmpeg -y -loglevel error -ss 2.2 -i "$OUT/demo.mp4" -frames:v 1 -vf "scale=320:-2" -q:v 4 "$OUT/look.jpg"
  [ -f "$OUT/strip.jpg" ] && [ "$OUT/strip.jpg" -nt "$OUT/demo.mp4" ] && return 0
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/demo.mp4")
  ffmpeg -y -loglevel error -i "$OUT/demo.mp4" -vf "fps=30/$DUR,scale=96:60:flags=lanczos,tile=30x1" -frames:v 1 -q:v 5 "$OUT/strip.jpg"; }
if [ -f "$OUT/demo.mp4" ] && [ "$OUT/demo.mp4" -nt "$SRC" ] && [ -f "$OUT/poster.jpg" ]; then strip; exit 0; fi
ffmpeg -y -loglevel error -ss "${TRIM:-0}" -i "$SRC" -an -vf "scale=2160:1350:flags=lanczos,fps=30" -c:v libx264 -preset slow -crf 29 \
  -profile:v high -pix_fmt yuv420p -g 15 -keyint_min 15 -movflags +faststart "$OUT/demo.mp4"
ffmpeg -y -loglevel error -ss 0.3 -i "$OUT/demo.mp4" -frames:v 1 -vf "scale=1440:-2" -q:v 4 "$OUT/poster.jpg"
strip
ls -lh "$OUT"
