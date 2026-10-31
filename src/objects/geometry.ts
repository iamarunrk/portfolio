import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type P2 = [number, number];

/**
 * Resample a 2D polyline (r, y) to `n` points evenly spaced by arc length.
 * Points listed twice in a row are kept as hard creases.
 */
export function resample(points: P2[], n: number): P2[] {
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    segs.push(d);
    total += d;
  }
  const out: P2[] = [];
  let si = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (si < segs.length - 1 && acc + segs[si] < target) {
      acc += segs[si];
      si++;
    }
    const t = segs[si] > 0 ? (target - acc) / segs[si] : 0;
    const a = points[si];
    const b = points[si + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Smooth a corner polyline: replace each listed interior point by a quadratic fillet. */
export function fillet(points: P2[], radius: number | number[], steps = 6): P2[] {
  const out: P2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const r = Array.isArray(radius) ? radius[i] ?? 0 : radius;
    const p = points[i];
    if (r <= 0) {
      out.push(p);
      continue;
    }
    const a = points[i - 1];
    const b = points[i + 1];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, da * 0.5);
    const rb = Math.min(r, db * 0.5);
    const s: P2 = [p[0] + ((a[0] - p[0]) / da) * ra, p[1] + ((a[1] - p[1]) / da) * ra];
    const e: P2 = [p[0] + ((b[0] - p[0]) / db) * rb, p[1] + ((b[1] - p[1]) / db) * rb];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export interface LatheOptions {
  segments?: number;
  phiStart?: number;
  phiLength?: number;
  /** Radial modulation, e.g. knurling: returns extra radius for (phi, profileIndex, point). */
  radial?: (phi: number, j: number, p: P2) => number;
  /** v coordinate per profile point: 'arc' (by arc length, default) or 'y'. */
  vMode?: 'arc' | 'y';
  /** UV override, e.g. planar projection for lids. */
  uv?: (x: number, y: number, z: number, u: number, v: number) => [number, number];
}

/**
 * Lathe around +Y with arc-length v and analytic normals. Profile is (r, y) ordered
 * so that the outside is on the right-hand side when walking it (bottom to top on
 * an outer wall). Duplicate consecutive points make a hard crease. u = 0.5 faces +Z
 * when phiStart = -PI and phiLength = 2PI.
 */
export function lathe(profile: P2[], opts: LatheOptions = {}): THREE.BufferGeometry {
  const seg = opts.segments ?? 64;
  const phiStart = opts.phiStart ?? -Math.PI;
  const phiLen = opts.phiLength ?? Math.PI * 2;
  const n = profile.length;
  // profile normals (2D), creases where points repeat
  const nrm: P2[] = [];
  for (let j = 0; j < n; j++) {
    const p = profile[j];
    const prev = j > 0 ? profile[j - 1] : null;
    const next = j < n - 1 ? profile[j + 1] : null;
    const same = (a: P2 | null) => !!a && Math.abs(a[0] - p[0]) < 1e-9 && Math.abs(a[1] - p[1]) < 1e-9;
    let t: P2;
    if (next && !same(next) && prev && !same(prev)) {
      const t1 = norm2([p[0] - prev[0], p[1] - prev[1]]);
      const t2 = norm2([next[0] - p[0], next[1] - p[1]]);
      t = norm2([t1[0] + t2[0], t1[1] + t2[1]]);
    } else if (next && !same(next)) {
      t = norm2([next[0] - p[0], next[1] - p[1]]);
    } else if (prev && !same(prev)) {
      t = norm2([p[0] - prev[0], p[1] - prev[1]]);
    } else if (j > 0 && same(prev) && next) {
      t = norm2([next[0] - p[0], next[1] - p[1]]);
    } else {
      t = [0, 1];
    }
    nrm.push([t[1], -t[0]]);
  }
  // v by arc length
  const vs: number[] = [0];
  let total = 0;
  for (let j = 1; j < n; j++) {
    total += Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]);
    vs.push(total);
  }
  const yMin = Math.min(...profile.map((p) => p[1]));
  const yMax = Math.max(...profile.map((p) => p[1]));
  const vOf = (j: number) => (opts.vMode === 'y' ? (profile[j][1] - yMin) / (yMax - yMin || 1) : vs[j] / (total || 1));

  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const radial = opts.radial;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const phi = phiStart + u * phiLen;
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    for (let j = 0; j < n; j++) {
      const [r0, y] = profile[j];
      const r = r0 + (radial ? radial(phi, j, profile[j]) : 0);
      const x = r * s;
      const z = r * c;
      pos.push(x, y, z);
      nor.push(nrm[j][0] * s, nrm[j][1], nrm[j][0] * c);
      const v = vOf(j);
      if (opts.uv) uvs.push(...opts.uv(x, y, z, u, v));
      else uvs.push(u, v);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = (i + 1) * n + j;
      const c2 = i * n + j + 1;
      const d = (i + 1) * n + j + 1;
      const pa = profile[j];
      const pc = profile[j + 1];
      if (Math.abs(pa[0] - pc[0]) < 1e-9 && Math.abs(pa[1] - pc[1]) < 1e-9) continue; // crease (degenerate)
      if (pa[0] < 1e-9 && pc[0] < 1e-9) continue;
      idx.push(a, b, c2, b, d, c2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  if (radial) {
    // radial modulation changes the surface: recompute normals and weld the seam
    g.computeVertexNormals();
    if (Math.abs(phiLen - Math.PI * 2) < 1e-6) weldSeamNormals(g, n, seg);
  }
  return g;
}

function weldSeamNormals(g: THREE.BufferGeometry, n: number, seg: number): void {
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  for (let j = 0; j < n; j++) {
    const a = j;
    const b = seg * n + j;
    v.fromBufferAttribute(nor, a);
    w.fromBufferAttribute(nor, b);
    v.add(w).normalize();
    nor.setXYZ(a, v.x, v.y, v.z);
    nor.setXYZ(b, v.x, v.y, v.z);
  }
  nor.needsUpdate = true;
}

function norm2(v: P2): P2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/**
 * Parametric grid surface. `fn(u, v, out)` writes the position for u,v in [0,1].
 * Front faces follow dP/du x dP/dv. Normals by central differences.
 */
export function parametric(
  nu: number,
  nv: number,
  fn: (u: number, v: number, out: THREE.Vector3) => void,
  opts: { uv?: (u: number, v: number) => [number, number]; eps?: number } = {},
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const pu0 = new THREE.Vector3();
  const pu1 = new THREE.Vector3();
  const pv0 = new THREE.Vector3();
  const pv1 = new THREE.Vector3();
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const e = opts.eps ?? 1e-4;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      fn(u, v, p);
      pos.push(p.x, p.y, p.z);
      const ua = Math.max(0, u - e);
      const ub = Math.min(1, u + e);
      const va = Math.max(0, v - e);
      const vb = Math.min(1, v + e);
      fn(ua, v, pu0);
      fn(ub, v, pu1);
      fn(u, va, pv0);
      fn(u, vb, pv1);
      du.subVectors(pu1, pu0);
      dv.subVectors(pv1, pv0);
      du.cross(dv);
      if (du.lengthSq() < 1e-20) du.set(0, 0, 1);
      du.normalize();
      nor.push(du.x, du.y, du.z);
      if (opts.uv) uvs.push(...opts.uv(u, v));
      else uvs.push(u, v);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** A local frame on a surface: position + unit normal (+ optional tangent). */
export interface SurfacePoint {
  p: THREE.Vector3;
  n: THREE.Vector3;
}

/**
 * Sticker patch conforming to a surface. The sticker is a w x h rectangle centred at
 * (a0, b0) in the surface's *metric* parameter space, rotated by `rot`. `at(a, b)`
 * returns the surface point; the patch is pushed out by `offset` (+ `lift(s, t)` for
 * peeling corners; s,t in [0,1]). UVs map into `uvRect` [u0, v0, u1, v1].
 */
export function stickerPatch(
  at: (a: number, b: number) => SurfacePoint,
  a0: number,
  b0: number,
  w: number,
  h: number,
  rot: number,
  uvRect: [number, number, number, number],
  opts: { nx?: number; ny?: number; offset?: number; lift?: (s: number, t: number) => number } = {},
): THREE.BufferGeometry {
  const nx = opts.nx ?? 12;
  const ny = opts.ny ?? 12;
  const off = opts.offset ?? 0.004;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const tmp = new THREE.Vector3();
  return parametric(
    nx,
    ny,
    (u, v, out) => {
      const lx = (u - 0.5) * w;
      const ly = (v - 0.5) * h;
      const a = a0 + lx * c - ly * s;
      const b = b0 + lx * s + ly * c;
      const sp = at(a, b);
      const lift = opts.lift ? opts.lift(u, v) : 0;
      tmp.copy(sp.n).multiplyScalar(off + lift);
      out.copy(sp.p).add(tmp);
    },
    { uv: (u, v) => [uvRect[0] + u * (uvRect[2] - uvRect[0]), uvRect[1] + v * (uvRect[3] - uvRect[1])] },
  );
}

/** Surface helpers in metric parameters. */
export const surfaces = {
  /** Cylinder around Y: a = arc length (0 at +Z, positive towards +X), b = y. */
  cylinder:
    (r: number) =>
    (a: number, b: number): SurfacePoint => {
      const phi = a / r;
      const n = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
      return { p: n.clone().multiplyScalar(r).setY(b), n };
    },
  /** Plane with origin, right (a) and up (b) axes. */
  plane:
    (origin: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3) =>
    (a: number, b: number): SurfacePoint => {
      const n = new THREE.Vector3().crossVectors(right, up).normalize();
      return { p: origin.clone().addScaledVector(right, a).addScaledVector(up, b), n };
    },
};

/** Ribbon along a polyline: `side(i)` gives the half-width vector at point i, `n(i)` the offset normal. */
export function ribbon(
  pts: THREE.Vector3[],
  side: (i: number) => THREE.Vector3,
  opts: { uScale?: number; v0?: number; v1?: number } = {},
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  let len = 0;
  const v0 = opts.v0 ?? 0;
  const v1 = opts.v1 ?? 1;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    const sd = side(i);
    const l = pts[i].clone().sub(sd);
    const r = pts[i].clone().add(sd);
    pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
    const u = len * (opts.uScale ?? 1);
    uvs.push(u, v0, u, v1);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Merge geometries after making their attribute sets compatible (drops extras, adds uv). */
export function merge(geos: THREE.BufferGeometry[], keepGroups = false): THREE.BufferGeometry {
  const prepared = geos.map((g) => {
    if (!g.getAttribute('uv')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return g;
  });
  const anyIndexed = prepared.some((g) => g.index);
  const allIndexed = prepared.every((g) => g.index);
  const list = anyIndexed && !allIndexed ? prepared.map((g) => (g.index ? g.toNonIndexed() : g)) : prepared;
  // keep only the attributes common to all
  const names = ['position', 'normal', 'uv', 'color'].filter((nm) => list.every((g) => g.getAttribute(nm)));
  const cleaned = list.map((g) => {
    const c = new THREE.BufferGeometry();
    for (const nm of names) c.setAttribute(nm, g.getAttribute(nm));
    if (g.index) c.setIndex(g.index);
    return c;
  });
  const out = mergeGeometries(cleaned, keepGroups);
  if (!out) throw new Error('merge failed');
  return out;
}

/** Paint a constant vertex colour onto a geometry (adds/overwrites `color`). */
export function tint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return g;
}

/** Set every UV of a geometry to one point (for parts sharing an atlas material). */
export function flatUV(g: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    arr[i * 2] = u;
    arr[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(arr, 2));
  return g;
}

/** Apply a transform built from position / euler / scale. */
export function place(
  g: THREE.BufferGeometry,
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scl: [number, number, number] | number = 1,
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    typeof scl === 'number' ? new THREE.Vector3(scl, scl, scl) : new THREE.Vector3(...scl),
  );
  g.applyMatrix4(m);
  return g;
}

/**
 * Rounded box face atlas helper. RoundedBoxGeometry keeps one group per face
 * (+X, -X, +Y, -Y, +Z, -Z) and gives each face UVs 0..1 over its flat part plus half
 * of each bevel. `atlasRoundedBox` remaps every face into its own atlas rect so the
 * whole box is one draw call, and returns converters from face-local metric
 * coordinates (origin at the face centre, x right / y up as seen facing the face)
 * to atlas design pixels.
 */
export interface FaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type FaceName = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export const FACE_ORDER: FaceName[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export interface BoxFaceInfo {
  rect: FaceRect;
  /** Metric extent of the face's UV span (flat part + half bevels). */
  lu: number;
  lv: number;
  /** Map face-local metric (x right, y up) to atlas pixels. */
  toPx: (x: number, y: number) => [number, number];
  /** Pixels per metric unit. */
  k: number;
}

export function faceSpan(size: number, radius: number): number {
  return Math.max(size - 2 * radius, 0) + (Math.PI * radius) / 2;
}

export function boxFaceDims(w: number, h: number, d: number, r: number): Record<FaceName, [number, number]> {
  const W = faceSpan(w, r);
  const H = faceSpan(h, r);
  const D = faceSpan(d, r);
  return { px: [D, H], nx: [D, H], py: [W, D], ny: [W, D], pz: [W, H], nz: [W, H] };
}

export function atlasRoundedBox(
  geo: THREE.BufferGeometry,
  dims: Record<FaceName, [number, number]>,
  rects: Record<FaceName, FaceRect>,
  atlasW: number,
  atlasH: number,
): Record<FaceName, BoxFaceInfo> {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  geo.groups.forEach((grp, gi) => {
    const face = FACE_ORDER[grp.materialIndex ?? gi];
    const r = rects[face];
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const px = r.x + u * r.w;
      const py = r.y + (1 - v) * r.h;
      uv.setXY(i, px / atlasW, 1 - py / atlasH);
    }
  });
  uv.needsUpdate = true;
  geo.clearGroups();
  const out = {} as Record<FaceName, BoxFaceInfo>;
  for (const f of FACE_ORDER) {
    const [lu, lv] = dims[f];
    const r = rects[f];
    out[f] = {
      rect: r,
      lu,
      lv,
      k: r.w / lu,
      toPx: (x, y) => [r.x + (x / lu + 0.5) * r.w, r.y + (0.5 - y / lv) * r.h],
    };
  }
  return out;
}
