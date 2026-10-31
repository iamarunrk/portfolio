/**
 * Canvas-2D painting helpers for the sticker-bomb print look: rounded shapes,
 * starbursts, barcodes, hazard stripes, layered display type (extrusion + outlines),
 * arched type, die-cut stickers with white borders and soft shadows, smileys,
 * holographic foil gradients, pixel art and small print.
 *
 * Everything works in the current transform's units ("design units"); blur and
 * shadow offsets are converted to device pixels internally.
 */
import { FONTS } from '../fonts';
import type { Surface } from './textures';
import { maskColor } from './textures';

export type C2D = CanvasRenderingContext2D;
export type PathFn = (ctx: C2D) => void;

export { FONTS };

// ---------------------------------------------------------------- utilities

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEG = Math.PI / 180;

/** Current uniform scale of the transform (design unit -> device px). */
export function pxScale(ctx: C2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) || 1;
}

export function font(size: number, family: string, weight: number | string = 400, italic = false): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
}

/** Run `fn` with a canvas shadow expressed in design units. */
export function withShadow(ctx: C2D, color: string, blur: number, dx: number, dy: number, fn: () => void): void {
  const s = pxScale(ctx);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * s;
  // shadow offsets ignore the rotation part of the transform; rotate them back
  const m = ctx.getTransform();
  const ang = Math.atan2(m.b, m.a);
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  ctx.shadowOffsetX = (dx * c - dy * sn) * s;
  ctx.shadowOffsetY = (dx * sn + dy * c) * s;
  fn();
  ctx.restore();
}

// ---------------------------------------------------------------- paths

export function rrect(ctx: C2D, x: number, y: number, w: number, h: number, r: number | number[]): void {
  const rr = Array.isArray(r) ? r : [r, r, r, r];
  const [tl, tr, br, bl] = rr.map((v) => Math.max(0, Math.min(v, w / 2, h / 2)));
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

export const rrPath =
  (x: number, y: number, w: number, h: number, r: number | number[]): PathFn =>
  (ctx) =>
    rrect(ctx, x, y, w, h, r);

export const circlePath =
  (cx: number, cy: number, r: number): PathFn =>
  (ctx) => {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
  };

export const ellipsePath =
  (cx: number, cy: number, rx: number, ry: number, rot = 0): PathFn =>
  (ctx) => {
    ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    ctx.closePath();
  };

/** Star / starburst. `round` softens the tips (0..1). */
export const starPath =
  (cx: number, cy: number, rOut: number, rIn: number, n: number, rot = -Math.PI / 2, round = 0): PathFn =>
  (ctx) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? rOut : rIn;
      const a = rot + (i * Math.PI) / n;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    if (round <= 0) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      return;
    }
    const L = pts.length;
    const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const start = mid(pts[L - 1], pts[0]);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < L; i++) {
      const p = pts[i];
      const prev = pts[(i - 1 + L) % L];
      const next = pts[(i + 1) % L];
      const a = lerp(p, prev, round * 0.5);
      const b = lerp(p, next, round * 0.5);
      ctx.lineTo(a[0], a[1]);
      ctx.quadraticCurveTo(p[0], p[1], b[0], b[1]);
    }
    ctx.closePath();
  };

/** Wavy-edged seal (like a price/"NEW" sticker): sinusoidal radius. */
export const sealPath =
  (cx: number, cy: number, r: number, waves: number, amp: number): PathFn =>
  (ctx) => {
    const N = waves * 12;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rr = r + Math.cos(a * waves) * amp;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

/** Ticket: rectangle with semicircular notches on the short sides. */
export const ticketPath =
  (x: number, y: number, w: number, h: number, notch: number, r = 6): PathFn =>
  (ctx) => {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h / 2 - notch);
    ctx.arc(x + w, y + h / 2, notch, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + h / 2 + notch);
    ctx.arc(x, y + h / 2, notch, Math.PI / 2, -Math.PI / 2, true);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  };

/** Price tag: rectangle with a pointed left end and a punched hole. */
export const tagPath =
  (x: number, y: number, w: number, h: number, point: number, r = 10): PathFn =>
  (ctx) => {
    ctx.moveTo(x + point, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + point, y + h);
    ctx.lineTo(x, y + h / 2);
    ctx.closePath();
  };

/** Banner ribbon with forked ends. */
export const ribbonPath =
  (x: number, y: number, w: number, h: number, fork: number): PathFn =>
  (ctx) => {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - fork, y + h / 2);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + fork, y + h / 2);
    ctx.closePath();
  };

export function fillPath(ctx: C2D, path: PathFn, style: string | CanvasGradient | CanvasPattern): void {
  ctx.beginPath();
  path(ctx);
  ctx.fillStyle = style;
  ctx.fill();
}

export function strokePath(ctx: C2D, path: PathFn, style: string | CanvasGradient, width: number): void {
  ctx.beginPath();
  path(ctx);
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ---------------------------------------------------------------- type

export interface Outline {
  color: string;
  width: number;
}

export interface TextStyle {
  size: number;
  family: string;
  weight?: number | string;
  italic?: boolean;
  color?: string | CanvasGradient | CanvasPattern;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Extra letter spacing in design units. */
  tracking?: number;
  /** Squash horizontally so the run is at most this wide. */
  maxWidth?: number;
  /** Outlines, drawn widest first (pass them in any order). */
  outlines?: Outline[];
  /** Solid extrusion (stacked copies) behind the type: classic toy-logo depth. */
  extrude?: { color: string; dx: number; dy: number; steps?: number };
  /** Soft drop shadow under everything. */
  shadow?: { color: string; dx: number; dy: number; blur: number };
  /** Vertical two-stop gradient fill [top, bottom] (overrides `color`). */
  gradient?: [string, string];
  /** Horizontal stretch (1 = normal). */
  stretch?: number;
}

interface Glyph {
  ch: string;
  x: number;
  y: number;
  rot: number;
}

function applyFont(ctx: C2D, st: TextStyle): void {
  ctx.font = font(st.size, st.family, st.weight ?? 400, st.italic ?? false);
  ctx.textAlign = 'left';
  ctx.textBaseline = st.baseline ?? 'alphabetic';
  ctx.letterSpacing = '0px';
}

/** Width of a run including tracking, in design units. */
export function measure(ctx: C2D, str: string, st: TextStyle): number {
  ctx.save();
  applyFont(ctx, st);
  let w = 0;
  if (st.tracking) {
    for (const ch of str) w += ctx.measureText(ch).width + st.tracking;
    w -= st.tracking;
  } else {
    w = ctx.measureText(str).width;
  }
  ctx.restore();
  return w * (st.stretch ?? 1);
}

/** Largest size (<= style.size) that fits `maxW`. */
export function fitSize(ctx: C2D, str: string, st: TextStyle, maxW: number): number {
  const w = measure(ctx, str, st);
  return w > maxW ? (st.size * maxW) / w : st.size;
}

function drawGlyphLayers(ctx: C2D, glyphs: Glyph[], st: TextStyle, whole: string | null): void {
  const draw = (fn: (g: Glyph | null) => void) => {
    if (whole !== null) fn(null);
    else for (const g of glyphs) fn(g);
  };
  const put = (g: Glyph | null, dx: number, dy: number, mode: 'fill' | 'stroke') => {
    if (g === null) {
      if (mode === 'fill') ctx.fillText(whole as string, dx, dy);
      else ctx.strokeText(whole as string, dx, dy);
      return;
    }
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot);
    if (mode === 'fill') ctx.fillText(g.ch, dx, dy);
    else ctx.strokeText(g.ch, dx, dy);
    ctx.restore();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const outlines = [...(st.outlines ?? [])].sort((a, b) => b.width - a.width);
  const outer = outlines[0];

  // soft shadow
  if (st.shadow) {
    const sh = st.shadow;
    withShadow(ctx, sh.color, sh.blur, sh.dx, sh.dy, () => {
      ctx.fillStyle = sh.color;
      ctx.strokeStyle = sh.color;
      draw((g) => {
        if (outer) {
          ctx.lineWidth = outer.width;
          put(g, 0, 0, 'stroke');
        }
        put(g, 0, 0, 'fill');
      });
    });
  }
  // extrusion
  if (st.extrude) {
    const ex = st.extrude;
    const steps = ex.steps ?? Math.max(2, Math.ceil(Math.hypot(ex.dx, ex.dy) / 1.5));
    ctx.fillStyle = ex.color;
    ctx.strokeStyle = ex.color;
    for (let i = steps; i >= 1; i--) {
      const dx = (ex.dx * i) / steps;
      const dy = (ex.dy * i) / steps;
      draw((g) => {
        if (outer) {
          ctx.lineWidth = outer.width;
          put(g, dx, dy, 'stroke');
        }
        put(g, dx, dy, 'fill');
      });
    }
  }
  // outlines (widest first)
  for (const o of outlines) {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.width;
    draw((g) => put(g, 0, 0, 'stroke'));
  }
  // fill
  if (st.gradient) {
    const g = ctx.createLinearGradient(0, -st.size * 0.75, 0, st.size * 0.05);
    g.addColorStop(0, st.gradient[0]);
    g.addColorStop(1, st.gradient[1]);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = st.color ?? '#fff';
  }
  draw((g) => put(g, 0, 0, 'fill'));
}

/**
 * Draw a layered run of type at (x, y). `rot` rotates around the anchor.
 * Returns the drawn width (design units).
 */
export function text(ctx: C2D, str: string, x: number, y: number, st: TextStyle, rot = 0): number {
  ctx.save();
  applyFont(ctx, st);
  const tracking = st.tracking ?? 0;
  const widths: number[] = [];
  for (const ch of str) widths.push(ctx.measureText(ch).width);
  let w = tracking ? widths.reduce((a, b) => a + b, 0) + tracking * (widths.length - 1) : ctx.measureText(str).width;
  let sx = st.stretch ?? 1;
  if (st.maxWidth && w * sx > st.maxWidth) sx = st.maxWidth / w;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sx, 1);
  const align = st.align ?? 'left';
  const x0 = align === 'center' ? -w / 2 : align === 'right' || align === 'end' ? -w : 0;
  if (tracking) {
    const glyphs: Glyph[] = [];
    let cx = x0;
    let i = 0;
    for (const ch of str) {
      glyphs.push({ ch, x: cx, y: 0, rot: 0 });
      cx += widths[i++] + tracking;
    }
    drawGlyphLayers(ctx, glyphs, st, null);
  } else {
    ctx.translate(x0, 0);
    drawGlyphLayers(ctx, [], st, str);
  }
  ctx.restore();
  w *= sx;
  return w;
}

/**
 * Type set on a circular arc. `angle` is the centre of the run (radians, 0 = right,
 * -PI/2 = top). Positive radius sets glyphs on the outside reading clockwise; set
 * `inside` to read along the bottom of a circle.
 */
export function arcText(
  ctx: C2D,
  str: string,
  cx: number,
  cy: number,
  radius: number,
  angle: number,
  st: TextStyle,
  inside = false,
): void {
  ctx.save();
  applyFont(ctx, st);
  const tracking = st.tracking ?? 0;
  const chars = [...str];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
  const dir = inside ? -1 : 1;
  let a = angle - (dir * total) / 2 / radius;
  const glyphs: Glyph[] = [];
  chars.forEach((ch, i) => {
    const half = widths[i] / 2;
    a += (dir * half) / radius;
    const gx = cx + Math.cos(a) * radius;
    const gy = cy + Math.sin(a) * radius;
    glyphs.push({ ch, x: gx, y: gy, rot: a + (dir * Math.PI) / 2 });
    a += (dir * (half + tracking)) / radius;
  });
  // centre each glyph on its anchor
  ctx.textAlign = 'center';
  drawGlyphLayers(ctx, glyphs, st, null);
  ctx.restore();
}

/** Multi-line small print block. */
export function smallPrint(
  ctx: C2D,
  lines: string[],
  x: number,
  y: number,
  size: number,
  color: string,
  opts: { family?: string; weight?: number | string; lineHeight?: number; align?: CanvasTextAlign; maxWidth?: number } = {},
): number {
  ctx.save();
  ctx.font = font(size, opts.family ?? FONTS.spaceMono, opts.weight ?? 400);
  ctx.fillStyle = color;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'top';
  const lh = opts.lineHeight ?? size * 1.25;
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh, opts.maxWidth));
  ctx.restore();
  return lines.length * lh;
}

// ---------------------------------------------------------------- graphics

/** Barcode with guard bars and digits. (x, y) is the top-left of the bars. */
export function barcode(
  ctx: C2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  opts: { digits?: string; color?: string; bg?: string | null; pad?: number } = {},
): void {
  const r = rng(seed);
  const color = opts.color ?? '#111';
  const pad = opts.pad ?? 0;
  const digits = opts.digits ?? '';
  const textH = digits ? h * 0.2 : 0;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  }
  const barsH = h - textH;
  // modules
  const mods: number[] = [];
  let total = 0;
  while (total < 95) {
    const m = 1 + Math.floor(r() * 3.2);
    mods.push(m);
    total += m;
  }
  const unit = w / total;
  let cx = x;
  ctx.fillStyle = color;
  mods.forEach((m, i) => {
    const bw = m * unit;
    if (i % 2 === 0) {
      const guard = i < 3 || i > mods.length - 4 || Math.abs(i - mods.length / 2) < 2;
      ctx.fillRect(cx, y, bw * 0.92, guard ? barsH + textH * 0.6 : barsH);
    }
    cx += bw;
  });
  if (digits) {
    ctx.font = font(textH * 0.95, FONTS.spaceMono, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.fillText(digits, x + w / 2, y + barsH + textH * 0.08, w * 0.84);
  }
}

/** Diagonal hazard stripes filling a rect (clipped). */
export function hazard(ctx: C2D, x: number, y: number, w: number, h: number, stripe: number, a = '#ffd21f', b = '#111', angle = 45 * DEG): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = a;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = b;
  const k = Math.tan(angle) * h;
  for (let sx = x - Math.abs(k) - stripe * 2; sx < x + w + Math.abs(k) + stripe * 2; sx += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + stripe, y + h);
    ctx.lineTo(sx + stripe + k, y);
    ctx.lineTo(sx + k, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Seamless horizontal sine band across the full width `W` (periods must be an integer). */
export function waveBand(
  ctx: C2D,
  W: number,
  yMid: number,
  amp: number,
  thick: number,
  periods: number,
  phase: number,
  style: string | CanvasGradient,
  amp2 = 0,
): void {
  const N = 256;
  const f = (x: number, k: number) =>
    yMid + k * thick * 0.5 + Math.sin((x / W) * Math.PI * 2 * periods + phase) * amp + Math.sin((x / W) * Math.PI * 2 * periods * 2 + phase * 1.7) * amp2;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * W;
    if (i === 0) ctx.moveTo(x, f(x, -1));
    else ctx.lineTo(x, f(x, -1));
  }
  for (let i = N; i >= 0; i--) {
    const x = (i / N) * W;
    ctx.lineTo(x, f(x, 1));
  }
  ctx.closePath();
  ctx.fillStyle = style;
  ctx.fill();
}

/** Pastel holographic foil gradient. */
export function holoGradient(ctx: C2D, x0: number, y0: number, x1: number, y1: number, alpha = 1): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const stops = ['#ff9de2', '#ffe08a', '#a6ffcb', '#8fd8ff', '#c7a2ff', '#ff9de2', '#fff3a8', '#9ef0ff'];
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), alpha === 1 ? c : hexA(c, alpha)));
  return g;
}

/** Fill a path with holographic foil (two crossed gradients + sparkles). */
export function holoFill(ctx: C2D, path: PathFn, x: number, y: number, w: number, h: number, seed = 7): void {
  ctx.save();
  ctx.beginPath();
  path(ctx);
  ctx.clip();
  ctx.fillStyle = holoGradient(ctx, x, y, x + w, y + h);
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.globalAlpha = 0.55;
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = holoGradient(ctx, x + w, y, x, y + h);
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.8;
  const r = rng(seed);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 26; i++) {
    const sx = x + r() * w;
    const sy = y + r() * h;
    const s = 1.5 + r() * 4;
    fillPath(ctx, starPath(sx, sy, s * 2, s * 0.45, 4, 0), '#ffffff');
  }
  ctx.restore();
}

/** Smiley face. */
export function smiley(ctx: C2D, cx: number, cy: number, r: number, face = '#ffd400', ink = '#141414', outline = 0): void {
  ctx.save();
  if (outline > 0) {
    fillPath(ctx, circlePath(cx, cy, r + outline), ink);
  }
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, lighten(face, 0.35));
  g.addColorStop(1, face);
  fillPath(ctx, circlePath(cx, cy, r), g);
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.33, cy - r * 0.22, r * 0.1, r * 0.17, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.33, cy - r * 0.22, r * 0.1, r * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.lineWidth = r * 0.1;
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;
  ctx.arc(cx, cy + r * 0.02, r * 0.55, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

/** Pixel art from strings; '.' or ' ' = empty, other chars looked up in palette. */
export function pixelArt(ctx: C2D, x: number, y: number, cell: number, rows: string[], palette: Record<string, string>): void {
  rows.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      const c = palette[ch];
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(x + i * cell, y + j * cell, cell + 0.4, cell + 0.4);
    });
  });
}

export const PIXEL_HEART = ['.XX.XX.', 'XWXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

/** Halftone dots; `fn(u, v)` -> 0..1 dot size over the rect. */
export function halftone(
  ctx: C2D,
  x: number,
  y: number,
  w: number,
  h: number,
  spacing: number,
  color: string,
  fn: (u: number, v: number) => number,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let j = 0, yy = y; yy < y + h + spacing; yy += spacing, j++) {
    const off = j % 2 ? spacing / 2 : 0;
    for (let xx = x + off; xx < x + w + spacing; xx += spacing) {
      const s = fn((xx - x) / w, (yy - y) / h);
      if (s <= 0.02) continue;
      const r = (s * spacing) / 2;
      ctx.moveTo(xx + r, yy);
      ctx.arc(xx, yy, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

/** Subtle print grain over a rect. */
export function grain(ctx: C2D, x: number, y: number, w: number, h: number, count: number, alpha: number, seed = 3): void {
  const r = rng(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * r();
    ctx.fillStyle = r() > 0.5 ? '#fff' : '#000';
    const s = 0.8 + r() * 1.6;
    ctx.fillRect(x + r() * w, y + r() * h, s, s);
  }
  ctx.restore();
}

/** Classic black-rule "facts" panel. Rows: [label, value, bold?]; '-' = thick rule. Returns height. */
export function factsPanel(
  ctx: C2D,
  x: number,
  y: number,
  w: number,
  title: string,
  sub: string,
  rows: ([string, string] | [string, string, boolean] | '-')[],
  opts: { size?: number; ink?: string; paper?: string | null; footer?: string[] } = {},
): number {
  const ink = opts.ink ?? '#111';
  const s = opts.size ?? 22;
  const pad = s * 0.55;
  const footer = opts.footer ?? [];
  const titleH = s * 1.75;
  const subH = s * 1.15;
  const rowH = s * 1.3;
  const ruleH = s * 0.5;
  let h = pad + titleH + subH + ruleH;
  for (const r of rows) h += r === '-' ? ruleH : rowH;
  h += footer.length ? s * 0.35 + footer.length * s * 0.9 : 0;
  h += pad;
  if (opts.paper !== null) {
    ctx.fillStyle = opts.paper ?? '#fff';
    ctx.fillRect(x, y, w, h);
  }
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.strokeRect(x + s * 0.2, y + s * 0.2, w - s * 0.4, h - s * 0.4);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const iw = w - pad * 2;
  let cy = y + pad;
  ctx.font = font(s * 1.5, FONTS.archivoBlack);
  ctx.fillText(title, x + pad, cy, iw);
  cy += titleH;
  ctx.font = font(s * 0.78, FONTS.spaceMono, 400);
  ctx.fillText(sub, x + pad, cy, iw);
  cy += subH;
  ctx.fillRect(x + pad, cy, iw, s * 0.32);
  cy += ruleH;
  for (const r of rows) {
    if (r === '-') {
      ctx.fillRect(x + pad, cy + s * 0.1, iw, s * 0.24);
      cy += ruleH;
      continue;
    }
    const [label, value, bold] = r;
    ctx.textAlign = 'left';
    ctx.font = bold ? font(s * 0.9, FONTS.archivoBlack) : font(s * 0.9, FONTS.spaceMono, 400);
    ctx.fillText(label, x + pad, cy + s * 0.16, iw * 0.66);
    ctx.textAlign = 'right';
    ctx.font = font(s * 0.9, FONTS.spaceMono, 700);
    ctx.fillText(value, x + w - pad, cy + s * 0.16, iw * 0.4);
    ctx.fillRect(x + pad, cy + rowH - s * 0.06, iw, Math.max(1, s * 0.06));
    cy += rowH;
  }
  ctx.textAlign = 'left';
  ctx.font = font(s * 0.66, FONTS.spaceMono, 400);
  cy += s * 0.35;
  footer.forEach((l, i) => ctx.fillText(l, x + pad, cy + i * s * 0.9, iw));
  ctx.restore();
  return h;
}

// ---------------------------------------------------------------- colour

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function lighten(hex: string, t: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  const f = (v: number) => Math.round(v + (255 - v) * t);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function darken(hex: string, t: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  const f = (v: number) => Math.round(v * (1 - t));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---------------------------------------------------------------- stickers

export interface StickerStyle {
  /** White (or coloured) die-cut border width in design units. 0 = none. */
  border?: number;
  borderColor?: string;
  /** Base fill under the content. */
  fill?: string | CanvasGradient;
  /** Soft drop shadow strength 0..1 (0 = none). */
  shadow?: number;
  /** Mask values for the sticker area (paper/vinyl by default). */
  rough?: number;
  metal?: number;
  /** Holographic foil fill instead of `fill`. */
  holo?: boolean;
  /** Thin dark outline around the border (helps on light prints). */
  edge?: string;
}

/**
 * Die-cut sticker: soft shadow, white border following the shape, then `content`
 * clipped to the shape. Drawn at (x, y) rotated by `rot`; `shape` is in local units.
 * Also marks the sticker area as paper/vinyl on the Surface mask.
 */
export function sticker(
  surf: Surface | C2D,
  x: number,
  y: number,
  rot: number,
  shape: PathFn,
  st: StickerStyle,
  content?: (ctx: C2D) => void,
  bounds?: [number, number, number, number],
): void {
  const ctx = 'c' in surf ? surf.c : surf;
  const border = st.border ?? 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const outer = (c: C2D) => {
    c.beginPath();
    shape(c);
  };
  if (st.shadow && st.shadow > 0) {
    const k = st.shadow;
    withShadow(ctx, `rgba(0,0,0,${0.55 * k})`, 10 + 10 * k, 3 * k, 6 * k, () => {
      outer(ctx);
      ctx.fillStyle = st.borderColor ?? '#fff';
      ctx.fill();
      if (border > 0) {
        ctx.lineWidth = border * 2;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = st.borderColor ?? '#fff';
        ctx.stroke();
      }
    });
  }
  if (border > 0) {
    if (st.edge) {
      outer(ctx);
      ctx.lineWidth = border * 2 + 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = st.edge;
      ctx.stroke();
    }
    outer(ctx);
    ctx.lineWidth = border * 2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = st.borderColor ?? '#fff';
    ctx.stroke();
  }
  outer(ctx);
  ctx.fillStyle = st.fill ?? st.borderColor ?? '#fff';
  ctx.fill();
  if (st.holo) {
    const b = bounds ?? [-200, -200, 400, 400];
    holoFill(ctx, shape, b[0], b[1], b[2], b[3]);
  }
  if (content) {
    ctx.save();
    outer(ctx);
    ctx.clip();
    content(ctx);
    ctx.restore();
  }
  ctx.restore();

  if ('c' in surf && surf.mask) {
    const m = surf.mask.ctx;
    m.save();
    m.translate(x, y);
    m.rotate(rot);
    m.beginPath();
    shape(m);
    const col = maskColor(st.rough ?? 0.38, st.metal ?? (st.holo ? 0.9 : 0));
    m.fillStyle = col;
    m.fill();
    if (border > 0) {
      m.lineWidth = border * 2;
      m.lineJoin = 'round';
      m.strokeStyle = col;
      m.stroke();
    }
    m.restore();
  }
}
