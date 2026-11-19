import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import { Surface, type StickerSheet, type AtlasCell } from '../textures';
import type { P2, SurfacePoint } from '../geometry';
import { rng, pxScale, type C2D } from '../paint';

/*
 * Shared helpers for the desi food shelf (biryani, chai, noodles): value noise for lumps
 * and colour variation, a sticker surface for lathed vessels, per-vertex tinting,
 * instancing and animated steam wisps.
 */

// ------------------------------------------------------------------ noise

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), sx), l(h(0, 1, 0), h(1, 1, 0), sx), sy),
    l(l(h(0, 0, 1), h(1, 0, 1), sx), l(h(0, 1, 1), h(1, 1, 1), sx), sy),
    sz,
  );
}

/** Fractal value noise, roughly in [0, 1] (mean 0.5). */
export function fbm3(x: number, y: number, z: number, seed = 0, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, y * f, z * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

// ------------------------------------------------------------------ sticker surface on a lathe

export interface RevolveSurface {
  /** a = arc length around the axis at the local radius (0 at +Z, + towards +X), b = arc length along the profile. */
  at: (a: number, b: number) => SurfacePoint;
  /** Total arc length of the profile. */
  length: number;
  /** Arc length at the first profile point reaching height y. */
  sAtY: (y: number) => number;
}

/**
 * Surface of revolution around +Y from an outer-wall profile (r, y) walked bottom to top
 * (outside on the right). Normals are interpolated between profile vertices so stickers
 * shade smoothly.
 */
export function revolveSurface(profile: P2[]): RevolveSurface {
  const n = profile.length;
  const s: number[] = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const segN: P2[] = [];
  for (let i = 1; i < n; i++) {
    const dr = profile[i][0] - profile[i - 1][0];
    const dy = profile[i][1] - profile[i - 1][1];
    const l = Math.hypot(dr, dy) || 1;
    segN.push([dy / l, -dr / l]);
  }
  const vN: P2[] = profile.map((_, i) => {
    const a = segN[Math.max(0, i - 1)];
    const b = segN[Math.min(segN.length - 1, i)];
    const x = a[0] + b[0];
    const y = a[1] + b[1];
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  });
  const total = s[n - 1];
  const at = (a: number, b: number): SurfacePoint => {
    const bb = THREE.MathUtils.clamp(b, 0, total);
    let i = 1;
    while (i < n - 1 && s[i] < bb) i++;
    const t = THREE.MathUtils.clamp((bb - s[i - 1]) / (s[i] - s[i - 1] || 1), 0, 1);
    const r = profile[i - 1][0] + (profile[i][0] - profile[i - 1][0]) * t;
    const y = profile[i - 1][1] + (profile[i][1] - profile[i - 1][1]) * t;
    const nr = vN[i - 1][0] + (vN[i][0] - vN[i - 1][0]) * t;
    const ny = vN[i - 1][1] + (vN[i][1] - vN[i - 1][1]) * t;
    const phi = a / Math.max(r, 1e-3);
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    return { p: new THREE.Vector3(r * sp, y, r * cp), n: new THREE.Vector3(nr * sp, ny, nr * cp).normalize() };
  };
  const sAtY = (y: number): number => {
    for (let i = 1; i < n; i++) {
      const y0 = profile[i - 1][1];
      const y1 = profile[i][1];
      if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) return s[i - 1] + ((y - y0) / (y1 - y0)) * (s[i] - s[i - 1]);
    }
    return y <= profile[0][1] ? 0 : total;
  };
  return { at, length: total, sAtY };
}

/** Cumulative arc length of a profile (for mapping lathe v to canvas rows). */
export function arcLengths(profile: P2[]): number[] {
  const s: number[] = [0];
  for (let i = 1; i < profile.length; i++) s.push(s[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  return s;
}

// ------------------------------------------------------------------ geometry utilities

/** Per-vertex colour from a function of position and normal (adds/overwrites `color`). */
export function colorize(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const nor = g.getAttribute('normal');
  const arr = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    nn.fromBufferAttribute(nor, i);
    fn(p, nn, c);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return g;
}

/** Push every vertex along its normal by `fn(p)` and recompute normals. */
export function displace(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const nor = g.getAttribute('normal');
  const p = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    nn.fromBufferAttribute(nor, i);
    p.addScaledVector(nn, fn(p));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export interface Instance {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  s: THREE.Vector3 | number;
  c?: THREE.ColorRepresentation;
}

export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Instance[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const sv = new THREE.Vector3();
  items.forEach((it, i) => {
    if (typeof it.s === 'number') sv.setScalar(it.s);
    else sv.copy(it.s);
    mesh.setMatrixAt(i, m.compose(it.p, it.q, sv));
    if (it.c !== undefined) mesh.setColorAt(i, col.set(it.c));
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Quaternion turning +Y onto `dir`, then spinning `spin` radians around it. */
export function alignY(dir: THREE.Vector3, spin = 0): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin));
}

/** Draw into a sticker-sheet cell with the origin at the cell centre. */
export function inCell(sheet: StickerSheet, cell: AtlasCell, fn: (c: C2D, w: number, h: number) => void): void {
  const c = sheet.surf.c;
  c.save();
  c.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  fn(c, cell.w, cell.h);
  c.restore();
}

// ------------------------------------------------------------------ steam

export interface SteamOptions {
  /** Centre of the steam's base. */
  base: THREE.Vector3;
  /** Radius of the area wisps rise from. */
  spread: number;
  height: number;
  width: number;
  count?: number;
  opacity?: number;
  seed?: number;
}

/**
 * Soft rising steam: crossed ribbons with a vertically scrolling wisp texture and a gentle
 * sway. Fades in at the bottom and out at the top through vertex alpha, so it also reads
 * as steam when time is frozen.
 */
export function steam(bctx: ObjectBuildContext, o: SteamOptions): { mesh: THREE.Mesh; update: (t: number) => void } {
  const r = rng(o.seed ?? 5);
  // seamless (vertically periodic) wisp texture
  const s = new Surface(128, 512, bctx, { transparent: true });
  const c = s.c;
  c.save();
  c.filter = `blur(${7 * pxScale(c)}px)`;
  c.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const x0 = 34 + r() * 60;
    const amp = 10 + r() * 16;
    const ph = r() * Math.PI * 2;
    const per = 1 + Math.floor(r() * 2);
    c.strokeStyle = `rgba(255,255,255,${0.5 + r() * 0.35})`;
    c.lineWidth = 10 + r() * 12;
    for (const oy of [-512, 0, 512]) {
      c.beginPath();
      for (let y = 0; y <= 512; y += 8) {
        const x = x0 + Math.sin((y / 512) * Math.PI * 2 * per + ph) * amp;
        if (y === 0) c.moveTo(x, y + oy);
        else c.lineTo(x, y + oy);
      }
      c.stroke();
    }
  }
  c.restore();
  const tex = s.colorTexture();
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapS = THREE.ClampToEdgeWrapping;

  const count = o.count ?? 3;
  const NY = 16;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const meta: { ph: number; amp: number; h: number }[] = [];
  for (let w = 0; w < count; w++) {
    const a = r() * Math.PI * 2;
    const rr = o.spread * Math.sqrt(r());
    const cx = o.base.x + Math.sin(a) * rr;
    const cz = o.base.z + Math.cos(a) * rr;
    const h = o.height * (0.7 + r() * 0.5);
    const ww = o.width * (0.7 + r() * 0.5);
    const ph = r() * Math.PI * 2;
    const u0 = r();
    for (let k = 0; k < 2; k++) {
      const ang = r() * Math.PI + (k * Math.PI) / 2;
      const dx = Math.cos(ang) * ww * 0.5;
      const dz = Math.sin(ang) * ww * 0.5;
      const start = pos.length / 3;
      for (let j = 0; j <= NY; j++) {
        const t = j / NY;
        const y = o.base.y + t * h;
        const spreadK = 0.6 + t * 0.9;
        const alpha = Math.pow(THREE.MathUtils.smoothstep(t, 0, 0.25), 1.2) * (1 - THREE.MathUtils.smoothstep(t, 0.55, 1));
        for (const side of [-1, 1]) {
          pos.push(cx + dx * side * spreadK, y, cz + dz * side * spreadK);
          uv.push(side < 0 ? 0 : 1, u0 + t * 0.9);
          col.push(1, 1, 1, alpha);
          meta.push({ ph, amp: 0.18 * o.width, h });
        }
      }
      for (let j = 0; j < NY; j++) {
        const a0 = start + j * 2;
        idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.Float32BufferAttribute(pos, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const base = Float32Array.from(pos);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: '#ffffff',
    vertexColors: true,
    transparent: true,
    opacity: o.opacity ?? 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 3;
  const update = (t: number) => {
    for (let i = 0; i < posAttr.count; i++) {
      const m = meta[i];
      const y = base[i * 3 + 1] - o.base.y;
      const k = Math.pow(Math.max(0, y) / m.h, 1.3);
      posAttr.setX(i, base[i * 3] + Math.sin(t * 1.1 + m.ph + y * 1.7) * m.amp * k);
      posAttr.setZ(i, base[i * 3 + 2] + Math.cos(t * 0.9 + m.ph * 1.3 + y * 1.3) * m.amp * 0.7 * k);
    }
    posAttr.needsUpdate = true;
    tex.offset.y = -t * 0.08;
  };
  update(0);
  return { mesh, update };
}
