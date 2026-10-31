import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { lathe, fillet, parametric, stickerPatch, merge, tint, place, type P2 } from '../geometry';
import { stickerSheet, paperBackfaces, glossyPlastic } from '../materials';
import { FONTS, DEG, rng, text, arcText, font, sticker, circlePath, rrPath, starPath, fillPath, smallPrint, barcode, factsPanel, grain } from '../paint';
import { fbm3, revolveSurface, arcLengths, colorize, inCell, steam } from './_desi';

/*
 * 2-MINUTE MVP: an instant noodle cup with its foil lid peeled back into a curl, a lime
 * fork stuck in crinkly noodles with peas, carrot, corn and spring onion, steam rising.
 * Printed cup: a pink top band, a huge "MVP" logo, a masala flavour seal, a dark base
 * band and a facts panel on the back. A "NEW v2 FLAVOUR" burst and a price sticker.
 * Units ~ cm, normalised afterwards.
 */

const TOP_R = 4.5;
const RIM_Y = 9.7;
const SOUP_Y = 8.35;
const FOLD_Z = -0.2;
const LID_R = 4.78;

// ------------------------------------------------------------------ shapes

function cupProfile(): P2[] {
  return fillet(
    [
      [0, 0.28],
      [3.02, 0.28],
      [3.12, 0.0],
      [3.32, 0.02],
      [TOP_R - 0.08, 9.32],
      [TOP_R + 0.12, 9.46],
      [TOP_R + 0.13, 9.64],
      [TOP_R - 0.02, RIM_Y],
      [TOP_R - 0.2, 9.56],
      [TOP_R - 0.25, 9.2],
      [3.62, 4.2],
    ],
    [0, 0.06, 0.06, 0.12, 0.12, 0.08, 0.08, 0.08, 0.08, 0.1, 0],
    5,
  );
}

/** Inner wall radius at height y. */
function innerR(y: number): number {
  return 3.62 + ((y - 4.2) * (TOP_R - 0.25 - 3.62)) / (9.2 - 4.2);
}

/** The lid outline: a disc with a rounded pull tab at the front (+Z). */
function lidRadius(phi: number): number {
  const d = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));
  const tab = 1 - THREE.MathUtils.smoothstep(d, 0.1, 0.22);
  return LID_R + 0.75 * tab;
}

/** Flat lid point (x0, z0) -> peeled position. The front part curls up and back over the fold line. */
function peel(x0: number, z0: number, out: THREE.Vector3): THREE.Vector3 {
  const y0 = RIM_Y + 0.025;
  const d = z0 - FOLD_Z;
  if (d <= 0) return out.set(x0, y0, z0);
  const R = 0.9;
  const thMax = 0.86 * Math.PI;
  if (d < R * thMax) {
    const th = d / R;
    return out.set(x0, y0 + R * (1 - Math.cos(th)), FOLD_Z + R * Math.sin(th));
  }
  const rest = d - R * thMax;
  const ty = Math.sin(thMax);
  const tz = Math.cos(thMax);
  const wr = 0.07 * Math.sin(x0 * 2.6 + rest * 1.4) * Math.min(1, rest);
  return out.set(x0, y0 + R * (1 - Math.cos(thMax)) + rest * ty + wr * -tz, FOLD_Z + R * Math.sin(thMax) + rest * tz + wr * ty);
}

/** Plastic fork along +Y (handle end at 0, tine tips at `len`), flat in XY, thickness along Z. */
function forkGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const headW = 0.74;
  const tineTop = 7.4;
  const slotBottom = 6.25;
  const slot = 0.12;
  const tine = (2 * headW - 3 * slot) / 4;
  s.moveTo(-0.34, 0.32);
  s.quadraticCurveTo(-0.38, 0, 0, 0);
  s.quadraticCurveTo(0.38, 0, 0.34, 0.32);
  s.lineTo(0.2, 4.4);
  s.bezierCurveTo(0.2, 4.95, headW, 5.1, headW, 5.75);
  s.lineTo(headW, tineTop - 0.12);
  // tines, right to left
  let x = headW;
  for (let i = 0; i < 4; i++) {
    const x1 = x - tine;
    s.quadraticCurveTo(x, tineTop, x - tine / 2, tineTop);
    s.quadraticCurveTo(x1, tineTop, x1, tineTop - 0.12);
    if (i < 3) {
      s.lineTo(x1, slotBottom + slot / 2);
      s.quadraticCurveTo(x1, slotBottom, x1 - slot / 2, slotBottom);
      s.quadraticCurveTo(x1 - slot, slotBottom, x1 - slot, slotBottom + slot / 2);
      s.lineTo(x1 - slot, tineTop - 0.12);
      x = x1 - slot;
    } else {
      x = x1;
    }
  }
  s.lineTo(-headW, 5.75);
  s.bezierCurveTo(-headW, 5.1, -0.2, 4.95, -0.2, 4.4);
  s.lineTo(-0.34, 0.32);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 5 });
  g.translate(0, 0, -0.07);
  // the classic bend: the head lifts away from the handle
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > 4.3) {
      const a = Math.min(1, (y - 4.3) / 1.8) * 14 * DEG;
      const yy = y - 4.3;
      pos.setY(i, 4.3 + yy * Math.cos(a) - z * Math.sin(a));
      pos.setZ(i, yy * Math.sin(a) + z * Math.cos(a));
    }
    // a slight sag along the handle
    pos.setZ(i, pos.getZ(i) - 0.012 * Math.pow(Math.min(y, 4.3) - 2.2, 2) + 0.06);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ textures

function paintCup(s: Surface, prof: P2[]): void {
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
    return y <= 0.1 ? S[2] : S[iTop];
  };
  const W = s.w;
  const H = s.h;
  const row = (sv: number) => (1 - sv / total) * H;
  const ry = (y: number) => row(sOuter(y));
  const X = (deg: number) => W / 2 + (deg / 360) * W;
  const c = s.c;

  // paper
  c.fillStyle = '#fff8ec';
  c.fillRect(0, 0, W, H);
  // inside of the cup: white with a fill line
  c.fillStyle = '#fbfaf6';
  c.fillRect(0, 0, W, row(S[iTop] + 0.05));
  const sFill = S[iTop] + 0.05 + (RIM_Y - 8.9);
  c.fillStyle = '#e8213a';
  c.fillRect(0, row(sFill) - 3, W, 6);
  c.font = font(H * 0.016, FONTS.archivoBlack);
  c.textBaseline = 'bottom';
  c.textAlign = 'center';
  for (let k = 0; k < 4; k++) c.fillText('FILL TO HERE', X(-135 + k * 90), row(sFill) - 6);

  // dark base band with the ready-in strip
  const yBase0 = ry(1.75);
  const yBase1 = ry(0.05);
  c.fillStyle = '#0b0b0d';
  c.fillRect(0, yBase0, W, yBase1 - yBase0);
  c.save();
  c.font = font((yBase1 - yBase0) * 0.42, FONTS.rubikMono);
  c.fillStyle = '#d7ff3a';
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  const strip = 'READY IN 2 MIN · JUST ADD HOT WATER · ';
  const sw = c.measureText(strip).width;
  const n = Math.max(1, Math.round(W / sw));
  c.translate(0, (yBase0 + yBase1) / 2);
  c.scale(W / (n * sw), 1);
  for (let i = 0; i <= n; i++) c.fillText(strip, i * sw, 0);
  c.restore();

  // pink top band
  const yTop0 = ry(9.36);
  const yTop1 = ry(7.75);
  c.fillStyle = '#ff4fb8';
  c.fillRect(0, yTop0, W, yTop1 - yTop0);
  c.fillStyle = '#d7ff3a';
  c.fillRect(0, yTop1 - 8, W, 8);
  c.save();
  c.font = font((yTop1 - yTop0) * 0.36, FONTS.archivoBlack);
  c.fillStyle = '#ffffff';
  c.textBaseline = 'middle';
  const band = 'INSTANT NOODLES · ZEROS FOODS · ';
  const bw = c.measureText(band).width;
  const nb = Math.max(1, Math.round(W / bw));
  c.translate(0, (yTop0 + yTop1) / 2 + 2);
  c.scale(W / (nb * bw), 1);
  for (let i = 0; i <= nb; i++) c.fillText(band, i * bw, 0);
  c.restore();
  // rim lip (outside of the roll) in white
  c.fillStyle = '#fbfaf6';
  c.fillRect(0, row(S[iTop] + 0.05), W, yTop0 - row(S[iTop] + 0.05));

  // sunburst behind the logo
  const fx = X(0);
  const fy = (ry(7.6) + ry(2.0)) / 2;
  c.save();
  c.beginPath();
  c.rect(0, ry(7.7), W, ry(1.8) - ry(7.7));
  c.clip();
  for (let i = 0; i < 28; i++) {
    const a0 = (i / 28) * Math.PI * 2;
    c.beginPath();
    c.moveTo(fx, fy);
    c.arc(fx, fy, W * 0.4, a0, a0 + Math.PI / 28);
    c.closePath();
    c.fillStyle = i % 2 ? 'rgba(255,210,31,0.22)' : 'rgba(255,79,184,0.08)';
    c.fill();
  }
  c.restore();
  // logo: "2-MINUTE" over a huge "MVP"
  const logoH = ry(2.2) - ry(7.4);
  text(c, '2-MINUTE', fx, fy - logoH * 0.2, { size: logoH * 0.2, family: FONTS.archivoBlack, align: 'center', color: '#0b0b0d', tracking: 6, maxWidth: W * 0.2 });
  text(c, 'MVP', fx, fy + logoH * 0.33, {
    size: logoH * 0.5,
    family: FONTS.bagel,
    align: 'center',
    color: '#ff4fb8',
    outlines: [
      { color: '#0b0b0d', width: logoH * 0.075 },
      { color: '#ffffff', width: logoH * 0.03 },
    ],
    extrude: { color: '#0b0b0d', dx: logoH * 0.012, dy: logoH * 0.03 },
    maxWidth: W * 0.24,
  });
  text(c, 'just add hot water', fx, fy + logoH * 0.47, { size: logoH * 0.075, family: FONTS.marker, align: 'center', color: '#0b0b0d' });

  // masala flavour seal (right of the logo)
  const sx = X(58);
  const sy = fy - logoH * 0.04;
  const sr = logoH * 0.22;
  fillPath(c, starPath(sx, sy, sr * 1.12, sr * 0.98, 20, 0, 0.5), '#e8213a');
  fillPath(c, circlePath(sx, sy, sr * 0.86), '#fff2c4');
  arcText(c, 'MASALA', sx, sy, sr * 0.62, -Math.PI / 2, { size: sr * 0.26, family: FONTS.archivoBlack, color: '#c4122f', tracking: 2 });
  arcText(c, 'FLAVOUR', sx, sy, sr * 0.7, Math.PI / 2, { size: sr * 0.2, family: FONTS.archivoBlack, color: '#c4122f', tracking: 2 }, true);
  // chili
  c.save();
  c.translate(sx, sy);
  c.rotate(-0.5);
  c.fillStyle = '#e8213a';
  c.beginPath();
  c.moveTo(-sr * 0.36, 0);
  c.bezierCurveTo(-sr * 0.2, -sr * 0.16, sr * 0.28, -sr * 0.12, sr * 0.38, sr * 0.14);
  c.bezierCurveTo(sr * 0.1, sr * 0.02, -sr * 0.16, sr * 0.12, -sr * 0.36, 0);
  c.fill();
  c.fillStyle = '#2f9a3a';
  c.fillRect(-sr * 0.46, -sr * 0.05, sr * 0.14, sr * 0.08);
  c.restore();
  smallPrint(c, ['spicy · level 3'], sx, sy + sr * 1.18, sr * 0.16, '#c4122f', { align: 'center', weight: 700 });

  // left: a little steaming bowl icon + "serves 1 founder"
  const bx = X(-58);
  const by = fy;
  c.save();
  c.translate(bx, by);
  c.fillStyle = '#0b0b0d';
  c.beginPath();
  c.moveTo(-sr * 0.8, -sr * 0.05);
  c.lineTo(sr * 0.8, -sr * 0.05);
  c.quadraticCurveTo(sr * 0.7, sr * 0.65, 0, sr * 0.7);
  c.quadraticCurveTo(-sr * 0.7, sr * 0.65, -sr * 0.8, -sr * 0.05);
  c.fill();
  c.strokeStyle = '#ffd21f';
  c.lineWidth = sr * 0.09;
  c.lineCap = 'round';
  for (const k of [-0.35, 0, 0.35]) {
    c.beginPath();
    c.moveTo(sr * k, -sr * 0.25);
    c.bezierCurveTo(sr * (k - 0.2), -sr * 0.5, sr * (k + 0.2), -sr * 0.7, sr * k, -sr * 0.95);
    c.stroke();
  }
  c.restore();
  smallPrint(c, ['SERVES', '1 FOUNDER'], bx, by + sr * 0.85, sr * 0.2, '#0b0b0d', { align: 'center', weight: 700, family: FONTS.archivoBlack });

  // back: facts panel, cooking steps and barcode
  c.save();
  c.translate(X(180) - 150, ry(7.45));
  factsPanel(
    c,
    0,
    0,
    300,
    'Sprint Facts',
    'Serving size: 1 sprint',
    [['Calories', 'enough', true], ['Shortcuts', '0g', true], ['Bugs', 'some', true], '-', ['MSG', 'Make Stuff Great'], ['Ready in', '2 min']],
    { size: 15, footer: ['* tastes like a demo day win'] },
  );
  c.restore();
  const cx = X(128);
  smallPrint(c, ['1. PEEL LID TO HALF', '2. ADD BOILING WATER', '   TO THE LINE', '3. WAIT 2 MIN', '4. SHIP IT'], cx - 110, ry(7.2), 19, '#0b0b0d', { weight: 700, lineHeight: 25 });
  barcode(c, X(-135) - 90, ry(4.6), 180, 100, 777, { digits: '8 90000 12345 6', bg: '#ffffff', pad: 8 });
  smallPrint(c, ['NET WT. 70 g · MADE WITH LOVE', 'BY ZEROS FOODS, ONCE UPON A TIME'], X(-135), ry(4.6) + 120, 16, '#0b0b0d', { align: 'center', weight: 700 });
  grain(c, 0, 0, W, H, 6000, 0.05, 12);
}

function paintLid(s: Surface): void {
  const c = s.c;
  const W = s.w;
  const k = W / (2 * (LID_R + 0.8)); // px per cm (texture covers +-5.58)
  const cx = W / 2;
  const cy = W / 2;
  // silver base, printed white circle, logo on the back half (canvas top half)
  const g = c.createLinearGradient(0, 0, W, W);
  g.addColorStop(0, '#e9ecf0');
  g.addColorStop(0.5, '#cfd5dc');
  g.addColorStop(1, '#eef0f3');
  c.fillStyle = g;
  c.fillRect(0, 0, W, W);
  fillPath(c, circlePath(cx, cy, LID_R * k * 0.92), '#ffffff');
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2;
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, LID_R * k * 0.92, a0, a0 + Math.PI / 24);
    c.closePath();
    c.fillStyle = 'rgba(255,79,184,0.12)';
    c.fill();
  }
  text(c, '2-MINUTE', cx, cy - 2.3 * k, { size: 0.72 * k, family: FONTS.archivoBlack, align: 'center', color: '#0b0b0d', tracking: 3 });
  text(c, 'MVP', cx, cy - 0.35 * k, { size: 2.0 * k, family: FONTS.bagel, align: 'center', color: '#ff4fb8', outlines: [{ color: '#0b0b0d', width: 0.28 * k }], extrude: { color: '#0b0b0d', dx: 0, dy: 0.1 * k } });
  smallPrint(c, ['PEEL TO THE DOTTED LINE', 'POUR BOILING WATER · WAIT 2 MIN · SHIP'], cx, cy + 0.15 * k, 0.32 * k, '#0b0b0d', { align: 'center', weight: 700 });
  // dotted peel line along the fold
  c.save();
  c.setLineDash([0.25 * k, 0.2 * k]);
  c.strokeStyle = '#0b0b0d';
  c.lineWidth = 0.07 * k;
  c.beginPath();
  c.moveTo(cx - LID_R * k, cy + FOLD_Z * k);
  c.lineTo(cx + LID_R * k, cy + FOLD_Z * k);
  c.stroke();
  c.restore();
  // pull tab: "PEEL HERE" on the tab at the front (+Z = canvas bottom)
  fillPath(c, rrPath(cx - 1.0 * k, cy + (LID_R - 0.25) * k, 2.0 * k, 1.1 * k, 0.4 * k), '#d7ff3a');
  text(c, 'PEEL', cx, cy + (LID_R + 0.5) * k, { size: 0.42 * k, family: FONTS.archivoBlack, align: 'center', color: '#0b0b0d' });
}

function paintNoodles(s: Surface): void {
  const c = s.c;
  const W = s.w;
  // golden broth
  const g = c.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  g.addColorStop(0, '#e9a23a');
  g.addColorStop(1, '#c97a22');
  c.fillStyle = g;
  c.fillRect(0, 0, W, W);
  // crinkly noodles: dense sine strands
  const r = rng(55);
  c.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x0 = r() * W;
    const y0 = r() * W;
    const ang = r() * Math.PI;
    const len = 80 + r() * 180;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const shade = 0.75 + r() * 0.25;
    c.strokeStyle = `rgb(${Math.round(250 * shade)},${Math.round(208 * shade)},${Math.round(110 * shade)})`;
    c.lineWidth = 7 + r() * 3;
    c.beginPath();
    for (let t = 0; t <= len; t += 4) {
      const off = Math.sin(t * 0.18 + i) * 7;
      const x = x0 + ca * t - sa * off;
      const y = y0 + sa * t + ca * off;
      if (t === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  // oil droplets
  for (let i = 0; i < 70; i++) {
    c.beginPath();
    c.arc(r() * W, r() * W, 3 + r() * 8, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,170,60,0.55)';
    c.fill();
    c.strokeStyle = 'rgba(255,240,200,0.6)';
    c.lineWidth = 1.5;
    c.stroke();
  }
  // chili flakes
  for (let i = 0; i < 90; i++) {
    c.fillStyle = r() > 0.4 ? '#c8211c' : '#8a1410';
    c.fillRect(r() * W, r() * W, 4 + r() * 6, 3 + r() * 3);
  }
}

function paintStickers(sheet: StickerSheet) {
  const cNew = sheet.alloc(300, 300);
  inCell(sheet, cNew, (c) => {
    sticker(c, 0, 0, 0, starPath(0, 0, 138, 108, 14, -Math.PI / 2, 0.35), { border: 10, fill: '#ffd21f', shadow: 0.7 }, (q) => {
      text(q, 'NEW!', 0, -24, { size: 58, family: FONTS.bagel, align: 'center', color: '#e8213a', outlines: [{ color: '#ffffff', width: 8 }] });
      text(q, 'v2', 0, 40, { size: 64, family: FONTS.archivoBlack, align: 'center', color: '#0b0b0d' });
      text(q, 'FLAVOUR', 0, 74, { size: 26, family: FONTS.archivoBlack, align: 'center', color: '#0b0b0d', tracking: 2 });
    });
  });
  const cPrice = sheet.alloc(300, 170);
  inCell(sheet, cPrice, (c) => {
    sticker(c, 0, 0, 0, rrPath(-138, -72, 276, 144, 16), { border: 8, fill: '#ff7a1a', shadow: 0.6 }, (q) => {
      text(q, '20/-', -30, 26, { size: 78, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: '#7a2a00', width: 8 }] });
      smallPrint(q, ['MRP', 'incl.', 'taxes'], 92, -46, 20, '#3a1400', { align: 'center', weight: 700 });
    });
  });
  const cHot = sheet.alloc(360, 150);
  inCell(sheet, cHot, (c) => {
    sticker(c, 0, 0, 0, rrPath(-168, -60, 336, 120, 60), { border: 10, fill: '#0b0b0d', shadow: 0.6 }, (q) => {
      text(q, 'CAUTION: HOT', 0, 4, { size: 40, family: FONTS.archivoBlack, align: 'center', color: '#d7ff3a', maxWidth: 290 });
      text(q, 'like your launch', 0, 40, { size: 26, family: FONTS.marker, align: 'center', color: '#ffffff' });
    });
  });
  return { cNew, cPrice, cHot };
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- printed paper cup (outside, rolled lip and the inner wall share one wrap)
  const prof = cupProfile();
  const S = arcLengths(prof);
  const total = S[S.length - 1];
  const cupSurf = new Surface(2048, Math.round((2048 * total) / (2 * Math.PI * 4.0)), bctx, { density: 0.8 });
  paintCup(cupSurf, prof);
  inner.add(new THREE.Mesh(lathe(prof, { segments: 96 }), new THREE.MeshPhysicalMaterial({ map: cupSurf.colorTexture(), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.18 })));

  // ---------- noodles: a glossy noodle-and-broth surface plus 3D strands and veggies
  const nSurf = new Surface(1024, 1024, bctx, { density: 0.7 });
  paintNoodles(nSurf);
  const NR = innerR(SOUP_Y) - 0.02;
  const soup = new THREE.CircleGeometry(NR, 64);
  soup.rotateX(-Math.PI / 2);
  soup.translate(0, SOUP_Y, 0);
  inner.add(new THREE.Mesh(soup, new THREE.MeshPhysicalMaterial({ map: nSurf.colorTexture(), roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.08 })));

  const r = rng(2);
  const foodParts: THREE.BufferGeometry[] = [];
  const NOODLE = new THREE.Color('#f6c95a');
  const NOODLE_DARK = new THREE.Color('#d99a2e');
  const inside = (x: number, z: number, m = 0.35) => Math.hypot(x, z) < NR - m;
  // the fork: tines dipped in the front-left noodles, handle rising out over the right rim
  const tineTip = new THREE.Vector3(-0.9, SOUP_Y - 0.15, 1.7);
  const forkDir = new THREE.Vector3(-0.8, -0.42, 0.42).normalize();
  for (let i = 0; i < 30; i++) {
    let x = 0;
    let z = 0;
    do {
      x = (r() - 0.5) * 2 * NR;
      z = FOLD_Z - 0.6 + r() * (NR - FOLD_Z + 0.6);
    } while (!inside(x, z));
    const ang = r() * Math.PI * 2;
    const len = 2.2 + r() * 2.4;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const along = (t - 0.5) * len;
      const wave = Math.sin(t * 14 + i) * 0.16;
      let px = x + Math.cos(ang) * along - Math.sin(ang) * wave;
      let pz = z + Math.sin(ang) * along + Math.cos(ang) * wave;
      const rr = Math.hypot(px, pz);
      if (rr > NR - 0.25) {
        px *= (NR - 0.25) / rr;
        pz *= (NR - 0.25) / rr;
      }
      pts.push(new THREE.Vector3(px, SOUP_Y + 0.06 + 0.05 * Math.sin(t * 9 + i * 2) + 0.12 * fbm3(px, i, pz, 3), pz));
    }
    foodParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.085, 5, false));
  }
  // strands looping over the fork tines
  for (let i = 0; i < 4; i++) {
    const along = 0.35 + i * 0.22;
    const hang = tineTip.clone().addScaledVector(forkDir, -along);
    const side = new THREE.Vector3().crossVectors(forkDir, new THREE.Vector3(0, 1, 0)).normalize();
    const pts = [
      hang.clone().addScaledVector(side, -0.9).setY(SOUP_Y + 0.05),
      hang.clone().addScaledVector(side, -0.45).add(new THREE.Vector3(0, 0.55, 0)),
      hang.clone().add(new THREE.Vector3(0, 0.32, 0)),
      hang.clone().addScaledVector(side, 0.45).add(new THREE.Vector3(0, 0.5, 0)),
      hang.clone().addScaledVector(side, 0.95).setY(SOUP_Y + 0.05),
    ];
    foodParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.085, 5, false));
  }
  for (const g of foodParts) colorize(g, (p, _n, c) => c.copy(NOODLE).lerp(NOODLE_DARK, fbm3(p.x * 2, p.y * 2, p.z * 2, 7)));
  // veggies
  const veg: THREE.BufferGeometry[] = [];
  const spot = () => {
    let x = 0;
    let z = 0;
    do {
      x = (r() - 0.5) * 2 * NR;
      z = FOLD_Z - 0.3 + r() * (NR - FOLD_Z + 0.3);
    } while (!inside(x, z, 0.4));
    return [x, z] as const;
  };
  for (let i = 0; i < 9; i++) {
    const [x, z] = spot();
    veg.push(tint(place(new THREE.SphereGeometry(0.17, 10, 7), [x, SOUP_Y + 0.18, z]), '#4fb83a'));
  }
  for (let i = 0; i < 11; i++) {
    const [x, z] = spot();
    veg.push(tint(place(new THREE.BoxGeometry(0.3, 0.3, 0.3), [x, SOUP_Y + 0.17, z], [r() * 3, r() * 3, r() * 3]), '#ff8a1f'));
  }
  for (let i = 0; i < 9; i++) {
    const [x, z] = spot();
    veg.push(tint(place(new THREE.SphereGeometry(0.16, 8, 6), [x, SOUP_Y + 0.15, z], [0, r() * 3, 0], [1, 0.75, 0.85]), '#ffd23a'));
  }
  for (let i = 0; i < 9; i++) {
    const [x, z] = spot();
    veg.push(tint(place(new THREE.TorusGeometry(0.17, 0.055, 6, 14), [x, SOUP_Y + 0.14, z], [Math.PI / 2 + (r() - 0.5) * 0.6, 0, r() * 3]), '#86d95e'));
  }
  const foodGeo = merge([...foodParts, ...veg]);
  [...foodParts, ...veg].forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(foodGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12 })));

  // ---------- lime fork
  const fork = forkGeometry();
  {
    const len = 7.4;
    const yAxis = forkDir.clone();
    const zAxis = new THREE.Vector3(0, 1, 0).addScaledVector(yAxis, -yAxis.y).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    m.setPosition(tineTip.clone().addScaledVector(yAxis, -len));
    fork.applyMatrix4(m);
  }
  inner.add(new THREE.Mesh(fork, glossyPlastic('#d7ff3a', { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06, emissive: '#3a4a00', emissiveIntensity: 0.15 })));

  // ---------- foil lid, peeled back into a curl (printed top / silver foil underside)
  const lidSurf = new Surface(1024, 1024, bctx);
  paintLid(lidSurf);
  const span = LID_R + 0.8;
  const lidGeo = parametric(
    96,
    30,
    (u, v, out) => {
      const phi = u * Math.PI * 2 - Math.PI;
      const rr = lidRadius(phi) * Math.max(0.004, v);
      return peel(Math.sin(phi) * rr, Math.cos(phi) * rr, out);
    },
    {
      uv: (u, v) => {
        const phi = u * Math.PI * 2 - Math.PI;
        const rr = lidRadius(phi) * Math.max(0.004, v);
        return [0.5 + (Math.sin(phi) * rr) / (2 * span), 0.5 - (Math.cos(phi) * rr) / (2 * span)];
      },
    },
  );
  // parametric() faces follow dP/du x dP/dv, which points down here: flip so the print faces up
  {
    const idx = lidGeo.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      idx.setX(i, idx.getX(i + 1));
      idx.setX(i + 1, a);
    }
    const nr = lidGeo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < nr.count; i++) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i));
  }
  inner.add(new THREE.Mesh(lidGeo, new THREE.MeshPhysicalMaterial({ map: lidSurf.colorTexture(), metalness: 0.35, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15 })));
  inner.add(new THREE.Mesh(lidGeo, new THREE.MeshPhysicalMaterial({ color: '#e7eaee', metalness: 1, roughness: 0.24, side: THREE.BackSide })));

  // ---------- stickers on the cup
  const sheet = new StickerSheet(1024, 512, bctx, 12);
  const cells = paintStickers(sheet);
  let iTop = 0;
  prof.forEach((p, i) => {
    if (p[1] > prof[iTop][1]) iTop = i;
  });
  const wallProf = prof.slice(3, iTop).filter((p) => p[1] > 0.2 && p[1] < 9.4);
  const wall = revolveSurface(wallProf);
  const cm = (cell: { w: number; h: number }, w: number) => (w * cell.h) / cell.w;
  const patches: THREE.BufferGeometry[] = [];
  patches.push(
    stickerPatch(wall.at, -2.0, wall.sAtY(8.35), 2.05, 2.05, -12 * DEG, cells.cNew.uv, {
      nx: 12,
      ny: 12,
      offset: 0.02,
      lift: (u, v) => 0.3 * Math.pow(THREE.MathUtils.smoothstep(1 - u, 0.55, 1) * THREE.MathUtils.smoothstep(v, 0.55, 1), 1.4),
    }),
  );
  patches.push(stickerPatch(wall.at, 10.2, wall.sAtY(3.0), 2.4, cm(cells.cPrice, 2.4), 8 * DEG, cells.cPrice.uv, { nx: 12, ny: 6, offset: 0.02 }));
  patches.push(stickerPatch(wall.at, 2.5, wall.sAtY(2.85), 2.5, cm(cells.cHot, 2.5), -7 * DEG, cells.cHot.uv, { nx: 14, ny: 6, offset: 0.02 }));
  const stickersGeo = merge(patches);
  patches.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheet.surf.colorTexture(), { roughness: 0.4, clearcoat: 0.6 }), '#f4ecdc')));

  // ---------- steam from the open half (added after normalising)
  const st = steam(bctx, { base: new THREE.Vector3(0.3, SOUP_Y + 0.3, 1.6), spread: 1.8, height: 6.2, width: 2.6, count: 4, opacity: 0.4, seed: 21 });
  const built = finish(inner, trash, st.update, 'two-minute-mvp');
  inner.add(st.mesh);
  trash.add(st.mesh.geometry);
  trash.add(st.mesh.material as THREE.Material);
  trash.add((st.mesh.material as THREE.MeshBasicMaterial).map!);
  return built;
}

export const noodles: LibraryDef = {
  kind: 'noodles',
  name: '2-Minute MVP',
  tagline: 'just add hot water',
  category: 'food',
  defaultRotation: [0.5, -0.32, 0.05],
  build,
};
export default noodles;
