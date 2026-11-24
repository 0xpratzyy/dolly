# Subtle (vendored)

The parts of Subtle that Dolly needs to draw captions, copied unchanged from Subtle at commit `80694d4` ("Release Subtle"):

- `template/src/`: the caption engine (React / Remotion components), imported through the `@subtle` alias;
- `styles/*.json`: the caption styles (`captions.style` in a Dolly style);
- `fonts/`: the fonts those styles use, each with its licence file (`OFL-*.txt`, SIL Open Font License 1.1);
- `scripts/transcribe.py`: local word-timed transcription (mlx-whisper, run with `uv`), used by Narrate.

Subtle's own code is MIT (`LICENSE`); `THIRD_PARTY.md` lists the fonts and what Subtle calls at run time.
To use your own Subtle checkout instead (newer styles, your own style JSON), set `SUBTLE_DIR=/path/to/subtle`.
Do not edit these files here: change Subtle and copy again.
