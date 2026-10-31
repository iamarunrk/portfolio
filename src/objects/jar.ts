import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObjectBuildContext, ObjectDef } from './types';
import { Surface, StickerSheet, type AtlasCell } from './textures';
import { Trash, finish } from './build';
import { lathe, fillet, stickerPatch, surfaces, merge, type P2 } from './geometry';
import { glass, gold, stickerSheet, paperBackfaces } from './materials';
import {
  FONTS,
  DEG,
  rng,
  text,
  sticker,
  circlePath,
  rrPath,
  fillPath,
  smallPrint,
  barcode,
  pixelArt,
  PIXEL_HEART,
  grain,
  halftone,
  hazard,
  type C2D,
} from './paint';

/*
 * PIXEL JAM: a squat amber jar glowing with warm candy "pixels", a tall gold lid
 * with stacked ring ridges, a black & white collage label and a sticker-bombed lid.
 * Centimetres, normalised afterwards.
 */

const RB = 4.0; // body radius
const NECK_R = 2.72;
const LID_R = 2.88;
const LID_Y0 = 5.55;
const LID_Y1 = 8.35;
const RIDGE_Y0 = 5.78;
const RIDGE_Y1 = 7.98;
const RIDGES = 5;
const LABEL_R = RB + 0.035;
const LABEL_Y0 = 0.62;
const LABEL_Y1 = 3.42;

const WARM = ['#ff6a00', '#ff8c1a', '#ff5a1f', '#ffa21a', '#ff3b2f', '#ff4a26', '#ffc23a', '#ff7a2a', '#e8321e'];

function glassProfile(): P2[] {
  return fillet(
    [
      [0, 0],
      [3.1, 0],
      [RB, 0.95],
      [RB, 3.6],
      [3.3, 5.15],
      [NECK_R, 5.5],
      [NECK_R, 6.3],
      [2.7, 6.42],
      [0, 6.44],
    ],
    [0, 0.9, 0.5, 1.1, 0.25, 0.08, 0.1, 0],
    7,
  );
}

/** Lid: skirt, ring ridges, rounded top edge and a shallow inset disc. */
function lidProfile(): P2[] {
  const pts: P2[] = [
    [0, LID_Y0],
    [LID_R - 0.12, LID_Y0],
    [LID_R - 0.01, LID_Y0 + 0.08],
    [LID_R, RIDGE_Y0],
  ];
  const per = (RIDGE_Y1 - RIDGE_Y0) / RIDGES;
  for (let i = 0; i < RIDGES; i++) {
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const y = RIDGE_Y0 + (i + t) * per;
      // rounded bead with a sharp groove between beads
      const bump = Math.pow(Math.sin(Math.PI * t), 0.55);
      pts.push([LID_R - 0.2 + 0.24 * bump, y]);
    }
  }
  const top: P2[] = fillet(
    [
      [LID_R, RIDGE_Y1],
      [LID_R, LID_Y1 - 0.14],
      [LID_R - 0.14, LID_Y1],
      [2.42, LID_Y1],
      [2.32, LID_Y1 - 0.05],
      [0, LID_Y1 - 0.05],
    ],
    [0, 0.1, 0.1, 0.03, 0.03, 0],
    4,
  );
  return pts.concat(top.slice(1));
}

// ---------------------------------------------------------------- textures

function paintCollage(s: Surface): void {
  const c = s.c;
  const W = s.w;
  const H = s.h;
  const r = rng(2019);
  c.fillStyle = '#ecebe6';
  c.fillRect(0, 0, W, H);
  const top = 14;
  const bot = H - 30;
  c.save();
  c.beginPath();
  c.rect(0, top, W, bot - top);
  c.clip();
  // collage tiles across the full wrap
  let x = -40;
  let i = 0;
  while (x < W) {
    const w = 120 + r() * 170;
    const kind = i % 5;
    const y0 = top - 6 + r() * 14;
    const h = bot - y0 + 6;
    c.save();
    c.translate(x + w / 2, top + (bot - top) / 2);
    c.rotate((r() - 0.5) * 0.06);
    c.translate(-w / 2, y0 - (top + (bot - top) / 2));
    if (kind === 0 || kind === 3) {
      // halftone "photo" of a crowd: rows of heads and shoulders in greys under a fine dot screen
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#b4b4ae');
      g.addColorStop(1, '#2c2c2a');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      for (let row = 0; row < 4; row++) {
        const yy = 30 + row * (h / 4);
        const sz = 10 + row * 4;
        for (let hx = -10; hx < w + 10; hx += sz * 1.7 + r() * 8) {
          const tone = Math.floor(20 + r() * 200);
          c.fillStyle = `rgb(${tone},${tone},${tone - 4})`;
          c.beginPath();
          c.ellipse(hx, yy + sz * 1.9, sz * 1.25, sz * 1.1, 0, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = `rgb(${tone + 30},${tone + 30},${tone + 26})`;
          c.beginPath();
          c.arc(hx + (r() - 0.5) * 4, yy, sz * 0.72, 0, Math.PI * 2);
          c.fill();
          if (r() > 0.7) c.fillRect(hx + sz * 0.6, yy - sz * 2.2, sz * 0.32, sz * 2);
        }
      }
      halftone(c, 0, 0, w, h, 4.5, 'rgba(10,10,10,0.35)', (u, v) => 0.3 + 0.35 * Math.sin(u * 13 + v * 5 + i) * Math.cos(v * 9 - u * 4));
    } else if (kind === 1) {
      // newspaper column with a bold headline
      c.fillStyle = '#f4f3ee';
      c.fillRect(0, 0, w, h);
      text(c, ['PIXELS', 'LIVE', 'JAM', 'SHIP', 'GRID'][i % 5], w / 2, 52, { size: 46, family: FONTS.archivoBlack, align: 'center', color: '#141414', maxWidth: w - 16 });
      c.fillStyle = 'rgba(20,20,20,0.75)';
      for (let yy = 70; yy < h - 8; yy += 9) c.fillRect(8, yy, (w - 16) * (0.6 + r() * 0.4), 3.5);
    } else if (kind === 2) {
      // pixel art panel
      c.fillStyle = '#151515';
      c.fillRect(0, 0, w, h);
      pixelArt(c, w / 2 - 35, 30, 10, PIXEL_HEART, { X: '#f0f0ea', W: '#151515' });
      pixelArt(c, w / 2 - 30, 120, 8, ['XX......', 'XWX.....', 'XWWX....', 'XWWWX...', 'XWWWWX..', 'XWWXXX..', 'XX.XWX..', '....XX..'], { X: '#f0f0ea', W: '#151515' });
    } else {
      // torn paper with handwriting
      c.fillStyle = '#d9d8d2';
      c.fillRect(0, 0, w, h);
      text(c, 'est.', w / 2, 70, { size: 40, family: FONTS.marker, align: 'center', color: '#1a1a1a' });
      text(c, '2019', w / 2, 120, { size: 52, family: FONTS.marker, align: 'center', color: '#1a1a1a' });
      smallPrint(c, ['hand-picked', 'pixels'], w / 2, 150, 20, '#1a1a1a', { align: 'center', weight: 700 });
    }
    c.restore();
    x += w - 8;
    i++;
  }
  c.restore();
  // yellow hairline on top, orange-red band at the bottom
  c.fillStyle = '#ffd21a';
  c.fillRect(0, 0, W, top);
  c.fillStyle = '#ff4a1c';
  c.fillRect(0, bot, W, H - bot);
  c.font = `700 16px ${FONTS.spaceMono}`;
  c.fillStyle = '#ffe7d6';
  c.textBaseline = 'middle';
  for (let xx = 10; xx < W; xx += 520) c.fillText('PIXEL JAM · NET WT. 1,000,000 px · EST. 2019', xx, bot + 15);
  grain(c, 0, 0, W, H, 6000, 0.08, 4);
}

function paintLidPrint(s: Surface): void {
  // planar map of the lid top: white = plain gold, dark = printed ink
  const c = s.c;
  const W = s.w;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, W);
  const k = W / (2 * LID_R); // px per cm
  const cx = W / 2;
  const cy = W / 2;
  c.strokeStyle = '#4a3200';
  c.lineWidth = 0.09 * k;
  c.beginPath();
  c.arc(cx, cy, 2.25 * k, 0, Math.PI * 2);
  c.stroke();
  c.save();
  c.translate(cx, cy);
  c.rotate(-28 * DEG);
  text(c, 'PIXEL', 0, -0.08 * k, { size: 1.2 * k, family: FONTS.archivoBlack, align: 'center', color: '#3b2700', maxWidth: 3.9 * k });
  text(c, 'JAM', 0, 1.1 * k, { size: 1.2 * k, family: FONTS.archivoBlack, align: 'center', color: '#3b2700', maxWidth: 3.9 * k });
  c.restore();
  s.maskPath((m) => m.rect(0, 0, W, W), 0.22, 1);
  // ink is less metallic
  if (s.mask) {
    const m = s.mask.ctx;
    m.save();
    m.translate(cx, cy);
    m.rotate(-28 * DEG);
    text(m, 'PIXEL', 0, -0.08 * k, { size: 1.2 * k, family: FONTS.archivoBlack, align: 'center', color: 'rgb(0,110,90)', maxWidth: 3.9 * k });
    text(m, 'JAM', 0, 1.1 * k, { size: 1.2 * k, family: FONTS.archivoBlack, align: 'center', color: 'rgb(0,110,90)', maxWidth: 3.9 * k });
    m.restore();
  }
}

/** Draw one sticker centred in its sheet cell. */
function inCell(sheet: StickerSheet, cell: AtlasCell, fn: (c: C2D, w: number, h: number) => void): void {
  const c = sheet.surf.c;
  c.save();
  c.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  fn(c, cell.w, cell.h);
  c.restore();
}

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- amber glass
  const glassGeo = lathe(glassProfile(), { segments: 96 });
  const glassMat = glass({
    color: '#ffd9a6',
    roughness: 0.04,
    thickness: 0.6,
    ior: 1.5,
    attenuationColor: new THREE.Color('#ff9a3a'),
    attenuationDistance: 2.2,
    side: THREE.DoubleSide,
  });
  inner.add(new THREE.Mesh(glassGeo, glassMat));

  // ---------- glowing jam core (fills the gaps between candies with warm light)
  const core = lathe(
    fillet(
      [
        [0, 0.35],
        [2.3, 0.35],
        [2.6, 0.9],
        [2.6, 3.9],
        [2.0, 5.1],
        [0, 5.25],
      ],
      [0, 0.4, 0.3, 0.6, 0.4, 0],
      5,
    ),
    { segments: 48 },
  );
  const coreMat = new THREE.MeshStandardMaterial({ color: '#ff7a1a', emissive: '#ff5200', emissiveIntensity: 1.25, roughness: 0.55 });
  inner.add(new THREE.Mesh(core, coreMat));

  // ---------- warm candy pixels packed between the core and the glass
  const cube = new RoundedBoxGeometry(0.82, 0.82, 0.82, 1, 0.2);
  const rand = rng(42);
  const pts: { p: THREE.Vector3; q: THREE.Quaternion; c: string }[] = [];
  const innerR = (y: number) => {
    // inner radius available for candy centres at height y (inside the glass, minus a margin)
    if (y < 0.95) return 2.95;
    if (y < 3.6) return 3.38;
    return 3.38 - (y - 3.6) * 0.62;
  };
  for (let layer = 0; layer < 6; layer++) {
    const y = 0.72 + layer * 0.84;
    const ringR = innerR(y);
    if (ringR < 2.2) continue;
    // outer ring everywhere; a second ring only in the top layers (seen through the shoulder)
    for (const rr of layer >= 4 ? [ringR, ringR - 0.86] : [ringR]) {
      if (rr < 1.6) continue;
      const n = Math.floor((2 * Math.PI * rr) / 0.9);
      const off = rand() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        if (rand() < 0.08) continue;
        const a = off + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.08;
        const r2 = rr + (rand() - 0.5) * 0.12;
        const e = new THREE.Euler((rand() - 0.5) * 0.8, rand() * Math.PI, (rand() - 0.5) * 0.8);
        pts.push({ p: new THREE.Vector3(Math.sin(a) * r2, y + (rand() - 0.5) * 0.14, Math.cos(a) * r2), q: new THREE.Quaternion().setFromEuler(e), c: WARM[Math.floor(rand() * WARM.length)] });
      }
    }
  }
  const candyMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08, emissive: '#ff5a10', emissiveIntensity: 0.26 });
  const candies = new THREE.InstancedMesh(cube, candyMat, pts.length);
  const m4 = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  pts.forEach((pt, i) => {
    candies.setMatrixAt(i, m4.compose(pt.p, pt.q, one));
    candies.setColorAt(i, col.set(pt.c));
  });
  candies.instanceMatrix.needsUpdate = true;
  if (candies.instanceColor) candies.instanceColor.needsUpdate = true;
  candies.computeBoundingSphere();
  inner.add(candies);

  // ---------- gold ridged lid with a printed top
  const lidPrint = new Surface(512, 512, bctx, { mask: { rough: 0.22, metal: 1, density: 0.5 } });
  paintLidPrint(lidPrint);
  const lidGeo = lathe(lidProfile(), {
    segments: 96,
    uv: (x, y, z) => (y > LID_Y1 - 0.2 ? [0.5 + x / (2 * LID_R), 0.5 - z / (2 * LID_R)] : [0.02, 0.98]),
  });
  const lidMask = lidPrint.maskTexture();
  const lidMat = gold({ color: '#f1c232', map: lidPrint.colorTexture(), roughnessMap: lidMask, metalnessMap: lidMask, roughness: 1, metalness: 1 });
  inner.add(new THREE.Mesh(lidGeo, lidMat));

  // ---------- B&W collage label (full wrap, seam at the back)
  const labelH = LABEL_Y1 - LABEL_Y0;
  const LW = 2048;
  const LH = Math.round((LW * labelH) / (2 * Math.PI * LABEL_R));
  const label = new Surface(LW, LH, bctx, { mask: { rough: 0.5, metal: 0 } });
  paintCollage(label);
  const labelGeo = new THREE.CylinderGeometry(LABEL_R, LABEL_R, labelH, 96, 1, true, -Math.PI, Math.PI * 2);
  labelGeo.translate(0, (LABEL_Y0 + LABEL_Y1) / 2, 0);
  const labelMat = new THREE.MeshPhysicalMaterial({ map: label.colorTexture(), roughnessMap: label.maskTexture(), roughness: 1, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  inner.add(new THREE.Mesh(labelGeo, labelMat));

  // ---------- stickers (one sheet): brand sticker, heart, warning, SHIP IT tab and the lid stack
  const sheet = new StickerSheet(2048, 1024, bctx, 10);
  const cBrand = sheet.alloc(300, 300);
  inCell(sheet, cBrand, (c) => {
    sticker(c, 0, 0, 0, circlePath(0, 0, 132), { border: 9, borderColor: '#f6e15a', fill: '#ffd60a', shadow: 0.7 }, (q) => {
      q.strokeStyle = '#2b1d00';
      q.lineWidth = 5;
      q.beginPath();
      q.arc(0, 0, 112, 0, Math.PI * 2);
      q.stroke();
      text(q, 'PIXEL', 0, -6, { size: 66, family: FONTS.archivoBlack, align: 'center', color: '#1e1400', maxWidth: 190 });
      text(q, 'JAM', 0, 58, { size: 66, family: FONTS.archivoBlack, align: 'center', color: '#1e1400', maxWidth: 190 });
    });
  });
  const cHeart = sheet.alloc(170, 160);
  inCell(sheet, cHeart, (c) => {
    const cell = 20;
    const path = (q: C2D) => {
      PIXEL_HEART.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && q.rect(-70 + i * cell, -66 + j * cell, cell + 0.5, cell + 0.5)));
    };
    sticker(c, 0, 0, 0, path, { border: 7, borderColor: '#ffffff', fill: '#e8141c', shadow: 0.6 }, (q) => {
      pixelArt(q, -70, -66, cell, PIXEL_HEART, { X: '#e8141c', W: '#ff8a8a' });
    });
  });
  const cWarn = sheet.alloc(360, 230);
  inCell(sheet, cWarn, (c) => {
    sticker(c, 0, 0, 0, rrPath(-165, -100, 330, 200, 10), { border: 8, fill: '#ffffff', shadow: 0.7 }, (q) => {
      fillPath(q, rrPath(-150, -86, 300, 54, 6), '#e8214a');
      text(q, 'WARNING', 0, -45, { size: 40, family: FONTS.archivoBlack, align: 'center', color: '#ffffff' });
      text(q, 'HOT PIXELS', 0, 22, { size: 52, family: FONTS.archivoBlack, align: 'center', color: '#e8214a', maxWidth: 290 });
      text(q, 'handle with taste', 0, 70, { size: 30, family: FONTS.marker, align: 'center', color: '#e8214a' });
    });
  });
  const cShip = sheet.alloc(200, 250);
  inCell(sheet, cShip, (c) => {
    sticker(c, 0, 0, 0, rrPath(-88, -112, 176, 224, 14), { border: 8, fill: '#ffffff', shadow: 0.6 }, (q) => {
      fillPath(q, rrPath(-74, -98, 148, 196, 8), '#ff3b21');
      text(q, 'SHIP', 0, -18, { size: 58, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: '#8a1200', width: 8 }] });
      text(q, 'IT!', 0, 58, { size: 74, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: '#8a1200', width: 8 }] });
    });
  });
  // lid stack (from the stickered steel lid reference)
  const cHazard = sheet.alloc(1300, 120);
  inCell(sheet, cHazard, (c, w, h) => {
    c.save();
    c.translate(-w / 2, -h / 2);
    hazard(c, 0, 0, w, h, 26, '#ffd21f', '#141414', 50 * DEG);
    fillPath(c, rrPath(w * 0.3, 18, w * 0.4, h - 36, 4), '#ffd21f');
    text(c, 'CAUTION: CONTAINS IDEAS', w / 2, h / 2 + 18, { size: 50, family: FONTS.archivoBlack, align: 'center', color: '#141414', maxWidth: w * 0.38 });
    c.restore();
  });
  const cOrange = sheet.alloc(620, 104);
  inCell(sheet, cOrange, (c, w, h) => {
    fillPath(c, rrPath(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 4), '#ff5a1f');
    text(c, 'PIXEL PERFECT', 0, 22, { size: 62, family: FONTS.archivoBlack, align: 'center', color: '#ffffff', maxWidth: w - 60 });
  });
  const cFragile = sheet.alloc(330, 200);
  inCell(sheet, cFragile, (c) => {
    sticker(c, 0, 0, 0, rrPath(-150, -86, 300, 172, 8), { border: 6, fill: '#ffffff', shadow: 0.6 }, (q) => {
      q.save();
      q.beginPath();
      q.rect(-150, -86, 300, 172);
      q.clip();
      q.strokeStyle = '#2f62d8';
      q.lineWidth = 14;
      q.setLineDash([20, 12]);
      q.strokeRect(-140, -76, 280, 152);
      q.restore();
      text(q, 'FRAGILE', 0, 18, { size: 66, family: FONTS.archivoBlack, align: 'center', color: '#e8213a', maxWidth: 250 });
      text(q, 'contains pixels', 0, 54, { size: 22, family: FONTS.spaceMono, weight: 700, align: 'center', color: '#2f62d8' });
    });
  });
  const cArrows = sheet.alloc(220, 190);
  inCell(sheet, cArrows, (c) => {
    sticker(c, 0, 0, 0, rrPath(-100, -84, 200, 168, 8), { border: 5, fill: '#f6f3ea', shadow: 0.5 }, (q) => {
      const arrow = (x: number, color: string) => {
        q.fillStyle = color;
        q.beginPath();
        q.moveTo(x, -64);
        q.lineTo(x + 34, -20);
        q.lineTo(x + 14, -20);
        q.lineTo(x + 14, 22);
        q.lineTo(x - 14, 22);
        q.lineTo(x - 14, -20);
        q.lineTo(x - 34, -20);
        q.closePath();
        q.fill();
      };
      arrow(-44, '#ff6a1a');
      arrow(44, '#6f5cff');
      smallPrint(q, ['THIS SIDE UP'], 0, 34, 22, '#222', { align: 'center', weight: 700, family: FONTS.archivoBlack });
      barcode(q, -50, 58, 100, 22, 8, {});
    });
  });
  const cSketch = sheet.alloc(230, 230);
  inCell(sheet, cSketch, (c) => {
    sticker(c, 0, 0, 0, rrPath(-104, -104, 208, 208, 6), { border: 0, fill: '#f2f0e8', shadow: 0.5 }, (q) => {
      q.strokeStyle = '#2a2a2a';
      q.lineWidth = 3;
      q.lineCap = 'round';
      // a pencil sketch of a cursor + grid
      for (let i = -80; i <= 80; i += 32) {
        q.beginPath();
        q.moveTo(i, -90);
        q.lineTo(i, 90);
        q.moveTo(-90, i);
        q.lineTo(90, i);
        q.globalAlpha = 0.25;
        q.stroke();
      }
      q.globalAlpha = 1;
      q.lineWidth = 5;
      q.beginPath();
      q.moveTo(-30, -60);
      q.lineTo(-30, 40);
      q.lineTo(-6, 16);
      q.lineTo(14, 58);
      q.lineTo(30, 50);
      q.lineTo(10, 10);
      q.lineTo(42, 8);
      q.closePath();
      q.stroke();
      text(q, 'v0.1', 50, 84, { size: 26, family: FONTS.marker, align: 'center', color: '#2a2a2a' });
    });
  });
  const sheetTex = sheet.surf.colorTexture();

  const body = surfaces.cylinder(LABEL_R);
  const lidSide = (off: number) => surfaces.cylinder(LID_R + 0.07 + off);
  const geos: THREE.BufferGeometry[] = [];
  const cm = (cell: AtlasCell, wcm: number) => wcm * (cell.h / cell.w);
  // label: brand sticker on the front-left
  geos.push(stickerPatch(body, -22 * DEG * LABEL_R, 1.95, 2.6, 2.6, 12 * DEG, cBrand.uv, { nx: 12, ny: 12, offset: 0.03 }));
  // shoulder: warning on the right (glass), heart on the left
  const shoulder = surfaces.cylinder(RB);
  geos.push(stickerPatch(shoulder, 42 * DEG * RB, 3.62, 2.7, cm(cWarn, 2.7), -14 * DEG, cWarn.uv, { nx: 14, ny: 8, offset: 0.06 }));
  geos.push(stickerPatch(shoulder, -46 * DEG * RB, 3.75, 1.35, cm(cHeart, 1.35), 8 * DEG, cHeart.uv, { nx: 6, ny: 6, offset: 0.06 }));
  // lid side stack, bottom layer first
  geos.push(stickerPatch(lidSide(0), -72 * DEG * LID_R, 6.95, 2.0, cm(cFragile, 2.0), -6 * DEG, cFragile.uv, { nx: 12, ny: 6, offset: 0 }));
  geos.push(stickerPatch(lidSide(0.01), -96 * DEG * LID_R, 7.5, 1.4, cm(cArrows, 1.4), 4 * DEG, cArrows.uv, { nx: 8, ny: 6, offset: 0 }));
  geos.push(stickerPatch(lidSide(0.02), -36 * DEG * LID_R, 6.85, 5.6, cm(cHazard, 5.6), -5 * DEG, cHazard.uv, { nx: 32, ny: 3, offset: 0 }));
  geos.push(stickerPatch(lidSide(0.03), -50 * DEG * LID_R, 7.2, 3.3, cm(cOrange, 3.3), -14 * DEG, cOrange.uv, { nx: 20, ny: 3, offset: 0 }));
  geos.push(stickerPatch(lidSide(0.02), 150 * DEG * LID_R, 7.2, 1.55, 1.55, 6 * DEG, cSketch.uv, { nx: 8, ny: 8, offset: 0 }));
  // SHIP IT tab on the lid's left, lower edge peeling off
  geos.push(
    stickerPatch(lidSide(0.04), -14 * DEG * LID_R, 6.05, 1.2, cm(cShip, 1.2), 6 * DEG, cShip.uv, {
      nx: 6,
      ny: 10,
      offset: 0,
      lift: (_u, v) => 0.35 * Math.pow(THREE.MathUtils.smoothstep(1 - v, 0.55, 1), 2),
    }),
  );
  const stickersGeo = merge(geos);
  geos.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.4, clearcoat: 0.7 }), '#f1ece2')));

  return finish(inner, trash, undefined, 'pixel-jam');
}

export const jar: ObjectDef = {
  kind: 'jar',
  name: 'Pixel Jam',
  tagline: 'hand-picked pixels, est. 2019',
  defaultRotation: [0.6, 0.1, -0.5],
  build,
};
