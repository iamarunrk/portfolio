import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, canvasTexture, maskColor, type AtlasCell } from '../textures';
import { Trash, finish } from '../build';
import { merge, parametric, place, stickerPatch, type BoxFaceInfo, type FaceName, type FaceRect } from '../geometry';
import { stickerSheet, paperBackfaces, holoFoil } from '../materials';
import {
  FONTS,
  DEG,
  rng,
  text,
  font,
  smallPrint,
  barcode,
  sticker,
  rrPath,
  circlePath,
  sealPath,
  fillPath,
  holoFill,
  rrect,
  grain,
  smiley,
  type C2D,
} from '../paint';
import { SoftBox } from './_founder';

/*
 * FIRST DOLLAR: a chunky candy-pink card terminal that just took its first payment.
 * A lime Zeros card sticks out of the top slot, the screen blinks APPROVED, and the
 * receipt curls out of the side. Scene units ~ 10 cm.
 */

const W = 1.06;
const H = 1.56;
const D = 0.62;
const R = 0.17;
const ZF = D / 2;

const PINK_DEEP = '#e8329c';
const INK = '#141016';
const LIME = '#d7ff3a';
const CREAM = '#f7f1e6';

const SCREEN = { cx: 0, cy: 0.405, w: 0.62, h: 0.28 };
const KEY = { w: 0.145, h: 0.105, d: 0.062, r: 0.03 };
const KEY_COLS = [-0.258, -0.088, 0.082, 0.262];
const KEY_ROWS = [-0.07, -0.2, -0.33, -0.46];
const PANEL = { cx: 0.002, cy: -0.265, w: 0.73, h: 0.58 };
const CARD = { w: 0.56, h: 0.88, d: 0.024, inserted: 0.33 };
const RECEIPT = { y: 0.3, w: 0.4, len: 1.18 };
/** The shared sticker / keycap-legend / receipt sheet (design px). */
const SHEET_W = 1024;
const SHEET_H = 2048;
const LEGEND = { x: 0, y: 1536, size: 512 };
const RECEIPT_CELL = { x: 512, y: 0, w: 512, h: 1510 };

/** Gentle toy taper: a touch narrower at the top. */
function taper(p: THREE.Vector3): void {
  const t = THREE.MathUtils.clamp((p.y + H / 2) / H, 0, 1);
  p.x *= 1 - 0.05 * t;
}

// ------------------------------------------------------------------ body print

function paintBody(s: Surface, f: Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', BoxFaceInfo>): void {
  const c = s.c;
  // candy pink everywhere, a soft vertical gradient per face
  for (const key of ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const) {
    const { x, y, w, h } = f[key].rect;
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ff63c2');
    g.addColorStop(1, PINK_DEEP);
    c.fillStyle = g;
    c.fillRect(x - 14, y - 14, w + 28, h + 28);
  }
  // ---- front
  {
    const F = f.pz;
    const k = F.k;
    const P = F.toPx;
    const [lx, ly] = P(0, 0.075);
    text(c, 'first dollar', lx, ly, { size: 0.1 * k, family: FONTS.bagel, align: 'center', color: '#ffffff', extrude: { color: '#a3156b', dx: 0, dy: 0.012 * k }, maxWidth: 0.7 * k });
    const [tx, ty] = P(0, 0.6);
    smallPrint(c, ['ZEROS PAY · FD-1'], tx, ty - 0.02 * k, 0.03 * k, '#ffe3f4', { align: 'center', weight: 700 });
    // contactless waves, top right
    const [wx, wy] = P(0.28, 0.6);
    c.save();
    c.strokeStyle = '#ffe3f4';
    c.lineCap = 'round';
    c.lineWidth = 0.008 * k;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.arc(wx - 0.03 * k, wy, (0.012 + i * 0.012) * k, -0.8, 0.8);
      c.stroke();
    }
    c.restore();
    const [bx, by] = P(0, -0.6);
    smallPrint(c, ['TAP · INSERT · SHIP'], bx, by - 0.014 * k, 0.026 * k, '#ffe3f4', { align: 'center', weight: 700 });
  }
  // ---- top: insert card arrows
  {
    const F = f.py;
    const k = F.k;
    const P = F.toPx;
    const [x, y] = P(0, 0.17);
    text(c, 'INSERT CARD', x, y, { size: 0.04 * k, family: FONTS.archivoBlack, align: 'center', color: '#ffe3f4' });
    c.save();
    c.fillStyle = '#ffe3f4';
    for (const dx of [-0.22, 0.22]) {
      const [ax, ay] = P(dx, 0.155);
      c.beginPath();
      c.moveTo(ax - 0.02 * k, ay - 0.03 * k);
      c.lineTo(ax + 0.02 * k, ay - 0.03 * k);
      c.lineTo(ax, ay);
      c.closePath();
      c.fill();
    }
    c.restore();
  }
  // ---- sides
  {
    const F = f.nx;
    const k = F.k;
    const P = F.toPx;
    const [x, y] = P(0, -0.1);
    c.save();
    c.translate(x, y);
    c.rotate(-Math.PI / 2);
    text(c, '$1 → $1M', 0, 0, { size: 0.09 * k, family: FONTS.archivoBlack, align: 'center', color: '#ffffff', extrude: { color: '#a3156b', dx: 0.006 * k, dy: 0.006 * k } });
    c.restore();
  }
  {
    const F = f.px;
    const k = F.k;
    const P = F.toPx;
    const [x, y] = P(0, 0.4);
    smallPrint(c, ['RECEIPT ↓'], x, y - 0.012 * k, 0.026 * k, '#ffe3f4', { align: 'center', weight: 700 });
  }
  // ---- back: battery hatch, label print, vents
  {
    const F = f.nz;
    const k = F.k;
    const P = F.toPx;
    const [hx, hy] = P(-0.3, 0.42);
    c.save();
    c.strokeStyle = 'rgba(120,0,70,0.55)';
    c.lineWidth = 0.006 * k;
    c.beginPath();
    rrect(c, hx, hy, 0.6 * k, 0.5 * k, 0.05 * k);
    c.stroke();
    c.restore();
    const [vx, vy] = P(0, -0.42);
    c.fillStyle = 'rgba(90,0,50,0.55)';
    for (let i = 0; i < 6; i++) fillPath(c, rrPath(vx - 0.25 * k + i * 0.09 * k, vy - 0.06 * k, 0.04 * k, 0.12 * k, 0.02 * k), 'rgba(90,0,50,0.6)');
    const [tx, ty] = P(0, -0.24);
    smallPrint(c, ['WARNING: MAY CAUSE REVENUE'], tx, ty, 0.03 * k, '#ffe3f4', { align: 'center', weight: 700 });
  }
  grain(c, 0, 0, s.w, s.h, 6000, 0.035, 9);
}

// ------------------------------------------------------------------ screen

function drawScreen(surf: Surface, on: boolean): void {
  const c = surf.c;
  const Wd = surf.w;
  const Hd = surf.h;
  const g = c.createLinearGradient(0, 0, 0, Hd);
  g.addColorStop(0, '#13261d');
  g.addColorStop(1, '#09140f');
  c.fillStyle = g;
  c.fillRect(0, 0, Wd, Hd);
  c.save();
  c.shadowColor = 'rgba(200,255,120,0.55)';
  c.shadowBlur = 10 * (c.getTransform().a || 1);
  c.font = font(22, FONTS.spaceMono, 700);
  c.fillStyle = 'rgba(215,255,58,0.75)';
  c.textBaseline = 'top';
  c.fillText('ZEROS PAY · SALE', 22, 16);
  c.textAlign = 'right';
  c.fillText('●●●●', Wd - 22, 16);
  c.textAlign = 'left';
  text(c, '$1.00', Wd / 2, 142, { size: 104, family: FONTS.archivoBlack, align: 'center', color: '#f4fff0' });
  if (on) {
    fillPath(c, rrPath(Wd / 2 - 158, 160, 316, 54, 27), LIME);
    text(c, 'APPROVED ✓', Wd / 2, 198, { size: 34, family: FONTS.archivoBlack, align: 'center', color: INK });
  } else {
    c.strokeStyle = LIME;
    c.lineWidth = 3;
    c.beginPath();
    rrect(c, Wd / 2 - 158, 160, 316, 54, 27);
    c.stroke();
    text(c, 'APPROVED ✓', Wd / 2, 198, { size: 34, family: FONTS.archivoBlack, align: 'center', color: LIME });
  }
  c.restore();
  c.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < Hd; y += 4) c.fillRect(0, y, Wd, 1.5);
}

// ------------------------------------------------------------------ card

function paintCard(s: Surface): void {
  const c = s.c;
  const half = s.w / 2;
  const Hc = s.h;
  // front (left half)
  const g = c.createLinearGradient(0, 0, half, Hc);
  g.addColorStop(0, '#e9ff6a');
  g.addColorStop(0.55, LIME);
  g.addColorStop(1, '#b9e81c');
  c.fillStyle = g;
  c.fillRect(0, 0, half, Hc);
  // big soft zero in the background
  c.save();
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 60;
  c.beginPath();
  c.ellipse(half * 0.62, Hc * 0.62, 190, 250, 0, 0, Math.PI * 2);
  c.stroke();
  c.restore();
  text(c, 'ZEROS', 34, 112, { size: 96, family: FONTS.bagel, color: INK });
  // contactless
  c.save();
  c.strokeStyle = INK;
  c.lineCap = 'round';
  c.lineWidth = 9;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(430, 72, 16 + i * 17, -0.8, 0.8);
    c.stroke();
  }
  c.restore();
  // chip (painted gold, metallic in the mask)
  const chip = { x: 46, y: 176, w: 104, h: 80 };
  const cg = c.createLinearGradient(chip.x, chip.y, chip.x + chip.w, chip.y + chip.h);
  cg.addColorStop(0, '#f7dc7a');
  cg.addColorStop(0.5, '#d7a531');
  cg.addColorStop(1, '#f2cf62');
  fillPath(c, rrPath(chip.x, chip.y, chip.w, chip.h, 14), cg);
  c.strokeStyle = 'rgba(120,80,10,0.8)';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(chip.x, chip.y + chip.h / 2);
  c.lineTo(chip.x + chip.w, chip.y + chip.h / 2);
  c.moveTo(chip.x + chip.w * 0.35, chip.y);
  c.lineTo(chip.x + chip.w * 0.35, chip.y + chip.h);
  c.moveTo(chip.x + chip.w * 0.65, chip.y);
  c.lineTo(chip.x + chip.w * 0.65, chip.y + chip.h);
  c.stroke();
  s.maskPath(rrPath(chip.x, chip.y, chip.w, chip.h, 14), 0.25, 1);
  // holo stripe down the right edge
  const hs = { x: 404, y: 150, w: 70, h: 640 };
  holoFill(c, rrPath(hs.x, hs.y, hs.w, hs.h, 12), hs.x, hs.y, hs.w, hs.h, 5);
  if (s.mask) {
    s.mask.ctx.fillStyle = 'rgb(255,46,220)';
    s.mask.ctx.beginPath();
    rrect(s.mask.ctx, hs.x, hs.y, hs.w, hs.h, 12);
    s.mask.ctx.fill();
  }
  // number + name
  c.save();
  c.font = font(36, FONTS.spaceMono, 700);
  c.fillStyle = INK;
  c.fillText('0000 0000', 46, 330);
  c.fillText('0000 0001', 46, 372);
  c.font = font(22, FONTS.spaceMono, 700);
  c.fillText('FOUNDER · CUSTOMER #1', 46, 418);
  c.restore();
  text(c, 'debit', 46, 760, { size: 40, family: FONTS.shrikhand, color: INK });
  grain(c, 0, 0, half, Hc, 3000, 0.04, 2);
  // back (right half): magstripe + signature
  c.fillStyle = '#c9f02a';
  c.fillRect(half, 0, half, Hc);
  c.fillStyle = '#18161a';
  c.fillRect(half + 70, 0, 110, Hc);
  if (s.mask) {
    s.mask.ctx.fillStyle = maskColor(0.18, 0.6);
    s.mask.ctx.fillRect(half + 70, 0, 110, Hc);
  }
  fillPath(c, rrPath(half + 230, 120, 220, 420, 10), '#fbfaf2');
  c.save();
  c.translate(half + 340, 330);
  c.rotate(-Math.PI / 2);
  text(c, 'once upon a time', 0, 14, { size: 44, family: FONTS.marker, align: 'center', color: '#2a2aa8' });
  c.restore();
  smallPrint(c, ['IF FOUND, SHIP IT.', 'ZEROS PAY'], half + 340, 600, 22, INK, { align: 'center', weight: 700 });
}

function cardGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const w = CARD.w;
  const h = CARD.h;
  const r = 0.05;
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const bev = 0.005;
  const depth = CARD.d - 2 * bev;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nz = nor.getZ(i);
    const fu = THREE.MathUtils.clamp((x + w / 2) / w, 0, 1);
    const fv = THREE.MathUtils.clamp((y + h / 2) / h, 0, 1);
    if (nz > 0.3) uv.setXY(i, fu * 0.5, fv);
    else if (nz < -0.3) uv.setXY(i, 0.5 + (1 - fu) * 0.5, fv);
    else uv.setXY(i, 0.01, 0.02);
  }
  uv.needsUpdate = true;
  return g;
}

// ------------------------------------------------------------------ receipt

function paintReceipt(c: C2D, x0: number, y0: number, Wr: number, Hr: number): void {
  c.save();
  c.translate(x0, y0);
  c.beginPath();
  c.rect(0, 0, Wr, Hr);
  c.clip();
  c.fillStyle = '#fbfaf5';
  c.fillRect(0, 0, Wr, Hr);
  // torn bottom edge (the free end), carved out of the alpha
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.moveTo(0, Hr);
  const teeth = 16;
  for (let i = 0; i <= teeth; i++) c.lineTo((Wr * i) / teeth, Hr - (i % 2 ? 18 : 2));
  c.lineTo(Wr, Hr);
  c.closePath();
  c.fill();
  c.restore();
  const ink = '#26262b';
  let y = 40;
  text(c, 'ZEROS PAY', Wr / 2, y + 40, { size: 50, family: FONTS.bagel, align: 'center', color: ink });
  y += 70;
  smallPrint(c, ['ONCE UPON A TIME, 00:00', 'TERMINAL FD-1 · STORE #0'], Wr / 2, y, 20, ink, { align: 'center', weight: 700, lineHeight: 26 });
  y += 74;
  text(c, '*** FIRST REVENUE!! ***', Wr / 2, y + 30, { size: 34, family: FONTS.archivoBlack, align: 'center', color: ink, maxWidth: Wr - 40 });
  y += 70;
  const row = (l: string, r: string, size = 24, bold = false) => {
    c.font = font(size, bold ? FONTS.archivoBlack : FONTS.spaceMono, bold ? 400 : 700);
    c.fillStyle = ink;
    c.textBaseline = 'top';
    c.textAlign = 'left';
    c.fillText(l, 30, y);
    c.textAlign = 'right';
    c.fillText(r, Wr - 30, y);
    c.textAlign = 'left';
    y += size * 1.45;
  };
  const dash = () => {
    c.fillStyle = ink;
    for (let x = 30; x < Wr - 30; x += 16) c.fillRect(x, y + 6, 9, 3);
    y += 22;
  };
  row('1 x MVP', '$1.00');
  row('1 x BIG DREAM', '$0.00');
  row('1 x SLEEPLESS NIGHT', '$0.00');
  row('5 YRS OF PIXELS', 'FREE');
  dash();
  row('SUBTOTAL', '$1.00');
  row('TAX (NONE YET)', '$0.00');
  dash();
  row('TOTAL', '$1.00', 40, true);
  y += 6;
  row('CARD', '···· 0001');
  row('AUTH', '000001');
  y += 10;
  fillPath(c, rrPath(30, y, Wr - 60, 64, 8), ink);
  text(c, 'APPROVED ✓', Wr / 2, y + 46, { size: 38, family: FONTS.archivoBlack, align: 'center', color: '#fbfaf5' });
  y += 92;
  smallPrint(c, ['THANK YOU, CUSTOMER #1!', 'MRR: $1  →  NEXT STOP $1M', 'keep this receipt forever'], Wr / 2, y, 21, ink, { align: 'center', weight: 700, lineHeight: 28 });
  y += 104;
  barcode(c, 60, y, Wr - 120, 110, 2024, { digits: '0000 0000 0001' });
  c.restore();
}

function receiptGeometry(x0: number): THREE.BufferGeometry {
  // centre line curls down and back under itself; v runs across (towards -Z)
  const N = 90;
  const pts: THREE.Vector3[] = [];
  const tans: THREE.Vector3[] = [];
  let px = x0;
  let py = RECEIPT.y;
  const ds = RECEIPT.len / N;
  for (let i = 0; i <= N; i++) {
    const s = i * ds;
    const th = -(0.55 * s + 1.75 * s * s);
    pts.push(new THREE.Vector3(px, py, 0.06 * s * s));
    tans.push(new THREE.Vector3(Math.cos(th), Math.sin(th), 0.12 * s));
    px += Math.cos(th) * ds;
    py += Math.sin(th) * ds;
  }
  const side = new THREE.Vector3();
  return parametric(
    N,
    6,
    (u, v, out) => {
      const fi = u * N;
      const i = Math.min(N - 1, Math.floor(fi));
      const t = fi - i;
      const p = pts[i].clone().lerp(pts[i + 1], t);
      const tan = tans[i].clone().lerp(tans[i + 1], t).normalize();
      // width vector: -Z, twisted a little around the tangent as the paper flops
      const tw = 0.35 * u * u;
      side.set(0, 0, -1).applyAxisAngle(tan, tw);
      // slight cupping across the width
      const across = v - 0.5;
      out.copy(p).addScaledVector(side, across * RECEIPT.w);
      const up = new THREE.Vector3().crossVectors(tan, side).normalize();
      out.addScaledVector(up, 0.03 * (1 - 4 * across * across) * Math.min(1, u * 4));
    },
    {
      uv: (u, v) => {
        const r = RECEIPT_CELL;
        return [(r.x + v * r.w) / SHEET_W, 1 - (r.y + u * r.h) / SHEET_H];
      },
    },
  );
}

// ------------------------------------------------------------------ stickers

function paintMRR(c: C2D): void {
  const path = sealPath(0, 0, 118, 14, 9);
  sticker(c, 0, 0, 0, path, { border: 10, fill: '#ffffff', shadow: 0.6 }, (k) => {
    holoFill(k, path, -130, -130, 260, 260, 3);
    text(k, '$1', 0, 18, { size: 104, family: FONTS.bagel, align: 'center', color: '#1b1640', outlines: [{ color: '#ffffff', width: 12 }] });
    text(k, 'MRR', 0, 66, { size: 36, family: FONTS.archivoBlack, align: 'center', color: '#1b1640' });
  });
}

function paintTap(c: C2D): void {
  sticker(c, 0, 0, 0, rrPath(-150, -100, 300, 200, 30), { border: 10, fill: INK, shadow: 0.6 }, (k) => {
    k.strokeStyle = LIME;
    k.lineCap = 'round';
    k.lineWidth = 14;
    for (let i = 0; i < 4; i++) {
      k.beginPath();
      k.arc(-80, -10, 18 + i * 22, -0.75, 0.75);
      k.stroke();
    }
    text(k, 'TAP', 52, -6, { size: 64, family: FONTS.archivoBlack, align: 'center', color: LIME });
    text(k, 'TO SHIP', 52, 44, { size: 36, family: FONTS.archivoBlack, align: 'center', color: '#ffffff' });
  });
}

function paintSerial(c: C2D): void {
  sticker(c, 0, 0, 0, rrPath(-230, -70, 460, 140, 10), { border: 0, fill: '#f7f6f0', shadow: 0.5 }, (k) => {
    barcode(k, -210, -52, 250, 92, 77, { digits: 'FD1 000000001' });
    smallPrint(k, ['MODEL FD-1', 'SN 000000001', 'MADE: ONCE UPON', 'A TIME'], 64, -50, 19, INK, { weight: 700, lineHeight: 23 });
  });
}

function paintCoffee(c: C2D): void {
  sticker(c, 0, 0, 0, circlePath(0, 0, 96), { border: 10, fill: '#3b2416', shadow: 0.6 }, (k) => {
    // cup
    fillPath(k, rrPath(-34, -26, 60, 64, [4, 4, 18, 18]), '#f7efe2');
    k.strokeStyle = '#f7efe2';
    k.lineWidth = 9;
    k.beginPath();
    k.arc(30, 4, 14, -Math.PI / 2, Math.PI / 2);
    k.stroke();
    k.lineWidth = 5;
    k.lineCap = 'round';
    for (const dx of [-16, 0, 14]) {
      k.beginPath();
      k.moveTo(dx - 4, -36);
      k.quadraticCurveTo(dx + 6, -46, dx - 2, -58);
      k.stroke();
    }
    text(k, 'BACKED BY', 0, -64, { size: 20, family: FONTS.archivoBlack, align: 'center', color: '#ffd38a' });
    text(k, 'COFFEE', 0, 74, { size: 30, family: FONTS.archivoBlack, align: 'center', color: '#ffd38a' });
  });
}

function paintSmile(c: C2D): void {
  sticker(c, 0, 0, 0, circlePath(0, 0, 70), { border: 9, fill: '#ffd21f', shadow: 0.6 }, (k) => smiley(k, 0, 0, 70));
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  const box = new SoftBox(W, H, D, R, taper);

  // ---------- body
  const AW = 2048;
  const AH = 2048;
  // the front gets the most pixels; everything else shares the rest of the sheet
  const rect = (f: FaceName, x: number, y: number, k: number): FaceRect => ({ x, y, w: Math.round(box.dims[f][0] * k), h: Math.round(box.dims[f][1] * k) });
  const rects: Record<FaceName, FaceRect> = {
    pz: rect('pz', 12, 12, 1000),
    nz: rect('nz', 1023, 12, 640),
    px: rect('px', 1679, 12, 640),
    nx: rect('nx', 1023, 988, 640),
    py: rect('py', 1397, 988, 640),
    ny: rect('ny', 1397, 1362, 640),
  };
  const faces = box.faceInfo(rects);
  const atlas = new Surface(AW, AH, bctx);
  paintBody(atlas, faces);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: atlas.colorTexture(),
    roughness: 0.3,
    metalness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    sheen: 0.3,
    sheenColor: new THREE.Color('#ffd0ec'),
  });
  inner.add(new THREE.Mesh(box.geometry(rects, AW, AH, { flat: 8, bevel: 6 }), bodyMat));

  // front-face placement helper (the front is flat at z = ZF; taper only scales x)
  const onFront = (g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry => {
    const t = THREE.MathUtils.clamp((y + H / 2) / H, 0, 1);
    return place(g, [x * (1 - 0.05 * t), y, ZF + z]);
  };

  // ---------- dark plastic: keypad well, screen bezel, card slot, receipt slot, feet
  const dark: THREE.BufferGeometry[] = [];
  dark.push(onFront(new RoundedBoxGeometry(PANEL.w, PANEL.h, 0.05, 3, 0.05), PANEL.cx, PANEL.cy, 0.0));
  {
    const bez = new THREE.Shape();
    const ow = SCREEN.w + 0.1;
    const oh = SCREEN.h + 0.1;
    const rr = 0.06;
    const rect = (p: THREE.Shape | THREE.Path, w: number, h: number, r: number) => {
      p.moveTo(-w / 2 + r, -h / 2);
      p.lineTo(w / 2 - r, -h / 2);
      p.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      p.lineTo(w / 2, h / 2 - r);
      p.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      p.lineTo(-w / 2 + r, h / 2);
      p.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      p.lineTo(-w / 2, -h / 2 + r);
      p.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    };
    rect(bez, ow, oh, rr);
    const hole = new THREE.Path();
    rect(hole, SCREEN.w, SCREEN.h, 0.025);
    bez.holes.push(hole);
    const bg = new THREE.ExtrudeGeometry(bez, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3, curveSegments: 8 });
    dark.push(onFront(bg, SCREEN.cx, SCREEN.cy, -0.01));
  }
  // card slot on the top, receipt slot on the right side
  dark.push(place(new RoundedBoxGeometry(CARD.w + 0.12, 0.07, 0.12, 3, 0.03), [0, H / 2 - 0.005, 0]));
  dark.push(place(new RoundedBoxGeometry(0.05, 0.085, RECEIPT.w + 0.1, 3, 0.02), [W / 2 * (1 - 0.05 * ((RECEIPT.y + H / 2) / H)) + 0.006, RECEIPT.y, 0]));
  for (const [fx, fz] of [
    [-0.33, 0.18],
    [0.33, 0.18],
    [-0.33, -0.18],
    [0.33, -0.18],
  ]) {
    dark.push(place(new THREE.CylinderGeometry(0.07, 0.075, 0.04, 20), [fx, -H / 2 - 0.012, fz]));
  }
  const darkGeo = merge(dark);
  dark.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(darkGeo, new THREE.MeshPhysicalMaterial({ color: '#1d1a22', roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.15 })));

  // ---------- screen (emissive, blinks APPROVED)
  const scr = new Surface(512, 248, bctx, { density: 1 });
  const scrTex = canvasTexture(scr.color.canvas, bctx, true);
  scrTex.generateMipmaps = false;
  scrTex.minFilter = THREE.LinearFilter;
  drawScreen(scr, true);
  scrTex.needsUpdate = true;
  const scrGeo = onFront(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), SCREEN.cx, SCREEN.cy, 0.004);
  const scrMat = new THREE.MeshPhysicalMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: scrTex, emissiveIntensity: 1.35, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 });
  inner.add(new THREE.Mesh(scrGeo, scrMat));

  // ---------- one transparent sheet for stickers, keycap legends and the receipt
  const sheet = new Surface(SHEET_W, SHEET_H, bctx, { transparent: true, density: 1 });
  const cell = (x: number, y: number, w: number, h: number): AtlasCell => ({ x, y, w, h, uv: [x / SHEET_W, 1 - (y + h) / SHEET_H, (x + w) / SHEET_W, 1 - y / SHEET_H] });
  const inSheet = (cl: AtlasCell, fn: (c: C2D) => void) => {
    const c = sheet.c;
    c.save();
    c.translate(cl.x + cl.w / 2, cl.y + cl.h / 2);
    fn(c);
    c.restore();
  };
  const legends = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#', 'F', '✕', '←', '✓'];
  {
    const c = sheet.c;
    const lc = LEGEND.size / 4;
    c.fillStyle = '#ffffff';
    c.fillRect(LEGEND.x, LEGEND.y, LEGEND.size, LEGEND.size);
    legends.forEach((lg, i) => {
      const cx = LEGEND.x + (i % 4) * lc + lc / 2;
      const cy = LEGEND.y + Math.floor(i / 4) * lc + lc / 2;
      const big = lg === '✕' || lg === '✓' || lg === '←';
      text(c, lg, cx, cy + lc * (big ? 0.17 : 0.16), { size: lc * (big ? 0.5 : 0.46), family: big ? FONTS.ui : FONTS.archivoBlack, weight: 700, align: 'center', color: '#24161e' });
    });
  }
  paintReceipt(sheet.c, RECEIPT_CELL.x, RECEIPT_CELL.y, RECEIPT_CELL.w, RECEIPT_CELL.h);
  const cMRR = cell(12, 12, 270, 270);
  inSheet(cMRR, paintMRR);
  const cTap = cell(12, 306, 300, 206);
  inSheet(cTap, paintTap);
  const cSmile = cell(334, 306, 150, 150);
  inSheet(cSmile, paintSmile);
  const cSerial = cell(12, 540, 480, 160);
  inSheet(cSerial, paintSerial);
  const cCoffee = cell(12, 724, 220, 220);
  inSheet(cCoffee, paintCoffee);
  const sheetTex = sheet.colorTexture();

  const cap = new RoundedBoxGeometry(KEY.w, KEY.h, KEY.d, 2, KEY.r);
  {
    const pos = cap.getAttribute('position') as THREE.BufferAttribute;
    const uv = cap.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const f = 1 - 0.1 * THREE.MathUtils.clamp((z + KEY.d / 2) / KEY.d, 0, 1);
      pos.setX(i, pos.getX(i) * f);
      pos.setY(i, pos.getY(i) * f);
    }
    const front = cap.groups.find((g) => g.materialIndex === 4)!;
    // a key is wider than tall: crop the square legend cell to the key's aspect
    const ah = KEY.h / KEY.w;
    const cu = LEGEND.size / 4 / SHEET_W;
    const cv = LEGEND.size / 4 / SHEET_H;
    const u0 = LEGEND.x / SHEET_W;
    const vTop = 1 - LEGEND.y / SHEET_H;
    for (let i = 0; i < uv.count; i++) {
      if (i >= front.start && i < front.start + front.count) uv.setXY(i, u0 + uv.getX(i) * cu, vTop - cv + (0.5 - ah / 2 + uv.getY(i) * ah) * cv);
      else uv.setXY(i, u0 + 0.5 * cu, vTop - 0.04 * cv);
    }
    cap.clearGroups();
    pos.needsUpdate = true;
    uv.needsUpdate = true;
  }
  const keyColors: string[] = [];
  const keyLegend: number[] = [];
  const keyPos: [number, number][] = [];
  const numeric = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  KEY_ROWS.forEach((ky, r) => {
    for (let ci = 0; ci < 3; ci++) {
      keyPos.push([KEY_COLS[ci], ky]);
      keyLegend.push(numeric[r * 3 + ci]);
      keyColors.push(CREAM);
    }
    keyPos.push([KEY_COLS[3], ky]);
    keyLegend.push(12 + r);
    keyColors.push(['#c9c2ff', '#ff4747', '#ffd21f', '#33d17a'][r]);
  });
  const nKeys = keyPos.length;
  const keys = new THREE.InstancedMesh(cap, new THREE.MeshPhysicalMaterial({ map: sheetTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }), nKeys);
  const offsets = new Float32Array(nKeys * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const kr = rng(4);
  for (let i = 0; i < nKeys; i++) {
    const [x, y] = keyPos[i];
    const t = THREE.MathUtils.clamp((y + H / 2) / H, 0, 1);
    q.setFromEuler(new THREE.Euler(0, 0, (kr() - 0.5) * 0.04));
    m.compose(new THREE.Vector3(x * (1 - 0.05 * t), y, ZF + 0.025 + KEY.d / 2), q, new THREE.Vector3(1, 1, 1));
    keys.setMatrixAt(i, m);
    keys.setColorAt(i, col.set(keyColors[i]));
    const li = keyLegend[i];
    offsets[i * 2] = ((li % 4) * LEGEND.size) / 4 / SHEET_W;
    offsets[i * 2 + 1] = -(Math.floor(li / 4) * LEGEND.size) / 4 / SHEET_H;
  }
  cap.setAttribute('legendOffset', new THREE.InstancedBufferAttribute(offsets, 2));
  const keyMat = keys.material as THREE.MeshPhysicalMaterial;
  keyMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 legendOffset;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv += legendOffset;\n#endif');
  };
  keyMat.customProgramCacheKey = () => 'fd1-keycap-legends';
  keys.instanceMatrix.needsUpdate = true;
  if (keys.instanceColor) keys.instanceColor.needsUpdate = true;
  keys.computeBoundingSphere();
  inner.add(keys);

  // ---------- status LED on the top
  const ledGeo = place(new THREE.SphereGeometry(0.03, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), [0.38 * 0.95, H / 2 - 0.004, 0.17], [0, 0, 0], [1, 0.7, 1]);
  const ledMat = new THREE.MeshPhysicalMaterial({ color: '#7dff6a', emissive: '#46ff3a', emissiveIntensity: 2.2, roughness: 0.15, clearcoat: 1 });
  inner.add(new THREE.Mesh(ledGeo, ledMat));

  // ---------- the card, chip-first in the top slot
  const cardSurf = new Surface(1024, 804, bctx, { mask: { rough: 0.32, metal: 0 } });
  paintCard(cardSurf);
  const cardMask = cardSurf.maskTexture()!;
  const cardMat = new THREE.MeshPhysicalMaterial({
    map: cardSurf.colorTexture(),
    roughnessMap: cardMask,
    metalnessMap: cardMask,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    iridescence: 1,
    iridescenceMap: cardMask,
    iridescenceIOR: 1.8,
    iridescenceThicknessMinimum: 180,
    iridescenceThicknessMaximum: 820,
  });
  const cardGeo = cardGeometry();
  cardGeo.rotateX(-0.06);
  cardGeo.translate(0, H / 2 + CARD.h / 2 - CARD.inserted, 0);
  inner.add(new THREE.Mesh(cardGeo, cardMat));

  // ---------- receipt curling out of the side
  const receiptMat = paperBackfaces(
    new THREE.MeshPhysicalMaterial({ map: sheetTex, alphaTest: 0.5, roughness: 0.55, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.6 }),
    '#f2efe6',
  );
  inner.add(new THREE.Mesh(receiptGeometry(W / 2 * (1 - 0.05 * ((RECEIPT.y + H / 2) / H)) + 0.02), receiptMat));

  // ---------- stickers
  const [luPX] = box.dims.px;
  const holo = [
    stickerPatch(box.at('px'), 0.0, 0.52, 0.27, 0.27, 12 * DEG, cMRR.uv, {
      nx: 10,
      ny: 10,
      offset: 0.008,
      lift: (u, v) => 0.035 * Math.pow(THREE.MathUtils.smoothstep(u, 0.7, 1) * THREE.MathUtils.smoothstep(1 - v, 0.55, 1), 2),
    }),
  ];
  const paper = [
    stickerPatch(box.at('px'), 0.02, -0.28, 0.4, 0.275, -6 * DEG, cTap.uv, { nx: 6, ny: 6, offset: 0.006 }),
    stickerPatch(box.wrapAt('px', 'nz', 'right'), luPX / 2, -0.04, 0.5, 0.152, 4 * DEG, cSerial.uv, { nx: 16, ny: 4, offset: 0.006 }),
    stickerPatch(box.at('py'), -0.3, 0.1, 0.17, 0.17, 0, cSmile.uv, { nx: 4, ny: 4, offset: 0.006 }),
    stickerPatch(box.at('nz'), 0.2, 0.0, 0.26, 0.26, -14 * DEG, cCoffee.uv, {
      nx: 8,
      ny: 8,
      offset: 0.006,
      lift: (u, v) => 0.03 * Math.pow(THREE.MathUtils.smoothstep(1 - u, 0.7, 1) * THREE.MathUtils.smoothstep(v, 0.6, 1), 2),
    }),
  ];
  const holoGeo = merge(holo);
  const paperGeo = merge(paper);
  [...holo, ...paper].forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(paperGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.12 }), '#f3efe6')));
  inner.add(new THREE.Mesh(holoGeo, paperBackfaces(holoFoil(sheetTex, { metalness: 0.3, roughness: 0.22 }), '#f3efe6')));

  // ---------- animation: APPROVED blinks, the LED breathes
  let lastOn = true;
  const update = (t: number) => {
    const on = Math.floor(t * 1.6) % 2 === 0;
    if (on !== lastOn) {
      lastOn = on;
      drawScreen(scr, on);
      scrTex.needsUpdate = true;
    }
    ledMat.emissiveIntensity = 1.2 + 1.4 * (0.5 + 0.5 * Math.sin(t * 4));
  };
  return finish(inner, trash, update, 'first-dollar');
}

export const cardreader: LibraryDef = {
  kind: 'cardreader',
  name: 'First Dollar',
  tagline: '$1.00 · approved',
  category: 'founder',
  defaultRotation: [0.22, -0.56, 0.05],
  build,
};
export default cardreader;
