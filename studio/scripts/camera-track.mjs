#!/usr/bin/env node
// The render spec for the native renderer (recorder: dolly-render): the per-frame camera / cursor track computed by
// src/camera.ts (the same code the Remotion render runs), the layout and look, and the paths of the pictures to composite.
//   node scripts/camera-track.mjs <recording-dir> [--style <preset|file.json>] [--set a.b=value ...] [--captions file.json]
//                                  [--audio voice.m4a] [--fps n] [--out spec.json] [--no-stills]
// Prints the spec (JSON) to stdout, or writes it to --out. --no-stills skips drawing caption / key / background stills
// (their paths stay empty): the track alone, for inspection.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs, resolveRender} from './lib/render-args.mjs';
import {prepareNative} from './lib/render-prep.mjs';

const {flags, sets, pos} = parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('usage: node scripts/camera-track.mjs <recording-dir> [--style ...] [--set a.b=v] [--captions f.json] [--fps n] [--out spec.json]'); process.exit(1); }
const dir = path.resolve(pos[0]);
try {
  const r = await resolveRender(dir, flags, sets);
  if (flags['no-stills'] === 'true') { r.captions = []; r.captionStyle = undefined; r.style = {...r.style, keystrokes: false}; }
  const {spec, timings} = await prepareNative({dir, ...r, fps: flags.fps ? Number(flags.fps) : undefined, log: (m) => console.error(m)});
  const json = JSON.stringify(spec);
  if (flags.out) fs.writeFileSync(path.resolve(flags.out), json); else process.stdout.write(json + '\n');
  console.error(`track: ${spec.frames} frames ${spec.width}x${spec.height}@${spec.fps} in ${timings.trackMs} ms; stills: ${timings.stillsRendered} drawn, ${timings.stillsCached} cached (${timings.stillsMs} ms)${spec.unsupported.length ? `; NOT supported natively: ${spec.unsupported.join(', ')}` : ''}`);
} catch (e) { console.error(String(e?.message ?? e)); process.exit(1); }
