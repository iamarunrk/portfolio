import type { BgConfig, MaterialKind } from '../bg/types';
import { BASE_META, MATERIAL_META } from '../bg/meta';

/**
 * Theme tokens: the homepage background (Shaders / Gradients / Colors / Glass / Effects) is the site's
 * theme. Everywhere else (the board, case-study pages) it is only *echoed*, on purpose very quietly:
 *
 *  - the board floor takes the hue of the theme's dark stops, at a chroma you notice only side by side;
 *  - a faint ambient light in the theme's most colourful stops sits in the corners of the board;
 *  - the dot grid, section wash and HUD glass lean the same way;
 *  - grain and vignette come through at a fraction of their strength;
 *  - the glass material leaves a whisper of its texture on the board's glass chrome;
 *  - case-study paper leans toward the theme's light stops, and its small accents take the theme colour.
 *
 * Neutral themes (ink, mercury, black or white) give back the original look.
 * Pure functions, so they can be tested and reused; `live.ts` applies them to the page.
 */

type RGB = [number, number, number];
type Lab = [number, number, number];

export interface ThemeTokens {
  /** CSS custom properties to set on the app root. */
  vars: Record<string, string>;
  /** The board floor, as hex (WebGL glass on the board "sees" this behind it). */
  floor: string;
  /** "Flow + Fluted glass" */
  name: string;
  /** True when the theme itself is bright (it reads with dark ink). */
  light: boolean;
}

// ── colour math (sRGB ⇄ OKLab) ──────────────────────────────────────────────

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function hexToRgb(hex: string): RGB {
  let h = (hex ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(h)) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return [0, 0, 0];
  const n = parseInt(h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(rgb: RGB): string {
  return `#${rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToLab([r, g, b]: RGB): Lab {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToRgbRaw([L, a, b]: Lab): RGB {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    toGam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const inGamut = (c: RGB) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH (L 0..1, C, hue in degrees) to sRGB, lowering chroma until it fits the gamut. */
export function oklch(L: number, C: number, h: number): RGB {
  const rad = (h * Math.PI) / 180;
  const at = (c: number): RGB => labToRgbRaw([L, c * Math.cos(rad), c * Math.sin(rad)]);
  let rgb = at(C);
  if (inGamut(rgb)) return rgb.map(clamp01) as RGB;
  let lo = 0, hi = C;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  rgb = at(lo);
  return rgb.map(clamp01) as RGB;
}

function mixLab(a: Lab, b: Lab, t: number): Lab {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const rgba = (rgb: RGB, a: number) =>
  `rgba(${Math.round(clamp01(rgb[0]) * 255)}, ${Math.round(clamp01(rgb[1]) * 255)}, ${Math.round(clamp01(rgb[2]) * 255)}, ${+a.toFixed(3)})`;

// ── reading the theme ───────────────────────────────────────────────────────

interface Stop {
  L: number;
  c: number;
  h: number;
  a: number;
  b: number;
}

const stopOf = (hex: string): Stop => {
  const [L, a, b] = rgbToLab(hexToRgb(hex));
  return { L, a, b, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
};

/**
 * The hue a set of stops leans toward, and how strongly: a chroma-weighted mean of their (a, b).
 * Grey stops dilute the lean instead of pulling the hue, so a grey theme with one violet chip leans
 * only a little violet.
 */
function leanOf(stops: Stop[]): { hue: number; lean: number } | null {
  let A = 0, B = 0, S = 0;
  for (const s of stops) {
    A += s.a * s.c;
    B += s.b * s.c;
    S += Math.max(s.c, 0.05);
  }
  const mag = Math.hypot(A, B);
  if (S <= 0 || mag < 1e-6) return null;
  return { hue: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360, lean: mag / S };
}

const PAPER = '#f4efe6'; // the case-study paper of the neutral (original) look
const PAPER_MUTED = '#6b6458';

const accentScore = (s: Stop) => s.c * (s.h > 70 && s.h < 118 ? 0.55 : 1);

/** Faint film grain as a tiling SVG (alpha is baked in, so it needs no opacity of its own). */
function grainImage(alpha: number): string {
  if (alpha < 0.004) return 'none';
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
    `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${(alpha * 2).toFixed(3)} 0 0 0 0'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#g)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The glass material, as a whisper of texture on the board's own glass chrome. */
function materialTexture(kind: MaterialKind, angle: number): { tex: string; blur: number } {
  const w = 'rgba(255, 255, 255, 0.032)';
  switch (kind) {
    case 'fluted':
      return { tex: `repeating-linear-gradient(${90 + Math.round(angle)}deg, ${w} 0 1px, transparent 1px 7px)`, blur: 18 };
    case 'ribbed':
      return { tex: `repeating-linear-gradient(${90 + Math.round(angle)}deg, ${w} 0 2px, transparent 2px 9px)`, blur: 18 };
    case 'tiles':
    case 'pixelate':
      return { tex: `repeating-linear-gradient(0deg, ${w} 0 1px, transparent 1px 11px), repeating-linear-gradient(90deg, ${w} 0 1px, transparent 1px 11px)`, blur: 18 };
    case 'halftone':
    case 'dither':
      return { tex: `radial-gradient(rgba(255, 255, 255, 0.05) 0.7px, transparent 1.1px) 0 0 / 5px 5px`, blur: 18 };
    case 'crt':
      return { tex: `repeating-linear-gradient(0deg, ${w} 0 1px, transparent 1px 3px)`, blur: 18 };
    case 'frosted':
    case 'blur':
      return { tex: 'none', blur: 30 };
    case 'liquidGlass':
    case 'water':
    case 'crystal':
    case 'prism':
      return { tex: 'linear-gradient(118deg, rgba(255, 255, 255, 0.05), transparent 38%, rgba(255, 255, 255, 0.025) 62%, transparent 80%)', blur: 20 };
    default:
      return { tex: 'none', blur: 18 };
  }
}

export function themeName(bg: BgConfig): string {
  const base = BASE_META[bg.base.kind]?.label ?? bg.base.kind;
  const glass = bg.material.kind !== 'none' ? MATERIAL_META[bg.material.kind]?.label : null;
  return glass ? `${base} + ${glass}` : base;
}

/** Everything the rest of the site needs to echo the theme. `ink` is the homepage's headline ink. */
export function themeTokens(bg: BgConfig, ink: 'light' | 'dark'): ThemeTokens {
  const light = ink === 'dark';
  const count = Math.max(1, Math.min(4, BASE_META[bg.base.kind]?.colorCount ?? 4));
  const stops = bg.base.colors.slice(0, count).map(stopOf);
  // a tinted glass colours the whole look a little
  const m = bg.material;
  if (m.kind !== 'none' && MATERIAL_META[m.kind]?.usesTint && m.tintAmount > 0.08) stops.push(stopOf(m.tint));

  const all = leanOf(stops);
  const darkLean = leanOf(stops.filter((s) => s.L < 0.5)) ?? all;
  const lightLean = leanOf(stops.filter((s) => s.L >= 0.5)) ?? all;
  const vivid = stops.filter((s) => s.c > 0.035).sort((x, y) => y.c - x.c);
  const chromatic = vivid.length > 0 && !!all;

  // board floor: dark, leaning toward the theme's shadows
  const floorHue = chromatic && darkLean ? darkLean.hue : 285;
  const floorC = chromatic && darkLean ? Math.min(0.011, 0.003 + darkLean.lean * 0.065) : 0.003;
  const floorL = light ? 0.176 : 0.168;
  const floorRgb = oklch(floorL, floorC, floorHue);
  const floor = rgbToHex(floorRgb);

  const dot = rgba(oklch(0.93, Math.min(0.03, floorC * 1.8), floorHue), 0.11);
  const secFill = rgba(oklch(0.92, Math.min(0.04, floorC * 2.5), floorHue), 0.03);
  const secLine = rgba(oklch(0.92, Math.min(0.04, floorC * 2.5), floorHue), 0.1);
  const hud = rgba(oklch(0.215, floorC * 1.2, floorHue), 0.62);
  const hudStrong = rgba(oklch(0.2, floorC * 1.2, floorHue), 0.84);

  // ambient light: the most colourful stops, at a lightness that reads the same in every theme
  const glowL = light ? 0.74 : 0.64;
  const glowA = [0.12, 0.085, 0.055];
  const glow = [0, 1, 2].map((i) => {
    const s = vivid[i] ?? vivid[0];
    return s ? rgba(oklch(glowL, Math.min(s.c, 0.16), s.h), glowA[i] * (vivid[i] ? 1 : 0.6)) : 'rgba(0, 0, 0, 0)';
  });

  const fx = bg.fx;
  const grain = grainImage(clamp01(fx.grain) * 0.05);
  const vignette = `rgba(0, 0, 0, ${(clamp01(fx.vignette) * 0.3).toFixed(3)})`;
  const tex = materialTexture(m.kind, m.angle ?? 0);

  // case-study paper: the original warm paper, leaning toward the theme's light stops
  const paperLab = rgbToLab(hexToRgb(PAPER));
  const pl = lightLean && chromatic ? lightLean : null;
  const pw = pl ? smooth(0.015, 0.09, pl.lean) * 0.7 : 0;
  const paperTint = pl ? rgbToLab(oklch(0.953, 0.013, pl.hue)) : paperLab;
  const paperRgb = labToRgbRaw(mixLab(paperLab, paperTint, pw)).map(clamp01) as RGB;
  const paper = rgbToHex(paperRgb);
  const paperL = rgbToLab(paperRgb);
  const paperHue = pl ? pl.hue : 80;
  const paperC = Math.hypot(paperL[1], paperL[2]);
  const line = rgbToHex(oklch(0.875, Math.min(0.03, paperC * 1.3), paperHue));
  const chip = rgbToHex(oklch(0.99, Math.min(0.01, paperC * 0.4), paperHue));
  const muted = pw > 0.05 ? rgbToHex(oklch(0.5, Math.min(0.03, paperC * 1.4), paperHue)) : PAPER_MUTED;
  // the accent is used as small text on paper: yellows turn to olive at that lightness, so they rank lower
  const accentStop = [...vivid].sort((x, y) => accentScore(y) - accentScore(x))[0];
  const accent = accentStop ? rgbToHex(oklch(0.5, Math.min(accentStop.c, 0.15), accentStop.h)) : PAPER_MUTED;
  const accentSoft = accentStop ? rgba(oklch(0.8, Math.min(accentStop.c, 0.12), accentStop.h), 0.45) : 'rgba(20, 18, 16, 0.12)';
  const caseGlow = [0, 1].map((i) => {
    const s = vivid[i] ?? vivid[0];
    return s ? rgba(oklch(0.85, Math.min(s.c, 0.11), s.h), [0.15, 0.09][i] * (vivid[i] ? 1 : 0.6)) : 'rgba(0, 0, 0, 0)';
  });

  return {
    floor,
    light,
    name: themeName(bg),
    vars: {
      '--th-floor': floor,
      '--th-dot': dot,
      '--th-sec': secFill,
      '--th-sec-line': secLine,
      '--th-g1': glow[0],
      '--th-g2': glow[1],
      '--th-g3': glow[2],
      '--th-vig': vignette,
      '--th-grain': grain,
      '--th-hud': hud,
      '--th-hud-strong': hudStrong,
      '--th-tex': tex.tex,
      '--th-hud-blur': `${tex.blur}px`,
      '--th-paper': paper,
      '--th-paper-line': line,
      '--th-paper-chip': chip,
      '--th-paper-muted': muted,
      '--th-accent': accent,
      '--th-accent-soft': accentSoft,
      '--th-cg1': caseGlow[0],
      '--th-cg2': caseGlow[1],
    },
  };
}
