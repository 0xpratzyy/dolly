# Release audit (2026-11-24)

Audit of the Dolly working tree for the public release at github.com/0xpratzyy/dolly. The repo has never been pushed; 232 files were
tracked before this pass, 179 after. Nothing here was pushed or created on GitHub.

## Result in one paragraph
No secrets, tokens or account ids in the tracked tree. Three things need a human glance (listed under "Open items"). The real risk was
media: the hero, demo, Spotlight and Narrate clips contain footage that must not be public, and ~29 MB of it was tracked. Those are
now untracked and git-ignored (files stay on disk). Publish as one fresh orphan commit (commands below), so nothing in old history leaks.

## Secret scan (gitleaks not installed; manual grep over `git ls-files`)
Patterns: `refs_…` keys, `phc_…`, `sk-…`, `AKIA…`, `ghp_…`, `xox[bp]-`, `api_key=`, `token=`, `secret`, PEM blocks, the Cloudflare account id,
`CLOUDFLARE`, e-mail addresses. Plus a check for `.env*`, `*.pem`, `*.key`, `storage-state*.json`, `.auth/` (all ignored, none tracked).

| Finding | Where | Verdict |
|---|---|---|
| `phc_umZB9…` PostHog project key | `site/src/analytics.ts:7` | Public project token (meant for browsers; the site also proxies it through `/ingest`). Fine to publish. Anyone can send events with it; if that matters, rotate later. |
| e-mail addresses | none | clean |
| Cloudflare account id, API tokens, wrangler secrets | none (`site/wrangler*.jsonc` hold only names, a bindings block and a commented route) | clean |
| Refs/Subtle API keys | none | clean |

## Personal paths and identifiers
| Finding | Where | Action |
|---|---|---|
| `/Users/pratyushrungta` | none in tracked files | clean |
| `~/dolly-test/...` scratch paths | `docs/motion-audit.md` (2 lines) | replaced with generic wording |
| `https://dolly-site-dev.pratyush987.workers.dev/og.jpg` (personal workers.dev subdomain) | `site/index.html:16,21` (og:image, twitter:image) | **Open item 1**: not edited (site/ is owned by another agent right now). Point it at `https://dolly.refs.video/og.jpg` when the domain is live. |
| `https://x.com/pratyushrungta` "Contact" link | `site/src/RefsFooter.tsx:41` | Intentional public handle, fine. |
| `0xpratzyy/dolly`, `0xpratzyy/subtle` URLs | `site/src/consts.ts`, README | Intended. |
| `/private/tmp/claude-501/...` scratchpad path | `docs/design-audit.md` | file moved out of the public tree (see below) |

## Internal planning docs
| File | Decision |
|---|---|
| `SPEC.md` ("owner brief", launch gating) | moved to `internal/` (git-ignored, on disk) |
| `docs/design-audit.md` (owner quotes, scratchpad paths, redesign plan) | moved to `internal/` |
| `docs/showcase-references.md` (notes on third-party launch videos, local download paths) | moved to `internal/` |
| `docs/motion-audit.md` | kept: contributors can re-run its numbers. Owner quote and internal file references removed. |
| `docs/backgrounds.md`, `docs/backgrounds-credits.md`, `docs/spotlight.md`, `CONTRACT.md`, `studio/docs/plan-fields.md` | kept |
| `SKILL.md` | kept; "owner" wording changed to "user", layout block now lists `spotlight/`. Reads for a new user; no owner-specific paths. Subtle line already updated by the vendoring commit. |
| `site/README.md` | kept; has two "owner" mentions about attaching the production domain, harmless. |

## Large and non-public media (tracked before this pass)
| Path | Size | Why | Action |
|---|---|---|---|
| `site/public/narrate/*.mp4`, posters | 11.6 MB + | Narrate demo (voice and face of a real person) | untracked, ignored |
| `site/public/hero/*.mp4`, posters, `looks/` | 15.5 MB + | built from Subtle's demo clip (a real public figure, licensed for subtle.refs.video only) and recordings of refs.video | untracked, ignored |
| `site/public/spot/*` (31 clips) | ~9 MB | Spotlight renders of refs.video UI | untracked, ignored |
| `autopilot/examples/narrate/refs-facecam-test.mp4`, `refs-voice.m4a` | 0.6 MB | a person's face and voice | untracked, ignored |
| `autopilot/examples/**/*.jpg`, `studio/demo/refs-tour/*.jpg` (contact sheets) | ~1.3 MB | frames of refs.video / Subtle footage | untracked, ignored |
| `studio/assets/backgrounds/*.jpg` (4 NASA photos, ~2 MB) | kept | public domain, credited in `docs/backgrounds-credits.md` |
| `studio/public/wallpapers/ai/*` (AI wallpapers + thumbs) | kept | original, `manifest.json` says "AI-generated ... original, no third-party assets" |
| `site/public/og.jpg`, `brand/*.svg`, `favicon.svg` | kept | og.jpg is a wallpaper frame; the SVGs are the Refs logo (Refs' own brand, fine under "Made by Refs") |

Remaining tracked size (excluding vendored Subtle): about 6.3 MB, none above 600 KB. `docs/media.md` explains how to regenerate the ignored files.

Note: `studio/demo/refs-tour/{plan.json,events.json,captions.example.json}` stay (data only, no footage).

## Licences
- Dolly: MIT, (c) 2026 Refs (LICENSE added).
- Subtle: MIT, (c) 2026 Refs (refs.video): compatible. Subtle bundles fonts under SIL OFL 1.1 (listed in its `THIRD_PARTY.md`). Now vendored in `studio/vendor/subtle` (commit dcf7781) with `LICENSE`, `THIRD_PARTY.md` and 15 `OFL-*.txt` files; the README points at them. Vendored size about 6 MB (fonts); the remaining tracked tree is about 12 MB, so the earlier "~6.5 MB" figure no longer holds.
- NASA photos: public domain, credited. AI wallpapers: ours.
- npm and Swift dependencies keep their own licences (Remotion has its own company-licence terms for larger companies: mention in README if the audience cares; not changed here).

## Open items for the owner
1. `site/index.html` og:image / twitter:image still point at the personal workers.dev dev URL.
2. (Done by the other agent) Subtle vendored. Check `site/scripts/prep-media.sh` still copies fonts from the right place, and `studio/README.md` "Captions" says `studio/vendor/subtle`.
3. The README has two TODO placeholders: the `dolly.refs.video` link and a "Lite mode" section (lite mode did not exist in the tree yet).
4. `site/README.md` (lines 17-18) and `site/scripts/prep-media.sh` (line 11) still default to a sibling `../../subtle` instead of `studio/vendor/subtle`, and `site/README.md` says "owner" twice. Left for whoever owns `site/`.
5. Remotion's licence: Remotion is free for individuals and small companies only; worth one sentence in the README before launch.

## Publish commands (run after the other agent has finished and you have reviewed)
```bash
cd ~/code/dolly
git status --short                      # everything intended is committed; nothing under studio/ recorder/ site/src left half-done
git ls-files | grep -E '\.(mp4|mov|m4a)$'   # must print nothing
git ls-files -z | xargs -0 grep -IlE '/Users/|pratyush987|phc_' # expect only site/index.html (fix), site/src/analytics.ts (public key)

git checkout --orphan public-main       # new root, tree = the current index (ignored media is not in it)
git add -A                              # respects .gitignore
git ls-files | wc -l && du -ch $(git ls-files) | tail -1   # sanity: ~180 files, < 10 MB
git commit -m "Dolly: open-source Screen Studio alternative run by Claude Code" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"

# create the repo (public) and push ONLY the orphan branch as main
gh repo create 0xpratzyy/dolly --public --source=. --remote=origin --description "Open-source Screen Studio alternative, run by Claude Code"
git push -u origin public-main:main
git checkout main                       # the private history stays local, never pushed
git remote -v
```
The old branch (with the media in its history) must never be pushed: only `public-main:main`. After publishing, add the repo topics
(`claude-code`, `screen-recorder`, `remotion`, `product-demo`) and enable Issues.
