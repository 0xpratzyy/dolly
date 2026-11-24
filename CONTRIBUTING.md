# Contributing to Dolly

Thanks for helping. Dolly is a Claude Code skill plus a renderer, so most changes touch one of four places:

| Area | Folder | Notes |
|---|---|---|
| Planner and renderer | `studio/` | TypeScript + Remotion. `npm run typecheck` before sending a change. |
| Native renderer and recorder | `recorder/` | Swift 6, macOS 14+. `swift build` and `swift test`. |
| Autopilot, Narrate, Spotlight drivers | `autopilot/`, `spotlight/` | Node 22+, Playwright. |
| Playground site | `site/` | Vite + React. `npm run build` type-checks. |

## Ground rules
- Open an issue first for anything large. Small fixes can go straight to a pull request.
- Keep the file formats stable: `CONTRACT.md` (events.json) and the `Style` and plan types in `studio/src/types.ts`. If you change one, update the docs in the same pull request.
- Motion numbers live in `motionDefaults` (`studio/src/types.ts`). If you change a timing, measure it with `studio/scripts/motion-*.mjs` and say what you saw (see `docs/motion-audit.md`).
- Do not add third-party footage, logos or recordings of people. Wallpapers must be original or public domain, with a line in `docs/backgrounds-credits.md` or the wallpaper manifest.
- Never commit sessions, cookies, `.env` files or recordings of signed-in apps.
- Check your change on the demo (`studio/demo/refs-tour`) and look at the contact sheet before and after.

By contributing you agree your work is released under the MIT licence in `LICENSE`.
