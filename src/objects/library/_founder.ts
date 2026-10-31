import * as THREE from 'three';
import { faceSpan, parametric, type BoxFaceInfo, type FaceName, type FaceRect, type SurfacePoint } from '../geometry';
import type { AtlasCell, StickerSheet } from '../textures';
import { rng, type C2D } from '../paint';

/*
 * Shared helpers for the founder-kit shelf objects (parcel, card reader, rocket).
 *
 * SoftBox: a rounded box evaluated analytically per face in metric face coordinates
 * (same face conventions and UV spans as RoundedBoxGeometry + atlasRoundedBox), with an
 * optional smooth deformation (pillowing, dents). Because every point is a function of
 * (face, x, y), stickers and tapes can follow the deformed surface exactly, and strips can
 * run across edges from one face onto the next.
 */

export type { FaceName };

interface Frame {
  n: THREE.Vector3;
  r: THREE.Vector3;
  u: THREE.Vector3;
}

/** Face frames: outward normal, "right" and "up" as seen when looking at the face (r x u = n). */
const FRAMES: Record<FaceName, Frame> = {
  pz: { n: new THREE.Vector3(0, 0, 1), r: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0) },
  nz: { n: new THREE.Vector3(0, 0, -1), r: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, 1, 0) },
  px: { n: new THREE.Vector3(1, 0, 0), r: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(0, 1, 0) },
  nx: { n: new THREE.Vector3(-1, 0, 0), r: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(0, 1, 0) },
  py: { n: new THREE.Vector3(0, 1, 0), r: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 0, -1) },
  ny: { n: new THREE.Vector3(0, -1, 0), r: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 0, 1) },
};

export const FACES: FaceName[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

const MAX_ANG = Math.PI / 2 - 1e-3;

export class SoftBox {
  readonly hw: number;
  readonly hh: number;
  readonly hd: number;
  readonly r: number;
  /** Metric UV span of every face (flat part + half of each bevel): [along right, along up]. */
  readonly dims: Record<FaceName, [number, number]>;
  private readonly deform?: (p: THREE.Vector3) => void;
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private readonly _c = new THREE.Vector3();
  private readonly _d = new THREE.Vector3();

  constructor(w: number, h: number, d: number, r: number, deform?: (p: THREE.Vector3) => void) {
    this.hw = w / 2;
    this.hh = h / 2;
    this.hd = d / 2;
    this.r = Math.min(r, w / 2, h / 2, d / 2) * 0.999;
    this.deform = deform;
    const dims = {} as Record<FaceName, [number, number]>;
    for (const f of FACES) {
      const F = FRAMES[f];
      dims[f] = [faceSpan(2 * this.half(F.r), this.r), faceSpan(2 * this.half(F.u), this.r)];
    }
    this.dims = dims;
  }

  /** Half extent of the box along an axis-aligned unit vector. */
  half(axis: THREE.Vector3): number {
    return Math.abs(axis.x) * this.hw + Math.abs(axis.y) * this.hh + Math.abs(axis.z) * this.hd;
  }

  /** Half length of the flat part of a face along its right / up axis. */
  flat(face: FaceName): [number, number] {
    const F = FRAMES[face];
    return [this.half(F.r) - this.r, this.half(F.u) - this.r];
  }

  private raw(face: FaceName, fx: number, fy: number, out: THREE.Vector3, nOut?: THREE.Vector3): THREE.Vector3 {
    const F = FRAMES[face];
    const r = this.r;
    const Lr = this.half(F.r) - r;
    const Lu = this.half(F.u) - r;
    const Ln = this.half(F.n) - r;
    let br = fx;
    let tr = 0;
    const ar = Math.abs(fx) - Lr;
    if (ar > 0) {
      br = Math.sign(fx) * Lr;
      tr = Math.sign(fx) * Math.tan(Math.min(ar / r, MAX_ANG));
    }
    let bu = fy;
    let tu = 0;
    const au = Math.abs(fy) - Lu;
    if (au > 0) {
      bu = Math.sign(fy) * Lu;
      tu = Math.sign(fy) * Math.tan(Math.min(au / r, MAX_ANG));
    }
    const len = Math.sqrt(tr * tr + tu * tu + 1);
    const dr = tr / len;
    const du = tu / len;
    const dn = 1 / len;
    out
      .set(0, 0, 0)
      .addScaledVector(F.r, br + r * dr)
      .addScaledVector(F.u, bu + r * du)
      .addScaledVector(F.n, Ln + r * dn);
    if (nOut) nOut.set(0, 0, 0).addScaledVector(F.r, dr).addScaledVector(F.u, du).addScaledVector(F.n, dn);
    return out;
  }

  /** Deformed position only. */
  pos(face: FaceName, fx: number, fy: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.raw(face, fx, fy, out);
    if (this.deform) this.deform(out);
    return out;
  }

  /** Deformed surface point and outward normal at face-local metric coordinates (origin = face centre). */
  point(face: FaceName, fx: number, fy: number): SurfacePoint {
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    this.raw(face, fx, fy, p, n);
    if (!this.deform) return { p, n };
    this.deform(p);
    const e = 1e-3;
    this.pos(face, fx - e, fy, this._a);
    this.pos(face, fx + e, fy, this._b);
    this.pos(face, fx, fy - e, this._c);
    this.pos(face, fx, fy + e, this._d);
    const du = this._b.sub(this._a);
    const dv = this._d.sub(this._c);
    const nn = du.cross(dv);
    if (nn.lengthSq() > 1e-18) {
      nn.normalize();
      if (nn.dot(n) < 0) nn.negate();
      n.copy(nn);
    }
    return { p, n };
  }

  /** Surface function for stickerPatch on one face. */
  at(face: FaceName): (a: number, b: number) => SurfacePoint {
    return (a, b) => this.point(face, a, b);
  }

  /**
   * Surface function that continues across an edge: past face A's right edge (dir 'right')
   * or top edge (dir 'up') it carries on into face B, which must share that edge with the
   * same orientation along it (e.g. pz -> py going up, px -> nz going right, nx -> pz going right).
   */
  wrapAt(A: FaceName, B: FaceName, dir: 'right' | 'up'): (a: number, b: number) => SurfacePoint {
    const [luA, lvA] = this.dims[A];
    const [luB, lvB] = this.dims[B];
    if (dir === 'up') return (a, b) => (b <= lvA / 2 ? this.point(A, a, b) : this.point(B, a, -lvB / 2 + (b - lvA / 2)));
    return (a, b) => (a <= luA / 2 ? this.point(A, a, b) : this.point(B, -luB / 2 + (a - luA / 2), b));
  }

  /** Face info for painting an atlas laid out with `rects` (same contract as atlasRoundedBox). */
  faceInfo(rects: Record<FaceName, FaceRect>): Record<FaceName, BoxFaceInfo> {
    const out = {} as Record<FaceName, BoxFaceInfo>;
    for (const f of FACES) {
      const [lu, lv] = this.dims[f];
      const r = rects[f];
      out[f] = { rect: r, lu, lv, k: r.w / lu, toPx: (x, y) => [r.x + (x / lu + 0.5) * r.w, r.y + (0.5 - y / lv) * r.h] };
    }
    return out;
  }

  /** Atlas rects for every face at `k` px per unit, packed in rows: [[faces...], [faces...]]. */
  packRects(k: number, rows: FaceName[][], gap = 24): Record<FaceName, FaceRect> {
    const rects = {} as Record<FaceName, FaceRect>;
    let y = gap / 2;
    for (const row of rows) {
      let x = gap / 2;
      let rh = 0;
      for (const f of row) {
        const [lu, lv] = this.dims[f];
        const w = Math.round(lu * k);
        const h = Math.round(lv * k);
        rects[f] = { x, y, w, h };
        x += w + gap;
        rh = Math.max(rh, h);
      }
      y += rh + gap;
    }
    return rects;
  }

  /** Mesh of the whole box with atlas UVs. `flat`/`bevel` = segments across the flat part / each half bevel. */
  geometry(rects: Record<FaceName, FaceRect>, atlasW: number, atlasH: number, opts: { flat?: number; bevel?: number } = {}): THREE.BufferGeometry {
    const flatSeg = opts.flat ?? 12;
    const bevSeg = opts.bevel ?? 4;
    const pos: number[] = [];
    const nor: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const samples = (span: number, L: number): number[] => {
      const out: number[] = [];
      const h = span / 2;
      for (let i = 0; i < bevSeg; i++) out.push(-h + ((h - L) * i) / bevSeg);
      for (let i = 0; i < flatSeg; i++) out.push(-L + (2 * L * i) / flatSeg);
      for (let i = 0; i <= bevSeg; i++) out.push(L + ((h - L) * i) / bevSeg);
      return out;
    };
    for (const f of FACES) {
      const [lu, lv] = this.dims[f];
      const [Lr, Lu] = this.flat(f);
      const xs = samples(lu, Lr);
      const ys = samples(lv, Lu);
      const rect = rects[f];
      const base = pos.length / 3;
      for (const y of ys) {
        for (const x of xs) {
          const sp = this.point(f, x, y);
          pos.push(sp.p.x, sp.p.y, sp.p.z);
          nor.push(sp.n.x, sp.n.y, sp.n.z);
          const px = rect.x + (x / lu + 0.5) * rect.w;
          const py = rect.y + (0.5 - y / lv) * rect.h;
          uvs.push(px / atlasW, 1 - py / atlasH);
        }
      }
      const nx = xs.length;
      for (let j = 0; j < ys.length - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const a = base + j * nx + i;
          const b = a + 1;
          const c = a + nx;
          const d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  }
}

export interface Leg {
  face: FaceName;
  from: [number, number];
  to: [number, number];
}

/**
 * A strip (tape, wrapped label) running along consecutive straight legs in face-local
 * coordinates, possibly across edges. u runs along the path (texture x), v across it
 * (texture y; +v is to the left of the direction of travel). `lift(s, t)` pushes the strip
 * off the surface (s = metric distance from the start, t = metric offset across).
 */
export function stripOnBox(
  box: SoftBox,
  legs: Leg[],
  width: number,
  uvRect: [number, number, number, number],
  opts: { perUnit?: number; nv?: number; offset?: number; lift?: (s: number, t: number, total: number) => number } = {},
): THREE.BufferGeometry {
  const lens = legs.map((l) => Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1]));
  const total = lens.reduce((a, b) => a + b, 0);
  const off = opts.offset ?? 0.004;
  const nu = Math.max(8, Math.ceil(total * (opts.perUnit ?? 60)));
  const nv = opts.nv ?? 3;
  const tmp = new THREE.Vector3();
  return parametric(
    nu,
    nv,
    (u, v, out) => {
      let s = u * total;
      let i = 0;
      while (i < legs.length - 1 && s > lens[i]) {
        s -= lens[i];
        i++;
      }
      const L = legs[i];
      const len = lens[i] || 1;
      const dx = (L.to[0] - L.from[0]) / len;
      const dy = (L.to[1] - L.from[1]) / len;
      const t = (v - 0.5) * width;
      const x = L.from[0] + dx * s - dy * t;
      const y = L.from[1] + dy * s + dx * t;
      const sp = box.point(L.face, x, y);
      const lift = opts.lift ? opts.lift(u * total, t, total) : 0;
      tmp.copy(sp.n).multiplyScalar(off + lift);
      out.copy(sp.p).add(tmp);
    },
    { uv: (u, v) => [uvRect[0] + u * (uvRect[2] - uvRect[0]), uvRect[1] + v * (uvRect[3] - uvRect[1])] },
  );
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
 * Rubber-stamp ink: draws `fn` (in the current transform) into an offscreen layer, knocks
 * random specks and streaks out of it, then multiplies it onto `c` at `alpha`.
 */
export function stampInk(c: C2D, x: number, y: number, w: number, h: number, seed: number, alpha: number, fn: (q: C2D) => void): void {
  const m = c.getTransform();
  const s = Math.hypot(m.a, m.b) || 1;
  const cw = Math.max(4, Math.ceil(w * s));
  const ch = Math.max(4, Math.ceil(h * s));
  const layer = document.createElement('canvas');
  layer.width = cw;
  layer.height = ch;
  const q = layer.getContext('2d');
  if (!q) return;
  q.setTransform(cw / w, 0, 0, ch / h, -x * (cw / w), -y * (ch / h));
  fn(q);
  // wear: specks + a few dry streaks
  const r = rng(seed);
  q.globalCompositeOperation = 'destination-out';
  const n = Math.round((w * h) / 160);
  for (const alpha of [0.3, 0.55, 0.8, 1]) {
    q.globalAlpha = alpha;
    q.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + r() * w;
      const py = y + r() * h;
      const rr = 0.4 + r() * 2.2;
      q.moveTo(px + rr, py);
      q.arc(px, py, rr, 0, Math.PI * 2);
    }
    q.fill();
  }
  q.globalAlpha = 0.35;
  for (let i = 0; i < 7; i++) {
    const py = y + r() * h;
    q.fillRect(x + r() * w * 0.3, py, w * (0.3 + r() * 0.6), 1 + r() * 2.5);
  }
  q.globalAlpha = 1;
  q.globalCompositeOperation = 'source-over';
  c.save();
  c.globalAlpha = alpha;
  c.globalCompositeOperation = 'multiply';
  c.drawImage(layer, x, y, w, h);
  c.restore();
}
