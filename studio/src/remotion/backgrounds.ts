import type {CSSProperties} from 'react';
import {staticFile} from 'remotion';
import type {Style} from '../types.ts';
import {shaderDefs, shaderById} from './shaders.ts';
export {shaderDefs, shaderById} from './shaders.ts';
export type {ShaderDef} from './shaders.ts';

// Backgrounds. Everything is CSS or an inline SVG data URI, so the website's Player and the Remotion CLI draw the same pixels.
// All scenes are original (generated here); none copies a system wallpaper.

const svgUrl = (svg: string) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}")`;
const scene = (defs: string, body: string) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900' preserveAspectRatio='xMidYMid slice'><defs>${defs}</defs>${body}</svg>`;
const lg = (id: string, stops: string[], x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id='${id}' x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}'>${stops.map((c, i) => `<stop offset='${(i / (stops.length - 1)).toFixed(3)}' stop-color='${c}'/>`).join('')}</linearGradient>`;
const rg = (id: string, c: string, o0 = 1, o1 = 0) => `<radialGradient id='${id}'><stop offset='0' stop-color='${c}' stop-opacity='${o0}'/><stop offset='1' stop-color='${c}' stop-opacity='${o1}'/></radialGradient>`;
const blurF = (id: string, sd: number) => `<filter id='${id}' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='${sd}'/></filter>`;
const fixed = (n: number) => +n.toFixed(1);

/** A smooth wave across the canvas, filled down to the bottom edge. */
function wave(y: number, amp: number, len: number, phase: number, h = 900) {
  const pts: string[] = [];
  for (let x = -40; x <= 1640; x += 40) pts.push(`${x} ${fixed(y + Math.sin((x / len) * Math.PI * 2 + phase) * amp + Math.sin((x / (len * 0.47)) * Math.PI * 2 + phase * 1.7) * amp * 0.35)}`);
  return `M${pts.join(' L')} L1640 ${h + 40} L-40 ${h + 40} Z`;
}
/** A closed wobbly contour ring. */
function ring(cx: number, cy: number, rx: number, ry: number, seed: number) {
  const pts: string[] = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const w = 1 + 0.07 * Math.sin(a * 3 + seed) + 0.045 * Math.sin(a * 5 - seed * 1.7) + 0.03 * Math.sin(a * 2 + seed * 0.6);
    pts.push(`${fixed(cx + Math.cos(a) * rx * w)} ${fixed(cy + Math.sin(a) * ry * w)}`);
  }
  return `M${pts.join(' L')} Z`;
}

const W: Record<string, {css: string; dark: boolean}> = {
  ribbons: {
    dark: true,
    css: svgUrl(scene(
      `${lg('bg', ['#070a14', '#0b1224', '#0a0d18'])}${lg('a', ['#86E4F0', '#5b7cff', '#9a6bff'], 0, 0, 1, 0)}${lg('b', ['#3be0c6', '#3a7bff'], 0, 0, 1, 1)}${lg('c', ['#b48cff', '#ff7fb0'], 1, 0, 0, 1)}${blurF('s', 5)}${blurF('g', 38)}`,
      `<rect width='1600' height='900' fill='url(#bg)'/>
       <g filter='url(#g)' opacity='.55'><path d='M-100 640 C 280 360 620 800 980 540 S 1500 320 1720 460 L1720 600 C1500 470 1220 760 920 740 S 320 600 -100 800Z' fill='url(#a)'/></g>
       <g filter='url(#s)' opacity='.9'><path d='M-100 640 C 280 360 620 800 980 540 S 1500 320 1720 460 L1720 540 C1500 410 1210 700 930 690 S 320 540 -100 740Z' fill='url(#a)' opacity='.8'/></g>
       <g filter='url(#s)' opacity='.75'><path d='M-100 300 C 260 120 600 420 940 240 S 1420 60 1720 200 L1720 270 C1440 150 1160 330 900 330 S 300 210 -100 380Z' fill='url(#b)'/></g>
       <g filter='url(#s)' opacity='.6'><path d='M-100 860 C 300 700 640 940 1020 760 S 1480 640 1720 760 L1720 840 C1480 740 1200 900 960 900 L-100 900Z' fill='url(#c)'/></g>`,
    )),
  },
  'ribbons-warm': {
    dark: true,
    css: svgUrl(scene(
      `${lg('bg', ['#120a14', '#1b0e1c', '#0e0a12'])}${lg('a', ['#ffb199', '#ff6f91', '#9b5de5'], 0, 0, 1, 0)}${lg('b', ['#ffd6a5', '#ff8fab'], 0, 0, 1, 1)}${lg('c', ['#7b6cff', '#4cc9f0'], 1, 0, 0, 1)}${blurF('s', 5)}${blurF('g', 40)}`,
      `<rect width='1600' height='900' fill='url(#bg)'/>
       <g filter='url(#g)' opacity='.5'><path d='M-100 420 C 300 200 640 560 1000 360 S 1500 160 1720 320 L1720 470 C1500 330 1200 600 940 580 S 320 420 -100 640Z' fill='url(#a)'/></g>
       <g filter='url(#s)' opacity='.85'><path d='M-100 420 C 300 200 640 560 1000 360 S 1500 160 1720 320 L1720 400 C1500 260 1190 520 950 500 S 320 340 -100 560Z' fill='url(#a)'/></g>
       <g filter='url(#s)' opacity='.7'><path d='M-100 760 C 260 600 620 860 960 680 S 1440 560 1720 680 L1720 760 C1440 650 1180 800 940 800 S 300 700 -100 860Z' fill='url(#b)'/></g>
       <g filter='url(#s)' opacity='.55'><path d='M-100 120 C 300 20 620 220 960 100 S 1400 -20 1720 80 L1720 140 C1400 40 1120 180 900 170 S 300 90 -100 190Z' fill='url(#c)'/></g>`,
    )),
  },
  dunes: {
    dark: false,
    css: svgUrl(scene(
      `${lg('sky', ['#fbe7cf', '#f6c9a4', '#eaa07e'])}${lg('d1', ['#f1b58d', '#e08f6f'])}${lg('d2', ['#d9805f', '#b4624f'])}${lg('d3', ['#9d4d49', '#6e3848'])}${rg('sun', '#fff6e4', 0.95, 0)}`,
      `<rect width='1600' height='900' fill='url(#sky)'/>
       <circle cx='1180' cy='360' r='420' fill='url(#sun)'/>
       <path d='${wave(560, 46, 900, 0.6)}' fill='url(#d1)' opacity='.95'/>
       <path d='${wave(660, 56, 760, 2.2)}' fill='url(#d2)'/>
       <path d='${wave(770, 44, 640, 4.1)}' fill='url(#d3)'/>`,
    )),
  },
  'dunes-night': {
    dark: true,
    css: svgUrl(scene(
      `${lg('sky', ['#0a0f24', '#1a1b45', '#3a2a63'])}${lg('d1', ['#4a3578', '#2b2457'])}${lg('d2', ['#2a2352', '#171a3a'])}${lg('d3', ['#141633', '#0a0c1e'])}${rg('moon', '#c9d4ff', 0.55, 0)}`,
      `<rect width='1600' height='900' fill='url(#sky)'/>
       <circle cx='380' cy='250' r='320' fill='url(#moon)'/><circle cx='380' cy='250' r='46' fill='#e9eeff' opacity='.9'/>
       ${Array.from({length: 46}, (_, i) => `<circle cx='${(i * 197) % 1600}' cy='${(i * 131) % 420}' r='${(i % 3) * 0.6 + 0.8}' fill='#fff' opacity='${0.25 + (i % 5) * 0.12}'/>`).join('')}
       <path d='${wave(600, 50, 900, 1.1)}' fill='url(#d1)'/>
       <path d='${wave(690, 52, 720, 3.0)}' fill='url(#d2)'/>
       <path d='${wave(790, 40, 600, 5.2)}' fill='url(#d3)'/>`,
    )),
  },
  waves: {
    dark: true,
    css: svgUrl(scene(
      `${lg('bg', ['#06141f', '#0a2a3c', '#0e4458'])}${lg('w1', ['#1a7f9a', '#0d4a63'])}${lg('w2', ['#146a85', '#0a3a52'])}${lg('w3', ['#0d4f69', '#07283b'])}${lg('w4', ['#082f45', '#041a28'])}`,
      `<rect width='1600' height='900' fill='url(#bg)'/>
       <path d='${wave(430, 38, 820, 0.2)}' fill='url(#w1)' opacity='.55'/>
       <path d='${wave(520, 44, 700, 1.6)}' fill='url(#w2)' opacity='.75'/>
       <path d='${wave(620, 48, 600, 3.0)}' fill='url(#w3)' opacity='.9'/>
       <path d='${wave(730, 40, 520, 4.4)}' fill='url(#w4)'/>`,
    )),
  },
  'waves-sunset': {
    dark: true,
    css: svgUrl(scene(
      `${lg('bg', ['#1a1040', '#4a1d6a', '#c0457a', '#ff9a8a'])}${lg('w1', ['#6a2a8a', '#3a1a62'])}${lg('w2', ['#4b2077', '#2a1450'])}${lg('w3', ['#2f1658', '#180d38'])}`,
      `<rect width='1600' height='900' fill='url(#bg)'/>
       <path d='${wave(520, 36, 840, 0.9)}' fill='url(#w1)' opacity='.8'/>
       <path d='${wave(620, 44, 700, 2.4)}' fill='url(#w2)' opacity='.92'/>
       <path d='${wave(730, 40, 600, 4.2)}' fill='url(#w3)'/>`,
    )),
  },
  blobs: {
    dark: false,
    css: svgUrl(scene(
      `${blurF('b', 90)}`,
      `<rect width='1600' height='900' fill='#f7f1ec'/>
       <g filter='url(#b)'><circle cx='260' cy='180' r='330' fill='#ffc2d6'/><circle cx='1280' cy='120' r='300' fill='#c9b8ff'/><circle cx='1380' cy='760' r='360' fill='#ffd9b3'/><circle cx='360' cy='800' r='320' fill='#b9efe0'/><circle cx='820' cy='460' r='230' fill='#fff4d6'/></g>`,
    )),
  },
  'blobs-dark': {
    dark: true,
    css: svgUrl(scene(
      `${blurF('b', 100)}`,
      `<rect width='1600' height='900' fill='#0a0c14'/>
       <g filter='url(#b)'><circle cx='300' cy='200' r='320' fill='#1f4fff' opacity='.55'/><circle cx='1300' cy='160' r='290' fill='#8a3dff' opacity='.5'/><circle cx='1360' cy='780' r='340' fill='#13b5c8' opacity='.42'/><circle cx='280' cy='780' r='300' fill='#d63a8a' opacity='.32'/></g>`,
    )),
  },
  shards: {
    dark: true,
    css: svgUrl(scene(
      `${lg('bg', ['#0b1218', '#0e2630', '#0a1218'], 0, 0, 1, 1)}${lg('f1', ['#ffffff', '#86E4F0'], 0, 0, 1, 1)}${lg('f2', ['#ffffff', '#7a8cff'], 1, 0, 0, 1)}${blurF('b', 90)}`,
      `<rect width='1600' height='900' fill='url(#bg)'/>
       <g filter='url(#b)'><circle cx='1180' cy='220' r='280' fill='#2fc7dc' opacity='.35'/><circle cx='320' cy='760' r='300' fill='#5a6cff' opacity='.28'/></g>
       <g stroke='#fff' stroke-opacity='.14' stroke-width='1.5'>
       <path d='M180 900 L560 120 L860 900Z' fill='url(#f1)' fill-opacity='.10'/>
       <path d='M520 900 L980 80 L1260 900Z' fill='url(#f2)' fill-opacity='.08'/>
       <path d='M900 900 L1240 220 L1600 700 L1600 900Z' fill='url(#f1)' fill-opacity='.12'/>
       <path d='M-20 520 L420 220 L640 900 L-20 900Z' fill='url(#f2)' fill-opacity='.07'/>
       <path d='M1140 0 L1600 0 L1600 460Z' fill='url(#f1)' fill-opacity='.09'/></g>`,
    )),
  },
  'shards-warm': {
    dark: true,
    css: svgUrl(scene(
      `${lg('bg', ['#170c1c', '#2a1233', '#150a1a'], 0, 0, 1, 1)}${lg('f1', ['#ffffff', '#ff9bc0'], 0, 0, 1, 1)}${lg('f2', ['#ffffff', '#b99bff'], 1, 0, 0, 1)}${blurF('b', 90)}`,
      `<rect width='1600' height='900' fill='url(#bg)'/>
       <g filter='url(#b)'><circle cx='1200' cy='260' r='290' fill='#ff5c9a' opacity='.3'/><circle cx='300' cy='740' r='300' fill='#8a5cff' opacity='.3'/></g>
       <g stroke='#fff' stroke-opacity='.14' stroke-width='1.5'>
       <path d='M140 900 L520 160 L840 900Z' fill='url(#f1)' fill-opacity='.10'/>
       <path d='M500 900 L960 60 L1240 900Z' fill='url(#f2)' fill-opacity='.08'/>
       <path d='M880 900 L1220 200 L1600 680 L1600 900Z' fill='url(#f1)' fill-opacity='.12'/>
       <path d='M-20 500 L400 200 L620 900 L-20 900Z' fill='url(#f2)' fill-opacity='.07'/></g>`,
    )),
  },
  grid: {
    dark: true,
    css: svgUrl(scene(
      `<pattern id='p' width='64' height='64' patternUnits='userSpaceOnUse'><path d='M64 0H0V64' fill='none' stroke='#fff' stroke-opacity='.075' stroke-width='1'/></pattern>${rg('v', '#0C0C0D', 0, 1)}${rg('glow', '#86E4F0', 0.14, 0)}`,
      `<rect width='1600' height='900' fill='#0C0C0D'/><rect width='1600' height='900' fill='url(#p)'/>
       <ellipse cx='800' cy='-60' rx='760' ry='420' fill='url(#glow)'/>
       <ellipse cx='800' cy='450' rx='1000' ry='620' fill='url(#v)'/>`,
    )),
  },
  'grid-light': {
    dark: false,
    css: svgUrl(scene(
      `<pattern id='p' width='64' height='64' patternUnits='userSpaceOnUse'><path d='M64 0H0V64' fill='none' stroke='#0c0c0d' stroke-opacity='.07' stroke-width='1'/></pattern>${rg('v', '#eef0f2', 0, 1)}`,
      `<rect width='1600' height='900' fill='#eef0f2'/><rect width='1600' height='900' fill='url(#p)'/>
       <ellipse cx='800' cy='450' rx='1000' ry='620' fill='url(#v)'/>`,
    )),
  },
  dots: {
    dark: true,
    css: svgUrl(scene(
      `<pattern id='p' width='32' height='32' patternUnits='userSpaceOnUse'><circle cx='16' cy='16' r='1.7' fill='#fff' fill-opacity='.2'/></pattern>${rg('v', '#0a0f14', 0, 1)}${rg('glow', '#86E4F0', 0.1, 0)}`,
      `<rect width='1600' height='900' fill='#0a0f14'/><rect width='1600' height='900' fill='url(#p)'/>
       <ellipse cx='1000' cy='80' rx='720' ry='380' fill='url(#glow)'/>
       <ellipse cx='800' cy='450' rx='980' ry='600' fill='url(#v)'/>`,
    )),
  },
  contours: {
    dark: true,
    css: svgUrl(scene(
      `${lg('bg', ['#0a1411', '#0c1c18', '#08100e'], 0, 0, 1, 1)}`,
      `<rect width='1600' height='900' fill='url(#bg)'/>
       <g fill='none' stroke='#9ff0d8' stroke-width='1.4'>${Array.from({length: 26}, (_, i) => `<path d='${ring(560, 470, 40 + i * 40, 28 + i * 27, 0.8)}' stroke-opacity='${(0.34 - i * 0.011).toFixed(3)}'/>`).join('')}</g>
       <g fill='none' stroke='#9ff0d8' stroke-width='1.2'>${Array.from({length: 12}, (_, i) => `<path d='${ring(1280, 220, 30 + i * 36, 24 + i * 26, 2.4)}' stroke-opacity='${(0.26 - i * 0.017).toFixed(3)}'/>`).join('')}</g>`,
    )),
  },
  horizon: {
    dark: true,
    css: svgUrl(scene(
      `${lg('sky', ['#0b1030', '#2a2060', '#8a4a9a', '#f2a08a'])}${lg('h1', ['#3a2860', '#1e1640'])}${lg('h2', ['#221848', '#120e2c'])}${rg('sun', '#ffe3c4', 0.9, 0)}`,
      `<rect width='1600' height='900' fill='url(#sky)'/>
       <circle cx='800' cy='610' r='520' fill='url(#sun)'/><circle cx='800' cy='610' r='120' fill='#fff1de' opacity='.85'/>
       <path d='${wave(640, 34, 1100, 0.4)}' fill='url(#h1)'/>
       <path d='${wave(740, 42, 900, 2.4)}' fill='url(#h2)'/>`,
    )),
  },
};

/** Gradients and meshes: pure CSS. */
const mesh = (base: string, ...spots: string[]) => `${spots.join(', ')}, ${base}`;
const G: Record<string, {css: string; dark: boolean}> = {
  // the first seven are the original presets, unchanged
  graphite: {
    css: 'radial-gradient(900px 600px at 82% -5%, rgba(134,228,240,0.16), transparent 62%), radial-gradient(800px 600px at 5% 105%, rgba(134,228,240,0.07), transparent 60%), linear-gradient(160deg, #131517 0%, #0C0C0D 55%, #0a0f11 100%)',
    dark: true,
  },
  ice: {css: 'linear-gradient(135deg, #0C0C0D 0%, #0f2a31 45%, #4fb7c6 100%)', dark: true},
  aurora: {
    css: 'radial-gradient(900px 700px at 20% 10%, rgba(134,228,240,0.35), transparent 60%), radial-gradient(900px 700px at 85% 90%, rgba(130,110,255,0.35), transparent 60%), #0b0e16',
    dark: true,
  },
  midnight: {css: 'linear-gradient(160deg, #0a1124 0%, #0c1a3d 60%, #162a5c 100%)', dark: true},
  dusk: {css: 'linear-gradient(150deg, #1a1530 0%, #3b2150 50%, #c05b7c 130%)', dark: true},
  sand: {css: 'linear-gradient(145deg, #f1e9da 0%, #d9c9ad 100%)', dark: false},
  mist: {css: 'linear-gradient(145deg, #e8eef0 0%, #b9c9cf 100%)', dark: false},
  // new
  'mesh-violet': {css: mesh('#14102b', 'radial-gradient(60% 70% at 15% 20%, #6d4aff 0%, transparent 60%)', 'radial-gradient(55% 65% at 90% 30%, #c34bff 0%, transparent 62%)', 'radial-gradient(70% 70% at 60% 105%, #2a6bff 0%, transparent 62%)'), dark: true},
  'mesh-peach': {css: mesh('#fff1e6', 'radial-gradient(55% 65% at 12% 15%, #ffc9b0 0%, transparent 62%)', 'radial-gradient(55% 65% at 92% 20%, #ffd8f0 0%, transparent 62%)', 'radial-gradient(70% 70% at 55% 110%, #ffe6a8 0%, transparent 62%)'), dark: false},
  'mesh-mint': {css: mesh('#eafaf4', 'radial-gradient(55% 65% at 10% 20%, #a8f0d8 0%, transparent 62%)', 'radial-gradient(55% 65% at 92% 25%, #bfe3ff 0%, transparent 62%)', 'radial-gradient(70% 70% at 50% 110%, #d9f5b8 0%, transparent 62%)'), dark: false},
  'mesh-ocean': {css: mesh('#06182a', 'radial-gradient(60% 70% at 12% 15%, #0fa6c4 0%, transparent 60%)', 'radial-gradient(55% 65% at 92% 30%, #2f5bff 0%, transparent 62%)', 'radial-gradient(70% 70% at 55% 110%, #17d4a8 0%, transparent 62%)'), dark: true},
  'mesh-rose': {css: mesh('#240c1c', 'radial-gradient(60% 70% at 12% 20%, #ff4f8b 0%, transparent 60%)', 'radial-gradient(55% 65% at 92% 25%, #ff9a6a 0%, transparent 62%)', 'radial-gradient(70% 70% at 50% 110%, #8b3dff 0%, transparent 62%)'), dark: true},
  slate: {css: 'linear-gradient(150deg, #20262c 0%, #151a1f 55%, #0f1317 100%)', dark: true},
  forest: {css: 'linear-gradient(150deg, #0e2a22 0%, #123b2f 50%, #1f6a52 130%)', dark: true},
  cobalt: {css: 'linear-gradient(145deg, #0a1a5c 0%, #1237b8 55%, #2f6bff 120%)', dark: true},
  lilac: {css: 'linear-gradient(145deg, #efe6ff 0%, #cfc0f5 60%, #b3a2ec 120%)', dark: false},
  sky: {css: 'linear-gradient(160deg, #e8f4ff 0%, #bfe0ff 55%, #8cc4ff 120%)', dark: false},
};

// ---- photos: public-domain NASA images in studio/assets/backgrounds/<file>.jpg (credits in docs/backgrounds-credits.md).
// The Remotion CLI serves them through its public dir: link studio/assets/backgrounds as <public>/backgrounds (docs/backgrounds.md).
export interface PhotoDef {id: string; name: string; dark: boolean; file: string; /** average colour, shown while the file loads */ color: string}
export const photoDefs: PhotoDef[] = [
  {id: 'earthset-artemis', name: 'Earthset (Artemis II)', dark: true, file: 'earthset-artemis.jpg', color: '#1f1c1d'},
  {id: 'earthrise-apollo11', name: 'Earthrise (Apollo 11)', dark: true, file: 'earthrise-apollo11.jpg', color: '#3f3d3f'},
  {id: 'cosmic-cliffs', name: 'Cosmic Cliffs (Webb)', dark: true, file: 'cosmic-cliffs.jpg', color: '#655258'},
  {id: 'blue-marble', name: 'Blue Marble 2012', dark: true, file: 'blue-marble.jpg', color: '#606c75'},
];
/** URL of a photo preset's file (id with or without the "photo-" prefix), resolved with staticFile('backgrounds/<file>'). */
export const photoUrl = (id: string): string => {
  const key = id.replace(/^photo-/, '');
  const d = photoDefs.find((p) => p.id === key);
  return staticFile(`backgrounds/${d?.file ?? `${key}.jpg`}`);
};

// ---- AI wallpapers: studio/public/wallpapers/ai/<file> (manifest.json next to them); served by Remotion's default public dir.
export interface AiWallpaperDef {id: string; name: string; dark: boolean; file: string}
export const aiWallpaperDefs: AiWallpaperDef[] = [
  {id: 'ai-alpine-dawn', name: 'Alpine dawn', dark: false, file: 'alpine-dawn.jpg'},
  {id: 'ai-cloud-sea', name: 'Sea of clouds', dark: false, file: 'cloud-sea.jpg'},
  {id: 'ai-coast-golden', name: 'Golden coast', dark: false, file: 'coast-golden.jpg'},
  {id: 'ai-curtain-light', name: 'Curtain light', dark: true, file: 'curtain-light.jpg'},
  {id: 'ai-desert-stars', name: 'Desert stars', dark: true, file: 'desert-stars.jpg'},
  {id: 'ai-dunes-bluehour', name: 'Blue-hour dunes', dark: false, file: 'dunes-bluehour.jpg'},
  {id: 'ai-forest-fog', name: 'Forest fog', dark: false, file: 'forest-fog.jpg'},
  {id: 'ai-glass-graphite', name: 'Glass graphite', dark: true, file: 'glass-graphite.jpg'},
  {id: 'ai-hills-golden', name: 'Golden meadow', dark: false, file: 'hills-golden.jpg'},
  {id: 'ai-ocean-pastel', name: 'Pastel ocean', dark: false, file: 'ocean-pastel.jpg'},
  {id: 'ai-paper-window', name: 'Paper light', dark: false, file: 'paper-window.jpg'},
  {id: 'ai-silk-night', name: 'Night silk', dark: true, file: 'silk-night.jpg'},
];
export const aiWallpaperUrl = (id: string): string => staticFile(`wallpapers/ai/${aiWallpaperDefs.find((d) => d.id === id)?.file ?? `${id.replace(/^ai-/, '')}.jpg`}`);
export const isAiBackground = (bg: Style['background']): boolean => bg.type === 'preset' && aiWallpaperDefs.some((d) => d.id === bg.value);

const A: Record<string, {css: string; dark: boolean}> = Object.fromEntries(shaderDefs.map((d) => [d.id, {css: d.fallback, dark: d.dark}]));
const P: Record<string, {css: string; dark: boolean}> = Object.fromEntries(photoDefs.map((d) => [`photo-${d.id}`, {css: `url(${JSON.stringify(photoUrl(d.id))})`, dark: d.dark}]));

const AI: Record<string, {css: string; dark: boolean}> = Object.fromEntries(aiWallpaperDefs.map((d) => [d.id, {css: `url(${JSON.stringify(aiWallpaperUrl(d.id))})`, dark: d.dark}]));

export const backgroundPresets: Record<string, {css: string; dark: boolean}> = {...G, ...W, ...A, ...P, ...AI};

/** Animated (WebGL shader) preset? Needs BackgroundField to move; backgroundStyle() gives its static CSS fallback. */
export const isAnimatedBackground = (bg: Style['background']): boolean => bg.type === 'preset' && !!shaderById[bg.value];
/** Photo preset (value "photo-<id>")? */
export const isPhotoBackground = (bg: Style['background']): boolean => bg.type === 'preset' && bg.value.startsWith('photo-') && photoDefs.some((p) => `photo-${p.id}` === bg.value);

const NAMES: Record<string, string> = {
  ribbons: 'Ribbons', 'ribbons-warm': 'Ribbons warm', dunes: 'Dunes', 'dunes-night': 'Dunes night', waves: 'Waves', 'waves-sunset': 'Sunset waves',
  blobs: 'Soft blobs', 'blobs-dark': 'Blobs dark', shards: 'Glass shards', 'shards-warm': 'Shards warm', grid: 'Grid', 'grid-light': 'Grid light',
  dots: 'Dots', contours: 'Contours', horizon: 'Horizon',
  graphite: 'Graphite', ice: 'Ice', aurora: 'Aurora', midnight: 'Midnight', dusk: 'Dusk', sand: 'Sand', mist: 'Mist',
  'mesh-violet': 'Mesh violet', 'mesh-peach': 'Mesh peach', 'mesh-mint': 'Mesh mint', 'mesh-ocean': 'Mesh ocean', 'mesh-rose': 'Mesh rose',
  slate: 'Slate', forest: 'Forest', cobalt: 'Cobalt', lilac: 'Lilac', sky: 'Sky',
};

export interface BackgroundInfo {id: string; name: string; category: 'wallpaper' | 'gradient' | 'animated' | 'photo' | 'ai'; dark: boolean}
/** Every named background, by category, in display order. */
export const backgroundCatalog: BackgroundInfo[] = [
  ...Object.keys(W).map((id) => ({id, name: NAMES[id] ?? id, category: 'wallpaper' as const, dark: W[id].dark})),
  ...Object.keys(G).map((id) => ({id, name: NAMES[id] ?? id, category: 'gradient' as const, dark: G[id].dark})),
  ...shaderDefs.map((d) => ({id: d.id, name: d.name, category: 'animated' as const, dark: d.dark})),
  ...photoDefs.map((d) => ({id: `photo-${d.id}`, name: d.name, category: 'photo' as const, dark: d.dark})),
  ...aiWallpaperDefs.map((d) => ({id: d.id, name: d.name, category: 'ai' as const, dark: d.dark})),
];

/** Curated flat colours for type "solid" (the site also offers a custom picker). */
export const colorSwatches: string[] = ['#0C0C0D', '#17181a', '#26282b', '#F2F3F4', '#ffffff', '#e8e2d6', '#0e1a3a', '#12332a', '#3b1d5a', '#5a1d2d', '#86E4F0', '#1f6bff'];

// ---- helpers
export function luminance(hex: string): number {
  const m = /#?([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(hex);
  if (!m) return 0;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Is the background dark (drives window chrome and keystroke colours)? */
export function backgroundIsDark(bg: Style['background']): boolean {
  if (bg.type === 'preset') return backgroundPresets[bg.value]?.dark ?? true;
  if (bg.type === 'solid') return luminance(bg.value) < 0.55;
  if (bg.type === 'gradient') return luminance(bg.value) < 0.55;
  return true;
}
export function hexToRgba(hex: string, a: number): string {
  let h = (/#?([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(hex)?.[1]) ?? '000000';
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}

/** CSS for the background's base layer (no blur, grain or vignette). */
export function backgroundStyle(bg: Style['background']): CSSProperties {
  if (bg.type === 'solid') return {background: bg.value};
  if (bg.type === 'gradient') return {background: bg.value};
  if (bg.type === 'image') return {backgroundColor: '#0C0C0D', backgroundImage: `url(${JSON.stringify(bg.value)})`, backgroundSize: 'cover', backgroundPosition: 'center'};
  if (bg.type === 'video') return {background: '#0C0C0D'};
  const p = (backgroundPresets[bg.value] ?? backgroundPresets.graphite).css;
  // wallpapers are one SVG image: size it to cover the canvas
  return p.startsWith('url(') ? {backgroundImage: p, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#0C0C0D'} : {background: p};
}

const GRAIN = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 1.1 -.15'/></filter><rect width='220' height='220' filter='url(#n)'/></svg>`);
/** Grain overlay (amount 0..1). Tiles at a fixed size; blends as overlay. */
export const grainStyle = (amount: number, u: number): CSSProperties => ({
  backgroundImage: GRAIN, backgroundSize: `${220 * Math.max(0.6, u)}px`, opacity: Math.min(1, Math.max(0, amount)) * 0.9, mixBlendMode: 'overlay',
});
/** Vignette overlay (amount 0..1). */
export const vignetteStyle = (amount: number): CSSProperties => ({
  background: `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 42%, rgba(0,0,0,${(Math.min(1, Math.max(0, amount)) * 0.85).toFixed(3)}) 100%)`,
});
