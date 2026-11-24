# Backgrounds

Everything lives in `studio/src/remotion/` (`backgrounds.ts`, `shaders.ts`, `BackgroundField.tsx`). A background is always the same
type as before: `Style['background'] = {type: 'preset'|'solid'|'image'|'gradient'|'video', value, blur?, grain?, vignette?}`.

## Categories (`backgroundCatalog[].category`)
| category | what | ids |
|---|---|---|
| `wallpaper` | the original SVG scenes (32 presets keep working) | ribbons, dunes, waves, ... |
| `gradient` | CSS gradients and meshes | graphite, ice, mesh-*, ... |
| `animated` | WebGL shader wallpapers, slow motion | liquid-dusk (dark), liquid-ice (light), liquid-ink (dark), aurora-night (dark), silk-navy (dark), silk-rose (light), light-leak (dark), caustics (light), bokeh-dusk (dark), dusk-sky (dark), hills (light), ocean (dark), glass-blobs (light) |
| `photo` | public-domain NASA photos, value `photo-<id>` | photo-earthset-artemis, photo-earthrise-apollo11, photo-cosmic-cliffs, photo-blue-marble (all dark) |

`aurora` already exists as a gradient preset, so the shader is `aurora-night`.

## Use
```tsx
import {BackgroundField} from './remotion/BackgroundField.tsx'; // or from lib.ts
<BackgroundField bg={{type: 'preset', value: 'ocean', grain: 0.25, vignette: 0.2}} width={1620} height={1080} />
// optional: frame={n} fps={30}; both default to Remotion's current frame / composition fps (0 / 30 outside one)
```
It renders any `Style['background']` and honours `blur` / `grain` / `vignette` like Dolly's background layer (blur scales with
`min(width, height) / 1080`). A video background has no pixels of its own here (Dolly draws it from the recording): it shows the dark base.
Shaders are a pure function of `(canvas size, frame / fps)`: no Date.now, no random. If WebGL cannot start, the component shows the
preset's CSS `fallback` instead of crashing.

`backgroundStyle(bg)` (CSS only) returns the fallback gradient for shader presets and the photo for photo presets, so existing code
paths keep working. `isAnimatedBackground(bg)`, `isPhotoBackground(bg)`, `shaderDefs`, `shaderById`, `photoDefs`, `photoUrl(id)`
are exported from `backgrounds.ts` and `lib.ts`. `backgroundIsDark(bg)` knows every id.

## Remotion CLI
- GL flag: `--gl=angle` or `--gl=swangle` both render the shaders (identical pixels on this Mac); the Remotion default also works.
  `--gl=swiftshader` fails to create a context here, so you get the CSS fallback (no crash).
- Photos: link `studio/assets/backgrounds` into the Remotion public dir as `backgrounds/` (`photoUrl()` returns
  `staticFile('backgrounds/<file>')`), e.g. `ln -s ../assets/backgrounds <public>/backgrounds`, or pass `--public-dir`.
- Cost: about 40-55 ms per frame at 1620x1080 for the heaviest shaders (hills, ocean) with the render scale `res` 0.6-0.75.

## Preview
`node scripts/bg-preview.mjs --group animated|photo|wallpaper|gradient|all [--only id,id] [--size 1620x1080] [--time 3] [--cell 480]
[--cols 4] [--ui none|dark|light|both] [--out sheet.jpg]` writes a contact sheet; `--single id --size 3840x2160` writes one still.

## Add a shader
1. Add a fragment program to `PROGRAMS` in `shaders.ts` (GLSL ES 1.0; the header gives `uRes`, `uTime`, `uC0..uC4`, `hash*`, `vnoise`,
   `fbm`, `aspectP(uv)` and `finish(color, vignette)`, which dithers). Always end with `gl_FragColor=vec4(finish(col,vig),1.)`.
2. Add a `ShaderDef` to `shaderDefs`: id, name, program, up to 5 colours, `dark`, CSS `fallback`, `res` (0.5-1), optional `t0`.
3. Run the preview, look at it behind a dark and a light card at thumbnail and full size.

## Add a photo
Public domain only. Put a ~3000 px wide JPEG (3:2, under ~700 KB) in `studio/assets/backgrounds/`, add an entry to `photoDefs`, and
record the exact source, credit line, licence and date in `docs/backgrounds-credits.md`. For a user's own photo use `{type: 'image', value}`.
