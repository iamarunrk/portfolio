import type { BaseKind, BaseLayer, BasePreset, BgConfig, Hex, MaterialKind, MaterialLayer, MaterialPreset } from './types';

type Pal = [Hex, Hex, Hex, Hex];
type BaseParams = Pick<BaseLayer, 'speed' | 'scale' | 'angle' | 'detail' | 'amount'>;

const base = (kind: BaseKind, colors: Pal, p: Partial<BaseParams> = {}): BaseLayer => ({
  kind,
  colors: [...colors] as Pal,
  speed: p.speed ?? 0.5,
  scale: p.scale ?? 1,
  angle: p.angle ?? 0,
  detail: p.detail ?? 0.5,
  amount: p.amount ?? 0.5,
});

/** Tuned per-kind parameter defaults (used by defaultBase and as the starting point of presets). */
const BASE_DEFAULTS: Record<BaseKind, { colors: Pal; p: Partial<BaseParams> }> = {
  solid: { colors: ['#0b0b0d', '#1c1c22', '#2a2a33', '#3a3a46'], p: { speed: 0 } },
  linear: { colors: ['#0b1026', '#2b2a6b', '#a3427e', '#f6a06a'], p: { speed: 0, angle: 180, detail: 0.25, amount: 0.5 } },
  radial: { colors: ['#ffd27a', '#ff7a3d', '#b3203f', '#2a0712'], p: { speed: 0, angle: 330, detail: 0.2, amount: 0.35, scale: 1.1 } },
  conic: { colors: ['#ff9ad5', '#ffd59a', '#9affd4', '#9ab8ff'], p: { speed: 0, detail: 0.15, amount: 0.5 } },
  mesh: { colors: ['#0a0618', '#3b1fa3', '#ff4f8b', '#ffb05c'], p: { speed: 0.6, detail: 0.45, amount: 0.55 } },
  flow: { colors: ['#07050f', '#4a1fd1', '#ff3d7f', '#ff9a3c'], p: { speed: 0.6, angle: 20, detail: 0.5, amount: 0.35 } },
  aurora: { colors: ['#040a18', '#1de9b6', '#46c8ff', '#b06cff'], p: { speed: 0.7, detail: 0.55, amount: 0.5 } },
  liquidMetal: { colors: ['#07080b', '#3c424e', '#dfe5ef', '#ffffff'], p: { speed: 0.5, detail: 0.55, amount: 0.65 } },
  satin: { colors: ['#2a0410', '#9e1235', '#ff9fb0', '#ffd2da'], p: { speed: 0.6, detail: 0.55, amount: 0.45 } },
  plasma: { colors: ['#07060f', '#2c2cff', '#ff2fb3', '#e8ff3a'], p: { speed: 0.6, detail: 0.5, amount: 0.55 } },
  swirl: { colors: ['#e8582c', '#f2a93b', '#f4e3c1', '#7b3f1f'], p: { speed: 0.35, detail: 0.45, amount: 0.3 } },
  waves: { colors: ['#d9541e', '#f29e38', '#f5d6a0', '#3b6e8f'], p: { speed: 0.4, angle: 0, detail: 0.6, amount: 0 } },
  goo: { colors: ['#12051d', '#ff3d7f', '#ffb800', '#7a5cff'], p: { speed: 0.6, detail: 0.55, amount: 0.6 } },
  sunburst: { colors: ['#ff7a1a', '#ffa23d', '#fff1d0', '#ffd27a'], p: { speed: 0.25, detail: 0.5, amount: 0.35 } },
  holo: { colors: ['#ff9ae6', '#8fd8ff', '#b8ffb0', '#fff07a'], p: { speed: 0.6, angle: 0, detail: 0.5, amount: 0.5 } },
  checker: { colors: ['#141414', '#f2eee6', '#3a1c71', '#ff7a59'], p: { speed: 0.4, angle: 12, detail: 0.45, amount: 0 } },
  dotgrid: { colors: ['#f3f3f1', '#c8c8c3', '#8b7cff', '#ffffff'], p: { speed: 0.4, detail: 0.35, amount: 0.35 } },
  halftone: { colors: ['#fff1d6', '#ff3b6b', '#2c5bff', '#ffd23f'], p: { speed: 0.4, angle: 30, detail: 0.5, amount: 0.5 } },
  dither: { colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'], p: { speed: 0.5, detail: 0.45, amount: 0.5 } },
  studio: { colors: ['#c6c8d0', '#ffffff', '#e2e8f6', '#f0e4ff'], p: { speed: 0, angle: 330, detail: 0.55, amount: 0.6 } },
};

/** Fresh BaseLayer for a kind with tuned defaults. Pass colors to keep the user's palette. */
export function defaultBase(kind: BaseKind, colors?: [Hex, Hex, Hex, Hex]): BaseLayer {
  const d = BASE_DEFAULTS[kind] ?? BASE_DEFAULTS.mesh;
  return base(kind, colors ?? d.colors, d.p);
}

const mat = (kind: MaterialKind, p: Partial<MaterialLayer> = {}): MaterialLayer => ({
  kind,
  strength: p.strength ?? 0.5,
  size: p.size ?? 0.5,
  blur: p.blur ?? 0,
  angle: p.angle ?? 0,
  highlight: p.highlight ?? 0.5,
  aberration: p.aberration ?? 0.3,
  tint: p.tint ?? '#ffffff',
  tintAmount: p.tintAmount ?? 0,
  speed: p.speed ?? 0,
  shape: p.shape ?? 0.5,
});

const MATERIAL_DEFAULTS: Record<MaterialKind, Partial<MaterialLayer>> = {
  none: { strength: 0, size: 0, highlight: 0, aberration: 0 },
  fluted: { strength: 0.7, size: 0.42, shape: 0.75, blur: 0.15, highlight: 0.6, aberration: 0.6 },
  ribbed: { strength: 0.55, size: 0.55, blur: 0.05, angle: 20, highlight: 0.5, aberration: 0.35 },
  frosted: { strength: 0.45, size: 0.35, blur: 0.45, highlight: 0.35, tintAmount: 0.12 },
  blur: { blur: 0.55, strength: 0.4 },
  liquidGlass: { strength: 0.6, size: 0.5, shape: 0.55, blur: 0, highlight: 0.75, aberration: 0.45, speed: 0.5 },
  tiles: { strength: 0.5, size: 0.4, shape: 0.3, blur: 0.06, highlight: 0.6, aberration: 0.35 },
  water: { strength: 0.5, size: 0.5, speed: 0.6, angle: 30, highlight: 0.5, aberration: 0.3, tint: '#bfe9ff', tintAmount: 0.08 },
  crystal: { strength: 0.5, size: 0.45, highlight: 0.6, aberration: 0.5, angle: 300 },
  prism: { strength: 0.5, size: 0.4, angle: 25, highlight: 0.6, aberration: 0.55, speed: 0.4 },
  halftone: { size: 0.3, angle: 45, strength: 0.5, shape: 0, tint: '#0b0b0d', tintAmount: 0 },
  pixelate: { size: 0.3, strength: 0.35, shape: 0.6, highlight: 0.5 },
  crt: { size: 0.35, strength: 0.4, highlight: 0.5, aberration: 0.4, speed: 0.5 },
  dither: { size: 0.3, strength: 1 },
};

/** Fresh MaterialLayer for a kind with tuned defaults. */
export function defaultMaterial(kind: MaterialKind): MaterialLayer {
  return mat(kind, MATERIAL_DEFAULTS[kind] ?? {});
}

// ---------------------------------------------------------------------------------------------
// Animated shader looks
// ---------------------------------------------------------------------------------------------
export const SHADER_PRESETS: BasePreset[] = [
  { id: 'midnight-bloom', name: 'Midnight Bloom', base: base('mesh', ['#0a0618', '#3b1fa3', '#ff4f8b', '#ffb05c'], { speed: 0.6, detail: 0.45, amount: 0.55 }) },
  { id: 'velvet', name: 'Velvet', base: base('flow', ['#07050f', '#4a1fd1', '#ff3d7f', '#ff9a3c'], { speed: 0.6, angle: 20, detail: 0.5, amount: 0.35 }) },
  { id: 'northern', name: 'Northern Lights', base: base('aurora', ['#040a18', '#1de9b6', '#46c8ff', '#b06cff'], { speed: 0.7, detail: 0.55, amount: 0.5 }) },
  { id: 'mercury', name: 'Mercury', base: base('liquidMetal', ['#07080b', '#3c424e', '#dfe5ef', '#ffffff'], { speed: 0.5, detail: 0.55, amount: 0.65 }) },
  { id: 'molten-gold', name: 'Molten Gold', base: base('liquidMetal', ['#140a02', '#6e4612', '#f2c76e', '#fff4d6'], { speed: 0.45, angle: 30, detail: 0.7, amount: 0.55 }) },
  { id: 'silk-rouge', name: 'Silk Rouge', base: base('satin', ['#2a0410', '#9e1235', '#ff9fb0', '#ffd2da'], { speed: 0.6, detail: 0.55, amount: 0.45 }) },
  { id: 'acid-plasma', name: 'Acid Plasma', base: base('plasma', ['#07060f', '#2c2cff', '#ff2fb3', '#e8ff3a'], { speed: 0.6, detail: 0.5, amount: 0.55 }) },
  { id: 'groovy', name: 'Groovy', base: base('swirl', ['#e8582c', '#f2a93b', '#f4e3c1', '#7b3f1f'], { speed: 0.35, detail: 0.45, amount: 0.3 }) },
  { id: 'retro-waves', name: 'Retro Waves', base: base('waves', ['#d9541e', '#f29e38', '#f5d6a0', '#3b6e8f'], { speed: 0.4, angle: 0, detail: 0.6, amount: 0 }) },
  { id: 'lava-lamp', name: 'Lava Lamp', base: base('goo', ['#12051d', '#ff3d7f', '#ffb800', '#7a5cff'], { speed: 0.6, detail: 0.55, amount: 0.6 }) },
  { id: 'sunday', name: 'Sunday', base: base('sunburst', ['#ff7a1a', '#ffa23d', '#fff1d0', '#ffd27a'], { speed: 0.25, detail: 0.5, amount: 0.35 }) },
  { id: 'holo-foil', name: 'Holo Foil', base: base('holo', ['#ff9ae6', '#8fd8ff', '#b8ffb0', '#fff07a'], { speed: 0.6, detail: 0.5, amount: 0.5 }) },
  { id: 'checkmate', name: 'Checkmate', base: base('checker', ['#141414', '#f2eee6', '#3a1c71', '#ff7a59'], { speed: 0.4, angle: 12, detail: 0.45, amount: 0 }) },
  { id: 'daydream', name: 'Daydream', base: base('mesh', ['#fdf6ff', '#c3b5ff', '#ffc2d9', '#ffe8b0'], { speed: 0.5, angle: 40, detail: 0.35, amount: 0.65 }) },
  { id: 'canvas', name: 'Canvas', base: base('dotgrid', ['#f3f3f1', '#c8c8c3', '#8b7cff', '#ffffff'], { speed: 0.4, detail: 0.35, amount: 0.35 }) },
  { id: 'night-canvas', name: 'Night Canvas', base: base('dotgrid', ['#121214', '#34343a', '#6e56ff', '#000000'], { speed: 0.4, detail: 0.35, amount: 0.45 }) },
  { id: 'pop-art', name: 'Pop Art', base: base('halftone', ['#fff1d6', '#ff3b6b', '#2c5bff', '#ffd23f'], { speed: 0.4, angle: 30, detail: 0.5, amount: 0.5 }) },
  { id: 'pocket', name: 'Pocket', base: base('dither', ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'], { speed: 0.5, detail: 0.45, amount: 0.5 }) },
];

// ---------------------------------------------------------------------------------------------
// Static gradients (speed 0)
// ---------------------------------------------------------------------------------------------
export const GRADIENT_PRESETS: BasePreset[] = [
  { id: 'dusk', name: 'Dusk', base: base('linear', ['#0b1026', '#2b2a6b', '#a3427e', '#f6a06a'], { speed: 0, angle: 180, detail: 0.25, amount: 0.5 }) },
  { id: 'peach', name: 'Peach Fuzz', base: base('linear', ['#fff1e6', '#ffc9b0', '#ff9c8f', '#f2708f'], { speed: 0, angle: 160, detail: 0.3, amount: 0.45 }) },
  { id: 'citrus', name: 'Citrus', base: base('linear', ['#fff7cc', '#ffd84d', '#ff9a1f', '#ff5a1f'], { speed: 0, angle: 135, detail: 0.2, amount: 0.5 }) },
  { id: 'mint', name: 'Mint Julep', base: base('linear', ['#f2fff4', '#bff2d3', '#73d9b4', '#2e8b7a'], { speed: 0, angle: 200, detail: 0.3, amount: 0.55 }) },
  { id: 'ember', name: 'Ember', base: base('radial', ['#ffd27a', '#ff7a3d', '#b3203f', '#2a0712'], { speed: 0, angle: 330, detail: 0.2, amount: 0.35, scale: 1.1 }) },
  { id: 'lagoon', name: 'Lagoon', base: base('radial', ['#e0fff7', '#7ee0d2', '#2a9bb8', '#123a5c'], { speed: 0, angle: 40, detail: 0.25, amount: 0.45, scale: 1.2 }) },
  { id: 'ink', name: 'Ink', base: base('radial', ['#30343f', '#1a1c22', '#0d0e12', '#050506'], { speed: 0, angle: 0, detail: 0.15, amount: 0.3, scale: 1 }) },
  { id: 'candy', name: 'Candy', base: base('conic', ['#ff9ad5', '#ffd59a', '#9affd4', '#9ab8ff'], { speed: 0, angle: 30, detail: 0.15, amount: 0.5 }) },
  { id: 'cyber', name: 'Cyber', base: base('conic', ['#0d0221', '#ff2a6d', '#05d9e8', '#d1f7ff'], { speed: 0, angle: 200, detail: 0.35, amount: 0.65 }) },
  { id: 'nebula', name: 'Nebula', base: base('mesh', ['#090a1a', '#5b2bd9', '#00b3ff', '#ff4fa1'], { speed: 0, angle: 0, detail: 0.4, amount: 0.55 }) },
  { id: 'pastel', name: 'Pastel', base: base('mesh', ['#fbf6ef', '#ffcadb', '#c9d8ff', '#fff0b3'], { speed: 0, angle: 120, detail: 0.3, amount: 0.65 }) },
  { id: 'studio', name: 'Studio', base: base('studio', ['#c6c8d0', '#ffffff', '#e2e8f6', '#f0e4ff'], { speed: 0, angle: 330, detail: 0.55, amount: 0.6 }) },
  { id: 'darkroom', name: 'Darkroom', base: base('studio', ['#2a2c33', '#c9d4ff', '#7a7f8f', '#5a4bff'], { speed: 0, angle: 20, detail: 0.5, amount: 0.6 }) },
];

export const COLOR_PRESETS: string[] = [
  '#0b0b0d', '#1d1e24', '#f4f1ea', '#ffffff',
  '#ff5a1f', '#ffd23f', '#c8f560', '#00c48c',
  '#2b59ff', '#7b61ff', '#ff4f9a', '#ff8fb1',
  '#e9e4ff', '#ffe4d6', '#0f2a1d', '#101935',
];

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------
export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'none', name: 'None', material: defaultMaterial('none') },
  { id: 'fluted', name: 'Fluted', material: defaultMaterial('fluted') },
  { id: 'reeded', name: 'Reeded', material: mat('fluted', { strength: 0.75, size: 0.55, shape: 0.85, blur: 0.3, highlight: 0.4, aberration: 0.55 }) },
  { id: 'ribbed', name: 'Ribbed', material: defaultMaterial('ribbed') },
  { id: 'frosted', name: 'Frosted', material: defaultMaterial('frosted') },
  { id: 'milk-glass', name: 'Milk Glass', material: mat('frosted', { strength: 0.3, size: 0.25, blur: 0.75, highlight: 0.15, tint: '#fff8f0', tintAmount: 0.45 }) },
  { id: 'soft-focus', name: 'Soft Focus', material: defaultMaterial('blur') },
  { id: 'liquid-glass', name: 'Liquid Glass', material: defaultMaterial('liquidGlass') },
  { id: 'bubbles', name: 'Bubbles', material: mat('liquidGlass', { strength: 0.8, size: 0.3, shape: 0.85, blur: 0.25, highlight: 0.9, aberration: 0.6, speed: 0.7, tint: '#e9f4ff', tintAmount: 0.15 }) },
  { id: 'glass-bricks', name: 'Glass Bricks', material: defaultMaterial('tiles') },
  { id: 'lens-grid', name: 'Lens Grid', material: mat('tiles', { strength: 0.6, size: 0.3, shape: 1, blur: 0, highlight: 0.65, aberration: 0.5 }) },
  { id: 'pool', name: 'Pool', material: defaultMaterial('water') },
  { id: 'crystal', name: 'Crystal', material: defaultMaterial('crystal') },
  { id: 'prism', name: 'Prism', material: defaultMaterial('prism') },
  { id: 'halftone', name: 'Halftone', material: defaultMaterial('halftone') },
  { id: 'led', name: 'LED Wall', material: defaultMaterial('pixelate') },
  { id: 'crt', name: 'CRT', material: defaultMaterial('crt') },
  { id: 'dither', name: 'Dither', material: defaultMaterial('dither') },
];

// ---------------------------------------------------------------------------------------------
// First impression
// ---------------------------------------------------------------------------------------------
export const DEFAULT_BG: BgConfig = {
  base: base('mesh', ['#05040e', '#1e1060', '#ff3f7f', '#ffa25c'], { speed: 0.55, angle: 0, detail: 0.6, amount: 0.35 }),
  material: mat('fluted', { strength: 0.7, size: 0.42, shape: 0.75, blur: 0.15, highlight: 0.6, aberration: 0.6 }),
  fx: { grain: 0.22, vignette: 0.35 },
};

// ---------------------------------------------------------------------------------------------
// Surprise me: curated pairings that always look good
// ---------------------------------------------------------------------------------------------
const PAIRINGS: { base: string; mats: string[]; grain?: [number, number]; vignette?: [number, number] }[] = [
  { base: 'midnight-bloom', mats: ['fluted', 'reeded', 'liquid-glass', 'glass-bricks', 'crystal', 'frosted', 'none'] },
  { base: 'velvet', mats: ['fluted', 'ribbed', 'liquid-glass', 'prism', 'pool', 'none'] },
  { base: 'northern', mats: ['fluted', 'ribbed', 'frosted', 'liquid-glass', 'none'] },
  { base: 'mercury', mats: ['none', 'fluted', 'lens-grid', 'prism'] },
  { base: 'molten-gold', mats: ['none', 'reeded', 'crystal'] },
  { base: 'silk-rouge', mats: ['none', 'fluted', 'frosted', 'liquid-glass'] },
  { base: 'acid-plasma', mats: ['led', 'crt', 'fluted', 'halftone', 'dither', 'liquid-glass'] },
  { base: 'groovy', mats: ['none', 'fluted', 'pool', 'bubbles', 'crt'] },
  { base: 'retro-waves', mats: ['none', 'ribbed', 'liquid-glass', 'halftone'] },
  { base: 'lava-lamp', mats: ['none', 'fluted', 'frosted', 'crt'] },
  { base: 'sunday', mats: ['none', 'fluted', 'prism', 'pool'] },
  { base: 'holo-foil', mats: ['none', 'frosted', 'glass-bricks', 'crystal', 'liquid-glass'] },
  { base: 'checkmate', mats: ['none', 'liquid-glass', 'bubbles', 'pool', 'lens-grid'] },
  { base: 'daydream', mats: ['fluted', 'milk-glass', 'liquid-glass', 'glass-bricks', 'none'] },
  { base: 'canvas', mats: ['none', 'liquid-glass'], grain: [0, 0.12], vignette: [0, 0.15] },
  { base: 'night-canvas', mats: ['none', 'liquid-glass'], grain: [0.05, 0.2] },
  { base: 'pop-art', mats: ['none'] },
  { base: 'pocket', mats: ['none', 'crt'] },
  { base: 'dusk', mats: ['ribbed', 'pool', 'liquid-glass', 'crystal', 'frosted'] },
  { base: 'peach', mats: ['ribbed', 'fluted', 'frosted', 'bubbles'] },
  { base: 'nebula', mats: ['fluted', 'crystal', 'lens-grid', 'prism'] },
  { base: 'pastel', mats: ['fluted', 'glass-bricks', 'liquid-glass', 'milk-glass'] },
  { base: 'cyber', mats: ['fluted', 'crt', 'prism'] },
  { base: 'studio', mats: ['none'], grain: [0.1, 0.25], vignette: [0.1, 0.3] },
  { base: 'darkroom', mats: ['none', 'frosted'] },
];

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const range = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
const findBase = (id: string) => [...SHADER_PRESETS, ...GRADIENT_PRESETS].find((p) => p.id === id);
const findMat = (id: string) => MATERIAL_PRESETS.find((p) => p.id === id);

/** A curated, always-good random background. */
export function randomBg(): BgConfig {
  const pair = pick(PAIRINGS);
  const bp = findBase(pair.base) ?? SHADER_PRESETS[0];
  const mp = findMat(pick(pair.mats)) ?? MATERIAL_PRESETS[0];
  const b: BaseLayer = { ...bp.base, colors: [...bp.base.colors] as Pal };
  const m: MaterialLayer = { ...mp.material };
  // gentle variations that never break the look
  if (b.kind !== 'solid') b.angle = (b.angle + (Math.random() - 0.5) * 50 + 360) % 360;
  b.detail = clamp01(b.detail + (Math.random() - 0.5) * 0.2);
  if (m.kind === 'fluted' || m.kind === 'ribbed' || m.kind === 'prism') {
    m.angle = Math.random() < 0.65 ? 0 : Math.round(Math.random() * 40 - 20 + 180) % 180;
  }
  return {
    base: b,
    material: m,
    fx: { grain: range(pair.grain ?? [0.15, 0.35]), vignette: range(pair.vignette ?? [0.15, 0.45]) },
  };
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
