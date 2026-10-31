import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { lathe, parametric, stickerPatch, type P2, type SurfacePoint } from '../geometry';
import { stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, rng, text, sticker, ellipsePath, fillPath, smallPrint, starPath, grain, type C2D } from '../paint';
import { valueNoise3, fbm, warp, sweep, capped, toothpick, flag, mergeSimple, inCell, woodMaterial } from './_food';

/*
 * PIZZA SLICE: one fat slice from Zeros Pizzeria. A puffy, blistered crust lip, a slight
 * droop and fold, melted mozzarella with browned blisters and drips over the cut edges,
 * cupped pepperoni with oil pools, basil, a produce-style sticker on the crust and a lime
 * toothpick flag. Modelled flat in centimetres (pizza centre = slice tip at the origin,
 * slice pointing to -Z, top facing +Y), then stood up so the toppings face +Z.
 */

const R = 13; // tip -> outer crust
const ALPHA = 24 * DEG; // half angle of the slice
const PHI0 = Math.PI - ALPHA;
const PHI_LEN = 2 * ALPHA;
const CR_C = R - 1.6; // crust bead centre (radius from the tip)
const CR_Y = 1.34;
const CR_RR = 1.6;
const CR_RY = 1.34;
const BODY_TOP = 1.0; // dough top under the cheese (hidden)
const TOP_Y = 1.1; // cheese level at the cut edges
const SAUCE0 = BODY_TOP - 0.34;
const SAUCE1 = BODY_TOP - 0.18;
const CHEESE_R = CR_C - 2.0; // the cheese sheet tucks under the crust slope here
const HW = R * Math.sin(ALPHA);
const ARC0 = -90 * DEG;
const ARC1 = 150 * DEG;
const DROOP = 1.15;
const FOLD = 0.75;

const PEPPERONI: { x: number; z: number; r: number; cup: number; rot: number }[] = [
  { x: 0.05, z: -3.35, r: 0.98, cup: 0.1, rot: 0.4 },
  { x: -1.2, z: -5.75, r: 1.08, cup: 0.26, rot: 1.9 },
  { x: 1.25, z: -5.95, r: 1.06, cup: 0.14, rot: 3.1 },
  { x: -1.75, z: -8.2, r: 1.12, cup: 0.3, rot: 0.9 },
  { x: 0.8, z: -8.45, r: 1.1, cup: 0.2, rot: 2.6 },
];
const BASIL: { x: number; z: number; rot: number; s: number }[] = [
  { x: -0.55, z: -4.35, rot: 0.75, s: 0.9 },
  { x: 2.35, z: -7.55, rot: -0.85, s: 0.95 },
];

// ------------------------------------------------------------------ profile

function norm2(v: P2): P2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

function bezier(a: P2, b: P2, c: P2, d: P2, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ]);
  }
  return out;
}

interface Profile {
  pts: P2[];
  /** Arc-length fractions where the crust arc starts and ends. */
  v0: number;
  v1: number;
}

/** Slice cross-section (r, y): along the bottom, round the crust bead, down the inner slope, back along the top. */
function sliceProfile(face: boolean): Profile {
  const pts: P2[] = [];
  for (let r = 0; r < CR_C - 0.2; r += 0.55) pts.push([r, 0]);
  const i0 = pts.length;
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const a = ARC0 + ((ARC1 - ARC0) * i) / N;
    pts.push([CR_C + CR_RR * Math.cos(a), CR_Y + CR_RY * Math.sin(a)]);
  }
  const i1 = pts.length - 1;
  const A = pts[i1];
  const tA = norm2([-CR_RR * Math.sin(ARC1), CR_RY * Math.cos(ARC1)]);
  const B: P2 = [CR_C - 2.75, BODY_TOP];
  const slope = bezier(A, [A[0] + tA[0] * 0.55, A[1] + tA[1] * 0.55], [B[0] + 0.55, B[1]], B, 16).slice(1);
  const level = face ? TOP_Y : BODY_TOP;
  let last = A;
  for (const p of slope) {
    if (face && p[1] <= TOP_Y) {
      const t = (last[1] - TOP_Y) / (last[1] - p[1]);
      pts.push([last[0] + (p[0] - last[0]) * t, TOP_Y]);
      break;
    }
    pts.push(p);
    last = p;
  }
  const rEnd = pts[pts.length - 1][0];
  for (let r = rEnd - 0.55; r > 0.01; r -= 0.55) pts.push([r, level]);
  pts.push([0, level]);
  // arc-length fractions
  let total = 0;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    acc.push(total);
  }
  return { pts, v0: acc[i0] / total, v1: acc[i1] / total };
}

// ------------------------------------------------------------------ deformation

const lumpNoise = valueNoise3(23);

/** Position-only crust lumpiness (identical on the lathe and the cut faces, so they stay sealed). */
function crustLumps(p: THREE.Vector3): void {
  const r = Math.hypot(p.x, p.z);
  if (r < CR_C - 2.9) return;
  const phi = Math.atan2(p.x, p.z);
  const dr = r - CR_C;
  const dy = p.y - CR_Y;
  const d = Math.hypot(dr / CR_RR, dy / CR_RY);
  const mask = THREE.MathUtils.smoothstep(r, CR_C - 2.9, CR_C - 1.6) * Math.min(1, d);
  if (mask <= 0) return;
  const l = Math.hypot(dr, dy) || 1;
  const n = fbm(lumpNoise, phi * 7.5, r * 0.6, p.y * 0.9, 3);
  const amt = mask * (0.2 * n + 0.07);
  const ur = (dr / l) * amt;
  p.x += (p.x / (r || 1)) * ur;
  p.z += (p.z / (r || 1)) * ur;
  p.y += (dy / l) * amt;
}

/** Droop towards the tip and a gentle NY fold (sides up). */
function bend(p: THREE.Vector3): void {
  const r = Math.hypot(p.x, p.z);
  const s = Math.min(1, r / R);
  const hw = Math.max(0.4, r * Math.sin(ALPHA));
  const lat = THREE.MathUtils.clamp(p.x / hw, -1.3, 1.3);
  p.y += -DROOP * Math.pow(1 - s, 2) + FOLD * s * lat * lat;
}

// ------------------------------------------------------------------ cheese

const cheeseNoise = valueNoise3(7);

function pepMask(x: number, z: number): number {
  let m = 0;
  for (const p of PEPPERONI) {
    const d = Math.hypot(x - p.x, z - p.z);
    m = Math.max(m, 1 - THREE.MathUtils.smoothstep(d, p.r - 0.15, p.r + 0.45));
  }
  return m;
}

function cheeseY(r: number, phi: number): number {
  const dEdge = Math.max(0, r * Math.sin(ALPHA - Math.abs(phi - Math.PI)));
  const fade = THREE.MathUtils.smoothstep(dEdge, 0, 0.8);
  const x = r * Math.sin(phi);
  const z = r * Math.cos(phi);
  const lump = Math.max(0, fbm(cheeseNoise, x * 0.5, 0.3, z * 0.5, 3) + 0.15) * 0.34 + Math.max(0, cheeseNoise(x * 1.6, 2.1, z * 1.6)) * 0.1 + Math.max(0, cheeseNoise(x * 3.4, 5.3, z * 3.4) - 0.2) * 0.07;
  const pm = pepMask(x, z);
  const nearCrust = THREE.MathUtils.smoothstep(r, CHEESE_R - 1.2, CHEESE_R) * 0.12;
  return TOP_Y + 0.006 + fade * (0.07 + lump * (1 - pm) + nearCrust);
}

/** Planar UV of the cheese print (x across, tip at the bottom of the canvas). */
function cheeseUV(x: number, z: number): [number, number] {
  return [THREE.MathUtils.clamp((x + HW) / (2 * HW), 0.002, 0.998), THREE.MathUtils.clamp(-z / R, 0.002, 0.998)];
}

function paintCheese(s: Surface): void {
  const c = s.c;
  const K = s.w / (2 * HW);
  const P = (x: number, z: number): [number, number] => [(x + HW) * K, (R + z) * K];
  const r = rng(91);
  c.fillStyle = '#f6d98d';
  c.fillRect(0, 0, s.w, s.h);
  // creamy and golden pools
  for (let i = 0; i < 90; i++) {
    const px = r() * s.w;
    const py = r() * s.h;
    const rad = (0.5 + r() * 1.5) * K;
    const g = c.createRadialGradient(px, py, 0, px, py, rad);
    const warm = r() > 0.55;
    g.addColorStop(0, warm ? 'rgba(238,176,74,0.42)' : 'rgba(255,248,222,0.7)');
    g.addColorStop(1, warm ? 'rgba(238,176,74,0)' : 'rgba(255,248,222,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(px, py, rad, 0, Math.PI * 2);
    c.fill();
  }
  // tomato sauce showing at the crust edge (wavy cheese boundary) and through a few gaps
  const sauce = '#c8381c';
  c.save();
  c.beginPath();
  const n2 = valueNoise3(5);
  for (let i = 0; i <= 120; i++) {
    const phi = PHI0 - 0.05 + ((PHI_LEN + 0.1) * i) / 120;
    const rb = CHEESE_R - 0.25 - 0.32 * (0.5 + 0.5 * n2(phi * 22, 0.5, 1.3)) - 0.2 * Math.max(0, n2(phi * 61, 4.1, 0.2));
    const [px, py] = P(rb * Math.sin(phi), rb * Math.cos(phi));
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  for (let i = 120; i >= 0; i--) {
    const phi = PHI0 - 0.05 + ((PHI_LEN + 0.1) * i) / 120;
    const rr = R + 1;
    const [px, py] = P(rr * Math.sin(phi), rr * Math.cos(phi));
    c.lineTo(px, py);
  }
  c.closePath();
  c.fillStyle = sauce;
  c.fill();
  c.restore();
  s.maskPath((m) => {
    for (let i = 0; i <= 60; i++) {
      const phi = PHI0 + (PHI_LEN * i) / 60;
      const [px, py] = P((CHEESE_R - 1.2) * Math.sin(phi), (CHEESE_R - 1.2) * Math.cos(phi));
      if (i === 0) m.moveTo(px, py);
      else m.lineTo(px, py);
    }
    m.lineTo(s.w, 0);
    m.lineTo(0, 0);
    m.closePath();
  }, 0.3, 0);
  for (let i = 0; i < 9; i++) {
    const rr = 2.2 + r() * 6.5;
    const phi = Math.PI + (r() - 0.5) * 1.6 * ALPHA;
    const [px, py] = P(rr * Math.sin(phi), rr * Math.cos(phi));
    const w = (0.18 + r() * 0.3) * K;
    c.save();
    c.translate(px, py);
    c.rotate(r() * Math.PI);
    fillPath(c, ellipsePath(0, 0, w * 1.6, w, 0), sauce);
    fillPath(c, ellipsePath(-w * 0.3, -w * 0.2, w * 0.7, w * 0.35, 0), 'rgba(255,140,90,0.45)');
    c.restore();
  }
  // orange grease halos around the pepperoni
  for (const p of PEPPERONI) {
    const [px, py] = P(p.x, p.z);
    const g = c.createRadialGradient(px, py, p.r * K * 0.85, px, py, p.r * K * 1.5);
    g.addColorStop(0, 'rgba(236,128,36,0.32)');
    g.addColorStop(1, 'rgba(236,128,36,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(px, py, p.r * K * 1.5, 0, Math.PI * 2);
    c.fill();
  }
  // browned blisters (more towards the crust), with a bump
  for (let i = 0; i < 64; i++) {
    const rr = 1.2 + Math.pow(r(), 0.7) * (CHEESE_R - 1.5);
    const phi = Math.PI + (r() - 0.5) * 1.85 * ALPHA;
    const x = rr * Math.sin(phi);
    const z = rr * Math.cos(phi);
    if (pepMask(x, z) > 0.2) continue;
    const [px, py] = P(x, z);
    const rad = (0.16 + r() * 0.48) * K;
    const sq = 0.6 + r() * 0.5;
    const rot = r() * Math.PI;
    const g = c.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, '#8f4a16');
    g.addColorStop(0.45, '#c9792f');
    g.addColorStop(0.8, 'rgba(232,170,80,0.85)');
    g.addColorStop(1, 'rgba(240,190,100,0)');
    c.save();
    c.translate(px, py);
    c.rotate(rot);
    c.scale(1, sq);
    c.translate(-px, -py);
    c.fillStyle = g;
    c.beginPath();
    c.arc(px, py, rad, 0, Math.PI * 2);
    c.fill();
    c.restore();
    s.bumpDraw((b) => {
      const gb = b.createRadialGradient(px, py, 0, px, py, rad * 1.1);
      gb.addColorStop(0, 'rgba(255,255,255,0.9)');
      gb.addColorStop(1, 'rgba(255,255,255,0)');
      b.fillStyle = gb;
      b.beginPath();
      b.arc(px, py, rad * 1.1, 0, Math.PI * 2);
      b.fill();
    });
  }
  // stringy streaks
  c.save();
  c.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const [px, py] = [r() * s.w, r() * s.h];
    c.strokeStyle = r() > 0.5 ? 'rgba(255,250,230,0.5)' : 'rgba(226,160,70,0.35)';
    c.lineWidth = (0.04 + r() * 0.08) * K;
    c.beginPath();
    c.moveTo(px, py);
    c.quadraticCurveTo(px + (r() - 0.5) * K * 1.6, py + (r() - 0.5) * K * 1.6, px + (r() - 0.5) * K * 2.4, py + (r() - 0.5) * K * 2.4);
    c.stroke();
  }
  c.restore();
  // oregano + chilli flakes
  for (let i = 0; i < 420; i++) {
    const [px, py] = [r() * s.w, r() * s.h];
    const sz = (0.03 + r() * 0.07) * K;
    c.fillStyle = r() > 0.85 ? '#c23a14' : r() > 0.4 ? '#41541c' : '#5f7428';
    c.save();
    c.translate(px, py);
    c.rotate(r() * Math.PI);
    c.fillRect(-sz, -sz * 0.45, sz * 2, sz * 0.9);
    c.restore();
  }
  // soft overall bump lumps
  s.bumpDraw((b) => {
    for (let i = 0; i < 60; i++) {
      const [px, py] = [r() * s.w, r() * s.h];
      const rad = (0.3 + r() * 0.9) * K;
      const gb = b.createRadialGradient(px, py, 0, px, py, rad);
      const v = r() > 0.5 ? 255 : 0;
      gb.addColorStop(0, `rgba(${v},${v},${v},0.25)`);
      gb.addColorStop(1, `rgba(${v},${v},${v},0)`);
      b.fillStyle = gb;
      b.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
  });
  grain(c, 0, 0, s.w, s.h, 5000, 0.05, 31);
  // melted 'goo' swatch for the drips (top-left corner lies outside the slice)
  c.fillStyle = '#f8cf63';
  c.fillRect(0, 0, s.w * 0.03, s.h * 0.03);
}

// ------------------------------------------------------------------ bread

const ATLAS_W = 1024;
const ATLAS_H = 2048;
const CRUST_H = 1536; // rows 0..1536: lathe (bottom, crust, slope)
const FACE_Y0 = 1600; // rows 1600..1856: cut-face cross-section
const FACE_H = 256;
const FACE_YMAX = 3.0;

function crustV(v: number, prof: Profile): number {
  // remap arc-length v so the crust bead gets most of the texture
  if (v < prof.v0) return 0.3 * (v / prof.v0);
  if (v < prof.v1) return 0.3 + 0.62 * ((v - prof.v0) / (prof.v1 - prof.v0));
  return 0.92 + 0.08 * ((v - prof.v1) / (1 - prof.v1));
}

function paintBread(s: Surface): void {
  const c = s.c;
  const r = rng(404);
  // --- underside (rows 0..461): pale bake with leopard spots
  const yB = CRUST_H * 0.3;
  const yC = CRUST_H * 0.92;
  const g0 = c.createLinearGradient(0, 0, 0, yB);
  g0.addColorStop(0, '#e9be76');
  g0.addColorStop(1, '#dca35a');
  c.fillStyle = g0;
  c.fillRect(0, 0, ATLAS_W, yB);
  for (let i = 0; i < 110; i++) {
    const px = r() * ATLAS_W;
    const py = Math.pow(r(), 0.7) * yB;
    const rad = 3 + r() * 12;
    const g = c.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(92,46,14,0.85)');
    g.addColorStop(1, 'rgba(120,64,22,0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(px, py, rad * 1.4, rad, r() * 3, 0, Math.PI * 2);
    c.fill();
  }
  // --- crust bead (rows 461..1413). Angle along the bead: -90 (underside) .. 150 (inner slope)
  const yOf = (deg: number) => yB + ((deg + 90) / 240) * (yC - yB);
  const g1 = c.createLinearGradient(0, yB, 0, yC);
  g1.addColorStop(0, '#e6b46c');
  g1.addColorStop((yOf(-20) - yB) / (yC - yB), '#dc9a4c');
  g1.addColorStop((yOf(40) - yB) / (yC - yB), '#c6742d');
  g1.addColorStop((yOf(85) - yB) / (yC - yB), '#a9541e');
  g1.addColorStop((yOf(128) - yB) / (yC - yB), '#cf8a3d');
  g1.addColorStop(1, '#e2a95e');
  c.fillStyle = g1;
  c.fillRect(0, yB, ATLAS_W, yC - yB);
  // mottling
  for (let i = 0; i < 160; i++) {
    const px = r() * ATLAS_W;
    const py = yB + r() * (yC - yB);
    const rad = 10 + r() * 40;
    const g = c.createRadialGradient(px, py, 0, px, py, rad);
    const dark = r() > 0.5;
    g.addColorStop(0, dark ? 'rgba(140,70,25,0.35)' : 'rgba(250,205,130,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  // charred blisters with pale rims, mostly on the outer face and top of the bead
  for (let i = 0; i < 110; i++) {
    const deg = -25 + Math.pow(r(), 0.9) * 140;
    const px = r() * ATLAS_W;
    const py = yOf(deg) + (r() - 0.5) * 30;
    const rad = 5 + r() * 16;
    const sq = 0.5 + r() * 0.5;
    c.save();
    c.translate(px, py);
    c.scale(1, sq);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, rad);
    g.addColorStop(0, r() > 0.4 ? '#2c1407' : '#5b2b0d');
    g.addColorStop(0.55, '#7a3a12');
    g.addColorStop(0.8, 'rgba(240,190,120,0.6)');
    g.addColorStop(1, 'rgba(240,190,120,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, rad, 0, Math.PI * 2);
    c.fill();
    c.restore();
    s.bumpDraw((b) => {
      b.save();
      b.translate(px, py);
      b.scale(1, sq);
      const gb = b.createRadialGradient(0, 0, 0, 0, 0, rad * 1.2);
      gb.addColorStop(0, 'rgba(255,255,255,0.95)');
      gb.addColorStop(0.7, 'rgba(255,255,255,0.4)');
      gb.addColorStop(1, 'rgba(255,255,255,0)');
      b.fillStyle = gb;
      b.beginPath();
      b.arc(0, 0, rad * 1.2, 0, Math.PI * 2);
      b.fill();
      b.restore();
    });
  }
  // flour dust + pores
  for (let i = 0; i < 2600; i++) {
    const px = r() * ATLAS_W;
    const py = r() * yC;
    c.fillStyle = r() > 0.35 ? 'rgba(255,246,226,0.5)' : 'rgba(90,45,15,0.35)';
    const sz = 0.8 + r() * 2.2;
    c.fillRect(px, py, sz, sz);
  }
  s.bumpDraw((b) => {
    for (let i = 0; i < 1800; i++) {
      const px = r() * ATLAS_W;
      const py = yB + r() * (yC - yB);
      b.fillStyle = 'rgba(0,0,0,0.35)';
      b.beginPath();
      b.arc(px, py, 1 + r() * 2.5, 0, Math.PI * 2);
      b.fill();
    }
  });
  // --- inner slope + hidden top: baked crust edge with a little caramelised sauce
  const gs = c.createLinearGradient(0, yC - 30, 0, CRUST_H);
  gs.addColorStop(0, '#e2ab62');
  gs.addColorStop(0.35, '#c9813b');
  gs.addColorStop(1, '#a4401f');
  c.fillStyle = gs;
  c.fillRect(0, yC - 30, ATLAS_W, CRUST_H - yC + 70);
  for (let i = 0; i < 40; i++) {
    const px = r() * ATLAS_W;
    const py = yC + 10 + r() * (CRUST_H - yC);
    fillPath(c, ellipsePath(px, py, 14 + r() * 40, 4 + r() * 9, (r() - 0.5) * 0.4), 'rgba(170,48,22,0.55)');
  }

  // --- cut face: dough / sauce / cheese layers and the airy crust
  const FX = (rr: number) => (rr / R) * ATLAS_W;
  const FY = (y: number) => FACE_Y0 + FACE_H - (y / FACE_YMAX) * FACE_H;
  c.fillStyle = '#f3dfb6';
  c.fillRect(0, FACE_Y0 - 8, ATLAS_W, FACE_H + 16);
  // air pockets
  for (let i = 0; i < 230; i++) {
    const rr = r() * R;
    const inCrust = rr > CR_C - 1.6;
    const y = inCrust ? CR_Y + (r() - 0.5) * 2 * CR_RY * 0.8 : 0.1 + r() * (SAUCE0 - 0.2);
    const rad = (inCrust ? 2 + r() * 7 : 1.5 + r() * 3.5) * 1.2;
    fillPath(c, ellipsePath(FX(rr), FY(y), rad * (1 + r()), rad, 0), r() > 0.25 ? '#d8bb84' : '#fff4dc');
  }
  // bottom bake line
  c.fillStyle = '#b5743a';
  c.fillRect(0, FY(0.07), FX(CR_C), FY(0) - FY(0.07) + 6);
  // sauce + cheese bands (stop at the crust)
  const xEnd = FX(CR_C - 2.25);
  c.fillStyle = '#b52f1a';
  c.fillRect(0, FY(SAUCE1), xEnd, FY(SAUCE0) - FY(SAUCE1));
  const gc = c.createLinearGradient(0, FY(TOP_Y + 0.2), 0, FY(SAUCE1));
  gc.addColorStop(0, '#fbe7a6');
  gc.addColorStop(1, '#f1c867');
  c.fillStyle = gc;
  c.fillRect(0, FY(TOP_Y + 0.25), xEnd + FX(0.9), FY(SAUCE1) - FY(TOP_Y + 0.25));
  c.fillStyle = 'rgba(230,120,30,0.5)';
  for (let x = 0; x < xEnd; x += 40 + r() * 70) c.fillRect(x, FY(SAUCE1 + 0.1), 18 + r() * 40, 3);
  // golden skin around the crust bead
  c.save();
  c.strokeStyle = '#c47a35';
  c.lineWidth = 0.3 * (ATLAS_W / R);
  c.beginPath();
  c.ellipse(FX(CR_C), FY(CR_Y), CR_RR * (ATLAS_W / R), CR_RY * (FACE_H / FACE_YMAX), 0, 0, Math.PI * 2);
  c.stroke();
  c.restore();
  s.bumpDraw((b) => {
    b.fillStyle = 'rgb(128,128,128)';
    b.fillRect(0, FACE_Y0 - 8, ATLAS_W, FACE_H + 16);
  });
}

function paintPepperoni(s: Surface): void {
  const c = s.c;
  const W = s.w;
  const r = rng(77);
  const cx = W / 2;
  const g = c.createRadialGradient(cx, cx, 0, cx, cx, W / 2);
  g.addColorStop(0, '#e2532c');
  g.addColorStop(0.4, '#cf3a22');
  g.addColorStop(0.76, '#bb2c1c');
  g.addColorStop(0.9, '#7e1a10');
  g.addColorStop(1, '#3f0c07');
  c.fillStyle = g;
  c.fillRect(0, 0, W, W);
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * W * 0.42;
    const px = cx + Math.cos(a) * d;
    const py = cx + Math.sin(a) * d;
    const rad = 3 + r() * 9;
    fillPath(c, ellipsePath(px, py, rad * (1 + r() * 0.6), rad, r() * 3), r() > 0.5 ? 'rgba(236,140,128,0.8)' : 'rgba(248,196,170,0.75)');
  }
  // oil pool in the middle
  const oil = c.createRadialGradient(cx - 10, cx - 12, 0, cx, cx, W * 0.3);
  oil.addColorStop(0, 'rgba(250,150,50,0.55)');
  oil.addColorStop(1, 'rgba(230,90,30,0)');
  c.fillStyle = oil;
  c.fillRect(0, 0, W, W);
  for (let i = 0; i < 260; i++) {
    c.fillStyle = r() > 0.5 ? 'rgba(40,6,4,0.35)' : 'rgba(255,200,170,0.25)';
    c.fillRect(r() * W, r() * W, 2, 2);
  }
}

function paintBasil(s: Surface): void {
  const c = s.c;
  const W = s.w;
  const H = s.h;
  const g = c.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#2c7a23');
  g.addColorStop(0.5, '#3f9a2c');
  g.addColorStop(1, '#2c7a23');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(170,230,120,0.75)';
  c.lineCap = 'round';
  c.lineWidth = 7;
  c.beginPath();
  c.moveTo(W / 2, H);
  c.lineTo(W / 2, 0);
  c.stroke();
  c.lineWidth = 3;
  for (let i = 1; i < 8; i++) {
    const y = H - (i / 8) * H * 0.95;
    c.beginPath();
    c.moveTo(W / 2, y);
    c.quadraticCurveTo(W * 0.3, y - 30, W * 0.06, y - 70);
    c.moveTo(W / 2, y);
    c.quadraticCurveTo(W * 0.7, y - 30, W * 0.94, y - 70);
    c.stroke();
  }
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  const flat = new THREE.Group();
  flat.rotation.x = Math.PI / 2; // top (+Y) -> +Z, crust (-Z) -> +Y
  inner.add(flat);

  // ---------- dough body + the two cut faces (one bread atlas)
  const prof = sliceProfile(false);
  const facePts = sliceProfile(true).pts;
  const bread = new Surface(ATLAS_W, ATLAS_H, bctx, { bump: { base: 0.5, density: 0.5 }, density: 1 });
  paintBread(bread);
  const body = lathe(prof.pts, {
    segments: 40,
    phiStart: PHI0,
    phiLength: PHI_LEN,
    uv: (_x, _y, _z, u, v) => [u, 1 - (crustV(v, prof) * CRUST_H) / ATLAS_H],
  });
  // upper and lower boundary of the cross-section as functions of r
  const upper: P2[] = [];
  {
    // the top chain runs from (0, TOP_Y) out to the outermost crust point
    const iOut = facePts.reduce((best, p, i) => (p[0] > facePts[best][0] ? i : best), 0);
    for (let i = facePts.length - 1; i >= iOut; i--) upper.push(facePts[i]);
  }
  const topAt = (rr: number) => {
    for (let i = 1; i < upper.length; i++) {
      if (rr <= upper[i][0]) {
        const a = upper[i - 1];
        const b = upper[i];
        const t = (rr - a[0]) / (b[0] - a[0] || 1);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return upper[upper.length - 1][1];
  };
  const bottomAt = (rr: number) => (rr <= CR_C ? 0 : CR_Y - CR_RY * Math.sqrt(Math.max(0, 1 - Math.pow((rr - CR_C) / CR_RR, 2))));
  const rMax = CR_C + CR_RR;
  const face = (phi: number, flip: boolean) => {
    const g = parametric(
      64,
      10,
      (u, v, out) => {
        const rr = rMax * (1 - Math.pow(1 - u, 1.7));
        const y0 = bottomAt(rr);
        const y1 = Math.max(y0, topAt(rr));
        const y = y0 + (y1 - y0) * v;
        return out.set(rr * Math.sin(phi), y, rr * Math.cos(phi));
      },
      {
        uv: (u, v) => {
          const rr = rMax * (1 - Math.pow(1 - u, 1.7));
          const y0 = bottomAt(rr);
          const y = y0 + (Math.max(y0, topAt(rr)) - y0) * v;
          return [rr / R, 1 - (FACE_Y0 + FACE_H - (y / FACE_YMAX) * FACE_H) / ATLAS_H];
        },
      },
    );
    if (flip) {
      const idx = g.index!;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
    }
    return g;
  };
  const doughGeo = mergeSimple([body, face(PHI0, false), face(PHI0 + PHI_LEN, true)]);
  warp(doughGeo, (p) => {
    crustLumps(p);
    bend(p);
  });
  const breadMat = new THREE.MeshPhysicalMaterial({
    map: bread.colorTexture(),
    bumpMap: bread.bumpTexture(),
    bumpScale: 2.2,
    roughness: 0.6,
    metalness: 0,
    sheen: 0.5,
    sheenColor: new THREE.Color('#ffd49a'),
    sheenRoughness: 0.55,
    clearcoat: 0.3,
    clearcoatRoughness: 0.42,
  });
  flat.add(new THREE.Mesh(doughGeo, breadMat));

  // ---------- melted cheese: top sheet + edge beads + drips over the cut faces
  const ck = 78;
  const cheese = new Surface(Math.round(2 * HW * ck), Math.round(R * ck), bctx, { bump: { base: 0.5, density: 0.5 }, mask: { rough: 0.42, metal: 0, density: 0.5 } });
  paintCheese(cheese);
  const sheet = parametric(
    84,
    40,
    (u, v, out) => {
      const rr = CHEESE_R * u;
      const phi = PHI0 + PHI_LEN * v;
      return out.set(rr * Math.sin(phi), cheeseY(rr, phi), rr * Math.cos(phi));
    },
    {
      uv: (u, v) => {
        const rr = CHEESE_R * u;
        const phi = PHI0 + PHI_LEN * v;
        return cheeseUV(rr * Math.sin(phi), rr * Math.cos(phi));
      },
    },
  );
  const cheeseParts: THREE.BufferGeometry[] = [sheet];
  const beadNoise = valueNoise3(61);
  const planarUV = (g: THREE.BufferGeometry) => {
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const [u, v] = cheeseUV(pos.getX(i), pos.getZ(i));
      uv.setXY(i, u, v);
    }
    return g;
  };
  // drips use the warm 'goo' swatch painted in the corner of the cheese print
  const gooUV = (g: THREE.BufferGeometry) => {
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.012, 0.988);
    return g;
  };
  const edges: [number, number][] = [
    [PHI0, -1],
    [PHI0 + PHI_LEN, 1],
  ];
  const dripAt: Record<number, [number, number][]> = {
    0: [
      [2.7, 0.75],
      [5.3, 1.0],
      [7.5, 0.62],
    ],
    1: [
      [3.8, 0.85],
      [6.4, 1.08],
      [8.3, 0.55],
    ],
  };
  edges.forEach(([phi, side], ei) => {
    const dir = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
    const out = new THREE.Vector3(Math.cos(phi), 0, -Math.sin(phi)).multiplyScalar(side);
    const pts: THREE.Vector3[] = [];
    const rEnd = CR_C - 2.3;
    for (let i = 0; i <= 40; i++) {
      const rr = 0.25 + ((rEnd - 0.25) * i) / 40;
      pts.push(dir.clone().multiplyScalar(rr).setY(TOP_Y + 0.012).addScaledVector(out, 0.025));
    }
    cheeseParts.push(planarUV(sweep(pts, (t) => (0.13 + 0.05 * beadNoise(t * 14 + ei * 7, 0.5, 0.5)) * Math.min(1, t * 12, (1 - t) * 10), 8)));
    // drips run down the cut face and slide towards the tip (the slice is held crust-up)
    for (const [rr, len] of dripAt[ei]) {
      const dpts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const along = rr - len * 0.85 * t * t;
        dpts.push(dir.clone().multiplyScalar(along).setY(TOP_Y + 0.04 - len * Math.sin(t * Math.PI * 0.5)).addScaledVector(out, 0.1 + 0.08 * t));
      }
      cheeseParts.push(gooUV(sweep(dpts, capped(0.21, 0.3, false, true, (t) => 0.75 + 0.5 * t), 10)));
    }
  });
  // a fat drip hanging off the tip
  {
    const tip: THREE.Vector3[] = [];
    const ctrl = [
      new THREE.Vector3(0.05, TOP_Y + 0.02, -1.1),
      new THREE.Vector3(0.0, TOP_Y + 0.06, -0.1),
      new THREE.Vector3(-0.05, TOP_Y - 0.25, 0.4),
      new THREE.Vector3(-0.1, TOP_Y - 0.85, 0.7),
      new THREE.Vector3(-0.12, TOP_Y - 1.45, 0.82),
    ];
    const curve = new THREE.CatmullRomCurve3(ctrl);
    for (let i = 0; i <= 24; i++) tip.push(curve.getPoint(i / 24));
    cheeseParts.push(gooUV(sweep(tip, capped(0.34, 0.22, false, true, (t) => 0.55 + 0.7 * Math.pow(t, 2)), 12)));
  }
  const cheeseGeo = mergeSimple(cheeseParts);
  cheeseParts.forEach((g) => g.dispose());
  warp(cheeseGeo, bend);
  const cheeseMask = cheese.maskTexture();
  const cheeseMat = new THREE.MeshPhysicalMaterial({
    map: cheese.colorTexture(),
    bumpMap: cheese.bumpTexture(),
    bumpScale: 1.4,
    roughnessMap: cheeseMask,
    roughness: 1,
    metalness: 0,
    clearcoat: 0.75,
    clearcoatRoughness: 0.18,
    sheen: 0.35,
    sheenColor: new THREE.Color('#fff2c8'),
    sheenRoughness: 0.4,
  });
  flat.add(new THREE.Mesh(cheeseGeo, cheeseMat));

  // ---------- pepperoni (cupped, some with oil pools)
  const pep = new Surface(512, 512, bctx, {});
  paintPepperoni(pep);
  const pepGeos = PEPPERONI.map((p) => {
    const rr = p.r;
    const cup = p.cup;
    const prof: P2[] = [
      [0, -0.03],
      [rr * 0.6, -0.02],
      [rr * 0.93, 0.03 + cup * 0.3],
      [rr, 0.09 + cup * 0.75],
      [rr * 0.985, 0.15 + cup],
      [rr * 0.91, 0.19 + cup],
      [rr * 0.74, 0.15 + cup * 0.72],
      [rr * 0.38, 0.12 + cup * 0.18],
      [0, 0.115],
    ];
    const g = lathe(prof, { segments: 40, uv: (x, _y, z) => [0.5 + x / (2 * rr * 1.04), 0.5 - z / (2 * rr * 1.04)] });
    g.rotateY(p.rot);
    const rr0 = Math.hypot(p.x, p.z);
    const phi = Math.atan2(p.x, p.z);
    const base = TOP_Y + 0.006 + THREE.MathUtils.smoothstep(Math.max(0, rr0 * Math.sin(ALPHA - Math.abs(phi - Math.PI))), 0, 0.8) * 0.07;
    g.translate(p.x, base - 0.02, p.z);
    return g;
  });
  const pepGeo = mergeSimple(pepGeos);
  pepGeos.forEach((g) => g.dispose());
  warp(pepGeo, bend);
  const pepMat = new THREE.MeshPhysicalMaterial({ map: pep.colorTexture(), roughness: 0.36, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.12, sheen: 0.2, sheenColor: new THREE.Color('#ff9a7a') });
  flat.add(new THREE.Mesh(pepGeo, pepMat));

  // ---------- basil leaves
  const basilTex = new Surface(128, 256, bctx, {});
  paintBasil(basilTex);
  const leafGeos = BASIL.map((b, i) => {
    const L = 3.1 * b.s;
    const Wd = 1.75 * b.s;
    const g = parametric(
      16,
      8,
      (u, v, out) => {
        const wv = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.85);
        const x = (v - 0.5) * Wd * wv;
        const z = (0.5 - u) * L;
        const y = 0.28 * Math.abs(v - 0.5) * 2 * wv + 0.35 * Math.pow(2 * u - 1, 2) + 0.06 * Math.sin(u * 9 + i);
        return out.set(x, y, z);
      },
      { uv: (u, v) => [v, u] },
    );
    g.rotateY(b.rot);
    const rr = Math.hypot(b.x, b.z);
    const phi = Math.atan2(b.x, b.z);
    g.translate(b.x, cheeseY(rr, phi) + 0.02, b.z);
    return g;
  });
  const basilGeo = mergeSimple(leafGeos);
  leafGeos.forEach((g) => g.dispose());
  warp(basilGeo, bend);
  flat.add(new THREE.Mesh(basilGeo, new THREE.MeshPhysicalMaterial({ map: basilTex.colorTexture(), roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15, side: THREE.DoubleSide, sheen: 0.3, sheenColor: new THREE.Color('#bff59a') })));

  // ---------- sticker sheet: flag (front + back) and a produce sticker on the crust
  const stickers = new StickerSheet(2048, 512, bctx, 12);
  const cFront = stickers.alloc(620, 410);
  const cBack = stickers.alloc(620, 410);
  const cPlu = stickers.alloc(360, 250);
  inCell(stickers, cFront, (c, w, h) => paintFlag(c, w, h, true));
  inCell(stickers, cBack, (c, w, h) => paintFlag(c, w, h, false));
  inCell(stickers, cPlu, (c) => {
    sticker(c, 0, 0, 0, ellipsePath(0, 0, 160, 108), { border: 9, fill: '#e8213a', shadow: 0.6 }, (k) => {
      k.strokeStyle = 'rgba(255,255,255,0.85)';
      k.lineWidth = 4;
      k.beginPath();
      k.ellipse(0, 0, 146, 94, 0, 0, Math.PI * 2);
      k.stroke();
      text(k, 'ZEROS', 0, -42, { size: 36, family: FONTS.rubikMono, align: 'center', color: '#ffffff', maxWidth: 200 });
      text(k, '0001', 0, 30, { size: 78, family: FONTS.archivoBlack, align: 'center', color: '#ffffff', tracking: 4 });
      smallPrint(k, ['HOT · FRESH · v2'], 0, 46, 22, '#ffe2e6', { align: 'center', weight: 700 });
    });
  });
  const stickerParts: THREE.BufferGeometry[] = [];
  // produce sticker hugging the crust bead (a = along the crust, b = around the bead)
  {
    const phiC = Math.PI + 0.42 * ALPHA;
    const thC = 62 * DEG;
    const bead = (a: number, b: number): SurfacePoint => {
      const phi = phiC - a / CR_C;
      const th = thC - b / ((CR_RR + CR_RY) / 2);
      const rr = CR_C + CR_RR * Math.cos(th);
      const y = CR_Y + CR_RY * Math.sin(th);
      const p = new THREE.Vector3(rr * Math.sin(phi), y, rr * Math.cos(phi));
      const nr = Math.cos(th) / CR_RR;
      const ny = Math.sin(th) / CR_RY;
      const l = Math.hypot(nr, ny);
      const n = new THREE.Vector3((nr / l) * Math.sin(phi), ny / l, (nr / l) * Math.cos(phi));
      const q = p.clone();
      crustLumps(q);
      const lift = Math.max(0, q.clone().sub(p).dot(n));
      return { p: p.addScaledVector(n, lift), n };
    };
    const w = 2.3;
    stickerParts.push(stickerPatch(bead, 0, 0, w, w * (cPlu.h / cPlu.w), -12 * DEG, cPlu.uv, { nx: 12, ny: 10, offset: 0.05 }));
  }
  const stickerGeo = mergeSimple(stickerParts);
  stickerParts.forEach((g) => g.dispose());
  warp(stickerGeo, bend);

  // ---------- toothpick flag stuck in the crust
  const pickLen = 9.6;
  const pick = toothpick(pickLen, 0.15);
  const flagW = 4.4;
  const flagH = 2.9;
  const fl = flag(flagW, flagH, cFront.uv, cBack.uv, { wave: 0.42, fork: 0.85, phase: 0.4 });
  fl.translate(0.13, pickLen - flagH / 2 - 0.35, 0);
  {
    const phi = Math.PI - 0.5 * ALPHA;
    const th = 70 * DEG;
    const rr = CR_C + CR_RR * Math.cos(th);
    const surf = new THREE.Vector3(rr * Math.sin(phi), CR_Y + CR_RY * Math.sin(th), rr * Math.cos(phi));
    const bent = surf.clone();
    bend(bent);
    const dir = new THREE.Vector3(0.32, 0.42, -1).normalize();
    const base = bent.clone().addScaledVector(dir, -2.4);
    const m = pickMatrix(base, dir, new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    pick.applyMatrix4(m);
    fl.applyMatrix4(m);
  }
  flat.add(new THREE.Mesh(pick, woodMaterial()));
  const paperGeo = mergeSimple([stickerGeo, fl]);
  stickerGeo.dispose();
  fl.dispose();
  flat.add(new THREE.Mesh(paperGeo, paperBackfaces(stickerSheet(stickers.surf.colorTexture(), { roughness: 0.45, clearcoat: 0.5 }), '#f4efe4')));

  return finish(inner, trash, undefined, 'pizza-slice');
}

/** Orientation for a pick along `dir` whose flag front faces `facing` and flies towards `fly`. */
function pickMatrix(base: THREE.Vector3, dir: THREE.Vector3, facing: THREE.Vector3, fly: THREE.Vector3): THREE.Matrix4 {
  const Y = new THREE.Vector3(0, 1, 0);
  const q0 = new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize());
  let best = new THREE.Quaternion();
  let bestScore = -Infinity;
  const z = new THREE.Vector3();
  const x = new THREE.Vector3();
  for (let a = 0; a < 360; a += 2) {
    const q = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y, a * DEG));
    z.set(0, 0, 1).applyQuaternion(q);
    x.set(1, 0, 0).applyQuaternion(q);
    const score = z.dot(facing) + 0.6 * x.dot(fly);
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return new THREE.Matrix4().compose(base, best, new THREE.Vector3(1, 1, 1));
}

function paintFlag(c: C2D, w: number, h: number, front: boolean): void {
  const x0 = -w / 2;
  const y0 = -h / 2;
  c.fillStyle = '#d7ff3a';
  c.fillRect(x0, y0, w, h);
  // pink hoist band
  c.fillStyle = '#ff4fb8';
  c.fillRect(front ? x0 : x0 + w - 70, y0, 70, h);
  if (front) {
    text(c, 'ZEROS', x0 + 70 + (w - 70) * 0.43, 34, { size: 128, family: FONTS.bagel, align: 'center', color: '#0b0b0d', maxWidth: (w - 70) * 0.78 });
    fillPath(c, starPath(x0 + w - 120, y0 + 92, 46, 20, 5, -Math.PI / 2, 0.3), '#ff4fb8');
    text(c, 'PIZZERIA', x0 + 70 + (w - 70) * 0.43, 112, { size: 40, family: FONTS.rubikMono, align: 'center', color: '#0b0b0d', maxWidth: (w - 70) * 0.7, tracking: 3 });
    smallPrint(c, ['EST. ONCE UPON A TIME'], x0 + 70 + (w - 70) * 0.43, 140, 22, '#0b0b0d', { align: 'center', weight: 700 });
  } else {
    text(c, 'one more slice,', x0 + (w - 70) * 0.47, -30, { size: 58, family: FONTS.marker, align: 'center', color: '#0b0b0d', maxWidth: (w - 70) * 0.84 });
    text(c, 'one more feature', x0 + (w - 70) * 0.47, 50, { size: 58, family: FONTS.marker, align: 'center', color: '#0b0b0d', maxWidth: (w - 70) * 0.84 });
    smallPrint(c, ['ZEROS PIZZERIA · SLICE #0001'], x0 + (w - 70) * 0.47, 100, 22, '#0b0b0d', { align: 'center', weight: 700 });
  }
}

export const pizza: LibraryDef = {
  kind: 'pizza',
  name: 'Pizza Slice',
  tagline: 'one more slice, one more feature',
  category: 'food',
  defaultRotation: [-0.36, -0.2, 0.36],
  build,
};
export default pizza;
