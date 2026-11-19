import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { parametric, stickerPatch, type SurfacePoint } from '../geometry';
import { stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, rng, text, sticker, starPath, ticketPath, circlePath, fillPath, smallPrint, barcode, factsPanel, grain, halftone } from '../paint';
import { mergeSimple, inCell, instanced } from './_food';

/*
 * HOT FIXES: a red fry carton (flared, folded paperboard with high corner "ears" and
 * scooped front and back) stuffed with golden fries. Bold yellow wordmark on the front,
 * a facts panel and barcode on the back, two stickers. Centimetres, Y up, front = +Z.
 */

const H = 9.6; // carton height at the corners
const DIP_FRONT = 1.9;
const DIP_SIDE = 1.0;
const A0 = 2.75; // half width at the bottom (x)
const B0 = 1.6; // half depth at the bottom (z)
const RC0 = 0.55;
const A1 = 4.35; // half width at the corners' top
const B1 = 2.3;
const RC1 = 0.85;
const WALL = 0.09;

const RED = '#e3261d';
const RED_DARK = '#9e1310';
const YELLOW = '#ffd21f';

// print atlas: rows 0..PRINT_H = outer wall (full width = full perimeter), below = inside / rim
const ATLAS_W = 2048;
const ATLAS_H = 1024;
const PRINT_H = 840;

interface Ring {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** Point on a rounded rectangle; s in [0, 1) with s = 0 at the back centre, 0.5 at the front centre. */
function rrPoint(s: number, a: number, b: number, rc: number): Ring {
  const fa = a - rc;
  const fb = b - rc;
  // segment lengths starting at the front centre, going towards +X
  const segs = [fa, (Math.PI / 2) * rc, 2 * fb, (Math.PI / 2) * rc, 2 * fa, (Math.PI / 2) * rc, 2 * fb, (Math.PI / 2) * rc, fa];
  const total = segs.reduce((p, q) => p + q, 0);
  let d = (((s + 0.5) % 1) + 1) % 1;
  d *= total;
  let k = 0;
  while (k < segs.length - 1 && d > segs[k]) {
    d -= segs[k];
    k++;
  }
  const t = segs[k] > 0 ? d / segs[k] : 0;
  const arc = (cx: number, cz: number, a0: number, a1: number): Ring => {
    const ang = a0 + (a1 - a0) * t;
    return { x: cx + rc * Math.cos(ang), z: cz + rc * Math.sin(ang), nx: Math.cos(ang), nz: Math.sin(ang) };
  };
  switch (k) {
    case 0:
      return { x: fa * t, z: b, nx: 0, nz: 1 };
    case 1:
      return arc(fa, fb, Math.PI / 2, 0);
    case 2:
      return { x: a, z: fb - 2 * fb * t, nx: 1, nz: 0 };
    case 3:
      return arc(fa, -fb, 0, -Math.PI / 2);
    case 4:
      return { x: fa - 2 * fa * t, z: -b, nx: 0, nz: -1 };
    case 5:
      return arc(-fa, -fb, -Math.PI / 2, -Math.PI);
    case 6:
      return { x: -a, z: -fb + 2 * fb * t, nx: -1, nz: 0 };
    case 7:
      return arc(-fa, fb, Math.PI, Math.PI / 2);
    default:
      return { x: -fa + fa * t, z: b, nx: 0, nz: 1 };
  }
}

/** Height of the top edge: corners stand up as ears, front/back and sides scoop down. */
function topY(s: number): number {
  const p = rrPoint(s, A1, B1, RC1);
  const psi = Math.atan2(p.z / B1, p.x / A1);
  const front = Math.abs(Math.sin(psi)) > Math.SQRT1_2;
  const k = Math.pow(Math.abs(Math.cos(2 * psi)), 1.25);
  return H - (front ? DIP_FRONT : DIP_SIDE) * k;
}

/** Outer wall point at perimeter s and height y (with a little paperboard bulge). */
function wallPoint(s: number, y: number, inset = 0): { p: THREE.Vector3; n: THREE.Vector3 } {
  const f = THREE.MathUtils.clamp(y / H, 0, 1.05);
  const a = A0 + (A1 - A0) * f;
  const b = B0 + (B1 - B0) * f;
  const rc = RC0 + (RC1 - RC0) * f;
  const q = rrPoint(s, a, b, rc);
  const psi = Math.atan2(q.z / b, q.x / a);
  const flat = Math.pow(Math.abs(Math.cos(2 * psi)), 0.8);
  const bulge = 0.2 * Math.sin(Math.PI * THREE.MathUtils.clamp(y / H, 0, 1)) * flat - inset;
  // flare tilts the normal outwards a little
  const slope = (A1 - A0) / H;
  const n = new THREE.Vector3(q.nx, -slope * 0.8, q.nz).normalize();
  return { p: new THREE.Vector3(q.x + q.nx * bulge, y, q.z + q.nz * bulge), n };
}

// ------------------------------------------------------------------ print

/** u (0..1, back centre = 0, front centre = 0.5) -> atlas x. */
const UX = (u: number) => u * ATLAS_W;
/** height (cm) -> atlas y in the print band. */
const VY = (y: number) => PRINT_H * (1 - y / (H + 0.3));

function perimeterFractions(): { front0: number; front1: number; right: number; left: number } {
  // find where the flat front panel starts / ends at the top
  const fa = A1 - RC1;
  const fb = B1 - RC1;
  const q = (Math.PI / 2) * RC1;
  const total = 4 * fa + 4 * fb + 4 * q;
  return { front0: 0.5 - fa / total, front1: 0.5 + fa / total, right: 0.5 + (fa + q + fb) / total, left: 0.5 - (fa + q + fb) / total };
}

function paintCarton(s: Surface): void {
  const c = s.c;
  const r = rng(5150);
  const pf = perimeterFractions();
  // base red with a slight vertical sheen
  const g = c.createLinearGradient(0, 0, 0, PRINT_H);
  g.addColorStop(0, '#f0362a');
  g.addColorStop(0.6, RED);
  g.addColorStop(1, '#c91c15');
  c.fillStyle = g;
  c.fillRect(0, 0, ATLAS_W, PRINT_H);
  // yellow ribbon wave near the bottom, all the way round
  c.save();
  c.fillStyle = YELLOW;
  c.beginPath();
  c.moveTo(0, VY(1.9));
  for (let x = 0; x <= ATLAS_W; x += 16) c.lineTo(x, VY(1.9) + Math.sin((x / ATLAS_W) * Math.PI * 2 * 6) * 14);
  c.lineTo(ATLAS_W, VY(0.9));
  for (let x = ATLAS_W; x >= 0; x -= 16) c.lineTo(x, VY(0.9) + Math.sin((x / ATLAS_W) * Math.PI * 2 * 6 + 1.2) * 10);
  c.closePath();
  c.fill();
  c.restore();
  c.font = `700 22px ${FONTS.spaceMono}`;
  c.fillStyle = RED_DARK;
  c.textBaseline = 'middle';
  {
    const band = 'HOT FIXES · DEPLOYED FAST · ';
    const bw = c.measureText(band).width;
    const n = Math.max(1, Math.round(ATLAS_W / bw));
    c.save();
    c.scale(ATLAS_W / (n * bw), 1);
    for (let i = 0; i < n; i++) c.fillText(band, i * bw, VY(1.4));
    c.restore();
  }
  // halftone dots fading up the walls
  halftone(c, 0, VY(H), ATLAS_W, VY(2.2) - VY(H), 22, 'rgba(255,255,255,0.12)', (_u, v) => 0.15 + 0.55 * v);

  // ---- front: emblem + stacked wordmark
  const fx = UX(0.5);
  {
    const ey = VY(6.5);
    fillPath(c, circlePath(fx, ey, 74), YELLOW);
    c.strokeStyle = RED_DARK;
    c.lineWidth = 8;
    c.beginPath();
    c.arc(fx, ey, 74, 0, Math.PI * 2);
    c.stroke();
    // lightning bolt "fix"
    c.fillStyle = RED;
    c.beginPath();
    c.moveTo(fx + 12, ey - 54);
    c.lineTo(fx - 30, ey + 8);
    c.lineTo(fx - 2, ey + 8);
    c.lineTo(fx - 14, ey + 54);
    c.lineTo(fx + 32, ey - 10);
    c.lineTo(fx + 4, ey - 10);
    c.closePath();
    c.fill();
  }
  const word = { family: FONTS.bagel, align: 'center' as const, color: YELLOW, outlines: [{ color: RED_DARK, width: 18 }], extrude: { color: RED_DARK, dx: 0, dy: 10 } };
  text(c, 'HOT', fx, VY(4.15), { ...word, size: 150, maxWidth: (pf.front1 - pf.front0) * ATLAS_W * 1.25 });
  text(c, 'FIXES', fx, VY(2.6), { ...word, size: 150, maxWidth: (pf.front1 - pf.front0) * ATLAS_W * 1.45 });
  smallPrint(c, ['served hot, deployed fast'], fx, VY(2.35), 26, '#ffffff', { align: 'center', weight: 700 });

  // ---- sides: big vertical 'PATCH' type and a mono strip
  for (const [u, rot] of [
    [pf.right + 0.005, -Math.PI / 2],
    [pf.left - 0.005, Math.PI / 2],
  ] as [number, number][]) {
    c.save();
    c.translate(UX(u), VY(5.4));
    c.rotate(rot);
    text(c, 'PATCH v1.0.1', 0, 22, { size: 64, family: FONTS.rubikMono, align: 'center', color: '#ffffff', maxWidth: 520 });
    c.restore();
  }

  // ---- back: facts panel, barcode, small print (the back centre is at u = 0 / 1)
  for (const off of [0, ATLAS_W]) {
    c.save();
    c.translate(off - 150, VY(8.4));
    factsPanel(
      c,
      0,
      0,
      300,
      'Fix Facts',
      'Serving size: 1 hotfix',
      [['Bugs fixed', '100%', true], ['Downtime', '0g', true], ['Rollbacks', '0', true], '-', ['Salt', 'yes'], ['Crunch', 'max']],
      { size: 18, paper: '#fff6e8', footer: ['* % daily value of shipping'] },
    );
    c.restore();
    c.save();
    c.translate(off + 210, VY(4.6));
    c.rotate(-Math.PI / 2);
    fillPath(c, (q) => q.rect(-110, -40, 220, 80), '#ffffff');
    barcode(c, -96, -32, 192, 64, 4242, { digits: '0 10101 00001 1' });
    c.restore();
  }
  s.maskPath((m) => m.rect(UX(0.93), VY(8.6), UX(0.07) + 2, VY(2.6) - VY(8.6)), 0.5, 0);
  s.maskPath((m) => m.rect(0, VY(8.6), UX(0.07), VY(2.6) - VY(8.6)), 0.5, 0);
  grain(c, 0, 0, ATLAS_W, PRINT_H, 9000, 0.05, 2);
  // speckled paper scratches
  for (let i = 0; i < 80; i++) {
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1 + r() * 2;
    const x = r() * ATLAS_W;
    const y = r() * PRINT_H;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 12);
    c.stroke();
  }

  // ---- inside of the carton (white board), rim edge (raw board), base
  c.fillStyle = '#f3ece0';
  c.fillRect(0, PRINT_H + 8, ATLAS_W, 90);
  c.fillStyle = '#e9dcc4';
  c.fillRect(0, PRINT_H + 110, ATLAS_W, 60);
}

/** Golden fry skin: speckles and salt; the colour comes from vertex + instance colours. */
function paintFrySkin(s: Surface): void {
  const c = s.c;
  const r = rng(99);
  c.fillStyle = '#f7f7f7';
  c.fillRect(0, 0, s.w, s.h);
  // faint lengthwise potato streaks and a few darker specks
  for (let i = 0; i < 140; i++) {
    c.fillStyle = r() > 0.25 ? 'rgba(200,170,120,0.22)' : 'rgba(150,100,45,0.3)';
    c.fillRect(r() * s.w, r() * s.h, 1 + r() * 2, 4 + r() * 16);
  }
  // salt
  for (let i = 0; i < 160; i++) {
    c.fillStyle = '#ffffff';
    const z = 1.2 + r() * 2;
    c.fillRect(r() * s.w, r() * s.h, z, z);
  }
  s.bumpDraw((b) => {
    for (let i = 0; i < 360; i++) {
      b.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.22)';
      b.fillRect(r() * s.w, r() * s.h, 2 + r() * 3, 4 + r() * 14);
    }
  });
}

/** One fry: rounded-square section swept along a gently bent line (length L along +Y), capped ends. */
function fryGeometry(L: number, w: number): THREE.BufferGeometry {
  const sec: [number, number][] = [];
  const rc = w * 0.3;
  const h = w / 2 - rc;
  const corners: [number, number][] = [
    [h, h],
    [-h, h],
    [-h, -h],
    [h, -h],
  ];
  corners.forEach(([cx, cz], k) => {
    for (let i = 0; i <= 3; i++) {
      const a = (k * Math.PI) / 2 + (i / 3) * (Math.PI / 2);
      sec.push([cx + rc * Math.cos(a), cz + rc * Math.sin(a)]);
    }
  });
  const nSec = sec.length;
  const nLen = 12;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const gold = new THREE.Color('#ffbf26');
  const brown = new THREE.Color('#c9832c');
  const tmp = new THREE.Color();
  const center = (t: number) => new THREE.Vector3(0.13 * Math.sin(Math.PI * t) * (L / 10), t * L, 0.05 * Math.sin(2 * Math.PI * t));
  for (let j = 0; j <= nLen; j++) {
    const t = j / nLen;
    const cpt = center(t);
    const endK = Math.max(THREE.MathUtils.smoothstep(t, 0.82, 1), 0.6 * THREE.MathUtils.smoothstep(1 - t, 0.9, 1));
    tmp.copy(gold).lerp(brown, endK * 0.75);
    for (let i = 0; i <= nSec; i++) {
      const [sx, sz] = sec[i % nSec];
      pos.push(cpt.x + sx, cpt.y, cpt.z + sz);
      uv.push(i / nSec, t);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  const row = nSec + 1;
  for (let j = 0; j < nLen; j++) {
    for (let i = 0; i < nSec; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  for (const end of [0, 1]) {
    const cpt = center(end);
    const base = pos.length / 3;
    tmp.copy(gold).lerp(brown, end ? 0.85 : 0.45);
    pos.push(cpt.x, cpt.y + (end ? 0.03 : -0.03), cpt.z);
    uv.push(0.5, end);
    col.push(tmp.r, tmp.g, tmp.b);
    for (let i = 0; i < nSec; i++) {
      const [sx, sz] = sec[i];
      pos.push(cpt.x + sx * 0.96, cpt.y, cpt.z + sz * 0.96);
      uv.push(0.5 + sx / w, end);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    for (let i = 0; i < nSec; i++) {
      const a = base + 1 + i;
      const b = base + 1 + ((i + 1) % nSec);
      if (end) idx.push(base, b, a);
      else idx.push(base, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function paintStickers(sheet: StickerSheet): { fresh: ReturnType<StickerSheet['alloc']>; ticket: ReturnType<StickerSheet['alloc']> } {
  const fresh = sheet.alloc(300, 300);
  inCell(sheet, fresh, (c) => {
    sticker(c, 0, 0, 0, starPath(0, 0, 132, 112, 18, -Math.PI / 2, 0.4), { border: 8, fill: '#d7ff3a', shadow: 0.7 }, (k) => {
      text(k, 'FRESH', 0, -16, { size: 50, family: FONTS.archivoBlack, align: 'center', color: '#0b0b0d', maxWidth: 180 });
      text(k, 'DEPLOY', 0, 34, { size: 44, family: FONTS.archivoBlack, align: 'center', color: '#0b0b0d', maxWidth: 180 });
      smallPrint(k, ['0 bugs inside'], 0, 50, 18, '#0b0b0d', { align: 'center', weight: 700 });
    });
  });
  const ticket = sheet.alloc(420, 170);
  inCell(sheet, ticket, (c) => {
    sticker(c, 0, 0, 0, ticketPath(-196, -70, 392, 140, 20, 10), { border: 7, fill: '#ff4fb8', shadow: 0.6 }, (k) => {
      k.save();
      k.setLineDash([10, 8]);
      k.strokeStyle = 'rgba(255,255,255,0.8)';
      k.lineWidth = 3;
      k.strokeRect(-168, -54, 336, 108);
      k.restore();
      text(k, 'NO ROLLBACKS', 0, 4, { size: 44, family: FONTS.archivoBlack, align: 'center', color: '#ffffff', maxWidth: 320 });
      smallPrint(k, ['ADMIT ONE · PROD ONLY'], 0, 18, 20, '#0b0b0d', { align: 'center', weight: 700 });
    });
  });
  return { fresh, ticket };
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  const rand = rng(31337);

  // ---------- carton: outer wall, inner wall, rolled rim and base (one atlas)
  const print = new Surface(ATLAS_W, ATLAS_H, bctx, { mask: { rough: 0.38, metal: 0, density: 0.25 } });
  paintCarton(print);
  const NU = 220;
  const NV = 26;
  const outer = parametric(
    NU,
    NV,
    (u, v, out) => {
      const y = v * topY(u);
      return out.copy(wallPoint(u, y).p);
    },
    { uv: (u, v) => [u, 1 - VY(v * topY(u)) / ATLAS_H] },
  );
  const innerWall = parametric(
    NU,
    NV,
    (u, v, out) => {
      const y = 0.1 + v * (topY(u) - 0.1);
      return out.copy(wallPoint(u, y, WALL).p);
    },
    { uv: (u, v) => [u, 1 - (PRINT_H + 12 + v * 80) / ATLAS_H] },
  );
  {
    const idx = innerWall.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    innerWall.computeVertexNormals();
  }
  const rim = parametric(
    NU,
    6,
    (u, v, out) => {
      const y = topY(u);
      const o = wallPoint(u, y).p;
      const i = wallPoint(u, y, WALL).p;
      out.copy(o).lerp(i, v);
      out.y += 0.05 * Math.sin(Math.PI * v);
      return out;
    },
    { uv: (u, v) => [u, 1 - (PRINT_H + 115 + v * 50) / ATLAS_H] },
  );
  // base (facing down)
  const baseShape = new THREE.Shape();
  for (let i = 0; i <= 64; i++) {
    const q = rrPoint(i / 64, A0, B0, RC0);
    if (i === 0) baseShape.moveTo(q.x, q.z);
    else baseShape.lineTo(q.x, q.z);
  }
  const base = new THREE.ShapeGeometry(baseShape, 1);
  base.rotateX(Math.PI / 2);
  {
    const uv = base.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 1 - (PRINT_H + 130) / ATLAS_H);
  }
  const cartonGeo = mergeSimple([outer, innerWall, rim, base]);
  [outer, innerWall, rim, base].forEach((g) => g.dispose());
  const mask = print.maskTexture();
  const cartonMat = new THREE.MeshPhysicalMaterial({
    map: print.colorTexture(),
    roughnessMap: mask,
    roughness: 1,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.2,
    sheen: 0.2,
    sheenColor: new THREE.Color('#ffd0c0'),
    side: THREE.FrontSide,
  });
  inner.add(new THREE.Mesh(cartonGeo, cartonMat));

  // ---------- fries
  const skin = new Surface(128, 512, bctx, { bump: { base: 0.5, density: 1 } });
  paintFrySkin(skin);
  const fryGeo = fryGeometry(10, 0.94);
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const Y = new THREE.Vector3(0, 1, 0);
  const placed: THREE.Vector3[] = [];
  // a fry may lean, but must stay inside the carton until it clears the rim
  const insideUntilRim = (p0: THREE.Vector3, dir: THREE.Vector3, len: number) => {
    const m = 0.66;
    for (let t = 0; t <= len; t += 0.4) {
      const p = p0.clone().addScaledVector(dir, t);
      if (p.y > H + 0.2) return true;
      const f = THREE.MathUtils.clamp(p.y / H, 0, 1);
      const a = A0 + (A1 - A0) * f - m;
      const b = B0 + (B1 - B0) * f - m;
      if (Math.pow(Math.abs(p.x) / a, 4) + Math.pow(Math.abs(p.z) / b, 4) > 1) return false;
    }
    return true;
  };
  for (let tries = 0; tries < 6000 && mats.length < 84; tries++) {
    const y0 = 2.0 + rand() * 3.2;
    const spread = 0.4 + (y0 - 2) * 0.1;
    const bx = (rand() * 2 - 1) * (A0 + spread);
    const bz = (rand() * 2 - 1) * (B0 + spread * 0.4);
    // keep fries apart (fries starting at very different depths may overlap in plan)
    if (placed.some((p) => Math.hypot(p.x - bx, p.y - bz) < 0.54 && Math.abs(p.z - y0) < 2.2)) continue;
    const back = 0.5 - bz / (2 * B1); // 0 front .. 1 back
    const dir = new THREE.Vector3(0.3 * (bx / A1) + (rand() - 0.5) * 0.16, 1, 0.26 * (bz / B1) + (rand() - 0.5) * 0.14).normalize();
    const len = 0.74 + rand() * 0.22 + back * 0.14 - (y0 - 2) * 0.06;
    const p0 = new THREE.Vector3(bx, y0, bz);
    if (!insideUntilRim(p0, dir, 10 * len)) continue;
    placed.push(new THREE.Vector3(bx, bz, y0));
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir).multiply(new THREE.Quaternion().setFromAxisAngle(Y, rand() * Math.PI * 2));
    mats.push(new THREE.Matrix4().compose(p0, q, new THREE.Vector3(1, len, 1)));
    cols.push(new THREE.Color().setHSL(0.12 + (rand() - 0.5) * 0.03, 0.35, 0.95 + (rand() - 0.5) * 0.08));
  }
  // a couple of strays leaning over the front edge
  for (const [x, ang, len] of [
    [-1.7, 0.58, 0.7],
    [2.0, 0.48, 0.66],
  ] as [number, number, number][]) {
    const dir = new THREE.Vector3(x > 0 ? 0.25 : -0.2, Math.cos(ang), Math.sin(ang)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 5.5, -0.2), q, new THREE.Vector3(1, len, 1)));
    cols.push(new THREE.Color().setHSL(0.11, 0.35, 0.94));
  }
  const fryMat = new THREE.MeshPhysicalMaterial({
    map: skin.colorTexture(),
    bumpMap: skin.bumpTexture(),
    bumpScale: 0.8,
    vertexColors: true,
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
    sheen: 0.5,
    sheenColor: new THREE.Color('#fff0b0'),
    sheenRoughness: 0.4,
  });
  inner.add(instanced(fryGeo, fryMat, mats, cols));

  // ---------- stickers on the carton
  const sheet = new StickerSheet(1024, 512, bctx, 12);
  const { fresh, ticket } = paintStickers(sheet);
  const cm = (cell: { w: number; h: number }, w: number) => w * (cell.h / cell.w);
  const atWall =
    (s0: number, lift: number) =>
    (a: number, b: number): SurfacePoint => {
      // a: arc length along the top perimeter from s0 (towards +s), b: height
      const per = 4 * (A1 - RC1) + 4 * (B1 - RC1) + 2 * Math.PI * RC1;
      const { p, n } = wallPoint(s0 + a / per, b);
      return { p: p.addScaledVector(n, lift), n };
    };
  const pf = perimeterFractions();
  const stickers = mergeSimple([
    // star seal wrapped round the front-left corner
    stickerPatch(atWall(pf.front0 - 0.012, 0.02), 0, 7.3, 2.5, 2.5, 10 * DEG, fresh.uv, { nx: 14, ny: 14, offset: 0.012 }),
    // ticket on the right side, lower edge peeling
    stickerPatch(atWall(pf.right - 0.004, 0.02), 0, 4.2, 3.4, cm(ticket, 3.4), 78 * DEG, ticket.uv, {
      nx: 14,
      ny: 8,
      offset: 0.012,
      lift: (u) => 0.25 * Math.pow(THREE.MathUtils.smoothstep(1 - u, 0.6, 1), 2),
    }),
  ]);
  inner.add(new THREE.Mesh(stickers, paperBackfaces(stickerSheet(sheet.surf.colorTexture(), { roughness: 0.42, clearcoat: 0.6 }), '#f4efe4')));

  return finish(inner, trash, undefined, 'hot-fixes');
}

export const fries: LibraryDef = {
  kind: 'fries',
  name: 'Hot Fixes',
  tagline: 'served hot, deployed fast',
  category: 'food',
  defaultRotation: [0.2, -0.4, 0.07],
  build,
};
export default fries;

