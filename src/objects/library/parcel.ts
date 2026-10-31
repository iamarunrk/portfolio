import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet, grey } from '../textures';
import { Trash, finish } from '../build';
import { merge, stickerPatch, type BoxFaceInfo, type FaceName } from '../geometry';
import { stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, rng, text, arcText, smallPrint, barcode, hazard, sticker, rrPath, circlePath, fillPath, rrect, hexA, type C2D } from '../paint';
import { SoftBox, stripOnBox, inCell, stampInk, FACES, type Leg } from './_founder';

/*
 * SHIP-IT BOX: a pillowy kraft shipping carton, flaps closed with a visible seam, a lime
 * "SHIP IT" tape running front-to-back over the top and a hot pink FRAGILE tape crossing it
 * down both sides. Shipping label, stamped FRAGILE / THIS SIDE UP, a caution sticker over
 * the top edge and a Zeros sticker around the front-right corner. Units ~ 30 cm.
 */

const W = 1.6;
const H = 1.05;
const D = 1.25;
const R = 0.075;
const TAPE_W = 0.25;
/** x of the lime tape (runs front -> top -> back). */
const XB = -0.24;
/** z of the pink tape (runs left -> top -> right). */
const ZA = -0.3;
/** How far both tapes run down the sides below the flat top edge. */
const DROP = 0.4;

const KRAFT = '#c99559';
const INK = '#21170f';
const STAMP_RED = '#d32a26';
const LIME = '#d7ff3a';
const PINK = '#ff4fb8';

// ------------------------------------------------------------------ shape

function dent(p: THREE.Vector3, c: [number, number, number], dir: [number, number, number], rad: number, depth: number): void {
  const dx = p.x - c[0];
  const dy = p.y - c[1];
  const dz = p.z - c[2];
  const d2 = (dx * dx + dy * dy + dz * dz) / (rad * rad);
  if (d2 >= 1) return;
  const k = (1 - d2) * (1 - d2) * depth;
  p.x += dir[0] * k;
  p.y += dir[1] * k;
  p.z += dir[2] * k;
}

/** Overfilled carton: every face pillows out a little, plus two soft knocks on the edges. */
function deform(p: THREE.Vector3): void {
  const hw = W / 2;
  const hh = H / 2;
  const hd = D / 2;
  const ux = p.x / hw;
  const uy = p.y / hh;
  const uz = p.z / hd;
  const fx = Math.max(0, 1 - ux * ux);
  const fy = Math.max(0, 1 - uy * uy);
  const fz = Math.max(0, 1 - uz * uz);
  p.x += 0.018 * ux * fy * fz;
  p.y += (uy > 0 ? 0.05 : 0.014) * uy * fx * fz;
  p.z += 0.022 * uz * fx * fy;
  // flaps sag a touch along the seam (z = 0 on the top)
  if (uy > 0.6) p.y -= 0.012 * Math.exp(-((p.z / 0.05) ** 2)) * fx * THREE.MathUtils.smoothstep(uy, 0.6, 1);
  dent(p, [-hw * 0.62, hh, hd], [0.1, -0.7, -0.7], 0.32, 0.05);
  dent(p, [hw, -hh * 0.35, -hd], [-0.7, 0.05, 0.7], 0.27, 0.04);
}

// ------------------------------------------------------------------ print

function kraftFace(s: Surface, f: BoxFaceInfo, seed: number): void {
  const c = s.c;
  const { x, y, w, h } = f.rect;
  const k = f.k;
  const B = 12;
  const r = rng(seed);
  c.save();
  c.beginPath();
  c.rect(x - B, y - B, w + 2 * B, h + 2 * B);
  c.clip();
  c.fillStyle = KRAFT;
  c.fillRect(x - B, y - B, w + 2 * B, h + 2 * B);
  // mottled fibre board
  for (let i = 0; i < 12; i++) {
    const bx = x + r() * w;
    const by = y + r() * h;
    const rad = (0.12 + r() * 0.35) * k;
    const g = c.createRadialGradient(bx, by, 0, bx, by, rad);
    const col = r() > 0.5 ? '255,226,180' : '120,72,28';
    g.addColorStop(0, `rgba(${col},${0.05 + r() * 0.07})`);
    g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g;
    c.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
  }
  // corrugation washboarding (flutes run along the face's up axis)
  const step = 0.034 * k;
  for (let xx = x - B; xx < x + w + B; xx += step) {
    c.fillStyle = 'rgba(95,55,15,0.06)';
    c.fillRect(xx, y - B, step * 0.42, h + 2 * B);
  }
  // fibres, batched into a few strokes (light / dark, two strengths each)
  c.lineCap = 'round';
  const fibreStyles = ['rgba(255,232,190,0.13)', 'rgba(255,232,190,0.2)', 'rgba(90,52,18,0.1)', 'rgba(90,52,18,0.16)'];
  fibreStyles.forEach((style, si) => {
    c.strokeStyle = style;
    c.lineWidth = si % 2 ? 1.2 : 1.6;
    c.beginPath();
    for (let i = 0; i < 600; i++) {
      const fx = x + r() * w;
      const fy = y + r() * h;
      const len = 2 + r() * 9;
      const a = r() * Math.PI;
      c.moveTo(fx, fy);
      c.lineTo(fx + Math.cos(a) * len, fy + Math.sin(a) * len);
    }
    c.stroke();
  });
  // scuffed, darker edges (the bevels)
  const e = 0.07 * k;
  const edge = (gx0: number, gy0: number, gx1: number, gy1: number, rx: number, ry: number, rw: number, rh: number) => {
    const g = c.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(92,52,18,0.26)');
    g.addColorStop(1, 'rgba(92,52,18,0)');
    c.fillStyle = g;
    c.fillRect(rx, ry, rw, rh);
  };
  edge(x, 0, x + e, 0, x - B, y - B, e + B, h + 2 * B);
  edge(x + w, 0, x + w - e, 0, x + w - e, y - B, e + B, h + 2 * B);
  edge(0, y, 0, y + e, x - B, y - B, w + 2 * B, e + B);
  edge(0, y + h, 0, y + h - e, x - B, y + h - e, w + 2 * B, e + B);
  c.restore();
  // bump: washboard ridges + fibre noise
  s.bumpDraw((b) => {
    b.beginPath();
    b.rect(x - B, y - B, w + 2 * B, h + 2 * B);
    b.clip();
    for (let xx = x - B; xx < x + w + B; xx += step) {
      b.fillStyle = grey(0.535);
      b.fillRect(xx, y - B, step * 0.5, h + 2 * B);
    }
    for (const g of [0.42, 0.47, 0.55, 0.6]) {
      b.fillStyle = grey(g);
      b.beginPath();
      for (let i = 0; i < 180; i++) b.rect(x + r() * w, y + r() * h, 2 + r() * 4, 1 + r() * 2);
      b.fill();
    }
  });
}

/** Printed ink sits in the fibres: multiply it on. */
function ink(c: C2D, alpha: number, fn: () => void): void {
  c.save();
  c.globalCompositeOperation = 'multiply';
  c.globalAlpha = alpha;
  fn();
  c.restore();
}

function upArrows(c: C2D, cx: number, cy: number, s: number, color: string): void {
  c.save();
  c.translate(cx, cy);
  c.fillStyle = color;
  for (const dx of [-0.3 * s, 0.3 * s]) {
    c.fillRect(dx - 0.07 * s, -0.22 * s, 0.14 * s, 0.62 * s);
    c.beginPath();
    c.moveTo(dx - 0.22 * s, -0.16 * s);
    c.lineTo(dx, -0.52 * s);
    c.lineTo(dx + 0.22 * s, -0.16 * s);
    c.closePath();
    c.fill();
  }
  c.fillRect(-0.56 * s, 0.48 * s, 1.12 * s, 0.1 * s);
  c.restore();
}

function wineGlass(c: C2D, cx: number, cy: number, s: number, color: string): void {
  c.save();
  c.translate(cx, cy);
  c.fillStyle = color;
  c.strokeStyle = color;
  c.beginPath();
  c.moveTo(-0.32 * s, -0.5 * s);
  c.lineTo(0.32 * s, -0.5 * s);
  c.quadraticCurveTo(0.34 * s, 0.02 * s, 0.04 * s, 0.08 * s);
  c.lineTo(0.04 * s, 0.4 * s);
  c.lineTo(0.24 * s, 0.48 * s);
  c.lineTo(-0.24 * s, 0.48 * s);
  c.lineTo(-0.04 * s, 0.4 * s);
  c.lineTo(-0.04 * s, 0.08 * s);
  c.quadraticCurveTo(-0.34 * s, 0.02 * s, -0.32 * s, -0.5 * s);
  c.closePath();
  c.fill();
  // crack
  c.globalCompositeOperation = 'destination-out';
  c.lineWidth = 0.05 * s;
  c.lineJoin = 'miter';
  c.beginPath();
  c.moveTo(-0.06 * s, -0.5 * s);
  c.lineTo(0.06 * s, -0.36 * s);
  c.lineTo(-0.05 * s, -0.24 * s);
  c.lineTo(0.08 * s, -0.1 * s);
  c.stroke();
  c.restore();
}

function recycle(c: C2D, cx: number, cy: number, s: number, color: string): void {
  c.save();
  c.translate(cx, cy);
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 0.13 * s;
  c.lineCap = 'butt';
  for (let i = 0; i < 3; i++) {
    const a0 = (i * 120 - 80) * DEG;
    const a1 = a0 + 80 * DEG;
    c.beginPath();
    c.arc(0, 0, 0.42 * s, a0, a1);
    c.stroke();
    const hx = Math.cos(a1) * 0.42 * s;
    const hy = Math.sin(a1) * 0.42 * s;
    const tx = -Math.sin(a1);
    const ty = Math.cos(a1);
    c.beginPath();
    c.moveTo(hx + Math.cos(a1) * 0.16 * s, hy + Math.sin(a1) * 0.16 * s);
    c.lineTo(hx + tx * 0.2 * s, hy + ty * 0.2 * s);
    c.lineTo(hx - Math.cos(a1) * 0.16 * s, hy - Math.sin(a1) * 0.16 * s);
    c.closePath();
    c.fill();
  }
  c.restore();
}

/** The Zeros mark: a fat oval zero with a diagonal slash. */
function zeroMark(c: C2D, cx: number, cy: number, s: number, color: string): void {
  c.save();
  c.translate(cx, cy);
  c.strokeStyle = color;
  c.lineCap = 'round';
  c.lineWidth = 0.2 * s;
  c.beginPath();
  c.ellipse(0, 0, 0.36 * s, 0.48 * s, 0, 0, Math.PI * 2);
  c.stroke();
  c.lineWidth = 0.1 * s;
  c.beginPath();
  c.moveTo(-0.26 * s, 0.34 * s);
  c.lineTo(0.26 * s, -0.34 * s);
  c.stroke();
  c.restore();
}

function paintFront(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const k = f.k;
  const P = f.toPx;
  // THIS SIDE UP
  {
    const [x, y] = P(-0.53, 0.2);
    ink(c, 0.9, () => upArrows(c, x, y, 0.24 * k, INK));
    const [tx, ty] = P(-0.53, -0.02);
    ink(c, 0.9, () => text(c, 'THIS SIDE UP', tx, ty, { size: 0.052 * k, family: FONTS.archivoBlack, align: 'center', color: INK, tracking: 0.004 * k }));
  }
  // FRAGILE stamp
  {
    const [x, y] = P(-0.4, -0.25);
    c.save();
    c.translate(x, y);
    c.rotate(-9 * DEG);
    const sw = 0.62 * k;
    const sh = 0.24 * k;
    stampInk(c, -sw / 2 - 10, -sh / 2 - 10, sw + 20, sh + 20, 71, 0.92, (q) => {
      q.strokeStyle = STAMP_RED;
      q.lineWidth = 0.016 * k;
      q.beginPath();
      rrect(q, -sw / 2, -sh / 2, sw, sh, 0.02 * k);
      q.stroke();
      q.lineWidth = 0.007 * k;
      q.beginPath();
      rrect(q, -sw / 2 + 0.022 * k, -sh / 2 + 0.022 * k, sw - 0.044 * k, sh - 0.044 * k, 0.012 * k);
      q.stroke();
      text(q, 'FRAGILE', 0, 0.035 * k, { size: 0.135 * k, family: FONTS.archivoBlack, align: 'center', color: STAMP_RED, maxWidth: sw - 0.08 * k, tracking: 0.008 * k });
      text(q, 'HANDLE WITH HYPE', 0, 0.088 * k, { size: 0.036 * k, family: FONTS.spaceMono, weight: 700, align: 'center', color: STAMP_RED, maxWidth: sw - 0.1 * k });
    });
    c.restore();
  }
  {
    const [x, y] = P(0.36, -0.4);
    ink(c, 0.85, () =>
      text(c, 'ZEROS SHIPPING CO. · EST. ONCE UPON A TIME', x, y, { size: 0.027 * k, family: FONTS.spaceMono, weight: 700, align: 'center', color: INK, maxWidth: 0.7 * k }),
    );
  }
}

function paintRight(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const k = f.k;
  const P = f.toPx;
  const [mx, my] = P(-0.33, -0.16);
  ink(c, 0.92, () => zeroMark(c, mx, my, 0.26 * k, INK));
  const [wx, wy] = P(0.1, -0.08);
  ink(c, 0.92, () => text(c, 'ZEROS', wx, wy, { size: 0.24 * k, family: FONTS.bagel, align: 'center', color: INK, maxWidth: 0.62 * k }));
  const [sx, sy] = P(0.1, -0.17);
  ink(c, 0.85, () => text(c, 'SHIP-IT DEPARTMENT', sx, sy, { size: 0.042 * k, family: FONTS.archivoBlack, align: 'center', color: INK, tracking: 0.006 * k, maxWidth: 0.62 * k }));
  // pictogram row: keep dry, fragile, this way up
  const icons: [number, (cx: number, cy: number) => void][] = [
    [-0.24, (cx, cy) => wineGlass(c, cx, cy, 0.12 * k, INK)],
    [0.0, (cx, cy) => upArrows(c, cx, cy, 0.1 * k, INK)],
    [0.24, (cx, cy) => recycle(c, cx, cy, 0.11 * k, INK)],
  ];
  for (const [ix, fn] of icons) {
    const [cx, cy] = P(ix, -0.36);
    ink(c, 0.85, () => {
      c.strokeStyle = INK;
      c.lineWidth = 0.006 * k;
      c.strokeRect(cx - 0.085 * k, cy - 0.085 * k, 0.17 * k, 0.17 * k);
      fn(cx, cy);
    });
  }
}

function paintLeft(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const k = f.k;
  const P = f.toPx;
  // box maker's certificate
  const [cx, cy] = P(0.27, -0.2);
  ink(c, 0.88, () => {
    const R1 = 0.2 * k;
    c.strokeStyle = INK;
    c.lineWidth = 0.008 * k;
    c.beginPath();
    c.arc(cx, cy, R1, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 0.004 * k;
    c.beginPath();
    c.arc(cx, cy, R1 - 0.05 * k, 0, Math.PI * 2);
    c.stroke();
    arcText(c, "BOX MAKER'S CERTIFICATE", cx, cy, R1 - 0.032 * k, -Math.PI / 2, { size: 0.026 * k, family: FONTS.archivoBlack, color: INK, tracking: 0.002 * k });
    arcText(c, 'ZEROS CORRUGATED CO.', cx, cy, R1 - 0.018 * k, Math.PI / 2, { size: 0.026 * k, family: FONTS.archivoBlack, color: INK, tracking: 0.002 * k }, true);
    smallPrint(c, ['THIS BOX MEETS ALL', 'CONSTRUCTION RULES', 'BURST TEST  200 IDEAS', 'SIZE LIMIT  1 MVP', 'GROSS WT    0 BUGS'], cx, cy - 0.085 * k, 0.019 * k, INK, {
      weight: 700,
      align: 'center',
      lineHeight: 0.034 * k,
    });
  });
  const [rx, ry] = P(-0.3, -0.16);
  ink(c, 0.88, () => recycle(c, rx, ry, 0.22 * k, INK));
  const [tx, ty] = P(-0.3, -0.36);
  ink(c, 0.85, () => smallPrint(c, ['100% RECYCLED', 'IDEAS'], tx, ty, 0.03 * k, INK, { weight: 700, align: 'center', family: FONTS.archivoBlack, lineHeight: 0.036 * k }));
}

function paintBack(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const k = f.k;
  const P = f.toPx;
  // hot pink priority band (printed)
  {
    const [x0, y0] = P(-0.73, -0.24);
    const [x1, y1] = P(0.73, -0.4);
    ink(c, 0.95, () => {
      c.fillStyle = PINK;
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
    });
    const [tx, ty] = P(0, -0.345);
    text(c, 'PRIORITY · OVERNIGHT · TO PRODUCTION', tx, ty, { size: 0.06 * k, family: FONTS.archivoBlack, align: 'center', color: '#fff6fb', maxWidth: 1.36 * k });
  }
  const [gx, gy] = P(-0.48, 0.14);
  ink(c, 0.9, () => wineGlass(c, gx, gy, 0.3 * k, INK));
  const [hx, hy] = P(-0.48, -0.08);
  ink(c, 0.9, () => smallPrint(c, ['HANDLE', 'WITH CARE'], hx, hy, 0.045 * k, INK, { family: FONTS.archivoBlack, align: 'center', lineHeight: 0.05 * k }));
  const [px, py] = P(0.42, 0.12);
  ink(c, 0.85, () =>
    smallPrint(
      c,
      ['ONCE UPON A TIME A PRODUCT', 'DESIGNER PACKED AN IDEA IN', 'THIS BOX, TAPED IT SHUT AND', 'WROTE "SHIP IT" ON THE SIDE.', '', 'CONTENTS: 1 MVP, SOME BUGS,', '5 YRS OF PIXELS, HOPE.'],
      px,
      py,
      0.026 * k,
      INK,
      { weight: 700, align: 'center', lineHeight: 0.036 * k },
    ),
  );
}

function paintTop(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const k = f.k;
  const P = f.toPx;
  const { x, w } = f.rect;
  // the flap seam: a dark gap with corrugated board edges either side
  const [, sy] = P(0, 0);
  c.save();
  c.fillStyle = 'rgba(70,40,12,0.55)';
  c.fillRect(x, sy - 0.022 * k, w, 0.044 * k);
  c.fillStyle = '#3a220c';
  c.fillRect(x, sy - 0.006 * k, w, 0.012 * k);
  c.strokeStyle = 'rgba(232,196,140,0.75)';
  c.lineWidth = 0.004 * k;
  for (const side of [-1, 1]) {
    const yy = sy + side * 0.014 * k;
    c.beginPath();
    for (let xx = x; xx <= x + w; xx += 2) {
      const v = yy + Math.sin((xx - x) / (0.012 * k)) * 0.005 * k;
      if (xx === x) c.moveTo(xx, v);
      else c.lineTo(xx, v);
    }
    c.stroke();
  }
  c.restore();
  s.bumpDraw((b) => {
    b.fillStyle = grey(0.3);
    b.fillRect(x, sy - 0.018 * k, w, 0.036 * k);
    b.fillStyle = grey(0.12);
    b.fillRect(x, sy - 0.006 * k, w, 0.012 * k);
  });
  // marker scribbles
  const [mx, my] = P(0.4, -0.2);
  c.save();
  c.translate(mx, my);
  c.rotate(-7 * DEG);
  ink(c, 0.92, () => {
    text(c, 'MVP v1', 0, 0, { size: 0.12 * k, family: FONTS.marker, align: 'center', color: '#141414' });
    text(c, 'do not open till launch!', 0, 0.075 * k, { size: 0.042 * k, family: FONTS.marker, align: 'center', color: '#141414' });
    c.strokeStyle = '#141414';
    c.lineWidth = 0.008 * k;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-0.16 * k, 0.1 * k);
    c.quadraticCurveTo(0, 0.13 * k, 0.17 * k, 0.095 * k);
    c.stroke();
  });
  c.restore();
  const [hx, hy] = P(0.58, 0.42);
  ink(c, 0.9, () => text(c, '♥', hx, hy, { size: 0.09 * k, family: FONTS.ui, weight: 700, align: 'center', color: STAMP_RED }, 12 * DEG));
  // OPEN HERE along the back edge
  const [ox, oy] = P(0.22, 0.5);
  ink(c, 0.8, () => {
    text(c, '✂ OPEN HERE', ox, oy, { size: 0.034 * k, family: FONTS.spaceMono, weight: 700, align: 'center', color: INK });
    c.strokeStyle = INK;
    c.lineWidth = 0.004 * k;
    c.setLineDash([0.02 * k, 0.014 * k]);
    c.beginPath();
    c.moveTo(ox - 0.4 * k, oy + 0.02 * k);
    c.lineTo(ox + 0.4 * k, oy + 0.02 * k);
    c.stroke();
    c.setLineDash([]);
  });
}

function paintBottom(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const k = f.k;
  const P = f.toPx;
  const { x, w } = f.rect;
  const [, sy] = P(0, 0);
  c.fillStyle = '#3a220c';
  c.fillRect(x, sy - 0.006 * k, w, 0.012 * k);
  const [tx, ty] = P(0, -0.3);
  ink(c, 0.85, () => text(c, 'LOT 0001 · PACKED WITH LOVE · NOT A BUG, A FEATURE', tx, ty, { size: 0.03 * k, family: FONTS.spaceMono, weight: 700, align: 'center', color: INK }));
}

// ------------------------------------------------------------------ tape

function paintTape(c: C2D, y0: number, w: number, h: number, base: string, inkCol: string, words: string, seed: number): void {
  const r = rng(seed);
  c.save();
  // torn zigzag ends, straight edges
  c.beginPath();
  const teeth = 9;
  const tw = 14;
  c.moveTo(tw, y0);
  c.lineTo(w - tw, y0);
  for (let i = 0; i <= teeth; i++) c.lineTo(w - (i % 2 ? 0 : tw) - r() * 4, y0 + (h * i) / teeth);
  c.lineTo(tw, y0 + h);
  for (let i = teeth; i >= 0; i--) c.lineTo((i % 2 ? 0 : tw) + r() * 4, y0 + (h * i) / teeth);
  c.closePath();
  c.fillStyle = base;
  c.fill();
  c.clip();
  // edge rules
  c.fillStyle = inkCol;
  c.fillRect(0, y0 + h * 0.08, w, h * 0.045);
  c.fillRect(0, y0 + h * 0.875, w, h * 0.045);
  // repeating type
  c.font = `400 ${h * 0.5}px ${FONTS.archivoBlack}`;
  c.textBaseline = 'middle';
  c.fillStyle = inkCol;
  const unit = c.measureText(words).width;
  for (let xx = -unit * 0.3; xx < w; xx += unit) c.fillText(words, xx, y0 + h * 0.52);
  // glossy streaks / wrinkles
  for (let i = 0; i < 10; i++) {
    c.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`;
    const xx = r() * w;
    c.fillRect(xx, y0, 2 + r() * 10, h);
  }
  c.restore();
}

// ------------------------------------------------------------------ stickers

function paintLabel(c: C2D): void {
  sticker(c, 0, 0, 0, rrPath(-290, -200, 580, 400, 12), { border: 0, fill: '#fbfaf4', shadow: 0.45 }, (k) => {
    fillPath(k, rrPath(-290, -200, 580, 66, [12, 12, 0, 0]), INK);
    text(k, 'PRIORITY · MVP', -268, -153, { size: 38, family: FONTS.archivoBlack, color: '#ffffff', maxWidth: 400 });
    fillPath(k, rrPath(196, -192, 80, 50, 8), LIME);
    text(k, 'P1', 236, -153, { size: 36, family: FONTS.archivoBlack, align: 'center', color: INK });
    smallPrint(k, ['FROM:', 'A PRODUCT DESIGNER', '12 ONCE UPON A TIME LN', 'DESIGNLAND 00000'], -268, -120, 19, INK, { weight: 700, lineHeight: 22 });
    k.fillStyle = INK;
    k.fillRect(-276, -26, 552, 4);
    text(k, 'SHIP TO:', -268, 8, { size: 24, family: FONTS.archivoBlack, color: INK });
    text(k, 'PRODUCTION', -268, 62, { size: 58, family: FONTS.archivoBlack, color: INK, maxWidth: 360 });
    smallPrint(k, ['1 LAUNCH AVENUE', 'THE INTERNET  WWW 404'], -266, 74, 20, INK, { weight: 700, lineHeight: 23 });
    // routing box
    k.lineWidth = 5;
    k.strokeStyle = INK;
    k.strokeRect(118, -112, 152, 152);
    text(k, 'Z0', 194, -16, { size: 86, family: FONTS.archivoBlack, align: 'center', color: INK });
    smallPrint(k, ['ZONE', '1 OF 1'], 194, 4, 17, INK, { weight: 700, align: 'center', lineHeight: 18 });
    barcode(k, -268, 128, 380, 64, 909, { digits: 'ZRS 0000 0000 0001' });
    smallPrint(k, ['WT: 1 MVP', 'DIM: BIG', 'SIGN: ✓'], 128, 132, 19, INK, { weight: 700, lineHeight: 22 });
  });
}

function paintCaution(c: C2D): void {
  sticker(c, 0, 0, 0, rrPath(-250, -112, 500, 224, 18), { border: 10, fill: '#ffd21f', shadow: 0.6 }, (k) => {
    hazard(k, -260, -122, 520, 46, 20, '#ffd21f', '#141414');
    hazard(k, -260, 76, 520, 46, 20, '#ffd21f', '#141414');
    fillPath(k, (q) => {
      q.moveTo(-200, 44);
      q.lineTo(-150, -42);
      q.lineTo(-100, 44);
      q.closePath();
    }, '#141414');
    text(k, '!', -150, 34, { size: 62, family: FONTS.archivoBlack, align: 'center', color: '#ffd21f' });
    text(k, 'CAUTION', 36, 4, { size: 70, family: FONTS.archivoBlack, align: 'center', color: '#141414', maxWidth: 300 });
    text(k, 'CONTAINS MVP · HANDLE WITH HYPE', 36, 44, { size: 21, family: FONTS.spaceMono, weight: 700, align: 'center', color: '#141414', maxWidth: 300 });
  });
}

function paintZeros(c: C2D): void {
  sticker(c, 0, 0, 0, circlePath(0, 0, 128), { border: 11, fill: LIME, shadow: 0.6 }, (k) => {
    zeroMark(k, 0, -22, 112, INK);
    text(k, 'ZEROS', 0, 82, { size: 46, family: FONTS.bagel, align: 'center', color: INK });
    arcText(k, 'SHIP IT · SHIP IT · SHIP IT ·', 0, 0, 112, -Math.PI / 2, { size: 15, family: FONTS.spaceMono, weight: 700, color: hexA(INK, 0.75) });
  });
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  const box = new SoftBox(W, H, D, R, deform);

  // ---------- carton with a printed kraft atlas
  const AW = 2048;
  const AH = 2048;
  const rects = box.packRects(590, [
    ['pz', 'nz'],
    ['py', 'ny'],
    ['px', 'nx'],
  ]);
  const faces = box.faceInfo(rects);
  const atlas = new Surface(AW, AH, bctx, { mask: { rough: 0.78, metal: 0 }, bump: { base: 0.5, density: 0.5 } });
  atlas.c.fillStyle = KRAFT;
  atlas.c.fillRect(0, 0, AW, AH);
  FACES.forEach((f, i) => kraftFace(atlas, faces[f], 11 + i * 7));
  paintFront(atlas, faces.pz);
  paintRight(atlas, faces.px);
  paintLeft(atlas, faces.nx);
  paintBack(atlas, faces.nz);
  paintTop(atlas, faces.py);
  paintBottom(atlas, faces.ny);
  // creases around the two knocks
  atlas.bumpDraw((b) => {
    const wr = rng(5);
    const crease = (f: FaceName, cx: number, cy: number) => {
      const fi = faces[f];
      for (let i = 0; i < 4; i++) {
        const [x0, y0] = fi.toPx(cx + (wr() - 0.5) * 0.2, cy + (wr() - 0.5) * 0.12);
        const a = wr() * Math.PI;
        const l = (0.05 + wr() * 0.08) * fi.k;
        b.strokeStyle = grey(0.32);
        b.lineWidth = 3;
        b.beginPath();
        b.moveTo(x0 - Math.cos(a) * l, y0 - Math.sin(a) * l);
        b.quadraticCurveTo(x0, y0 + 6, x0 + Math.cos(a) * l, y0 + Math.sin(a) * l);
        b.stroke();
      }
    };
    crease('pz', -0.5, 0.42);
    crease('py', -0.5, -0.5);
    crease('px', 0.55, -0.18);
  });
  const mask = atlas.maskTexture();
  const cartonMat = new THREE.MeshPhysicalMaterial({
    map: atlas.colorTexture(),
    roughnessMap: mask,
    metalnessMap: mask,
    roughness: 1,
    metalness: 1,
    bumpMap: atlas.bumpTexture(),
    bumpScale: 2.2,
    sheen: 0.5,
    sheenColor: new THREE.Color('#ffd9a6'),
    sheenRoughness: 0.65,
    clearcoat: 0.18,
    clearcoatRoughness: 0.55,
  });
  inner.add(new THREE.Mesh(box.geometry(rects, AW, AH, { flat: 16, bevel: 5 }), cartonMat));

  // ---------- the two tapes (one texture, one draw call)
  const TW = 2048;
  const TH = 512;
  const tape = new Surface(TW, TH, bctx, { transparent: true, density: 1 });
  const stripH = 236;
  paintTape(tape.c, 6, TW, stripH, LIME, INK, 'SHIP IT ✦ SHIP IT ✦ ', 3);
  paintTape(tape.c, 6 + stripH + 16, TW, stripH, PINK, '#fff7fb', 'FRAGILE · HANDLE WITH HYPE · ', 8);
  const uvB: [number, number, number, number] = [0, 1 - (6 + stripH) / TH, 1, 1 - 6 / TH];
  const uvA: [number, number, number, number] = [0, 1 - (6 + 2 * stripH + 16) / TH, 1, 1 - (6 + stripH + 16) / TH];

  const [, lvF] = box.dims.pz;
  const [, lvT] = box.dims.py;
  const [luT] = box.dims.py;
  const [, LuF] = box.flat('pz');
  const [, lvX] = box.dims.px;
  const [, LuX] = box.flat('px');
  const legsB: Leg[] = [
    { face: 'pz', from: [XB, LuF - DROP], to: [XB, lvF / 2] },
    { face: 'py', from: [XB, -lvT / 2], to: [XB, lvT / 2] },
    { face: 'nz', from: [-XB, lvF / 2], to: [-XB, LuF - DROP + 0.06] },
  ];
  const legsA: Leg[] = [
    { face: 'nx', from: [ZA, LuX - DROP + 0.04], to: [ZA, lvX / 2] },
    { face: 'py', from: [-luT / 2, -ZA], to: [luT / 2, -ZA] },
    { face: 'px', from: [-ZA, lvX / 2], to: [-ZA, LuX - DROP] },
  ];
  const tapeB = stripOnBox(box, legsB, TAPE_W, uvB, {
    offset: 0.006,
    nv: 6,
    lift: (s) => (s < 0.13 ? 0.075 * Math.pow((0.13 - s) / 0.13, 2.2) : 0),
  });
  const tapeA = stripOnBox(box, legsA, TAPE_W, uvA, {
    offset: 0.003,
    nv: 6,
    lift: (s, _t, total) => (s > total - 0.08 ? 0.02 * Math.pow((s - (total - 0.08)) / 0.08, 2) : 0),
  });
  const tapeGeo = merge([tapeA, tapeB]);
  tapeA.dispose();
  tapeB.dispose();
  const tapeMat = paperBackfaces(
    new THREE.MeshPhysicalMaterial({
      map: tape.colorTexture(),
      transparent: false,
      alphaTest: 0.5,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    }),
    '#efe4c8',
  );
  inner.add(new THREE.Mesh(tapeGeo, tapeMat));

  // ---------- stickers: shipping label, caution over the top edge, Zeros round the corner
  const sheet = new StickerSheet(1024, 1024, bctx, 14);
  const cLabel = sheet.alloc(600, 420);
  inCell(sheet, cLabel, paintLabel);
  const cZeros = sheet.alloc(300, 300);
  inCell(sheet, cZeros, paintZeros);
  const cCaution = sheet.alloc(520, 250);
  inCell(sheet, cCaution, paintCaution);
  const [luF] = box.dims.pz;
  const geos = [
    stickerPatch(box.at('pz'), 0.36, -0.07, 0.66, 0.462, -3 * DEG, cLabel.uv, {
      nx: 12,
      ny: 10,
      offset: 0.012,
      lift: (u, v) => 0.05 * Math.pow(THREE.MathUtils.smoothstep(u, 0.72, 1) * THREE.MathUtils.smoothstep(v, 0.62, 1), 2),
    }),
    stickerPatch(box.wrapAt('pz', 'py', 'up'), 0.47, lvF / 2 - 0.03, 0.5, 0.24, 5 * DEG, cCaution.uv, { nx: 14, ny: 14, offset: 0.01 }),
    stickerPatch(box.wrapAt('pz', 'px', 'right'), luF / 2 - 0.01, 0.16, 0.3, 0.3, -8 * DEG, cZeros.uv, { nx: 14, ny: 10, offset: 0.012 }),
  ];
  const stickerGeo = merge(geos);
  geos.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickerGeo, paperBackfaces(stickerSheet(sheet.surf.colorTexture(), { roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.2 }), '#f3efe6')));

  return finish(inner, trash, undefined, 'ship-it-box');
}

export const parcel: LibraryDef = {
  kind: 'parcel',
  name: 'Ship-It Box',
  tagline: 'fragile: contains MVP',
  category: 'founder',
  defaultRotation: [0.42, -0.62, 0.03],
  build,
};
export default parcel;
