/**
 * Background = Base (a generator: colour, gradient or animated shader)
 *            + Material (an optional glass/filter layer that refracts the base)
 *            + Effects (film grain, vignette).
 * Mirrors the layer model of shaders.com (generators + filter effects), rendered in WebGL2.
 */

export type BaseKind =
  | 'solid'
  | 'linear'
  | 'radial'
  | 'conic'
  | 'mesh'
  | 'flow'
  | 'aurora'
  | 'liquidMetal'
  | 'satin'
  | 'plasma'
  | 'swirl'
  | 'waves'
  | 'goo'
  | 'sunburst'
  | 'holo'
  | 'checker'
  | 'dotgrid'
  | 'halftone'
  | 'dither'
  | 'studio';

export type MaterialKind =
  | 'none'
  | 'fluted'
  | 'ribbed'
  | 'frosted'
  | 'blur'
  | 'liquidGlass'
  | 'tiles'
  | 'water'
  | 'crystal'
  | 'prism'
  | 'halftone'
  | 'pixelate'
  | 'crt'
  | 'dither';

/** Hex colour string, e.g. "#ff5a1f". */
export type Hex = string;

export interface BaseLayer {
  kind: BaseKind;
  /** Palette. Every kind reads from these 4 stops (solid uses colors[0]). */
  colors: [Hex, Hex, Hex, Hex];
  /** Animation speed multiplier, 0 = frozen. Typical 0..2. */
  speed: number;
  /** Pattern zoom / density. Typical 0.25..4, 1 = default. */
  scale: number;
  /** Direction in degrees (gradients, stripes, rays...). */
  angle: number;
  /** Kind-specific 0..1 knob (warp, swirl, softness, detail...). See BASE_META labels. */
  detail: number;
  /** Second kind-specific 0..1 knob. See BASE_META labels. */
  amount: number;
}

export interface MaterialLayer {
  kind: MaterialKind;
  /** Overall effect strength 0..1 (refraction / distortion amount). */
  strength: number;
  /** Feature size 0..1 (flute width, tile size, pixel size...), mapped per kind. */
  size: number;
  /** Blur / frost 0..1. */
  blur: number;
  /** Direction in degrees (flute angle, tile rotation...). */
  angle: number;
  /** Specular highlight strength 0..1. */
  highlight: number;
  /** Chromatic aberration 0..1. */
  aberration: number;
  /** Glass tint colour and amount 0..1. */
  tint: Hex;
  tintAmount: number;
  /** Animation speed for animated materials (water, liquid glass...). */
  speed: number;
}

export interface Effects {
  /** Film grain 0..1. */
  grain: number;
  /** Vignette 0..1. */
  vignette: number;
}

export interface BgConfig {
  base: BaseLayer;
  material: MaterialLayer;
  fx: Effects;
}

/** Describes one slider the UI should show for a kind. `key` is a numeric field of the layer. */
export interface ParamSpec<K extends string = string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface BaseMeta {
  label: string;
  /** How many palette entries matter for this kind (UI shows that many colour chips). */
  colorCount: 1 | 2 | 3 | 4;
  /** Numeric BaseLayer fields this kind actually uses, with human labels. */
  params: ParamSpec<'speed' | 'scale' | 'angle' | 'detail' | 'amount'>[];
  /** True if it animates when speed > 0. */
  animated: boolean;
  /** True if it has hard pixel-scale detail and must render at full resolution. */
  crisp?: boolean;
}

export interface MaterialMeta {
  label: string;
  params: ParamSpec<'strength' | 'size' | 'blur' | 'angle' | 'highlight' | 'aberration' | 'tintAmount' | 'speed'>[];
  /** True if the tint colour matters for this kind. */
  usesTint?: boolean;
  animated?: boolean;
}

/** A named, ready-made look shown as a swatch in the island. */
export interface BasePreset {
  id: string;
  name: string;
  base: BaseLayer;
}

export interface MaterialPreset {
  id: string;
  name: string;
  material: MaterialLayer;
}
