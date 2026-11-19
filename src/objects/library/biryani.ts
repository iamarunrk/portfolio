import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { lathe, fillet, parametric, stickerPatch, surfaces, merge, type P2 } from '../geometry';
import { stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, rng, text, arcText, sticker, circlePath, rrPath, smallPrint, barcode, grain, hexA, type C2D } from '../paint';
import { fbm3, revolveSurface, arcLengths, colorize, instanced, alignY, inCell, type Instance } from './_desi';

/*
 * DUM BIRYANI: a hammered copper handi with a brass neck and a tinned lip, heaped with
 * long basmati grains in white, saffron and orange, crowned with a glossy masala leg
 * piece, a boiled egg half, a lemon wedge, star anise, mint and crispy onions. The
 * torn dough (dum) seal still clings to the rim. A deep-green seal sticker on the belly,
 * a pink "0 SHORTCUTS" sticker peeling off the side and a kraft tag hanging off the
 * handle. Units ~ cm, normalised afterwards.
 */

const BELLY_R = 5.0;
const MOUND_R = 3.74;
const MOUND_BASE = 5.86;
const MOUND_H = 2.65;

const RICE_WHITE = ['#fbf7ec', '#f7f0dd', '#f1e5c6'];
const RICE_YELLOW = ['#ffd650', '#ffc93a', '#f8bb2c'];
const RICE_ORANGE = ['#ff9d30', '#f8852a', '#ee6a22'];

const col = (h: string) => new THREE.Color(h);
const MEAT = col('#a8401a');
const MEAT_DARK = col('#5c1f0b');
const MEAT_HI = col('#d0611f');
const CHAR = col('#3a1407');
const BONE = col('#f2e7cf');
const BONE_BROWN = col('#b8834d');
const EGG_WHITE = col('#fbf7ef');
const EGG_STAIN = col('#f1c97a');
const EGG_FACE = col('#fdfaf3');
const EGG_RIM = col('#f3d391');
const YOLK = col('#ffcf3f');
const YOLK_DEEP = col('#ff9a12');
const RIND = col('#ffd927');
const RIND_TIP = col('#f2b60f');
const PULP = col('#fff2a6');
const PITH = col('#fffbe8');
const ANISE = col('#4e2412');
const ANISE_POD = col('#9b5a2a');
const DOUGH = col('#efd29a');
const DOUGH_BAKED = col('#c98a45');
const FLOUR = col('#fbf3e0');
const JUTE_A = col('#c9a062');
const JUTE_B = col('#a87f45');

// ------------------------------------------------------------------ shapes

/** Pot profile: bottom centre, belly, shoulder, neck, flared rolled lip, then down the tinned inner wall. */
function potProfile(): P2[] {
  const raw: P2[] = [
    [0, 0],
    [2.3, 0],
    [3.95, 0.42],
    [4.78, 1.45],
    [BELLY_R, 2.55],
    [4.82, 3.6],
    [4.18, 4.62],
    [3.74, 5.16],
    [3.76, 5.5],
    [4.02, 5.8],
    [4.26, 5.97],
    [4.14, 6.13],
    [3.86, 6.1],
    [3.7, 5.9],
    [3.6, 5.4],
    [3.5, 4.5],
  ];
  const radii = [0, 0.7, 1.0, 1.25, 1.7, 1.1, 0.7, 0.35, 0.25, 0.14, 0.08, 0.08, 0.08, 0.12, 0.2, 0];
  return fillet(raw, radii, 5);
}

/** Height of the rice heap at (x, z). */
function moundY(x: number, z: number): number {
  const t = Math.min(1, Math.hypot(x, z) / MOUND_R);
  const dome = Math.pow(Math.max(0, 1 - t * t), 0.62);
  const lump = (fbm3(x * 0.75 + 11, 0.3, z * 0.75 - 4, 5) - 0.5) * 0.75;
  return MOUND_BASE + MOUND_H * dome + lump * (0.25 + 0.75 * dome);
}

function moundNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.03;
  const dx = (moundY(x + e, z) - moundY(x - e, z)) / (2 * e);
  const dz = (moundY(x, z + e) - moundY(x, z - e)) / (2 * e);
  return out.set(-dx, 1, -dz).normalize();
}

function moundPoint(x: number, z: number, lift = 0): THREE.Vector3 {
  return new THREE.Vector3(x, moundY(x, z), z).addScaledVector(moundNormal(x, z), lift);
}

/** Masala-coated drumstick along local +Y: lumpy meat bulb (y 0..2.5) and the bone poking out. */
function drumstick(): THREE.BufferGeometry {
  const prof: P2[] = fillet(
    [
      [0.02, -0.04],
      [0.6, 0.08],
      [0.95, 0.5],
      [1.0, 1.0],
      [0.84, 1.55],
      [0.56, 2.0],
      [0.32, 2.36],
      [0.02, 2.5],
    ],
    [0, 0.3, 0.4, 0.5, 0.4, 0.3, 0.15, 0],
    6,
  );
  const s = arcLengths(prof);
  const total = s[s.length - 1];
  const sample = (v: number): P2 => {
    const target = v * total;
    let i = 1;
    while (i < prof.length - 1 && s[i] < target) i++;
    const t = (target - s[i - 1]) / (s[i] - s[i - 1] || 1);
    return [prof[i - 1][0] + (prof[i][0] - prof[i - 1][0]) * t, prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * t];
  };
  const meat = parametric(36, 28, (u, v, out) => {
    const [r, y] = sample(v);
    const phi = u * Math.PI * 2;
    const sx = Math.sin(phi);
    const cz = Math.cos(phi);
    const lump = (fbm3(sx * 1.6 + 3, y * 1.5, cz * 1.6, 41) - 0.5) * 0.36 * Math.min(1, r * 2.2);
    const rr = r + lump;
    out.set(sx * rr, y, cz * rr * 0.9);
  });
  colorize(meat, (p, _n, c) => {
    const f = fbm3(p.x * 2.2, p.y * 2.2 + 7, p.z * 2.2, 9);
    const g = fbm3(p.x * 5 + 1, p.y * 5, p.z * 5 - 2, 13);
    c.copy(MEAT);
    if (f > 0.58) c.lerp(MEAT_DARK, Math.min(1, (f - 0.58) * 4.5));
    else if (f < 0.42) c.lerp(MEAT_HI, Math.min(1, (0.42 - f) * 4));
    if (g > 0.68) c.lerp(CHAR, 0.7);
  });
  const bone = lathe(
    fillet(
      [
        [0.02, 2.2],
        [0.17, 2.26],
        [0.15, 2.95],
        [0.24, 3.12],
        [0.3, 3.28],
        [0.22, 3.44],
        [0.02, 3.48],
      ],
      [0, 0.05, 0.08, 0.1, 0.1, 0.1, 0],
      5,
    ),
    { segments: 20 },
  );
  colorize(bone, (p, _n, c) => c.copy(BONE).lerp(BONE_BROWN, THREE.MathUtils.clamp((2.75 - p.y) * 1.4, 0, 0.8)));
  return merge([meat, bone]);
}

/** Boiled egg cut lengthwise: white dome on +Z side, the cut face with a domed yolk facing -Z. */
function eggHalf(): THREE.BufferGeometry {
  const white = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI);
  white.scale(0.62, 0.86, 0.6);
  colorize(white, (p, _n, c) => c.copy(EGG_WHITE).lerp(EGG_STAIN, THREE.MathUtils.smoothstep(Math.abs(p.y), 0.55, 0.86) * 0.35));
  const face = new THREE.CircleGeometry(1, 40);
  face.scale(0.62, 0.86, 1);
  face.rotateY(Math.PI);
  colorize(face, (p, _n, c) => c.copy(EGG_FACE).lerp(EGG_RIM, THREE.MathUtils.smoothstep(Math.hypot(p.x / 0.62, p.y / 0.86), 0.82, 1) * 0.5));
  const yolk = new THREE.SphereGeometry(1, 22, 12, 0, Math.PI);
  yolk.scale(0.38, 0.46, 0.14);
  yolk.rotateY(Math.PI);
  yolk.translate(0, -0.04, -0.004);
  colorize(yolk, (p, _n, c) => c.copy(YOLK).lerp(YOLK_DEEP, THREE.MathUtils.smoothstep(Math.hypot(p.x / 0.38, p.y / 0.46), 0.2, 1) * 0.7));
  return merge([white, face, yolk]);
}

/** Lemon wedge along local +Y, rind facing +Z, pulp on the two cut faces. */
function lemonWedge(): THREE.BufferGeometry {
  const half = Math.PI / 5.5;
  const rind = new THREE.SphereGeometry(1, 16, 18, Math.PI / 2 - half, half * 2, 0.06, Math.PI - 0.12);
  rind.scale(0.95, 1.3, 0.95);
  colorize(rind, (p, _n, c) => c.copy(RIND).lerp(RIND_TIP, THREE.MathUtils.smoothstep(Math.abs(p.y), 0.7, 1.3) * 0.6));
  const faces: THREE.BufferGeometry[] = [];
  for (const sgn of [-1, 1]) {
    const sh = new THREE.Shape();
    const N = 24;
    sh.moveTo(0, -1.3 * Math.cos(0.06));
    for (let i = 0; i <= N; i++) {
      const th = 0.06 + (i / N) * (Math.PI - 0.12);
      sh.lineTo(0.95 * Math.sin(th), -1.3 * Math.cos(th));
    }
    sh.lineTo(0, 1.3 * Math.cos(0.06));
    const g = new THREE.ShapeGeometry(sh, 1);
    // shape plane (x = radial, y = up) -> rotate into the cut plane at phi = PI/2 +- half
    const phi = Math.PI / 2 + sgn * half;
    // radial direction of the sphere param at phi: (-cos phi, 0, sin phi)
    const radial = new THREE.Vector3(-Math.cos(phi), 0, Math.sin(phi));
    const m = new THREE.Matrix4().makeBasis(radial, new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(radial, new THREE.Vector3(0, 1, 0)));
    g.applyMatrix4(m);
    colorize(g, (p, _n, c) => {
      const rr = Math.hypot(p.x, p.z) / 0.95;
      const yy = Math.abs(p.y) / 1.3;
      const edge = Math.hypot(rr, yy);
      c.copy(PULP);
      const seg = Math.abs(Math.sin(p.y * 7.5));
      if (seg < 0.12) c.lerp(PITH, 0.7);
      if (rr < 0.12) c.copy(PITH);
      if (edge > 0.86) c.copy(PITH);
      if (edge > 0.95) c.copy(RIND);
    });
    faces.push(g);
  }
  return merge([rind, ...faces]);
}

/** Eight-pointed star anise, flat on the XZ plane. */
function starAnise(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const N = 8;
  for (let i = 0; i <= N * 8; i++) {
    const a = (i / (N * 8)) * Math.PI * 2;
    const k = Math.pow(Math.abs(Math.cos((a * N) / 2)), 3);
    const r = 0.16 + 0.42 * k;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) sh.moveTo(x, y);
    else sh.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -0.04);
  g.rotateX(-Math.PI / 2);
  colorize(g, (p, _n, c) => {
    const r = Math.hypot(p.x, p.z);
    c.copy(ANISE).lerp(ANISE_POD, THREE.MathUtils.smoothstep(r, 0.18, 0.4) * (p.y > 0.05 ? 0.8 : 0.3));
  });
  return g;
}

/** Torn dough (dum) seal: lumpy arcs sitting on the lip. */
function doughSeal(): THREE.BufferGeometry {
  const arcs: [number, number][] = [
    [-168, -52],
    [-36, 74],
    [92, 178],
  ];
  const parts = arcs.map(([a0d, a1d], k) =>
    parametric(54, 10, (u, v, out) => {
      const a = (a0d + (a1d - a0d) * u) * DEG;
      const taper = Math.pow(Math.min(1, Math.min(u, 1 - u) * 7), 0.55);
      const th = v * Math.PI * 2;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      const rr = 0.27 * taper * (0.78 + 0.45 * fbm3(sa * 4, ca * 4, k * 3.1, 17));
      const R = 3.98;
      const cx = R * sa;
      const cz = R * ca;
      const cy = 6.2 + 0.05 * Math.sin(a * 5 + k);
      out.set(cx + sa * Math.cos(th) * rr, cy + Math.sin(th) * rr * 0.78, cz + ca * Math.cos(th) * rr);
    }),
  );
  const g = merge(parts);
  colorize(g, (p, n, c) => {
    const f = fbm3(p.x * 3, p.y * 3, p.z * 3, 23);
    c.copy(DOUGH);
    if (n.y > 0.2) c.lerp(DOUGH_BAKED, THREE.MathUtils.smoothstep(f, 0.45, 0.75) * 0.9);
    if (f < 0.32) c.lerp(FLOUR, 0.6);
  });
  return g;
}

/** Leaf strip along +X (length 1), fold along the midrib, tip curling up. UVs into `uv` rect. */
function leafGeometry(uv: [number, number, number, number]): THREE.BufferGeometry {
  return parametric(
    10,
    6,
    (u, v, out) => {
      const w = 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.8) * (1 - 0.25 * u);
      const across = (v - 0.5) * 2;
      out.set(u - 0.5, Math.abs(across) * w * 0.28 + 0.18 * u * u, across * w);
    },
    { uv: (u, v) => [uv[0] + u * (uv[2] - uv[0]), uv[1] + v * (uv[3] - uv[1])] },
  );
}

/** Brass D-loop handle on side `sgn` (+1 = +X). */
function loopCurve(sgn: number): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(sgn * 3.92, 4.8, 0),
    new THREE.Vector3(sgn * 4.7, 4.92, 0),
    new THREE.Vector3(sgn * 5.42, 4.46, 0),
    new THREE.Vector3(sgn * 5.62, 3.8, 0),
    new THREE.Vector3(sgn * 5.36, 3.22, 0),
    new THREE.Vector3(sgn * 4.68, 3.0, 0),
  ]);
}

// ------------------------------------------------------------------ textures

function paintPot(s: Surface, prof: P2[]): void {
  const S = arcLengths(prof);
  const total = S[S.length - 1];
  let iTop = 0;
  prof.forEach((p, i) => {
    if (p[1] > prof[iTop][1]) iTop = i;
  });
  const sOuter = (y: number): number => {
    for (let i = 1; i <= iTop; i++) {
      const y0 = prof[i - 1][1];
      const y1 = prof[i][1];
      if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) return S[i - 1] + ((y - y0) / (y1 - y0)) * (S[i] - S[i - 1]);
    }
    return y <= 0 ? 0 : S[iTop];
  };
  const W = s.w;
  const H = s.h;
  const row = (sv: number) => (1 - sv / total) * H;
  const c = s.c;

  // copper body
  const g = c.createLinearGradient(0, row(0), 0, row(S[iTop]));
  g.addColorStop(0, '#7d4636');
  g.addColorStop(0.12, '#a8573a');
  g.addColorStop(0.3, '#d9804f');
  g.addColorStop(0.5, '#e8956a');
  g.addColorStop(0.7, '#d27a4a');
  g.addColorStop(1, '#c46c40');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // heat tint near the base: purple-blue oxide bloom
  const r = rng(5);
  for (let i = 0; i < 26; i++) {
    const x = r() * W;
    const y = row(sOuter(0.2 + r() * 1.1));
    const rad = 60 + r() * 120;
    for (const ox of [0, -W, W]) {
      const rg = c.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
      rg.addColorStop(0, hexA(r() > 0.5 ? '#6a4a8a' : '#3f3f7a', 0.28));
      rg.addColorStop(1, hexA('#6a4a8a', 0));
      c.fillStyle = rg;
      c.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
    }
  }
  // brass neck + lip
  const yNeck = row(sOuter(5.02));
  const bg = c.createLinearGradient(0, yNeck, 0, row(S[iTop]));
  bg.addColorStop(0, '#d9a640');
  bg.addColorStop(0.6, '#f0c560');
  bg.addColorStop(1, '#e2b04a');
  c.fillStyle = bg;
  c.fillRect(0, row(S[iTop] + 0.02), W, yNeck - row(S[iTop] + 0.02));
  // tinned (silver) inner wall
  c.fillStyle = '#d4d6d8';
  c.fillRect(0, 0, W, row(S[iTop] + 0.06));
  c.fillStyle = 'rgba(0,0,0,0.12)';
  c.fillRect(0, yNeck - 3, W, 4);

  // engraved band on the shoulder: grooves, leaf motifs and a line of text at the back
  const yA = row(sOuter(4.45));
  const yB = row(sOuter(3.85));
  const engrave = (k: C2D, col: string, lw: number) => {
    k.save();
    k.strokeStyle = col;
    k.fillStyle = col;
    k.lineWidth = lw;
    k.lineCap = 'round';
    for (const yy of [yA, yB]) {
      k.beginPath();
      k.moveTo(0, yy);
      k.lineTo(W, yy);
      k.stroke();
    }
    const mid = (yA + yB) / 2;
    const hh = (yB - yA) * 0.36;
    for (let x = 0; x < W; x += 64) {
      const back = x < W * 0.22 || x > W * 0.78;
      if (back) continue;
      k.beginPath();
      k.moveTo(x, mid - hh);
      k.quadraticCurveTo(x + 22, mid, x, mid + hh);
      k.quadraticCurveTo(x - 22, mid, x, mid - hh);
      k.stroke();
      k.beginPath();
      k.arc(x + 32, mid, 4, 0, Math.PI * 2);
      k.fill();
    }
    k.font = `400 ${Math.round((yB - yA) * 0.5)}px ${FONTS.archivoBlack}`;
    k.textAlign = 'center';
    k.textBaseline = 'middle';
    for (const xx of [0, W]) k.fillText('ZEROS KITCHEN · DEPLOYED ON DUM · SINCE ONCE UPON A TIME', xx, mid + 1, W * 0.42);
    k.restore();
  };
  engrave(c, 'rgba(90,35,15,0.55)', 3);

  // maker's stamp on the flat base: one text line in the texture wraps into a ring of radius ~1.4
  const stamp = (k: C2D, col: string) => {
    const ring = 1.4;
    const yy = row(ring);
    const stretch = BELLY_R / ring;
    k.save();
    k.translate(W / 2, yy);
    k.scale(stretch, 1);
    k.font = `400 ${Math.round(H * 0.026)}px ${FONTS.archivoBlack}`;
    k.fillStyle = col;
    k.textAlign = 'center';
    k.textBaseline = 'middle';
    k.fillText('HANDMADE BY ZEROS KITCHEN · PURE COPPER · TINNED WITH LOVE ·', 0, 0, W / stretch - 20);
    k.restore();
  };
  stamp(c, 'rgba(70,30,20,0.6)');

  // hammered dimples: a little colour sparkle + depressions in the bump layer
  const yTop = row(sOuter(4.98));
  const yBot = row(sOuter(0.35));
  const rd = rng(17);
  const dimples: [number, number, number][] = [];
  const step = 24;
  for (let y = yTop; y < yBot; y += step * 0.86) {
    const off = (Math.round(y / step) % 2) * step * 0.5;
    for (let x = off; x < W; x += step) {
      const dx = x + (rd() - 0.5) * 9;
      const dy = y + (rd() - 0.5) * 7;
      if (dy > yA - 4 && dy < yB + 4) continue;
      dimples.push([dx, dy, 9 + rd() * 6]);
    }
  }
  for (const [x, y, rad] of dimples) {
    const tone = rd();
    c.fillStyle = tone > 0.5 ? 'rgba(255,220,190,0.09)' : 'rgba(90,30,10,0.08)';
    c.beginPath();
    c.ellipse(x, y, rad, rad * 0.9, 0, 0, Math.PI * 2);
    c.fill();
  }
  grain(c, 0, 0, W, H, 4000, 0.05, 2);

  // one pre-rendered dimple stamped everywhere (far cheaper than a gradient per dimple)
  const spr = document.createElement('canvas');
  spr.width = spr.height = 48;
  const sc = spr.getContext('2d')!;
  const sg = sc.createRadialGradient(24, 24, 0, 24, 24, 24);
  sg.addColorStop(0, 'rgba(70,70,70,0.75)');
  sg.addColorStop(0.7, 'rgba(110,110,110,0.35)');
  sg.addColorStop(1, 'rgba(128,128,128,0)');
  sc.fillStyle = sg;
  sc.fillRect(0, 0, 48, 48);
  s.bumpDraw((b) => {
    for (const [x, y, rad] of dimples) {
      for (const ox of x < rad ? [0, W] : x > W - rad ? [0, -W] : [0]) b.drawImage(spr, x + ox - rad, y - rad, rad * 2, rad * 2);
    }
    engrave(b, 'rgb(60,60,60)', 4);
    stamp(b, 'rgb(70,70,70)');
    // spun lines on the brass neck and lip
    b.strokeStyle = 'rgba(150,150,150,0.5)';
    b.lineWidth = 1.5;
    for (let y = row(S[iTop]); y < yNeck; y += 5) {
      b.beginPath();
      b.moveTo(0, y);
      b.lineTo(W, y);
      b.stroke();
    }
  });
}

function paintMound(s: Surface): void {
  const c = s.c;
  const W = s.w;
  c.fillStyle = '#e8d29e';
  c.fillRect(0, 0, W, W);
  const r = rng(77);
  const k = W / (2 * MOUND_R);
  c.lineWidth = 1.2;
  c.strokeStyle = 'rgba(120,80,20,0.35)';
  for (let i = 0; i < 2600; i++) {
    const px = r() * W;
    const py = r() * W;
    const x = (px / W - 0.5) * 2 * MOUND_R;
    const z = (py / W - 0.5) * 2 * MOUND_R;
    const col = grainColor(x, z, r);
    c.beginPath();
    c.ellipse(px, py, 0.25 * k, 0.075 * k, r() * Math.PI, 0, Math.PI * 2);
    c.fillStyle = col;
    c.fill();
    c.stroke();
  }
}

function grainColor(x: number, z: number, r: () => number): string {
  const f = fbm3(x * 0.32 + 3, 0.5, z * 0.32 - 1, 21);
  const pick = (a: string[]) => a[Math.floor(r() * a.length)];
  if (f > 0.6) return r() < 0.6 ? pick(RICE_ORANGE) : pick(RICE_YELLOW);
  if (f > 0.53) return r() < 0.7 ? pick(RICE_YELLOW) : pick(RICE_WHITE);
  return r() < 0.94 ? pick(RICE_WHITE) : pick(RICE_YELLOW);
}

function paintStickers(sheet: StickerSheet) {
  // hero seal
  const cSeal = sheet.alloc(440, 440);
  inCell(sheet, cSeal, (c) => {
    sticker(c, 0, 0, 0, circlePath(0, 0, 196), { border: 14, fill: '#0f5a3a', shadow: 0.7 }, (q) => {
      q.strokeStyle = '#f6cf63';
      q.lineWidth = 5;
      q.beginPath();
      q.arc(0, 0, 176, 0, Math.PI * 2);
      q.stroke();
      q.lineWidth = 2.5;
      q.beginPath();
      q.arc(0, 0, 122, 0, Math.PI * 2);
      q.stroke();
      arcText(q, 'SLOW-COOKED · WORTH THE WAIT', 0, 0, 146, -Math.PI / 2, { size: 24, family: FONTS.archivoBlack, color: '#f6cf63', tracking: 1.5 });
      arcText(q, 'ZEROS KITCHEN · EST. ONCE UPON A TIME', 0, 0, 158, Math.PI / 2, { size: 19, family: FONTS.spaceMono, weight: 700, color: '#bfe8cf', tracking: 0.5 }, true);
      // little handi pictogram with steam
      q.fillStyle = '#ffb21c';
      q.beginPath();
      q.moveTo(-34, -60);
      q.lineTo(34, -60);
      q.quadraticCurveTo(26, -52, 30, -46);
      q.bezierCurveTo(58, -36, 52, -6, 26, -2);
      q.lineTo(-26, -2);
      q.bezierCurveTo(-52, -6, -58, -36, -30, -46);
      q.quadraticCurveTo(-26, -52, -34, -60);
      q.fill();
      q.strokeStyle = '#ffb21c';
      q.lineWidth = 6;
      q.lineCap = 'round';
      for (const sx of [-16, 0, 16]) {
        q.beginPath();
        q.moveTo(sx, -70);
        q.bezierCurveTo(sx - 10, -82, sx + 10, -92, sx, -104);
        q.stroke();
      }
      text(q, 'DUM', 0, 66, { size: 92, family: FONTS.bagel, align: 'center', color: '#ffb21c', outlines: [{ color: '#062a1a', width: 12 }], extrude: { color: '#062a1a', dx: 0, dy: 6 } });
      text(q, 'BIRYANI', 0, 106, { size: 42, family: FONTS.archivoBlack, align: 'center', color: '#fff4dc', tracking: 3, maxWidth: 230 });
    });
  });
  // pink "0 SHORTCUTS" (peels)
  const cPink = sheet.alloc(420, 230);
  inCell(sheet, cPink, (c) => {
    sticker(c, 0, 0, 0, rrPath(-196, -100, 392, 200, 26), { border: 12, fill: '#ff4fb8', shadow: 0.6 }, (q) => {
      text(q, '0 SHORTCUTS', 0, -6, { size: 58, family: FONTS.archivoBlack, align: 'center', color: '#ffffff', maxWidth: 350, shadow: { color: 'rgba(120,0,60,0.35)', dx: 0, dy: 4, blur: 4 } });
      text(q, 'dum = done right', 0, 58, { size: 38, family: FONTS.marker, align: 'center', color: '#3a0024' });
    });
  });
  // lime Zeros stamp
  const cLime = sheet.alloc(230, 230);
  inCell(sheet, cLime, (c) => {
    sticker(c, 0, 0, 0, circlePath(0, 0, 100), { border: 10, fill: '#d7ff3a', shadow: 0.6 }, (q) => {
      q.strokeStyle = '#0b0b0d';
      q.lineWidth = 4;
      q.setLineDash([10, 8]);
      q.beginPath();
      q.arc(0, 0, 86, 0, Math.PI * 2);
      q.stroke();
      q.setLineDash([]);
      text(q, 'ZEROS', 0, 8, { size: 52, family: FONTS.bagel, align: 'center', color: '#0b0b0d' });
      text(q, 'SHIP IT HOT', 0, 44, { size: 20, family: FONTS.archivoBlack, align: 'center', color: '#0b0b0d', tracking: 1 });
    });
  });
  // kraft tag, both sides
  const tagShape = (q: C2D) => {
    q.moveTo(-90, -170);
    q.lineTo(90, -170);
    q.lineTo(130, -130);
    q.lineTo(130, 170);
    q.quadraticCurveTo(130, 180, 120, 180);
    q.lineTo(-120, 180);
    q.quadraticCurveTo(-130, 180, -130, 170);
    q.lineTo(-130, -130);
    q.closePath();
    q.moveTo(18, -130);
    q.arc(0, -130, 18, 0, Math.PI * 2, true);
  };
  const paper = (q: C2D, seed: number) => {
    q.fillStyle = '#d6ad74';
    q.fillRect(-140, -180, 280, 370);
    const rr = rng(seed);
    q.strokeStyle = 'rgba(120,80,30,0.18)';
    q.lineWidth = 1.2;
    for (let i = 0; i < 120; i++) {
      const x = -140 + rr() * 280;
      const y = -180 + rr() * 370;
      q.beginPath();
      q.moveTo(x, y);
      q.lineTo(x + (rr() - 0.5) * 30, y + (rr() - 0.5) * 8);
      q.stroke();
    }
    // reinforcement ring around the hole
    q.strokeStyle = '#f4ead6';
    q.lineWidth = 12;
    q.beginPath();
    q.arc(0, -130, 26, 0, Math.PI * 2);
    q.stroke();
  };
  const cTagF = sheet.alloc(290, 380);
  inCell(sheet, cTagF, (c) => {
    c.save();
    c.beginPath();
    tagShape(c);
    c.clip('evenodd');
    paper(c, 3);
    text(c, 'DEPLOY', 0, -46, { size: 56, family: FONTS.marker, align: 'center', color: '#3b1d08', maxWidth: 230 });
    text(c, 'ON DUM', 0, 10, { size: 56, family: FONTS.marker, align: 'center', color: '#3b1d08', maxWidth: 230 });
    c.strokeStyle = '#3b1d08';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(-96, 30);
    c.quadraticCurveTo(0, 44, 98, 26);
    c.stroke();
    smallPrint(c, ['ORDER  #0001', 'TABLE  founders', 'WHEN   friday, 1pm'], -104, 56, 21, '#3b1d08', { weight: 700 });
    // red ink stamp
    c.save();
    c.translate(74, 138);
    c.rotate(-16 * DEG);
    c.globalAlpha = 0.85;
    c.strokeStyle = '#d7262e';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(0, 0, 40, 0, Math.PI * 2);
    c.stroke();
    text(c, 'HOT', 0, 9, { size: 28, family: FONTS.archivoBlack, align: 'center', color: '#d7262e' });
    c.restore();
    c.restore();
  });
  const cTagB = sheet.alloc(290, 380);
  inCell(sheet, cTagB, (c) => {
    c.save();
    c.beginPath();
    tagShape(c);
    c.clip('evenodd');
    paper(c, 4);
    text(c, 'slow-cooked,', 0, -58, { size: 34, family: FONTS.marker, align: 'center', color: '#3b1d08', maxWidth: 230 });
    text(c, 'worth the wait', 0, -16, { size: 34, family: FONTS.marker, align: 'center', color: '#3b1d08', maxWidth: 230 });
    smallPrint(c, ['SERVES: the whole team', 'BEST BEFORE: ship date'], 0, 12, 18, '#3b1d08', { align: 'center', weight: 700 });
    barcode(c, -90, 74, 180, 84, 2024, { digits: '0 00001 10101 0', color: '#3b1d08' });
    c.restore();
  });
  // mint leaf texture
  const cLeaf = sheet.alloc(320, 170);
  inCell(sheet, cLeaf, (c, w, h) => {
    const L = w * 0.5;
    const outline = (q: C2D) => {
      q.beginPath();
      const N = 60;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const wd = (h * 0.5 - 6) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.8) * (1 - 0.25 * u);
        const serr = (i % 3 === 0 ? 1 : 0.9) * wd;
        const x = -L + u * w;
        if (i === 0) q.moveTo(x, -serr);
        else q.lineTo(x, -serr);
      }
      for (let i = N; i >= 0; i--) {
        const u = i / N;
        const wd = (h * 0.5 - 6) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.8) * (1 - 0.25 * u);
        const serr = (i % 3 === 0 ? 1 : 0.9) * wd;
        q.lineTo(-L + u * w, serr);
      }
      q.closePath();
    };
    const g = c.createLinearGradient(-L, 0, L, 0);
    g.addColorStop(0, '#2f9a3a');
    g.addColorStop(0.5, '#48c04e');
    g.addColorStop(1, '#2b8a33');
    outline(c);
    c.fillStyle = g;
    c.fill();
    c.save();
    outline(c);
    c.clip();
    c.strokeStyle = 'rgba(210,255,190,0.75)';
    c.lineWidth = 3.5;
    c.beginPath();
    c.moveTo(-L, 0);
    c.lineTo(L, 0);
    c.stroke();
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(200,255,180,0.45)';
    for (let i = 1; i < 7; i++) {
      const x = -L + (i / 7) * w;
      for (const sg of [-1, 1]) {
        c.beginPath();
        c.moveTo(x, 0);
        c.quadraticCurveTo(x + 18, sg * 18, x + 34, sg * 46);
        c.stroke();
      }
    }
    c.restore();
  });
  return { cSeal, cPink, cLime, cTagF, cTagB, cLeaf };
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  const prof = potProfile();

  // ---------- hammered copper handi (copper belly, brass neck, tinned lip)
  const S = arcLengths(prof);
  const total = S[S.length - 1];
  const TW = 2048;
  const TH = Math.round((TW * total) / (2 * Math.PI * BELLY_R));
  const potSurf = new Surface(TW, TH, bctx, { bump: { base: 0.5, density: 0.8 } });
  paintPot(potSurf, prof);
  const potMat = new THREE.MeshPhysicalMaterial({
    map: potSurf.colorTexture(),
    bumpMap: potSurf.bumpTexture(),
    bumpScale: 2.2,
    metalness: 1,
    roughness: 0.27,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
  });
  inner.add(new THREE.Mesh(lathe(prof, { segments: 96 }), potMat));

  // outer wall up to the neck, for stickers and the handle sockets
  let iNeck = 0;
  while (iNeck < prof.length - 1 && prof[iNeck][1] < 5.1) iNeck++;
  const wall = revolveSurface(prof.slice(0, iNeck + 1));

  // ---------- brass loop handles with rosette sockets
  const brassParts: THREE.BufferGeometry[] = [];
  for (const sgn of [-1, 1]) {
    const curve = loopCurve(sgn);
    brassParts.push(new THREE.TubeGeometry(curve, 48, 0.16, 12, false));
    for (const y of [4.8, 3.0]) {
      const b = wall.sAtY(y);
      const r0 = wall.at(0, b).p.z;
      const sp = wall.at((sgn * Math.PI * r0) / 2, b);
      const ros = new THREE.SphereGeometry(0.34, 18, 10);
      ros.scale(1, 1, 0.32);
      ros.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), sp.n));
      ros.translate(sp.p.x, sp.p.y, sp.p.z);
      brassParts.push(ros);
    }
  }
  const brassGeo = merge(brassParts);
  brassParts.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(brassGeo, new THREE.MeshPhysicalMaterial({ color: '#e8b851', metalness: 1, roughness: 0.22, clearcoat: 0.4, clearcoatRoughness: 0.1 })));

  // ---------- torn dough seal on the rim
  inner.add(new THREE.Mesh(doughSeal(), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.72, sheen: 0.6, sheenColor: new THREE.Color('#fff2d8'), sheenRoughness: 0.6 })));

  // ---------- rice heap: textured base dome + instanced basmati grains
  const moundSurf = new Surface(1024, 1024, bctx);
  paintMound(moundSurf);
  const moundGeo = parametric(
    72,
    26,
    (u, v, out) => {
      const phi = u * Math.PI * 2 - Math.PI;
      const rho = MOUND_R * (1 - v * 0.997);
      const x = Math.sin(phi) * rho;
      const z = Math.cos(phi) * rho;
      out.set(x, moundY(x, z) - 0.03, z);
    },
    {
      uv: (u, v) => {
        const phi = u * Math.PI * 2 - Math.PI;
        const rho = MOUND_R * (1 - v * 0.997);
        return [0.5 + (Math.sin(phi) * rho) / (2 * MOUND_R), 0.5 - (Math.cos(phi) * rho) / (2 * MOUND_R)];
      },
    },
  );
  inner.add(new THREE.Mesh(moundGeo, new THREE.MeshPhysicalMaterial({ map: moundSurf.colorTexture(), roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.4 })));

  const rnd = rng(1729);
  const grains: Instance[] = [];
  const tmpN = new THREE.Vector3();
  for (let i = 0; i < 1250; i++) {
    const rho = MOUND_R * 0.985 * Math.sqrt(rnd());
    const phi = rnd() * Math.PI * 2;
    const x = Math.sin(phi) * rho;
    const z = Math.cos(phi) * rho;
    const n = moundNormal(x, z, tmpN).clone();
    const ang = rnd() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    dir.addScaledVector(n, -dir.dot(n)).normalize().addScaledVector(n, (rnd() - 0.35) * 0.55).normalize();
    grains.push({
      p: new THREE.Vector3(x, moundY(x, z), z).addScaledVector(n, 0.03 + rnd() * 0.05),
      q: alignY(dir, rnd() * Math.PI),
      s: new THREE.Vector3(0.9 + rnd() * 0.25, 0.85 + rnd() * 0.35, 0.9 + rnd() * 0.25),
      c: grainColor(x, z, rnd),
    });
  }
  // a few grains spilled onto the lip and the dough
  for (let i = 0; i < 46; i++) {
    const phi = rnd() * Math.PI * 2;
    const rr = 3.82 + rnd() * 0.36;
    const p = new THREE.Vector3(Math.sin(phi) * rr, 6.2 + rnd() * 0.22, Math.cos(phi) * rr);
    const dir = new THREE.Vector3(Math.cos(phi + (rnd() - 0.5) * 1.6), (rnd() - 0.5) * 0.4, -Math.sin(phi + (rnd() - 0.5) * 1.6)).normalize();
    grains.push({ p, q: alignY(dir), s: new THREE.Vector3(1, 0.9 + rnd() * 0.3, 1), c: grainColor(p.x, p.z, rnd) });
  }
  const grainGeo = new THREE.CapsuleGeometry(0.074, 0.34, 2, 5, 1);
  const grainMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.4,
    clearcoat: 0.45,
    clearcoatRoughness: 0.22,
    sheen: 0.4,
    sheenColor: new THREE.Color('#fff4da'),
    emissive: '#2a1a06',
    emissiveIntensity: 0.25,
  });
  inner.add(instanced(grainGeo, grainMat, grains));

  // ---------- garnish: leg piece, egg, lemon, star anise (one glossy vertex-coloured mesh)
  const food: THREE.BufferGeometry[] = [];
  {
    const leg = drumstick();
    const dir = new THREE.Vector3(-0.9, 0.42, 0.2).normalize();
    leg.applyQuaternion(alignY(dir, 0.6));
    const bulb = moundPoint(0.15, 0.05, 0.5);
    const base = bulb.clone().addScaledVector(dir, -1.0);
    leg.translate(base.x, base.y, base.z);
    food.push(leg);
  }
  {
    const egg = eggHalf();
    egg.scale(1.22, 1.22, 1.22);
    const face = new THREE.Vector3(0.42, 0.72, 0.55).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), face);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(face, 1.2));
    egg.applyQuaternion(q);
    const p = moundPoint(1.5, 1.45, 0.3);
    egg.translate(p.x, p.y, p.z);
    food.push(egg);
  }
  {
    const lemon = lemonWedge();
    lemon.scale(0.85, 0.85, 0.85);
    const phi = -40 * DEG;
    const out = new THREE.Vector3(Math.sin(phi), 0.9, Math.cos(phi)).normalize();
    const along = new THREE.Vector3(Math.cos(phi), 0, -Math.sin(phi));
    const zAxis = out.clone().addScaledVector(along, -out.dot(along)).normalize();
    const yAxis = along.clone();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
    lemon.applyMatrix4(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    const R = 3.55;
    lemon.translate(Math.sin(phi) * R, 6.55, Math.cos(phi) * R);
    food.push(lemon);
  }
  for (const [x, z, spin] of [
    [1.1, -0.9, 0.3],
    [-1.75, 1.6, 1.1],
  ]) {
    const st = starAnise();
    const n = moundNormal(x, z);
    st.applyQuaternion(alignY(n, spin));
    const p = moundPoint(x, z, 0.06);
    st.translate(p.x, p.y, p.z);
    food.push(st);
  }
  const foodGeo = merge(food);
  food.forEach((g) => g.dispose());
  inner.add(
    new THREE.Mesh(
      foodGeo,
      new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.3, sheenColor: new THREE.Color('#ffd9b0') }),
    ),
  );

  // ---------- crispy fried onions (birista)
  const onionGeo = new THREE.TorusGeometry(0.17, 0.04, 4, 8, Math.PI * 1.2);
  const onions: Instance[] = [];
  const onionCols = ['#7a3a10', '#9a5016', '#5c290b', '#b4661f', '#8a4413'];
  for (let i = 0; i < 100; i++) {
    const rho = 3.3 * Math.pow(rnd(), 0.75);
    const phi = rnd() * Math.PI * 2;
    const x = Math.sin(phi) * rho;
    const z = Math.cos(phi) * rho;
    const n = moundNormal(x, z);
    const q = alignY(n, rnd() * Math.PI * 2).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + (rnd() - 0.5) * 0.8, 0, (rnd() - 0.5) * 0.6)));
    onions.push({ p: moundPoint(x, z, 0.08), q, s: 0.8 + rnd() * 0.6, c: onionCols[Math.floor(rnd() * onionCols.length)] });
  }
  inner.add(instanced(onionGeo, new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 }), onions));

  // ---------- stickers, tag and leaves (one atlas)
  const sheet = new StickerSheet(2048, 704, bctx, 12);
  const cells = paintStickers(sheet);
  const sheetTex = sheet.surf.colorTexture();

  const leafGeo = leafGeometry(cells.cLeaf.uv);
  const leaves: Instance[] = [];
  const leafSpots: [number, number, number, number][] = [
    [0.9, 0.75, 2.2, 1.0],
    [0.35, 1.35, 0.4, 0.9],
    [-1.3, 0.55, -0.6, 1.1],
    [0.55, -1.6, 1.4, 0.95],
    [-2.3, -0.6, 2.9, 0.85],
    [2.35, -0.25, -1.9, 0.9],
    [-0.2, 2.55, 0.9, 0.85],
    [2.2, 1.85, 2.6, 0.8],
    [-2.45, 1.95, -2.4, 0.8],
    [1.6, -2.4, 0.2, 0.8],
  ];
  for (const [x, z, ang, sc] of leafSpots) {
    const n = moundNormal(x, z);
    const q = alignY(n, ang).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.18)));
    leaves.push({ p: moundPoint(x, z, 0.12), q, s: sc * 1.15 });
  }
  const leafMat = new THREE.MeshPhysicalMaterial({
    map: sheetTex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.42,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
    sheen: 0.5,
    sheenColor: new THREE.Color('#c9ffb0'),
  });
  inner.add(instanced(leafGeo, leafMat, leaves));

  const patches: THREE.BufferGeometry[] = [];
  const cm = (cell: { w: number; h: number }, w: number) => (w * cell.h) / cell.w;
  patches.push(stickerPatch(wall.at, 1.35, wall.sAtY(3.25), 3.5, 3.5, -4 * DEG, cells.cSeal.uv, { nx: 20, ny: 20, offset: 0.025 }));
  patches.push(
    stickerPatch(wall.at, -2.05, wall.sAtY(1.2), 2.9, cm(cells.cPink, 2.9), 12 * DEG, cells.cPink.uv, {
      nx: 16,
      ny: 10,
      offset: 0.02,
      lift: (u, v) => 0.34 * Math.pow(THREE.MathUtils.smoothstep(u, 0.6, 1) * THREE.MathUtils.smoothstep(1 - v, 0.4, 1), 1.6),
    }),
  );
  patches.push(stickerPatch(wall.at, 5.35, wall.sAtY(3.6), 1.6, 1.6, -12 * DEG, cells.cLime.uv, { nx: 10, ny: 10, offset: 0.03 }));
  // the kraft tag hangs off the right handle on a jute twine
  const hole = new THREE.Vector3(5.86, 2.42, 0.62);
  const tagN = new THREE.Vector3(Math.sin(38 * DEG), 0.08, Math.cos(38 * DEG)).normalize();
  const tagUp = new THREE.Vector3(0, 1, 0).applyAxisAngle(tagN, -7 * DEG);
  tagUp.addScaledVector(tagN, -tagUp.dot(tagN)).normalize();
  const tagRight = new THREE.Vector3().crossVectors(tagUp, tagN).normalize();
  const TAG_W = 1.75;
  const tk = TAG_W / cells.cTagF.w;
  const TAG_H = cells.cTagF.h * tk;
  const tagCentre = hole.clone().addScaledVector(tagUp, -130 * tk);
  const front = surfaces.plane(tagCentre, tagRight, tagUp);
  const back = surfaces.plane(tagCentre, tagRight.clone().negate(), tagUp);
  const sway = (_u: number, v: number) => 0.06 * Math.pow(1 - v, 2);
  patches.push(stickerPatch(front, 0, 0, TAG_W, TAG_H, 0, cells.cTagF.uv, { nx: 6, ny: 8, offset: 0.006, lift: sway }));
  patches.push(stickerPatch(back, 0, 0, TAG_W, TAG_H, 0, cells.cTagB.uv, { nx: 6, ny: 8, offset: 0.006, lift: (u, v) => -sway(u, v) }));
  const stickersGeo = merge(patches);
  patches.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.48, clearcoat: 0.55 }), '#e9dcc4')));

  // jute twine: a loop round the handle and a strand down through the tag's hole
  const knot = loopCurve(1).getPoint(0.78);
  const tangent = loopCurve(1).getTangent(0.78);
  const twineParts: THREE.BufferGeometry[] = [];
  const loop = new THREE.TorusGeometry(0.24, 0.05, 6, 20);
  loop.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent));
  loop.translate(knot.x, knot.y, knot.z);
  twineParts.push(loop);
  const strand = new THREE.CatmullRomCurve3([
    knot.clone().add(new THREE.Vector3(0.1, -0.22, 0.05)),
    knot.clone().lerp(hole, 0.5).add(new THREE.Vector3(0.08, -0.05, 0.05)),
    hole.clone().addScaledVector(tagN, 0.06),
    hole.clone().addScaledVector(tagUp, -0.12),
    hole.clone().addScaledVector(tagN, -0.06),
  ]);
  twineParts.push(new THREE.TubeGeometry(strand, 32, 0.05, 6, false));
  const eye = new THREE.TorusGeometry(0.12, 0.035, 5, 14);
  eye.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tagRight));
  eye.translate(hole.x, hole.y, hole.z);
  twineParts.push(eye);
  const twineGeo = merge(twineParts);
  twineParts.forEach((g) => g.dispose());
  colorize(twineGeo, (p, _n, c) => {
    const k = Math.sin((p.x + p.y * 1.3 + p.z * 0.7) * 26);
    c.copy(k > 0 ? JUTE_A : JUTE_B);
  });
  inner.add(new THREE.Mesh(twineGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.85, sheen: 0.8, sheenColor: new THREE.Color('#f3dcae') })));

  return finish(inner, trash, undefined, 'dum-biryani');
}

export const biryani: LibraryDef = {
  kind: 'biryani',
  name: 'Dum Biryani',
  tagline: 'slow-cooked, worth the wait',
  category: 'food',
  defaultRotation: [0.42, -0.42, 0.05],
  build,
};
export default biryani;
