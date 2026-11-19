import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet, type AtlasCell } from '../textures';
import { Trash, finish } from '../build';
import { lathe, merge, parametric, stickerPatch, surfaces, type SurfacePoint } from '../geometry';
import { chrome, glossyPlastic, stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, rng, text, sticker, rrPath, rrect, fillPath, starPath, smallPrint, grain, hexA, type C2D } from '../paint';
import { ZEROS, roundedRect, trayWalls, colourByFacing } from './_studio';

/*
 * PAINTBOX: an open enamelled watercolour tin. Hot-pink enamel outside, white inside,
 * two rows of rainbow half-pans (a few dug out), the hinged lid opened ~105 degrees
 * with pressed mixing wells full of washes, and a wet brush resting across the box.
 * Centimetres, normalised afterwards.
 */

const W = 12.0; // outer width (x)
const D = 6.6; // outer depth (z)
const H = 1.6; // base height
const RC = 0.7; // plan corner radius
const T = 0.14; // wall thickness
const BEV = 0.05;
const FLOOR_Y = 0.12;
const IW = W - 2 * T; // interior
const ID = D - 2 * T;
const LID_H = 0.62;
const LID_PANEL_Y = 0.3; // lid inner panel height (lid local frame)
const OPEN = 105 * DEG;

const ENAMEL = '#ff4fb8';
const ENAMEL_INNER = '#fbf8f2';

const PAN = { w: 1.62, d: 1.95, h: 0.78, pitch: 1.84, rowGap: 0.12 };
const PAINTS = [
  // back row (warm), then front row (cool)
  '#ffe14d',
  '#ffb21f',
  '#ff7a1a',
  '#ff3b2f',
  '#e0115f',
  '#ff4fb8',
  '#8b4dff',
  '#2b4bff',
  '#19b7ff',
  '#0fc58a',
  '#d7ff3a',
  '#a0522d',
];
/** Dug-out pans: index -> [dent depth, dent x, dent z, spread]. */
const DENTS: Record<number, [number, number, number, number]> = {
  2: [0.16, 0.12, -0.2, 0.42],
  5: [0.26, -0.15, 0.18, 0.5],
  7: [0.3, 0.05, 0.05, 0.55],
  10: [0.2, 0.18, -0.25, 0.45],
  3: [0.08, -0.2, 0.3, 0.35],
};
const BLUE = '#2b4bff';

/** Atlas: lid inner panel (A), tray floor (B), lid outside (C). */
const AW = 2048;
const AH = 1656;
const RA = { x: 0, y: 0, w: 2048, h: 1104 };
const RB = { x: 0, y: 1104, w: 1024, h: 552 };
const RCo = { x: 1024, y: 1104, w: 1024, h: 552 };
const toUV = (r: { x: number; y: number; w: number; h: number }, s: number, t: number): [number, number] => [(r.x + s * r.w) / AW, 1 - (r.y + t * r.h) / AH];

function panCentre(i: number): [number, number] {
  const row = Math.floor(i / 6);
  const k = i % 6;
  const x = (k - 2.5) * PAN.pitch;
  const zBack = -D / 2 + T + 0.15 + PAN.d / 2;
  return [x, zBack + row * (PAN.d + PAN.rowGap)];
}

/** Mixing wells in the lid, lid-local (x, z) centres and half sizes. */
const WELLS: [number, number, number, number][] = [
  [-4.25, 0.75, 1.15, 1.45],
  [-1.42, 0.75, 1.15, 1.45],
  [1.42, 0.75, 1.15, 1.45],
  [4.25, 0.75, 1.15, 1.45],
];
const WELL_DEPTH = 0.2;

function wellAmount(x: number, z: number): number {
  let a = 0;
  for (const [cx, cz, hw, hh] of WELLS) {
    const d = Math.pow(Math.pow(Math.abs(x - cx) / hw, 6) + Math.pow(Math.abs(z - cz) / hh, 6), 1 / 6);
    a = Math.max(a, 1 - THREE.MathUtils.smoothstep(d, 0.8, 1.0));
  }
  return a;
}

// ------------------------------------------------------------------ geometry

/**
 * Flat rounded-rect plate in the XZ plane at height y, facing +Y (or -Y), with UVs into an
 * atlas rect: rect left = -x (or +x when `mirror`), rect top = -z.
 */
function plate(w: number, d: number, r: number, y: number, up: boolean, rect: { x: number; y: number; w: number; h: number } | null, mirror = false): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(roundedRect(new THREE.Shape(), w, d, r), 12);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); // shape XY -> XZ, facing +Y / -Y
  g.translate(0, y, 0);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const s = mirror ? 0.5 - pos.getX(i) / w : pos.getX(i) / w + 0.5;
    const t = pos.getZ(i) / d + 0.5;
    if (rect) uv.setXY(i, ...toUV(rect, s, t));
    else uv.setXY(i, 0, 0);
  }
  uv.needsUpdate = true;
  return g;
}

/** Lid inner panel (lid-local, facing +Y) with pressed mixing wells. u -> +x, v -> -z. */
function lidPanel(): THREE.BufferGeometry {
  const iw = IW - 0.02;
  const id = ID - 0.02;
  return parametric(
    132,
    76,
    (u, v, out) => {
      const x = (u - 0.5) * iw;
      const z = (0.5 - v) * id;
      out.set(x, LID_PANEL_Y - WELL_DEPTH * wellAmount(x, z), z);
    },
    { uv: (u, v) => toUV(RA, u, 1 - v) },
  );
}

/** One paint cake: a flat-ish top inside a pan hole with a meniscus and an optional dug-out dent. */
function paintCake(i: number, color: string, seed: number): THREE.BufferGeometry {
  const pw = PAN.w - 0.14;
  const pd = PAN.d - 0.14;
  const rr = 0.13;
  const dent = DENTS[i];
  const r = rng(seed);
  const tilt = (r() - 0.5) * 0.04;
  const g = parametric(18, 22, (u, v, out) => {
    let x = (u - 0.5) * pw;
    let z = (0.5 - v) * pd;
    // round the corners
    const ax = Math.abs(x) - (pw / 2 - rr);
    const az = Math.abs(z) - (pd / 2 - rr);
    if (ax > 0 && az > 0) {
      const l = Math.hypot(ax, az);
      const k = rr / l;
      if (l > rr) {
        x = Math.sign(x) * (pw / 2 - rr + ax * k);
        z = Math.sign(z) * (pd / 2 - rr + az * k);
      }
    }
    const edge = Math.max(Math.abs(x) / (pw / 2), Math.abs(z) / (pd / 2));
    let y = 0.035 * Math.pow(THREE.MathUtils.smoothstep(edge, 0.75, 1), 2) + tilt * x;
    if (dent) {
      const [depth, dx, dz, spread] = dent;
      const q = ((x - dx) ** 2) / (spread * spread) + ((z - dz) ** 2) / (spread * spread * 1.4);
      y -= depth * Math.exp(-q * 1.6);
    }
    out.set(x, y, z);
  });
  // vertex colours: mottled cake, darker + richer where the brush dug in
  const pos = g.getAttribute('position');
  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.62);
  const light = base.clone().lerp(new THREE.Color('#ffffff'), 0.22);
  const cols = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    const n = 0.5 + 0.5 * Math.sin(x * 2.3 + z * 1.7 + i) * Math.sin(x * 1.3 - z * 2.9 + i * 2.1);
    tmp.copy(base).lerp(light, n * 0.3);
    if (y < -0.01) tmp.lerp(dark, THREE.MathUtils.clamp(-y / 0.18, 0, 1) * 0.75);
    cols[k * 3] = tmp.r;
    cols[k * 3 + 1] = tmp.g;
    cols[k * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

/** Brush along +Y, end at y = 0, tip at y = BRUSH_L. Returns [lacquer + bristles (vertex coloured), ferrule]. */
const BRUSH_L = 13.5;
function brush(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const handle = lathe(
    [
      [0, 0],
      [0.14, 0.0],
      [0.19, 0.08],
      [0.2, 0.3],
      [0.2, 1.15],
      [0.205, 1.2],
      [0.235, 3.6],
      [0.285, 7.2],
      [0.27, 8.9],
      [0.255, 9.3],
      [0, 9.32],
    ],
    { segments: 36 },
  );
  const ferrule = lathe(
    [
      [0, 9.25],
      [0.262, 9.25],
      [0.283, 9.36],
      [0.283, 9.62],
      [0.27, 9.68],
      [0.283, 9.74],
      [0.283, 10.55],
      [0.262, 10.9],
      [0.24, 11.0],
      [0, 11.0],
    ],
    { segments: 36 },
  );
  const bristles = lathe(
    [
      [0, 10.9],
      [0.245, 10.9],
      [0.285, 11.45],
      [0.275, 12.2],
      [0.2, 12.85],
      [0.09, 13.3],
      [0, BRUSH_L],
    ],
    { segments: 32, radial: (phi, j) => (j > 0 && j < 6 ? 0.008 * Math.sin(phi * 23) : 0) },
  );
  const paintCol = (g: THREE.BufferGeometry, fn: (y: number) => THREE.Color) => {
    const pos = g.getAttribute('position');
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = fn(pos.getY(i));
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  };
  const lime = new THREE.Color(ZEROS.lime);
  const navy = new THREE.Color('#1a2fd6');
  paintCol(handle, (y) => (y < 1.18 ? lime : navy));
  const hair = new THREE.Color('#d8b27a');
  const wet = new THREE.Color(BLUE);
  const tmp = new THREE.Color();
  paintCol(bristles, (y) => tmp.copy(hair).lerp(wet, THREE.MathUtils.smoothstep(y, 11.4, 12.4)).clone());
  const lacquer = merge([handle, bristles]);
  handle.dispose();
  bristles.dispose();
  return [lacquer, ferrule];
}

// ------------------------------------------------------------------ print

/** A dried watercolour puddle: irregular flat wash, darker tide line, a wet highlight and some granulation. */
function wash(c: C2D, x: number, y: number, rx: number, ry: number, color: string, seed: number, alpha = 0.75): void {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  const blob = (k: number) => {
    c.beginPath();
    const n = 72;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const w = k * (0.86 + 0.07 * Math.sin(a * 3 + ph[0]) + 0.05 * Math.sin(a * 5 + ph[1]) + 0.03 * Math.sin(a * 11 + ph[2]));
      const px = x + Math.cos(a) * rx * w;
      const py = y + Math.sin(a) * ry * w;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
  };
  c.save();
  blob(1);
  const g = c.createRadialGradient(x - rx * 0.2, y - ry * 0.2, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, hexA(color, alpha * 0.55));
  g.addColorStop(0.7, hexA(color, alpha * 0.8));
  g.addColorStop(1, hexA(color, alpha));
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = hexA(color, Math.min(1, alpha * 1.25));
  c.lineWidth = Math.max(rx, ry) * 0.05;
  c.stroke();
  // granulation
  c.clip();
  for (let i = 0; i < 160; i++) {
    const px = x + (r() - 0.5) * rx * 2;
    const py = y + (r() - 0.5) * ry * 2;
    c.fillStyle = hexA(color, 0.25 + r() * 0.3);
    c.fillRect(px, py, 2 + r() * 3, 2 + r() * 3);
  }
  // wet highlight
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.beginPath();
  c.ellipse(x - rx * 0.35, y - ry * 0.45, rx * 0.28, ry * 0.08, -0.3, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function smear(c: C2D, pts: [number, number][], width: number, color: string, alpha = 0.85): void {
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = hexA(color, alpha);
  c.lineWidth = width;
  c.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
  c.stroke();
  c.strokeStyle = hexA(color, alpha * 0.5);
  c.lineWidth = width * 1.6;
  c.stroke();
  c.restore();
}

function paintAtlas(s: Surface): void {
  const c = s.c;
  c.fillStyle = ENAMEL_INNER;
  c.fillRect(0, 0, AW, AH);

  // ---------- A: lid inside (canvas up = the lid's free edge). 1 cm = kA px
  {
    const k = RA.w / IW;
    const P = (x: number, z: number): [number, number] => [RA.x + (x / IW + 0.5) * RA.w, RA.y + (z / ID + 0.5) * RA.h];
    // washes in three wells, the fourth is clean
    const tints = [BLUE, ZEROS.pink, '#9be22d', null];
    WELLS.forEach(([cx, cz, hw, hh], i) => {
      const [x, y] = P(cx, cz);
      const t = tints[i];
      if (t) wash(c, x, y, hw * k * 0.8, hh * k * 0.74, t, 30 + i, 0.78);
    });
    // a mixed puddle running between two wells
    wash(c, ...P(-2.85, 1.95), 0.55 * k, 0.28 * k, '#7a3dff', 41, 0.6);
    // printed brand line along the top (free edge)
    const [tx, ty] = P(0, -2.25);
    text(c, 'ZEROS  ARTIST  COLOURS', tx - 1.6 * k, ty + 0.18 * k, { size: 0.5 * k, family: FONTS.archivoBlack, align: 'center', color: hexA('#1b1b1f', 0.82), tracking: 0.04 * k });
    smallPrint(c, ['No. 0 · 12 half pans · every colour, no undo'], tx - 1.6 * k, ty + 0.36 * k, 0.24 * k, hexA('#1b1b1f', 0.6), { align: 'center', family: FONTS.spaceMono, weight: 700 });
    // colour index dots under the brand line
    PAINTS.forEach((col, i) => fillPath(c, (q) => q.arc(tx - 1.6 * k + (i - 5.5) * 0.36 * k, ty + 0.92 * k, 0.11 * k, 0, Math.PI * 2), col));
    // drips running down from the wells
    smear(c, [P(4.6, 1.9), P(4.62, 2.4), P(4.58, 2.9)], 0.13 * k, ZEROS.pink, 0.55);
    smear(c, [P(-4.5, 1.95), P(-4.45, 2.6)], 0.11 * k, BLUE, 0.45);
  }

  // ---------- B: tray floor (canvas up = back)
  {
    const k = RB.w / IW;
    const P = (x: number, z: number): [number, number] => [RB.x + (x / IW + 0.5) * RB.w, RB.y + (z / ID + 0.5) * RB.h];
    // blue streak where the wet brush lies, plus splashes
    smear(c, [P(-4.6, 2.35), P(-3.6, 2.2), P(-2.4, 2.32), P(-1.6, 2.15)], 0.32 * k, BLUE, 0.7);
    smear(c, [P(1.2, 1.6), P(2.4, 1.85), P(3.1, 1.55)], 0.24 * k, ZEROS.pink, 0.6);
    smear(c, [P(4.4, 2.6), P(5.2, 2.75)], 0.2 * k, '#ffb21f', 0.6);
    const r = rng(8);
    for (let i = 0; i < 26; i++) {
      const [x, y] = P((r() - 0.5) * IW * 0.95, 1.2 + r() * 1.9);
      fillPath(c, (q) => q.arc(x, y, (0.03 + r() * 0.08) * k, 0, Math.PI * 2), hexA(PAINTS[Math.floor(r() * PAINTS.length)], 0.75));
    }
    // smudges between the pans
    for (let i = 0; i < 5; i++) {
      const [x, y] = P((r() - 0.5) * IW * 0.9, -2.9 + r() * 3.6);
      fillPath(c, (q) => q.ellipse(x, y, 0.25 * k, 0.12 * k, r() * 3, 0, Math.PI * 2), hexA(PAINTS[Math.floor(r() * PAINTS.length)], 0.5));
    }
  }

  // ---------- C: lid outside (seen from behind when open). Canvas up = the lid's free edge.
  {
    const { x: rx, y: ry, w: rw, h: rh } = RCo;
    c.fillStyle = ENAMEL;
    c.fillRect(rx, ry, rw, rh);
    const k = rw / W;
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    // cream label with the wordmark
    c.save();
    c.fillStyle = '#fff6e6';
    c.beginPath();
    rrect(c, cx - 4.3 * k, cy - 1.95 * k, 8.6 * k, 3.9 * k, 0.5 * k);
    c.fill();
    c.strokeStyle = '#1b1b1f';
    c.lineWidth = 0.06 * k;
    c.beginPath();
    rrect(c, cx - 4.1 * k, cy - 1.75 * k, 8.2 * k, 3.5 * k, 0.35 * k);
    c.stroke();
    c.restore();
    text(c, 'PAINTBOX', cx, cy + 0.35 * k, { size: 1.55 * k, family: FONTS.bagel, align: 'center', color: ENAMEL, outlines: [{ color: '#1b1b1f', width: 0.16 * k }], extrude: { color: '#1b1b1f', dx: 0.08 * k, dy: 0.1 * k } });
    text(c, 'every colour, no undo', cx, cy + 1.15 * k, { size: 0.5 * k, family: FONTS.marker, align: 'center', color: '#1b1b1f' });
    // rainbow strip of the twelve colours
    const sw = (7.4 * k) / PAINTS.length;
    PAINTS.forEach((col, i) => {
      c.fillStyle = col;
      c.fillRect(cx - 3.7 * k + i * sw, cy - 1.45 * k, sw + 0.5, 0.42 * k);
    });
    smallPrint(c, ['ZEROS ARTIST COLOURS · No. 0 · MADE ONCE UPON A TIME'], cx, ry + rh - 0.55 * k, 0.22 * k, '#ffffff', { align: 'center', weight: 700 });
  }
  grain(c, 0, 0, AW, AH, 9000, 0.035, 5);
}

// ------------------------------------------------------------------ stickers

function inCell(sheet: StickerSheet, cell: AtlasCell, fn: (c: C2D) => void): void {
  const c = sheet.surf.c;
  c.save();
  c.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  fn(c);
  c.restore();
}

function paintStickers(sheet: StickerSheet) {
  // NO UNDO: crossed-out cmd+Z
  const cUndo = sheet.alloc(420, 176);
  inCell(sheet, cUndo, (c) => {
    sticker(c, 0, 0, 0, rrPath(-196, -76, 392, 152, 22), { border: 12, fill: '#141418', shadow: 0.7 }, (k) => {
      fillPath(k, rrPath(-176, -56, 132, 112, 18), '#ffffff');
      text(k, '⌘Z', -110, 22, { size: 58, family: FONTS.ui, weight: 700, align: 'center', color: '#141418' });
      k.strokeStyle = '#ff3b2f';
      k.lineWidth = 12;
      k.lineCap = 'round';
      k.beginPath();
      k.moveTo(-166, 44);
      k.lineTo(-54, -44);
      k.stroke();
      text(k, 'NO', 62, -6, { size: 54, family: FONTS.archivoBlack, align: 'center', color: ZEROS.lime });
      text(k, 'UNDO', 62, 46, { size: 54, family: FONTS.archivoBlack, align: 'center', color: '#ffffff', maxWidth: 220 });
    });
  });
  // starburst on the lid inside
  const cStar = sheet.alloc(250, 250);
  inCell(sheet, cStar, (c) => {
    const path = starPath(0, 0, 112, 90, 16, -Math.PI / 2, 0.4);
    sticker(c, 0, 0, 0, path, { border: 9, fill: ZEROS.lime, shadow: 0.6 }, (k) => {
      text(k, '12', 0, 10, { size: 84, family: FONTS.bagel, align: 'center', color: '#141418' });
      text(k, 'COLOURS!', 0, 50, { size: 30, family: FONTS.archivoBlack, align: 'center', color: '#141418' });
      text(k, 'artist grade', 0, -52, { size: 22, family: FONTS.marker, align: 'center', color: '#141418' });
    });
  });
  // wet-paint drip hanging over the front rim (no border: it's paint)
  const cDrip = sheet.alloc(200, 150);
  inCell(sheet, cDrip, (c) => {
    c.save();
    c.fillStyle = BLUE;
    c.beginPath();
    c.moveTo(-90, -70);
    c.lineTo(90, -70);
    c.lineTo(84, -42);
    const drip = (x: number, len: number, w: number) => {
      c.lineTo(x + w, -42);
      c.bezierCurveTo(x + w * 0.7, -30, x + w, len - w * 1.2, x + w, len - w);
      c.arc(x, len - w, w, 0, Math.PI);
      c.bezierCurveTo(x - w, len - w * 1.2, x - w * 0.7, -30, x - w, -42);
    };
    drip(52, 40, 11);
    drip(4, 66, 15);
    drip(-50, 22, 9);
    c.lineTo(-84, -42);
    c.closePath();
    c.fill();
    // wet highlight
    c.fillStyle = hexA('#ffffff', 0.55);
    c.beginPath();
    c.ellipse(2, 44, 4, 10, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  });
  // round ONCE UPON A TIME seal for the lid's outside
  const cSeal = sheet.alloc(210, 210);
  inCell(sheet, cSeal, (c) => {
    sticker(c, 0, 0, 0, (q) => q.arc(0, 0, 92, 0, Math.PI * 2), { border: 9, fill: '#141418', shadow: 0.6 }, (k) => {
      fillPath(k, (q) => q.arc(0, 0, 74, 0, Math.PI * 2), ZEROS.lime);
      text(k, 'once', 0, -14, { size: 40, family: FONTS.shrikhand, align: 'center', color: '#141418' });
      text(k, 'upon a time', 0, 22, { size: 26, family: FONTS.shrikhand, align: 'center', color: '#141418' });
      text(k, '✶ 2026 ✶', 0, 50, { size: 16, family: FONTS.spaceMono, weight: 700, align: 'center', color: '#141418' });
    });
  });
  return { cUndo, cStar, cDrip, cSeal };
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // lid transform: closed = flipped over the base; opened about the back hinge
  const hinge = new THREE.Vector3(0, H, -D / 2);
  const lidM = new THREE.Matrix4()
    .makeTranslation(hinge.x, hinge.y, hinge.z)
    .multiply(new THREE.Matrix4().makeRotationX(-OPEN))
    .multiply(new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z))
    .multiply(new THREE.Matrix4().makeTranslation(0, H + LID_H, 0))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI));

  // ---------- enamel shell: base walls + bottom, lid walls (vertex coloured pink / white)
  const base = colourByFacing(trayWalls(W, D, RC, T, H, BEV), ENAMEL, ENAMEL_INNER, ENAMEL);
  const bottom = colourByFacing(plate(W - 2 * BEV, D - 2 * BEV, RC - BEV, -0.002, false, null), ENAMEL, ENAMEL, ENAMEL);
  const lidWalls = colourByFacing(trayWalls(W, D, RC, T, LID_H, BEV), ENAMEL, ENAMEL_INNER, ENAMEL);
  lidWalls.applyMatrix4(lidM);
  const shellGeo = merge([base, bottom, lidWalls]);
  [base, bottom, lidWalls].forEach((g) => g.dispose());
  const enamelMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05 });
  inner.add(new THREE.Mesh(shellGeo, enamelMat));

  // ---------- printed / painted enamel surfaces: lid inside (wells), tray floor, lid outside
  const atlas = new Surface(AW, AH, bctx, { density: 1 });
  paintAtlas(atlas);
  const panel = lidPanel();
  panel.applyMatrix4(lidM);
  const floor = plate(IW + 0.02, ID + 0.02, RC - T, FLOOR_Y, true, RB);
  // lid outside (lid-local y = 0, looking down): printed so it reads upright from behind while open
  const lidOuter = plate(W - 2 * BEV, D - 2 * BEV, RC - BEV, -0.002, false, RCo, true);
  lidOuter.applyMatrix4(lidM);
  const printGeo = merge([panel, floor, lidOuter]);
  [panel, floor, lidOuter].forEach((g) => g.dispose());
  const printMat = new THREE.MeshPhysicalMaterial({ map: atlas.colorTexture(), roughness: 0.26, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.06 });
  printMat.color.setScalar(1.08); // white enamel reads white, not grey
  inner.add(new THREE.Mesh(printGeo, printMat));

  // ---------- pans (instanced white plastic) + paint cakes (merged, vertex coloured)
  const panGeo = trayWalls(PAN.w, PAN.d, 0.2, 0.07, PAN.h, 0.025);
  const pans = new THREE.InstancedMesh(panGeo, glossyPlastic('#ffffff', { roughness: 0.22, clearcoat: 0.9 }), PAINTS.length);
  const m = new THREE.Matrix4();
  const cakes: THREE.BufferGeometry[] = [];
  PAINTS.forEach((col, i) => {
    const [x, z] = panCentre(i);
    m.makeTranslation(x, FLOOR_Y, z);
    pans.setMatrixAt(i, m);
    const cake = paintCake(i, col, 100 + i);
    cake.translate(x, FLOOR_Y + PAN.h - 0.11, z);
    cakes.push(cake);
  });
  pans.instanceMatrix.needsUpdate = true;
  pans.computeBoundingSphere();
  inner.add(pans);
  const cakeGeo = merge(cakes);
  cakes.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(cakeGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35 })));

  // ---------- brush resting across the front trough, handle out over the right wall
  const [lacquer, ferrule] = brush();
  const placeBrush = (g: THREE.BufferGeometry) => {
    g.rotateZ(Math.PI / 2); // +Y -> -X: tip to the left
    g.rotateZ(9.5 * DEG); // tip lower
    g.rotateY(0.05);
    g.translate(9.9, 2.55, 1.6);
    return g;
  };
  placeBrush(lacquer);
  placeBrush(ferrule);
  inner.add(new THREE.Mesh(lacquer, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04 })));

  // ---------- chrome: ferrule + hinge knuckles
  const hingeParts: THREE.BufferGeometry[] = [ferrule];
  for (const x of [-3.9, 3.9]) {
    const k = new THREE.CylinderGeometry(0.13, 0.13, 1.5, 20);
    k.rotateZ(Math.PI / 2);
    k.translate(x, H + 0.02, -D / 2 - 0.06);
    hingeParts.push(k);
    const pin = new THREE.CylinderGeometry(0.06, 0.06, 1.7, 12);
    pin.rotateZ(Math.PI / 2);
    pin.translate(x, H + 0.02, -D / 2 - 0.06);
    hingeParts.push(pin);
  }
  const chromeGeo = merge(hingeParts);
  hingeParts.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(chromeGeo, chrome({ roughness: 0.12 })));

  // ---------- stickers
  const sheet = new StickerSheet(1024, 768, bctx, 14);
  const cells = paintStickers(sheet);
  const sheetTex = sheet.surf.colorTexture();
  const front = surfaces.plane(new THREE.Vector3(0, 0, D / 2 + 0.004), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  // lid inside: flat area above the wells, in lid-local coordinates (a = x, b = -z)
  const lidInside = (a: number, b: number): SurfacePoint => ({ p: new THREE.Vector3(a, LID_PANEL_Y, -b), n: new THREE.Vector3(0, 1, 0) });
  // lid outside: lid-local y = 0 face looking down; a = x, b = -z
  const lidOutside = (a: number, b: number): SurfacePoint => ({ p: new THREE.Vector3(-a, 0, -b), n: new THREE.Vector3(0, -1, 0) });
  const undo = stickerPatch(front, 3.15, 0.8, 2.75, 1.15, -4 * DEG, cells.cUndo.uv, {
    nx: 10,
    ny: 5,
    offset: 0.003,
    lift: (u, v) => 0.25 * Math.pow(THREE.MathUtils.smoothstep(u, 0.7, 1) * THREE.MathUtils.smoothstep(v, 0.5, 1), 2),
  });
  const drip = stickerPatch(front, -2.6, H - 0.52, 1.4, 1.05, 0, cells.cDrip.uv, { nx: 4, ny: 4, offset: 0.002 });
  const star = stickerPatch(lidInside, 4.55, 2.25, 1.75, 1.75, 12 * DEG, cells.cStar.uv, { nx: 6, ny: 6, offset: 0.006 });
  star.applyMatrix4(lidM);
  const seal = stickerPatch(lidOutside, 3.9, -1.5, 1.6, 1.6, -10 * DEG, cells.cSeal.uv, { nx: 6, ny: 6, offset: 0.006 });
  seal.applyMatrix4(lidM);
  const stickersGeo = merge([undo, drip, star, seal]);
  [undo, drip, star, seal].forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.32, clearcoat: 0.8 }), '#f3efe6')));

  return finish(inner, trash, undefined, 'paintbox');
}

export const paintbox: LibraryDef = {
  kind: 'paintbox',
  name: 'Paintbox',
  tagline: 'every colour, no undo',
  category: 'studio',
  defaultRotation: [0.62, -0.38, 0.06],
  build,
};
export default paintbox;
