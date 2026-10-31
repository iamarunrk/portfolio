import * as THREE from 'three';
import type { ObjectBuildContext, ObjectDef } from './types';
import { Surface, StickerSheet } from './textures';
import { Trash, finish } from './build';
import { lathe, fillet, stickerPatch, surfaces, merge, flatUV, place, tint, type P2 } from './geometry';
import { stickerSheet, paperBackfaces } from './materials';
import {
  FONTS,
  DEG,
  rng,
  text,
  arcText,
  font,
  sticker,
  rrPath,
  barcode,
  factsPanel,
  smallPrint,
  fillPath,
  grain,
  rrect,
  hexA,
  type C2D,
} from './paint';

/*
 * ZEROS Soda: royal-blue painted can with a yellow shoulder band, paint drips,
 * a big flat white wordmark, a peeling light-blue warning sticker and a dark
 * icon sticker. Modelled in centimetres (330 ml can), normalised afterwards.
 */

const R = 3.31;
/** The reference can is a stubby one: drop the classic 330 ml top section by this much. */
const SHORTEN = 2.5;
const PRINT_Y0 = 0.95;
const PRINT_Y1 = 10.42 - SHORTEN;
const LID_Y = 11.04 - SHORTEN;

const BLUE = '#2456f2';
const BLUE_DARK = '#1a3fd0';
const BLUE_LIGHT = '#5aa0ff';
const ICE = '#b9e3ff';
const YELLOW = '#ffe11f';
const NAVY = '#0c1f7a';

/** Outer profile (r, y), bottom centre -> lid centre, outside on the right. */
function canProfile(): P2[] {
  const raw: P2[] = [
    [0, 0.98],
    [1.1, 0.9],
    [1.75, 0.62],
    [2.12, 0.3],
    [2.3, 0.06],
    [2.45, 0.0],
    [2.62, 0.05],
    [2.95, 0.4],
    [3.22, 0.95],
    [R, 1.5],
    [R, 9.75],
    [3.24, 10.1],
    [2.98, 10.55],
    [2.74, 10.88],
    [2.68, 11.02],
    [2.74, 11.14],
    [2.86, 11.24],
    [2.89, 11.42],
    [2.8, 11.53],
    [2.68, 11.47],
    [2.62, 11.32],
    [2.58, 11.0],
    [2.5, 10.9],
    [2.36, 10.97],
    [1.2, 11.03],
    [0, 11.04],
  ];
  for (let i = 10; i < raw.length; i++) raw[i] = [raw[i][0], raw[i][1] - SHORTEN];
  const radii: number[] = raw.map((_, i) => (i === 0 || i === raw.length - 1 ? 0 : 0.12));
  radii[9] = 0.5;
  radii[10] = 0.55;
  radii[11] = 0.3;
  radii[12] = 0.25;
  radii[16] = 0.06;
  radii[17] = 0.08;
  radii[18] = 0.06;
  radii[19] = 0.05;
  return fillet(raw, radii, 6);
}

function splitProfile(pts: P2[], y0: number, y1: number): [P2[], P2[], P2[]] {
  const cut = (arr: P2[], y: number): [P2[], P2[]] => {
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1];
      const b = arr[i];
      if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1] && a[0] > 2.5) {
        const t = (y - a[1]) / (b[1] - a[1]);
        const p: P2 = [a[0] + (b[0] - a[0]) * t, y];
        return [[...arr.slice(0, i), p], [p, ...arr.slice(i)]];
      }
    }
    throw new Error('split failed');
  };
  const [bottom, rest] = cut(pts, y0);
  const [mid, top] = cut(rest, y1);
  return [bottom, mid, top];
}

/** Text repeated around the full wrap, squeezed so it tiles seamlessly. */
function ringText(c: C2D, str: string, W: number, y: number, f: string, color: string, offset = 0): void {
  c.save();
  c.font = f;
  c.textBaseline = 'middle';
  c.fillStyle = color;
  const w = c.measureText(str).width;
  const n = Math.max(1, Math.round(W / w));
  const sx = W / (n * w);
  c.translate(-offset * w * sx, y);
  c.scale(sx, 1);
  for (let i = 0; i <= n + 1; i++) c.fillText(str, i * w, 0);
  c.restore();
}

/** Seamless drip row: rounded icicles hanging from y0 (periodic over W). */
function drips(c: C2D, W: number, y0: number, count: number, minL: number, maxL: number, w: number, color: string, seed: number, phase = 0): void {
  const r = rng(seed);
  c.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = ((i + phase) / count) * W + (r() - 0.5) * (W / count) * 0.35;
    const len = minL + r() * (maxL - minL);
    const ww = w * (0.7 + r() * 0.6);
    for (const ox of [0, -W, W]) {
      const cx = x + ox;
      if (cx < -ww * 2 || cx > W + ww * 2) continue;
      c.beginPath();
      c.moveTo(cx - ww * 1.6, y0 - 4);
      c.bezierCurveTo(cx - ww * 0.9, y0 + 4, cx - ww, y0 + len * 0.4, cx - ww, y0 + len - ww);
      c.arc(cx, y0 + len - ww, ww, Math.PI, 0, true);
      c.bezierCurveTo(cx + ww, y0 + len * 0.4, cx + ww * 0.9, y0 + 4, cx + ww * 1.6, y0 - 4);
      c.closePath();
      c.fill();
    }
  }
}

/** White squiggle lines (swirl pattern). */
function squiggles(c: C2D, x0: number, x1: number, y0: number, rows: number, gap: number, color: string, width: number, seed: number): void {
  const r = rng(seed);
  c.save();
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (let j = 0; j < rows; j++) {
    const y = y0 + j * gap;
    const amp = 8 + r() * 10;
    const k = 0.035 + r() * 0.02;
    const ph = r() * 6;
    c.beginPath();
    for (let x = x0; x <= x1; x += 4) {
      const yy = y + Math.sin(x * k + ph) * amp + Math.sin(x * k * 2.3 + ph * 2) * amp * 0.35;
      if (x === x0) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    }
    c.stroke();
  }
  c.restore();
}

function paintLabel(s: Surface): void {
  const c = s.c;
  const W = s.w;
  const H = s.h;
  const X = (deg: number) => W / 2 + (deg / 360) * W;

  // royal blue body
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2b5fff');
  g.addColorStop(0.5, BLUE);
  g.addColorStop(1, BLUE_DARK);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  // big soft swirl blobs in lighter / darker blue (busy painted body)
  const r = rng(77);
  for (let i = 0; i < 26; i++) {
    const x = r() * W;
    const y = 220 + r() * (H - 280);
    const rx = 60 + r() * 150;
    const ry = 30 + r() * 80;
    const col = r() > 0.42 ? hexA(BLUE_LIGHT, 0.45) : hexA('#0d2aa6', 0.4);
    const rot = r() * Math.PI;
    for (const ox of [0, -W, W]) {
      c.beginPath();
      c.ellipse(x + ox, y, rx, ry, rot, 0, Math.PI * 2);
      c.fillStyle = col;
      c.fill();
    }
  }
  // light swirl strokes
  c.save();
  c.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = r() * W;
    const y = 240 + r() * (H - 300);
    const rad = 30 + r() * 80;
    const a0 = r() * 6;
    const a1 = a0 + 2.4 + r() * 2;
    c.strokeStyle = hexA(r() > 0.4 ? ICE : '#ffffff', 0.55);
    c.lineWidth = 6 + r() * 10;
    for (const ox of [0, -W, W]) {
      c.beginPath();
      c.arc(x + ox, y, rad, a0, a1);
      c.stroke();
    }
  }
  c.restore();

  // white + ice drips hanging from the yellow band
  const BAND0 = 52;
  const BAND1 = 158;
  drips(c, W, BAND1, 30, 120, 300, 34, ICE, 5, 0.25);
  drips(c, W, BAND1, 22, 90, 240, 28, '#ffffff', 9, 0.6);
  // blue neck, then the yellow band with a dripping lower edge
  c.fillStyle = '#1d47e6';
  c.fillRect(0, 0, W, BAND0);
  c.fillStyle = YELLOW;
  c.fillRect(0, BAND0, W, BAND1 - BAND0);
  drips(c, W, BAND1 - 4, 34, 24, 64, 15, YELLOW, 13, 0.1);
  ringText(c, 'ZERO SUGAR · INFINITE IDEAS · FOUNDER FUEL · SHIP DAILY · ', W, (BAND0 + BAND1) / 2 + 2, font(36, FONTS.archivoBlack, 400, true), NAVY);

  // ---------------- front: flat white wordmark where the reference has its brand mark
  const fx = X(-30);
  text(c, 'ZEROS', fx + 10, 452, { size: 232, maxWidth: 720, family: FONTS.bagel, align: 'center', color: hexA('#7fbfff', 0.75) });
  text(c, 'ZEROS', fx, 440, { size: 232, maxWidth: 720, family: FONTS.bagel, align: 'center', gradient: ['#ffffff', '#cfeaff'] });
  text(c, 'founder fuel', fx - 20, 540, { size: 64, family: FONTS.ui, weight: 600, align: 'center', color: '#ffffff', tracking: 4 });

  // right: white squiggle lines + small print panel
  squiggles(c, X(22), X(104), 300, 6, 32, hexA('#ffffff', 0.85), 6, 3);
  smallPrint(
    c,
    ['ZEROS SODA — SPARKLING FOUNDER', 'FUEL. 0 SUGAR, 0 MEETINGS, 100%', 'SHIPPING. BREWED BY A FORMER', 'PRODUCT DESIGNER WHO NOW BUILDS', 'ZEROS. SERVE COLD, THINK BIG.'],
    X(46),
    490,
    20,
    '#ffffff',
    { weight: 700, lineHeight: 26 },
  );

  // lower-right dark icon sticker (original design-tool icons)
  sticker(s, X(16), 572, -8 * DEG, rrPath(-92, -92, 184, 184, 34), { border: 8, borderColor: '#d9e6ff', fill: '#0e0f1a', shadow: 0.9 }, (k) => {
    k.lineWidth = 9;
    k.lineCap = 'round';
    k.lineJoin = 'round';
    k.strokeStyle = '#39f08a';
    k.beginPath();
    k.moveTo(-70, -12);
    k.bezierCurveTo(-52, -78, -24, -18, -14, -66);
    k.stroke();
    fillPath(k, (q) => q.arc(-70, -12, 7, 0, Math.PI * 2), '#39f08a');
    fillPath(k, (q) => q.arc(-14, -66, 7, 0, Math.PI * 2), '#39f08a');
    k.strokeStyle = '#ff3b4f';
    k.beginPath();
    k.moveTo(42, -76);
    k.lineTo(18, -36);
    k.lineTo(50, -36);
    k.lineTo(26, 4);
    k.stroke();
    k.strokeStyle = '#ff6ad5';
    k.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? 14 : 32;
      const px = -42 + Math.cos(a) * rr;
      const py = 46 + Math.sin(a) * rr;
      if (i === 0) k.moveTo(px, py);
      else k.lineTo(px, py);
    }
    k.stroke();
    k.strokeStyle = '#4aa8ff';
    k.beginPath();
    k.moveTo(20, 18);
    k.lineTo(20, 76);
    k.lineTo(34, 62);
    k.lineTo(46, 84);
    k.lineTo(56, 78);
    k.lineTo(44, 58);
    k.lineTo(64, 56);
    k.closePath();
    k.stroke();
  });

  // bottom band
  c.fillStyle = NAVY;
  c.fillRect(0, H - 58, W, 58);
  ringText(c, '250 ml · 8.4 FL OZ · 0 KCAL · 100% FOCUS · KEEP COLD, SHIP HOT · ', W, H - 29, font(24, FONTS.spaceMono, 700), ICE, 0.37);

  // ---------------- back
  const nx = X(136);
  c.save();
  c.translate(nx - 165, 205);
  const ph = factsPanel(
    c,
    0,
    0,
    330,
    'Nutrition Facts',
    'Serving size: 1 big idea',
    [['Ideas', '100%', true], ['Sleep', '0g', true], ['Meetings', '0mg', true], ['Shipping', 'daily', true], '-', ['Coffee', 'yes'], ['Pixels', '1,000,000'], ['Motion', '5 yrs']],
    { size: 18, footer: ['* % daily value of ambition'] },
  );
  c.restore();
  s.maskPath(rrPath(nx - 165, 205, 330, ph, 2), 0.42, 0);
  for (const bx of [X(-186), X(-186) + W]) {
    sticker(s, bx, 420, -90 * DEG, rrPath(-150, -62, 300, 124, 8), { border: 0, fill: '#fff', shadow: 0.6 }, (k) => {
      barcode(k, -128, -50, 256, 98, 1337, { digits: '0 00000 00001 0' });
    });
  }
  const ix = X(-142);
  c.save();
  c.fillStyle = hexA(NAVY, 0.8);
  rrect(c, ix - 180, 300, 360, 220, 18);
  c.fill();
  c.restore();
  text(c, 'INGREDIENTS', ix - 158, 344, { size: 26, family: FONTS.archivoBlack, color: YELLOW });
  smallPrint(
    c,
    ['carbonated ambition, natural', 'flavours, 5 years of motion', 'design, a pinch of chaos,', 'zero sugar. once upon a time', 'i was a product designer.'],
    ix - 158,
    364,
    19,
    '#ffffff',
    { lineHeight: 23 },
  );
  grain(c, 0, 0, W, H, 9000, 0.05, 11);
}

/** Drinking-hole outline (teardrop) in units of k (cm); narrow end towards +y. */
function mouthPath(p: { moveTo(x: number, y: number): void; quadraticCurveTo(a: number, b: number, c: number, d: number): void }, k: number): void {
  p.moveTo(-0.62 * k, 0.3 * k);
  p.quadraticCurveTo(-1.0 * k, -0.6 * k, 0, -0.8 * k);
  p.quadraticCurveTo(1.0 * k, -0.6 * k, 0.62 * k, 0.3 * k);
  p.quadraticCurveTo(0, 0.52 * k, -0.62 * k, 0.3 * k);
}

function paintLidBump(s: Surface): void {
  // left half: lid seen from above (x right, -z up). right half: base seen from below.
  const c = s.bump!.ctx;
  const half = s.w / 2;
  const k = half / (2 * 2.9); // px per cm
  const L = { cx: half / 2, cy: s.h / 2 };
  const B = { cx: half * 1.5, cy: s.h / 2 };
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = 'rgb(150,150,150)';
  c.lineWidth = 0.1 * k;
  for (const r of [2.2, 2.05]) {
    c.beginPath();
    c.arc(L.cx, L.cy, r * k, 0, Math.PI * 2);
    c.stroke();
  }
  // raised bead around the open mouth on the far side (texture up = -z = back)
  c.save();
  c.translate(L.cx, L.cy - 1.12 * k);
  // mouthPath's narrow end (+y = texture down) points at the rivet
  c.filter = `blur(${0.06 * k}px)`;
  c.beginPath();
  mouthPath(c, k * 1.26);
  c.strokeStyle = 'rgb(190,190,190)';
  c.lineWidth = 0.34 * k;
  c.stroke();
  c.filter = 'none';
  c.restore();
  c.strokeStyle = 'rgb(160,160,160)';
  c.lineWidth = 0.08 * k;
  c.beginPath();
  c.arc(L.cx, L.cy, 0.42 * k, 0, Math.PI * 2);
  c.stroke();
  arcText(c, 'ZEROS · RECYCLE ME · SHIP IT', L.cx, L.cy, 1.72 * k, Math.PI / 2, { size: 0.26 * k, family: FONTS.archivoBlack, color: 'rgb(185,185,185)', tracking: 0.03 * k }, true);
  c.strokeStyle = 'rgb(150,150,150)';
  c.lineWidth = 0.08 * k;
  for (const r of [0.7, 1.9]) {
    c.beginPath();
    c.arc(B.cx, B.cy, r * k, 0, Math.PI * 2);
    c.stroke();
  }
  arcText(c, 'BATCH 0001 · BEST BEFORE: SHIP DATE · ', B.cx, B.cy, 1.32 * k, -Math.PI / 2, { size: 0.24 * k, family: FONTS.spaceMono, weight: 700, color: 'rgb(180,180,180)', tracking: 0.02 * k });
  text(c, '0', B.cx, B.cy + 0.22 * k, { size: 0.62 * k, family: FONTS.bagel, align: 'center', color: 'rgb(185,185,185)' });
}

function pullTab(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.42, -0.55);
  s.quadraticCurveTo(0, -0.75, 0.42, -0.55);
  s.quadraticCurveTo(0.62, -0.1, 0.62, 0.55);
  s.quadraticCurveTo(0.66, 1.75, 0, 1.78);
  s.quadraticCurveTo(-0.66, 1.75, -0.62, 0.55);
  s.quadraticCurveTo(-0.62, -0.1, -0.42, -0.55);
  const ring = new THREE.Path();
  ring.moveTo(-0.38, 0.62);
  ring.quadraticCurveTo(-0.4, 1.52, 0, 1.52);
  ring.quadraticCurveTo(0.4, 1.52, 0.38, 0.62);
  ring.quadraticCurveTo(0, 0.42, -0.38, 0.62);
  s.holes.push(ring);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.035, bevelSegments: 2, curveSegments: 18 });
  geo.rotateX(-Math.PI / 2); // shape +Y -> -Z, extrusion -> +Y
  geo.rotateY(Math.PI); // ring end towards +Z (front)
  return geo;
}

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  const prof = canProfile();
  const [bottomP, midP, topP] = splitProfile(prof, PRINT_Y0, PRINT_Y1);
  const SEG = 112;

  // ---------- printed body
  let arc = 0;
  for (let i = 1; i < midP.length; i++) arc += Math.hypot(midP[i][0] - midP[i - 1][0], midP[i][1] - midP[i - 1][1]);
  const LW = 2048;
  const LH = Math.round((LW * arc) / (2 * Math.PI * R));
  const label = new Surface(LW, LH, bctx, { mask: { rough: 0.24, metal: 0.45 } });
  paintLabel(label);
  const mask = label.maskTexture();
  const labelMat = new THREE.MeshPhysicalMaterial({
    map: label.colorTexture(),
    roughnessMap: mask,
    metalnessMap: mask,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  inner.add(new THREE.Mesh(lathe(midP, { segments: SEG }), labelMat));

  // ---------- aluminium (lid + base + tab + rivet) with an embossing bump map
  const bump = new Surface(1024, 512, bctx, { bump: { base: 0.5, density: 1 }, density: 0.01 });
  paintLidBump(bump);
  const RM = 2.9;
  const lidUV = (x: number, _y: number, z: number): [number, number] => [0.25 + (x / RM) * 0.25, 0.5 - (z / RM) * 0.5];
  const baseUV = (x: number, _y: number, z: number): [number, number] => [0.75 + (x / RM) * 0.25, 0.5 + (z / RM) * 0.5];
  const topGeo = lathe(topP, { segments: SEG, uv: lidUV });
  const baseGeo = lathe(bottomP, { segments: SEG, uv: baseUV });
  const tab = flatUV(pullTab(), 0.5, 0.98);
  place(tab, [0, LID_Y + 0.04, -0.1], [-0.14, 0, 0]);
  const rivet = flatUV(new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0.5, 0.98);
  place(rivet, [0, LID_Y + 0.03, 0], [0, 0, 0], [1, 0.5, 1]);
  const aluParts = [topGeo, baseGeo, tab, rivet];
  const aluGeo = merge(aluParts);
  aluParts.forEach((g) => g.dispose());
  const aluMat = new THREE.MeshPhysicalMaterial({
    color: '#e4e8ee',
    metalness: 1,
    roughness: 0.2,
    bumpMap: bump.bumpTexture(),
    bumpScale: 1.6,
    clearcoat: 0.3,
    clearcoatRoughness: 0.1,
  });
  inner.add(new THREE.Mesh(aluGeo, aluMat));

  // ---------- the open mouth: dark rim + blue drink, just above the recessed panel
  const outer = new THREE.Shape();
  mouthPath(outer, 1.18);
  const innerShape = new THREE.Shape();
  mouthPath(innerShape, 1.0);
  const mo = tint(new THREE.ShapeGeometry(outer, 16), '#06133f');
  const mi = tint(new THREE.ShapeGeometry(innerShape, 16), '#2f6bff');
  mi.translate(0, -0.05, 0.004);
  const mouth = merge([mo, mi]);
  mo.dispose();
  mi.dispose();
  // shape +Y (narrow end) -> -Z after rotateX(-90deg); flip so the narrow end points at the rivet (+Z)
  mouth.rotateX(-Math.PI / 2);
  mouth.rotateY(Math.PI);
  mouth.translate(0, LID_Y + 0.005, -1.12);
  const mouthMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 });
  inner.add(new THREE.Mesh(mouth, mouthMat));

  // ---------- peeling light-blue warning sticker on the left side
  const sheet = new StickerSheet(640, 448, bctx, 14);
  const cell = sheet.alloc(600, 400);
  {
    const k = sheet.surf.c;
    k.save();
    k.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
    const shape = rrPath(-270, -175, 540, 350, 34);
    sticker(k, 0, 0, 0, shape, { border: 16, fill: '#bfe5ff', shadow: 0.5 }, (q) => {
      fillPath(q, rrPath(-246, -151, 492, 302, 22), '#d9f0ff');
      q.strokeStyle = '#3d8fe0';
      q.lineWidth = 6;
      q.beginPath();
      rrect(q, -232, -137, 464, 274, 16);
      q.stroke();
      fillPath(q, (p) => p.ellipse(-92, -6, 80, 92, 0, 0, Math.PI * 2), '#3d8fe0');
      fillPath(q, (p) => p.ellipse(-92, -6, 40, 52, 0, 0, Math.PI * 2), '#d9f0ff');
      fillPath(q, (p) => p.arc(-58, -64, 16, 0, Math.PI * 2), '#ffffff');
      text(q, 'WARNING', 130, -96, { size: 50, family: FONTS.archivoBlack, align: 'center', color: '#1d5fc0', maxWidth: 200 });
      text(q, 'CONTAINS', 130, -26, { size: 40, family: FONTS.archivoBlack, align: 'center', color: '#3d8fe0', maxWidth: 200 });
      text(q, 'BIG IDEAS', 130, 26, { size: 40, family: FONTS.archivoBlack, align: 'center', color: '#3d8fe0', maxWidth: 200 });
      text(q, 'may cause shipping', 130, 92, { size: 26, family: FONTS.spaceMono, weight: 700, align: 'center', color: '#1d5fc0', maxWidth: 210 });
    });
    k.restore();
  }
  const sheetTex = sheet.surf.colorTexture();
  const peel = stickerPatch(surfaces.cylinder(R), -76 * DEG * R, 5.5, 3.7, 2.47, 30 * DEG, cell.uv, {
    nx: 18,
    ny: 10,
    offset: 0.015,
    lift: (u, v) => {
      const a = THREE.MathUtils.smoothstep(1 - u, 0.45, 1);
      return 0.9 * a * a * (0.75 + 0.25 * v);
    },
  });
  const peelMat = paperBackfaces(stickerSheet(sheetTex, { roughness: 0.45, clearcoat: 0.5 }), '#eef6ff');
  inner.add(new THREE.Mesh(peel, peelMat));

  return finish(inner, trash, undefined, 'zeros-soda');
}

export const sodaCan: ObjectDef = {
  kind: 'can',
  name: 'Zeros Soda',
  tagline: 'founder fuel, zero sugar',
  defaultRotation: [0.84, 0, -0.7],
  build,
};
