#!/usr/bin/env bash
# One-time setup for Dolly: checks the tools, installs the Node dependencies, and (on macOS) builds the recorder and native renderer.
set -euo pipefail
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "setup: '$1' is required. $2" >&2; exit 1; }; }
need node "Install Node 22 or newer (https://nodejs.org)."
need ffmpeg "Install ffmpeg (macOS: brew install ffmpeg)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || { echo "setup: Node 22+ required, found $(node -v)" >&2; exit 1; }

echo "== studio: npm install"
(cd studio && npm install --no-audit --no-fund)
echo "== autopilot: npm install + Chromium"
(cd autopilot && npm install --no-audit --no-fund && npx playwright install chromium)

if [ "$(uname)" = "Darwin" ] && command -v swift >/dev/null 2>&1; then
  echo "== recorder: dolly-record + dolly-render (Swift, a few minutes the first time)"
  (cd recorder && swift build -c release -j 2 -Xswiftc -suppress-warnings)
else
  echo "== recorder: skipped (needs macOS 14+ with the Swift toolchain). Rendering falls back to Remotion; window capture is unavailable."
fi

if [ -x recorder/.build/release/dolly-record ]; then
  echo "== permissions (window capture only; Autopilot's default smooth capture needs none)"
  recorder/.build/release/dolly-record --check || echo "   Grant Screen Recording to your terminal in System Settings > Privacy & Security if you want window capture."
fi
echo "Done. Ask Claude Code: \"make a launch video for <your URL> with Dolly\"."
