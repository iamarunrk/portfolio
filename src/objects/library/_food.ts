import * as THREE from 'three';
import type { AtlasCell, StickerSheet } from '../textures';
import { lathe, parametric, type P2 } from '../geometry';
import { rng, type C2D } from '../paint';

/*
 * Shared bits for the fast-food shelf objects (pizza, burger, fries): smooth value
 * noise for lumpy food surfaces, vertex warps, a variable-radius sweep (drips, beads),
 * toothpicks and double-sided paper flags.
 */

/** Draw into a sticker-sheet cell with the origin at its centre. */
export function inCell(sheet: StickerSheet, cell: AtlasCell, fn: (c: C2D, w: number, h: number) => void): void {
  const c = sheet.surf.c;
  c.save();
  c.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  fn(c, cell.w, cell.h);
  c.restore();
}

export type Noise3 = (x: number, y: number, z: number) => number;

/** Deterministic smooth value noise in [-1, 1]. */
export function valueNoise3(seed: number): Noise3 {
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = r() * 2 - 1;
  const h = (x: number, y: number, z: number) => vals[perm[(perm[(perm[x & 255] + y) & 255] + z) & 255]];
  const f = (t: number) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const tx = f(x - xi);
    const ty = f(y - yi);
    const tz = f(z - zi);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const x0 = l(h(xi, yi, zi), h(xi + 1, yi, zi), tx);
    const x1 = l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), tx);
    const x2 = l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), tx);
    const x3 = l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), tx);
    return l(l(x0, x1, ty), l(x2, x3, ty), tz);
  };
}

/** Fractal sum of `n` octaves, roughly in [-1, 1]. */
export function fbm(n: Noise3, x: number, y: number, z: number, octaves = 3): number {
  let a = 0.5;
  let s = 0;
  let norm = 0;
  let k = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * n(x * k, y * k, z * k);
    norm += a;
    a *= 0.5;
    k *= 2.03;
  }
  return s / norm;
}

/** Move every vertex with `fn` (in place); recompute smooth normals afterwards. */
export function warp(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => void, normals = true): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    fn(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  if (normals) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Tube along a polyline with a radius per point (t = 0..1 along it). A radius of 0 at an
 * end closes it to a point, so `capped()` radii give round blobby tips (drips, beads).
 */
export function sweep(points: THREE.Vector3[], radius: (t: number) => number, radial = 10, uv: [number, number] = [0.5, 0.5]): THREE.BufferGeometry {
  const n = points.length;
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    tangents.push(b.clone().sub(a).normalize());
  }
  // parallel-transport frames
  const normals: THREE.Vector3[] = [];
  const t0 = tangents[0];
  const helper = Math.abs(t0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  let nrm = new THREE.Vector3().crossVectors(t0, helper).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = new THREE.Vector3().crossVectors(tangents[i - 1], tangents[i]);
      const s = axis.length();
      if (s > 1e-6) {
        const ang = Math.atan2(s, tangents[i - 1].dot(tangents[i]));
        nrm = nrm.clone().applyAxisAngle(axis.normalize(), ang);
      }
    }
    normals.push(nrm.clone());
  }
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const r = radius(t);
    const N = normals[i];
    const B = new THREE.Vector3().crossVectors(tangents[i], N).normalize();
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      tmp.copy(points[i]).addScaledVector(N, Math.cos(a) * r).addScaledVector(B, Math.sin(a) * r);
      pos.push(tmp.x, tmp.y, tmp.z);
      uvs.push(uv[0], uv[1]);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * row + k;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Radius profile with round caps: r0 in the middle, quarter-circle falloff over `cap` (fraction of length) at the chosen ends. */
export function capped(r0: number, cap: number, start = true, end = true, swell?: (t: number) => number): (t: number) => number {
  return (t) => {
    let k = 1;
    if (start && t < cap) k = Math.sqrt(Math.max(0, 1 - Math.pow(1 - t / cap, 2)));
    if (end && t > 1 - cap) k = Math.min(k, Math.sqrt(Math.max(0, 1 - Math.pow(1 - (1 - t) / cap, 2))));
    return r0 * k * (swell ? swell(t) : 1);
  };
}

/** Wooden pick along +Y from y = 0 to y = len, pointed at the bottom, blunt-rounded at the top. */
export function toothpick(len: number, r: number): THREE.BufferGeometry {
  const prof: P2[] = [
    [0, 0],
    [r * 0.35, len * 0.03],
    [r, len * 0.14],
    [r, len - r * 0.9],
    [r * 0.75, len - r * 0.25],
    [0, len],
  ];
  return lathe(prof, { segments: 12 });
}

/**
 * Double-sided paper flag. Hoist edge on the pole along +Y (x = 0, y in [-h/2, h/2]),
 * flying towards +X with a gentle wave in Z. Front faces +Z and shows `uvFront`;
 * the back shows `uvBack` reading correctly from behind. `fork` cuts a swallowtail.
 */
export function flag(
  w: number,
  h: number,
  uvFront: [number, number, number, number],
  uvBack: [number, number, number, number],
  opts: { wave?: number; fork?: number; phase?: number; thick?: number } = {},
): THREE.BufferGeometry {
  const wave = opts.wave ?? 0.12 * w;
  const fork = opts.fork ?? 0;
  const ph = opts.phase ?? 0.6;
  const th = opts.thick ?? 0.012 * w;
  const P = (s: number, t: number, out: THREE.Vector3, side: number) => {
    const xEnd = w - fork * (1 - Math.abs(2 * t - 1));
    const x = s * xEnd;
    const z = wave * Math.sin(s * Math.PI * 1.35 + ph) * Math.pow(s, 0.8) + wave * 0.25 * Math.sin(t * 3 + s * 2) * s;
    const y = (t - 0.5) * h + 0.04 * h * Math.sin(s * 3.1);
    return out.set(x, y, z + side * th * 0.5);
  };
  const lerpUV = (r: [number, number, number, number], u: number, v: number): [number, number] => [r[0] + u * (r[2] - r[0]), r[1] + v * (r[3] - r[1])];
  const front = parametric(24, 8, (u, v, out) => P(u, v, out, 1), { uv: (u, v) => lerpUV(uvFront, u, v) });
  const back = parametric(24, 8, (u, v, out) => P(u, 1 - v, out, -1), { uv: (u, v) => lerpUV(uvBack, 1 - u, 1 - v) });
  const g = mergeSimple([front, back]);
  front.dispose();
  back.dispose();
  return g;
}

/** Merge indexed geometries that all carry position / normal / uv. */
export function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** Orient a geometry built along +Y so that +Y points along `dir`, then move it to `at`. */
export function alongDir(g: THREE.BufferGeometry, at: THREE.Vector3, dir: THREE.Vector3, spin = 0): THREE.BufferGeometry {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const s = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin);
  g.applyQuaternion(s);
  g.applyQuaternion(q);
  g.translate(at.x, at.y, at.z);
  return g;
}

/** Instanced mesh from matrices (+ optional per-instance colours). */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], colors?: THREE.Color[]): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((mm, i) => m.setMatrixAt(i, mm));
  if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

/** Paper / card material settings shared by flags and wrappers. */
export const PAPER = { roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.3 } as const;

/** Light birch wood for picks. */
export function woodMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: '#e6c78f', roughness: 0.55, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color('#fff1d0'), sheenRoughness: 0.6 });
}
