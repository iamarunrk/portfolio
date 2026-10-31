import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AtlasCell, StickerSheet } from '../textures';
import { lathe, merge, place, tint } from '../geometry';
import type { C2D } from '../paint';

/*
 * Shared helpers for the translucent-tech shelf objects (cassette, handheld, hard drive):
 * smooth bevelled slabs, rounded-rect / circle paths, frosted and clear plastic presets,
 * cross-head screws and a few sticker-sheet conveniences.
 */

export type Corners = [number, number, number, number]; // tl, tr, br, bl

/** Append a rounded rectangle (centre cx, cy) to a Shape or Path. Corner radii [tl, tr, br, bl]. */
export function roundRect(p: THREE.Path, cx: number, cy: number, w: number, h: number, r: number | Corners): void {
  const rr = typeof r === 'number' ? [r, r, r, r] : r;
  const [tl, tr, br, bl] = rr.map((v) => Math.max(0, Math.min(v, w / 2 - 1e-4, h / 2 - 1e-4)));
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  p.moveTo(x0 + bl, y0);
  p.lineTo(x1 - br, y0);
  if (br > 0) p.absarc(x1 - br, y0 + br, br, -Math.PI / 2, 0, false);
  p.lineTo(x1, y1 - tr);
  if (tr > 0) p.absarc(x1 - tr, y1 - tr, tr, 0, Math.PI / 2, false);
  p.lineTo(x0 + tl, y1);
  if (tl > 0) p.absarc(x0 + tl, y1 - tl, tl, Math.PI / 2, Math.PI, false);
  p.lineTo(x0, y0 + bl);
  if (bl > 0) p.absarc(x0 + bl, y0 + bl, bl, Math.PI, Math.PI * 1.5, false);
}

export function roundRectShape(cx: number, cy: number, w: number, h: number, r: number | Corners): THREE.Shape {
  const s = new THREE.Shape();
  roundRect(s, cx, cy, w, h, r);
  return s;
}

export function roundRectPath(cx: number, cy: number, w: number, h: number, r: number | Corners): THREE.Path {
  const p = new THREE.Path();
  roundRect(p, cx, cy, w, h, r);
  return p;
}

export function circlePathShape(cx: number, cy: number, r: number): THREE.Path {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return p;
}

/**
 * Extrude a shape into a slab of total thickness `depth` (bevels included), centred on z = 0,
 * with soft rounded bevels and smooth shading everywhere (vertices welded, normals averaged).
 * The outline grows by `bevel`, so pass a shape inset by `bevel` from the wanted outer size.
 */
export function smoothSlab(shape: THREE.Shape, depth: number, bevel: number, opts: { bevelSegments?: number; curveSegments?: number; keepUV?: boolean } = {}): THREE.BufferGeometry {
  const core = Math.max(1e-4, depth - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: core,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: opts.bevelSegments ?? 4,
    curveSegments: opts.curveSegments ?? 14,
  });
  g.translate(0, 0, -core / 2);
  g.deleteAttribute('normal');
  if (!opts.keepUV) g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-5);
  g.dispose();
  m.computeVertexNormals();
  return m;
}

/** Plane in XY (facing +Z) whose UVs cover `uv` = [u0, v0, u1, v1] of an atlas. */
export function decalPlane(w: number, h: number, uv: [number, number, number, number], segX = 1, segY = 1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, segX, segY);
  const a = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  a.needsUpdate = true;
  return g;
}

/** Map a design-unit rect of a Surface (x, y, w, h; y down) to texture UVs [u0, v0, u1, v1]. */
export function rectUV(x: number, y: number, w: number, h: number, W: number, H: number): [number, number, number, number] {
  return [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];
}

/** Frosted / cloudy translucent plastic. `thickness` is in model units. */
export function frostedPlastic(color: THREE.ColorRepresentation, p: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.42,
    transmission: 0.94,
    thickness: 1.0,
    ior: 1.46,
    attenuationColor: new THREE.Color(color),
    attenuationDistance: 3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.28,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.05,
    ...p,
  });
}

/** Clear, glossy acrylic / polycarbonate. */
export function clearPlastic(color: THREE.ColorRepresentation = '#ffffff', p: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.05,
    transmission: 1,
    thickness: 0.5,
    ior: 1.49,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    ...p,
  });
}

/**
 * Cross-head (Phillips) screw head of radius r, axis +Z, sitting on z = 0. Vertex coloured:
 * `metal` on the dome, `slot` in the cross recess. Pair with a vertexColors chrome material.
 */
export function screwHead(r: number, metal = '#e8ebef', slot = '#2b2d31'): THREE.BufferGeometry {
  const dome = tint(
    lathe(
      [
        [0, 0],
        [r, 0],
        [r, r * 0.12],
        [r * 0.86, r * 0.36],
        [r * 0.5, r * 0.46],
        [0, r * 0.48],
      ],
      { segments: 20 },
    ),
    metal,
  );
  dome.rotateX(Math.PI / 2);
  const a = tint(place(new THREE.BoxGeometry(r * 1.2, r * 0.2, r * 0.2), [0, 0, r * 0.42]), slot);
  const b = tint(place(new THREE.BoxGeometry(r * 0.2, r * 1.2, r * 0.2), [0, 0, r * 0.42]), slot);
  const g = merge([dome, a, b]);
  [dome, a, b].forEach((q) => q.dispose());
  return g;
}

/** Orient a +Z-facing geometry so it faces `normal`, then move it to `pos`. */
export function orient(g: THREE.BufferGeometry, pos: THREE.Vector3, normal: THREE.Vector3, spin = 0): THREE.BufferGeometry {
  if (spin) g.rotateZ(spin);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal.x, normal.y, normal.z).normalize());
  g.applyQuaternion(q);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

/** Draw inside a sticker-sheet cell with the origin at the cell centre. */
export function inCell(sheet: StickerSheet, cell: AtlasCell, fn: (c: C2D) => void): void {
  const c = sheet.surf.c;
  c.save();
  c.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  fn(c);
  c.restore();
}

/** Smooth peel: lifts the corner nearest (u, v) = (cu, cv) by `amount`. */
export function peelLift(amount: number, cu = 1, cv = 1, reach = 0.45): (u: number, v: number) => number {
  return (u, v) => {
    const du = cu > 0.5 ? u : 1 - u;
    const dv = cv > 0.5 ? v : 1 - v;
    const k = THREE.MathUtils.smoothstep(du + dv, 2 - reach * 2, 2);
    return amount * k * k;
  };
}
