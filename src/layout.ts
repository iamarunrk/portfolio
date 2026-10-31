import * as THREE from 'three';
import type { ObjectKind } from './objects/types';
import type { TitleFrame } from './store';

/** Straight-on camera looking at the canvas plane (z = 0). A long-ish lens keeps the toys packshot-like. */
export const CAMERA_FOV = 30;
export const CAMERA_Z = 10;
/** Depth distance between stacked objects, so overlapping toys layer instead of intersecting. */
export const LAYER_GAP = 1.15;

export interface CanvasFrame {
  /** Half extents of the visible area on the z = 0 plane, in world units. */
  halfW: number;
  halfH: number;
  aspect: number;
  /** World radius of an object at scale 1 on the z = 0 plane. */
  unit: number;
  portrait: boolean;
  widthPx: number;
  heightPx: number;
}

const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));

export function computeFrame(widthPx: number, heightPx: number): CanvasFrame {
  const w = Math.max(1, widthPx);
  const h = Math.max(1, heightPx);
  const aspect = w / h;
  const halfH = CAMERA_Z * TAN_HALF_FOV;
  const halfW = halfH * aspect;
  const W = halfW * 2;
  const H = halfH * 2;
  const portrait = aspect < 0.9;
  // Object diameter: a fraction of the geometric mean of the frame, capped by the short side.
  const diameter = Math.min((portrait ? 0.235 : 0.2) * Math.sqrt(W * H), (portrait ? 0.36 : 0.3) * Math.min(W, H));
  return { halfW, halfH, aspect, unit: diameter / 2, portrait, widthPx: w, heightPx: h };
}

/** z of a layer slot, centred around 0. */
export function layerZ(rank: number, count: number): number {
  return (rank - (count - 1) / 2) * LAYER_GAP;
}

/** Factor that keeps an object at depth z the same on-screen size/position as on the z = 0 plane. */
export function depthFactor(z: number): number {
  return (CAMERA_Z - z) / CAMERA_Z;
}

export interface LayoutSlot {
  nx: number;
  ny: number;
  s: number;
  /** Extra rotation (radians, XYZ) on top of the object's default hero pose for this slot. */
  tilt?: [number, number, number];
}

/**
 * Composition around the headline. Landscape: corners + top centre; portrait: above & below the title.
 * `s` balances visual weight (flat bags read smaller than chunky cans at the same bounding sphere);
 * `tilt` adds a little yaw/roll so toys near the edges still face the viewer through the perspective camera.
 */
const LANDSCAPE: Record<ObjectKind, LayoutSlot> = {
  can: { nx: -0.75, ny: 0.4, s: 0.92, tilt: [0, 0.1, 0.1] },
  terminal: { nx: 0.04, ny: 0.62, s: 1.12 },
  pedal: { nx: 0.76, ny: 0.4, s: 1.0, tilt: [0, -0.42, -0.08] },
  jar: { nx: -0.67, ny: -0.5, s: 1.0, tilt: [0, 0.12, 0] },
  chips: { nx: 0.7, ny: -0.47, s: 1.2, tilt: [0, -0.1, 0.1] },
};

const PORTRAIT: Record<ObjectKind, LayoutSlot> = {
  can: { nx: -0.56, ny: 0.66, s: 0.9, tilt: [0, 0.08, 0.12] },
  terminal: { nx: 0.06, ny: 0.4, s: 1.08 },
  pedal: { nx: 0.58, ny: 0.72, s: 0.94, tilt: [0, -0.32, -0.1] },
  jar: { nx: -0.54, ny: -0.52, s: 0.98, tilt: [0, 0.1, 0] },
  chips: { nx: 0.55, ny: -0.6, s: 1.14, tilt: [0, -0.08, 0.1] },
};

export function defaultSlot(kind: ObjectKind, frame: CanvasFrame): LayoutSlot {
  return (frame.portrait ? PORTRAIT : LANDSCAPE)[kind];
}

export function defaultTitle(frame: CanvasFrame): TitleFrame {
  return frame.portrait ? { nx: 0, ny: -0.04, s: 1 } : { nx: 0, ny: 0.0, s: 1 };
}

/** Normalised canvas coords -> CSS pixels (origin top-left). */
export function toPx(nx: number, ny: number, frame: CanvasFrame): [number, number] {
  return [((nx + 1) / 2) * frame.widthPx, ((1 - ny) / 2) * frame.heightPx];
}

/** CSS pixels -> normalised canvas coords. */
export function fromPx(x: number, y: number, frame: CanvasFrame): [number, number] {
  return [(x / frame.widthPx) * 2 - 1, 1 - (y / frame.heightPx) * 2];
}
