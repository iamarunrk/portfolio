import type { BaseKind, BaseMeta, MaterialKind, MaterialMeta, ParamSpec } from './types';
import { BASE_KIND_ORDER } from './glsl/base';
import { MATERIAL_KIND_ORDER } from './glsl/material';

/** Every base kind, in island display order. */
export const BASE_KINDS: readonly BaseKind[] = BASE_KIND_ORDER;
/** Every material kind, in island display order ('none' first). */
export const MATERIAL_KINDS: readonly MaterialKind[] = MATERIAL_KIND_ORDER;

type BaseKey = 'speed' | 'scale' | 'angle' | 'detail' | 'amount';
type MatKey = 'strength' | 'size' | 'blur' | 'angle' | 'highlight' | 'aberration' | 'tintAmount' | 'speed' | 'shape';

const bp = (key: BaseKey, label: string, min = 0, max = 1, step = 0.01): ParamSpec<BaseKey> => ({ key, label, min, max, step });
const mp = (key: MatKey, label: string, min = 0, max = 1, step = 0.01): ParamSpec<MatKey> => ({ key, label, min, max, step });

const speed = (label = 'Speed', max = 2) => bp('speed', label, 0, max, 0.01);
const angle = (label = 'Angle') => bp('angle', label, 0, 360, 1);
const scale = (label = 'Zoom', min = 0.4, max = 2.5) => bp('scale', label, min, max, 0.01);

export const BASE_META: Record<BaseKind, BaseMeta> = {
  solid: { label: 'Solid', colorCount: 1, params: [], animated: false },
  linear: {
    label: 'Linear',
    colorCount: 4,
    params: [angle('Angle'), scale('Spread', 0.5, 2), bp('detail', 'Waviness'), bp('amount', 'Balance'), speed('Drift', 1)],
    animated: true,
  },
  radial: {
    label: 'Radial',
    colorCount: 4,
    params: [scale('Radius', 0.4, 2), angle('Direction'), bp('amount', 'Offset'), bp('detail', 'Waviness'), speed('Drift', 1)],
    animated: true,
  },
  conic: {
    label: 'Conic',
    colorCount: 4,
    params: [angle('Rotation'), bp('detail', 'Twist'), bp('amount', 'Soft core'), speed('Spin', 1)],
    animated: true,
  },
  mesh: {
    label: 'Mesh',
    colorCount: 4,
    params: [speed(), scale('Zoom', 0.5, 2), angle('Rotation'), bp('detail', 'Swirl'), bp('amount', 'Softness')],
    animated: true,
  },
  flow: {
    label: 'Flow',
    colorCount: 4,
    params: [speed(), scale('Zoom', 0.4, 2.5), angle('Rotation'), bp('detail', 'Turbulence'), bp('amount', 'Sheen')],
    animated: true,
  },
  aurora: {
    label: 'Aurora',
    colorCount: 4,
    params: [speed(), scale('Size', 0.5, 2), angle('Tilt'), bp('detail', 'Rays'), bp('amount', 'Height')],
    animated: true,
  },
  liquidMetal: {
    label: 'Liquid metal',
    colorCount: 4,
    params: [speed(), scale('Zoom', 0.4, 2.5), angle('Rotation'), bp('detail', 'Turbulence'), bp('amount', 'Sharpness')],
    animated: true,
  },
  satin: {
    label: 'Satin',
    colorCount: 4,
    params: [speed('Breeze'), scale('Fold width', 0.4, 2.5), angle('Direction'), bp('detail', 'Depth'), bp('amount', 'Gloss')],
    animated: true,
  },
  plasma: {
    label: 'Plasma',
    colorCount: 4,
    params: [speed(), scale('Zoom', 0.4, 2.5), angle('Rotation'), bp('detail', 'Warp'), bp('amount', 'Contrast')],
    animated: true,
  },
  swirl: {
    label: 'Swirl',
    colorCount: 4,
    params: [speed(), scale('Zoom', 0.4, 2.5), angle('Rotation'), bp('detail', 'Twist'), bp('amount', 'Arms')],
    animated: true,
  },
  waves: {
    label: 'Waves',
    colorCount: 4,
    params: [speed(), scale('Stripe width', 0.4, 2.5), angle('Angle'), bp('detail', 'Waviness'), bp('amount', 'Softness')],
    animated: true,
  },
  goo: {
    label: 'Goo',
    colorCount: 4,
    params: [speed(), scale('Zoom', 0.5, 2), angle('Light'), bp('detail', 'Merge'), bp('amount', 'Gloss')],
    animated: true,
  },
  sunburst: {
    label: 'Sunburst',
    colorCount: 4,
    params: [speed('Spin'), scale('Zoom', 0.5, 2.5), angle('Rotation'), bp('detail', 'Rays'), bp('amount', 'Sun size')],
    animated: true,
  },
  holo: {
    label: 'Holo foil',
    colorCount: 4,
    params: [speed(), scale('Zoom', 0.4, 2.5), angle('Angle'), bp('detail', 'Crinkle'), bp('amount', 'Sparkle')],
    animated: true,
  },
  checker: {
    label: 'Checker',
    colorCount: 4,
    params: [speed(), scale('Cell size', 0.4, 2.5), angle('Rotation'), bp('detail', 'Warp'), bp('amount', 'Softness')],
    animated: true,
    crisp: true,
  },
  dotgrid: {
    label: 'Dot grid',
    colorCount: 3,
    params: [scale('Spacing', 0.5, 2.5), bp('detail', 'Dot size'), bp('amount', 'Glow'), speed('Drift')],
    animated: true,
    crisp: true,
  },
  halftone: {
    label: 'Halftone',
    colorCount: 4,
    params: [speed(), scale('Cell size', 0.5, 2.5), angle('Screen angle'), bp('detail', 'Ink'), bp('amount', 'Turbulence')],
    animated: true,
    crisp: true,
  },
  dither: {
    label: 'Dither',
    colorCount: 4,
    params: [speed(), scale('Zoom', 0.4, 2.5), bp('detail', 'Pixel size'), bp('amount', 'Contrast')],
    animated: true,
    crisp: true,
  },
  studio: {
    label: 'Studio',
    colorCount: 4,
    params: [angle('Key light'), scale('Spread', 0.6, 1.6), bp('detail', 'Softness'), bp('amount', 'Intensity'), speed('Drift', 1)],
    animated: true,
  },
};

const tint = mp('tintAmount', 'Tint');

export const MATERIAL_META: Record<MaterialKind, MaterialMeta> = {
  none: { label: 'None', params: [] },
  fluted: {
    label: 'Fluted glass',
    params: [
      mp('strength', 'Refraction'), mp('size', 'Flute width'), mp('shape', 'Roundness'), mp('blur', 'Blur'),
      mp('angle', 'Angle', 0, 180, 1), mp('highlight', 'Highlight'), mp('aberration', 'Dispersion'), tint,
    ],
    usesTint: true,
  },
  ribbed: {
    label: 'Ribbed glass',
    params: [
      mp('strength', 'Refraction'), mp('size', 'Rib width'), mp('blur', 'Blur'), mp('angle', 'Angle', 0, 180, 1),
      mp('highlight', 'Highlight'), mp('aberration', 'Dispersion'), tint,
    ],
    usesTint: true,
  },
  frosted: {
    label: 'Frosted glass',
    params: [mp('strength', 'Frost'), mp('blur', 'Blur'), mp('size', 'Grain size'), mp('highlight', 'Sparkle'), mp('tintAmount', 'Milkiness')],
    usesTint: true,
  },
  blur: {
    label: 'Blur',
    params: [mp('blur', 'Radius'), mp('strength', 'Vibrance'), tint],
    usesTint: true,
  },
  liquidGlass: {
    label: 'Liquid glass',
    params: [
      mp('strength', 'Refraction'), mp('size', 'Blob size'), mp('shape', 'Merge'), mp('blur', 'Frost'),
      mp('highlight', 'Rim light'), mp('aberration', 'Dispersion'), mp('speed', 'Speed', 0, 2), tint,
    ],
    usesTint: true,
    animated: true,
  },
  tiles: {
    label: 'Glass tiles',
    params: [
      mp('strength', 'Refraction'), mp('size', 'Tile size'), mp('shape', 'Roundness'), mp('angle', 'Rotation', 0, 90, 1),
      mp('blur', 'Frost'), mp('highlight', 'Bevel light'), mp('aberration', 'Dispersion'), tint,
    ],
    usesTint: true,
  },
  water: {
    label: 'Water',
    params: [
      mp('strength', 'Ripple'), mp('size', 'Wave size'), mp('speed', 'Speed', 0, 2), mp('angle', 'Wind', 0, 360, 1),
      mp('highlight', 'Caustics'), mp('aberration', 'Dispersion'), mp('blur', 'Murk'), tint,
    ],
    usesTint: true,
    animated: true,
  },
  crystal: {
    label: 'Crystal',
    params: [
      mp('strength', 'Refraction'), mp('size', 'Shard size'), mp('highlight', 'Facets'), mp('aberration', 'Dispersion'),
      mp('angle', 'Light', 0, 360, 1), mp('blur', 'Frost'), tint,
    ],
    usesTint: true,
  },
  prism: {
    label: 'Prism',
    params: [
      mp('strength', 'Split'), mp('size', 'Facet width'), mp('angle', 'Angle', 0, 180, 1), mp('aberration', 'Rainbow'),
      mp('highlight', 'Light leak'), mp('speed', 'Drift', 0, 2), tint,
    ],
    usesTint: true,
    animated: true,
  },
  halftone: {
    label: 'Halftone',
    params: [mp('size', 'Dot size'), mp('angle', 'Screen angle', 0, 90, 1), mp('strength', 'Ink'), mp('shape', 'Dot shape'), mp('tintAmount', 'Paper')],
    usesTint: true,
  },
  pixelate: {
    label: 'Pixelate',
    params: [mp('size', 'Pixel size'), mp('shape', 'Roundness'), mp('strength', 'Gap'), mp('highlight', 'LED glow')],
  },
  crt: {
    label: 'CRT',
    params: [mp('size', 'Scanlines'), mp('strength', 'Curvature'), mp('highlight', 'Glow'), mp('aberration', 'Color shift'), mp('speed', 'Roll', 0, 2)],
    animated: true,
  },
  dither: {
    label: 'Dither',
    params: [mp('size', 'Pixel size'), mp('strength', 'Dither')],
  },
};
