import * as THREE from 'three';
import type { ObjectBuildContext } from './types';

/** Long-side cap for every canvas texture (before ctx.textureScale). */
export const MAX_TEX = 2048;

export interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function makeLayer(w: number, h: number): Layer {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(w));
  canvas.height = Math.max(4, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

export interface SurfaceOptions {
  /** Pixel density of the colour layer relative to the design size (before textureScale). Default 1. */
  density?: number;
  /** Also allocate a roughness(G)/metalness(B) mask, initialised to these values. */
  mask?: { rough: number; metal: number; density?: number };
  /** Also allocate a bump map (grey 0..1), initialised to this height. */
  bump?: { base: number; density?: number };
  /** Start fully transparent instead of opaque black. */
  transparent?: boolean;
}

/**
 * A paintable texture in *design units*. Every layer is pre-scaled, so painting code
 * works in the same coordinate system whatever ctx.textureScale (and the 2048px cap)
 * do to the real pixel size. Layers:
 *  - color: sRGB albedo (+alpha)
 *  - mask: G = roughness, B = metalness (linear), for paper-vs-metal print areas
 *  - bump: grey height, for embossing, crimps and seams
 */
export class Surface {
  readonly w: number;
  readonly h: number;
  readonly color: Layer;
  readonly mask: Layer | null;
  readonly bump: Layer | null;
  private readonly bctx: ObjectBuildContext;

  constructor(w: number, h: number, bctx: ObjectBuildContext, opts: SurfaceOptions = {}) {
    this.w = w;
    this.h = h;
    this.bctx = bctx;
    const cap = MAX_TEX * bctx.textureScale;
    const scaleFor = (density: number) => Math.min(density * bctx.textureScale, cap / Math.max(w, h));
    const layer = (density: number): Layer => {
      const s = scaleFor(density);
      const l = makeLayer(w * s, h * s);
      l.ctx.setTransform(l.canvas.width / w, 0, 0, l.canvas.height / h, 0, 0);
      return l;
    };
    this.color = layer(opts.density ?? 1);
    if (!opts.transparent) {
      this.color.ctx.fillStyle = '#000';
      this.color.ctx.fillRect(0, 0, w, h);
    }
    this.mask = null;
    this.bump = null;
    if (opts.mask) {
      const m = layer(opts.mask.density ?? 0.5);
      m.ctx.fillStyle = maskColor(opts.mask.rough, opts.mask.metal);
      m.ctx.fillRect(0, 0, w, h);
      this.mask = m;
    }
    if (opts.bump) {
      const b = layer(opts.bump.density ?? 0.5);
      b.ctx.fillStyle = grey(opts.bump.base);
      b.ctx.fillRect(0, 0, w, h);
      this.bump = b;
    }
  }

  /** The colour context (design units). */
  get c(): CanvasRenderingContext2D {
    return this.color.ctx;
  }

  /** Run a drawing function on every allocated layer with layer-specific fill styles. */
  each(fn: (ctx: CanvasRenderingContext2D, layer: 'color' | 'mask' | 'bump') => void): void {
    fn(this.color.ctx, 'color');
    if (this.mask) fn(this.mask.ctx, 'mask');
    if (this.bump) fn(this.bump.ctx, 'bump');
  }

  /** Mark an area of the mask (roughness / metalness) with a path. */
  maskPath(path: (ctx: CanvasRenderingContext2D) => void, rough: number, metal: number, transform?: DOMMatrix2DInit): void {
    if (!this.mask) return;
    const ctx = this.mask.ctx;
    ctx.save();
    if (transform) ctx.transform(transform.a ?? 1, transform.b ?? 0, transform.c ?? 0, transform.d ?? 1, transform.e ?? 0, transform.f ?? 0);
    ctx.beginPath();
    path(ctx);
    ctx.fillStyle = maskColor(rough, metal);
    ctx.fill();
    ctx.restore();
  }

  /** Paint into the bump layer (design units). */
  bumpDraw(fn: (ctx: CanvasRenderingContext2D) => void): void {
    if (!this.bump) return;
    this.bump.ctx.save();
    fn(this.bump.ctx);
    this.bump.ctx.restore();
  }

  colorTexture(): THREE.CanvasTexture {
    return canvasTexture(this.color.canvas, this.bctx, true);
  }

  maskTexture(): THREE.CanvasTexture | null {
    return this.mask ? canvasTexture(this.mask.canvas, this.bctx, false) : null;
  }

  bumpTexture(): THREE.CanvasTexture | null {
    return this.bump ? canvasTexture(this.bump.canvas, this.bctx, false) : null;
  }
}

export function maskColor(rough: number, metal: number): string {
  const r = Math.round(THREE.MathUtils.clamp(rough, 0, 1) * 255);
  const m = Math.round(THREE.MathUtils.clamp(metal, 0, 1) * 255);
  return `rgb(0,${r},${m})`;
}

export function grey(v: number): string {
  const g = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
  return `rgb(${g},${g},${g})`;
}

/** CanvasTexture with the house settings: sRGB (for colour), max anisotropy, trilinear mipmaps. */
export function canvasTexture(canvas: HTMLCanvasElement, bctx: ObjectBuildContext, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = bctx.maxAnisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface AtlasCell {
  /** Top-left of the cell content area in design units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Texture-space rect [u0, v0, u1, v1] of the content area (v up, flipY applied). */
  uv: [number, number, number, number];
}

/**
 * Shelf-packed sticker sheet on a transparent Surface. Each cell gets `pad` design
 * units of breathing room for drop shadows and mip bleeding.
 */
export class StickerSheet {
  readonly surf: Surface;
  private cx = 0;
  private cy = 0;
  private rowH = 0;
  private readonly pad: number;

  constructor(w: number, h: number, bctx: ObjectBuildContext, pad = 28) {
    this.surf = new Surface(w, h, bctx, { transparent: true });
    this.pad = pad;
  }

  alloc(w: number, h: number): AtlasCell {
    const p = this.pad;
    if (this.cx + w + 2 * p > this.surf.w) {
      this.cx = 0;
      this.cy += this.rowH;
      this.rowH = 0;
    }
    if (this.cy + h + 2 * p > this.surf.h) {
      console.warn('[objects] sticker sheet overflow', w, h);
    }
    const x = this.cx + p;
    const y = this.cy + p;
    this.cx += w + 2 * p;
    this.rowH = Math.max(this.rowH, h + 2 * p);
    const W = this.surf.w;
    const H = this.surf.h;
    return { x, y, w, h, uv: [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H] };
  }
}
