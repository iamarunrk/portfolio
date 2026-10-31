import * as THREE from 'three';
import type { StickerSheet, AtlasCell } from '../textures';
import { parametric, type SurfacePoint } from '../geometry';
import type { C2D } from '../paint';

/*
 * Helpers shared by the "computers" shelf objects (imac, camera, desktop):
 * superellipse discs that hug a height field, numeric-normal surfaces for
 * stickerPatch, bezel rings, CRT screen finishing and translucent plastics.
 */

/** sign(x) * |x|^p */
export function sgnpow(x: number, p: number): number {
  return Math.sign(x) * Math.pow(Math.abs(x), p);
}

/** Paint inside an atlas cell with the origin at the cell centre. */
export function inCell(sheet: StickerSheet, cell: AtlasCell, fn: (c: C2D) => void): void {
  const c = sheet.surf.c;
  c.save();
  c.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  fn(c);
  c.restore();
}

/**
 * Surface for stickerPatch from a point function in metric-ish parameters. The normal is
 * (dP/da x dP/db), so pick a and b so that a = sticker right and b = sticker up as seen
 * from outside.
 */
export function numSurface(fn: (a: number, b: number, out: THREE.Vector3) => THREE.Vector3, e = 0.02): (a: number, b: number) => SurfacePoint {
  const pa0 = new THREE.Vector3();
  const pa1 = new THREE.Vector3();
  const pb0 = new THREE.Vector3();
  const pb1 = new THREE.Vector3();
  return (a, b) => {
    const p = fn(a, b, new THREE.Vector3());
    fn(a - e, b, pa0);
    fn(a + e, b, pa1);
    fn(a, b - e, pb0);
    fn(a, b + e, pb1);
    const n = pa1.sub(pa0).cross(pb1.sub(pb0)).normalize();
    return { p, n };
  };
}

/**
 * Superellipse disc (a squircle / rounded rectangle when n is large) facing +Z, centred
 * at (cx, cy), hugging z = height(x, y). Polar grid (pole at the centre) with planar UVs
 * over the bounding rectangle, so a canvas painted for that rectangle maps straight on.
 */
export function superDisc(
  hw: number,
  hh: number,
  n: number,
  height: (x: number, y: number) => number,
  opts: { cx?: number; cy?: number; nr?: number; nphi?: number } = {},
): THREE.BufferGeometry {
  const cx = opts.cx ?? 0;
  const cy = opts.cy ?? 0;
  const e = 2 / n;
  return parametric(
    opts.nr ?? 10,
    opts.nphi ?? 72,
    (u, v, out) => {
      const phi = v * Math.PI * 2;
      const x = cx + u * hw * sgnpow(Math.cos(phi), e);
      const y = cy + u * hh * sgnpow(Math.sin(phi), e);
      out.set(x, y, height(x, y));
    },
    {
      uv: (u, v) => {
        const phi = v * Math.PI * 2;
        return [0.5 + 0.5 * u * sgnpow(Math.cos(phi), e), 0.5 + 0.5 * u * sgnpow(Math.sin(phi), e)];
      },
    },
  );
}

/** Rounded-rectangle ring (outer = inner + t), extruded towards +Z by `depth`, with a soft bevel. */
export function frameRing(w: number, h: number, r: number, t: number, depth: number, bevel = 0.015): THREE.BufferGeometry {
  const o = (x: number, y: number, ww: number, hh: number, rr: number, p: THREE.Shape | THREE.Path) => {
    p.moveTo(x + rr, y);
    p.lineTo(x + ww - rr, y);
    p.quadraticCurveTo(x + ww, y, x + ww, y + rr);
    p.lineTo(x + ww, y + hh - rr);
    p.quadraticCurveTo(x + ww, y + hh, x + ww - rr, y + hh);
    p.lineTo(x + rr, y + hh);
    p.quadraticCurveTo(x, y + hh, x, y + hh - rr);
    p.lineTo(x, y + rr);
    p.quadraticCurveTo(x, y, x + rr, y);
  };
  const outer = new THREE.Shape();
  o(-w / 2 - t, -h / 2 - t, w + 2 * t, h + 2 * t, r + t, outer);
  const hole = new THREE.Path();
  o(-w / 2, -h / 2, w, h, r, hole);
  outer.holes.push(hole);
  return new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
}

/** Rounded-rectangle Shape centred at the origin. */
export function rrShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

/** Scanlines + vignette + a soft top glare over a W x H CRT canvas (design units). */
export function crtFinish(c: C2D, W: number, H: number, lineGap = 4, lineAlpha = 0.18): void {
  c.save();
  c.fillStyle = `rgba(0,0,0,${lineAlpha})`;
  for (let y = 0; y < H; y += lineGap) c.fillRect(0, y, W, lineGap / 2);
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  const g = c.createLinearGradient(0, 0, 0, H * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(W * 0.42, H * 0.08, W * 0.55, H * 0.32, -0.08, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Translucent / frosted plastic tuned for the studio IBL (see terminal.ts shellMat). */
export function translucentPlastic(
  color: THREE.ColorRepresentation,
  p: THREE.MeshPhysicalMaterialParameters & { glow?: THREE.ColorRepresentation; glowIntensity?: number } = {},
): THREE.MeshPhysicalMaterial {
  const { glow, glowIntensity, ...rest } = p;
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.26,
    transmission: 0.75,
    thickness: 2,
    ior: 1.47,
    attenuationColor: new THREE.Color(color),
    attenuationDistance: 20,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    emissive: glow ?? color,
    emissiveIntensity: glowIntensity ?? 0.12,
    ...rest,
  });
}

/** A cable as a tube through a smooth curve. */
export function cable(points: THREE.Vector3[], radius: number, segments = 64): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.TubeGeometry(curve, segments, radius, 10, false);
}

/** Classic six-stripe rainbow colours (top to bottom). */
export const RAINBOW = ['#61bb46', '#fdb827', '#f5821f', '#e03a3e', '#963d97', '#009ddc'];
