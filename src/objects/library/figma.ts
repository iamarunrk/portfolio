import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet, type AtlasCell } from '../textures';
import { Trash, finish } from '../build';
import { lathe, fillet, stickerPatch, surfaces, merge, flatUV, type P2, type SurfacePoint } from '../geometry';
import { stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, text, arcText, font, measure, sticker, rrPath, rrect, circlePath, starPath, fillPath, barcode, factsPanel, smallPrint, grain, hexA, type C2D } from '../paint';
import { FIGMA, ZEROS, figmaLogo, cursorPath } from './_studio';

/*
 * FIGMA TIN: a squat tuna-style tin with rolled double seams, a ring-pull lid and a
 * glossy white wrap-around label (logo, wordmark, a band of brand colours, design
 * facts on the back). Stickers: a multiplayer cursor, a comment pin, a "Frame 1"
 * selection and a purple tab on the lid. Centimetres, normalised afterwards.
 */

const R = 4.2; // wall radius
const LABEL_R = R + 0.035;
const LABEL_Y0 = 0.86;
const LABEL_Y1 = 4.54;
const TOP = 5.42;
const LID_Y = 5.04; // lid panel height at its rim
const LID_DOME = 0.08;
const LID_R = 3.72; // lid panel radius
const RM = 4.45; // planar UV radius for lid / base emboss
/** Label angle (degrees from +Z towards +X) the hero pose looks at. */
const FRONT_DEG = 8;

const INK = '#1e1e1e';
const PAPER = '#fbfaf6';

const lidY = (r: number) => LID_Y + LID_DOME * (1 - Math.min(1, (r / LID_R) ** 2));

// ------------------------------------------------------------------ geometry

function tinProfile(): P2[] {
  const raw: P2[] = [
    [0, 0.22],
    [3.3, 0.2],
    [3.62, 0.16],
    [3.8, 0.05],
    [4.02, 0.0],
    [4.28, 0.05],
    [4.37, 0.22],
    [4.31, 0.41],
    [R, 0.5],
    [R, 0.6],
    [R + 0.05, 0.68],
    [R, 0.76],
    [R, 4.64],
    [R + 0.05, 4.72],
    [R, 4.8],
    [R, 4.92],
    [4.31, 5.01],
    [4.37, 5.2],
    [4.29, 5.37],
    [4.12, TOP],
    [3.98, 5.37],
    [3.9, 5.2],
    [3.84, 5.06],
  ];
  const radii: number[] = raw.map((_, i) => (i === 0 ? 0 : 0.06));
  [4, 5, 6, 7, 16, 17, 18, 19, 20].forEach((i) => (radii[i] = 0.1));
  [9, 10, 11, 12, 13, 14].forEach((i) => (radii[i] = 0.035));
  const lid: P2[] = [];
  for (let i = 0; i <= 10; i++) {
    const r = LID_R * (1 - i / 10);
    lid.push([r, lidY(r)]);
  }
  // fillet everything up to the panel edge, then the (already smooth) dome
  const seam = fillet([...raw, lid[0]], [...radii, 0], 5);
  return [...seam, ...lid.slice(1)];
}

function labelProfile(): P2[] {
  return [
    [R, LABEL_Y0],
    [LABEL_R, LABEL_Y0],
    [LABEL_R, LABEL_Y0],
    [LABEL_R, LABEL_Y1],
    [LABEL_R, LABEL_Y1],
    [R, LABEL_Y1],
  ];
}

/** Tuna-tin ring pull: a stamped loop with a nose that sits under the rivet (shape origin). */
function ringPull(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5);
  s.quadraticCurveTo(0, -0.72, 0.5, -0.5);
  s.quadraticCurveTo(0.62, -0.2, 0.7, 0.3);
  s.bezierCurveTo(1.3, 0.55, 1.35, 2.55, 0, 2.62);
  s.bezierCurveTo(-1.35, 2.55, -1.3, 0.55, -0.7, 0.3);
  s.quadraticCurveTo(-0.62, -0.2, -0.5, -0.5);
  const hole = new THREE.Path();
  hole.moveTo(-0.62, 0.78);
  hole.bezierCurveTo(-1.02, 0.95, -1.0, 2.26, 0, 2.3);
  hole.bezierCurveTo(1.0, 2.26, 1.02, 0.95, 0.62, 0.78);
  hole.quadraticCurveTo(0, 0.6, -0.62, 0.78);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.045, bevelSegments: 3, curveSegments: 24 });
  g.rotateX(-Math.PI / 2); // shape +Y -> -Z, extrusion -> +Y
  g.rotateY(Math.PI); // loop end towards +Z
  return g;
}

/** Point on the lid panel: a = x, b = -z (b grows towards the back). */
function lidSurface(a: number, b: number): SurfacePoint {
  const r = Math.hypot(a, b);
  const k = (2 * LID_DOME) / (LID_R * LID_R);
  const inside = r < LID_R ? 1 : 0;
  const n = new THREE.Vector3(k * a * inside, 1, -k * b * inside).normalize();
  return { p: new THREE.Vector3(a, lidY(r), -b), n };
}

// ------------------------------------------------------------------ print

function paintLabel(s: Surface): void {
  const c = s.c;
  const W = s.w;
  const H = s.h;
  const X = (deg: number) => W / 2 + (deg / 360) * W;
  const wrap = (fn: (ox: number) => void) => [0, -W, W].forEach(fn);

  c.fillStyle = PAPER;
  c.fillRect(0, 0, W, H);

  // colour band: brand blocks running all the way round, with a thin ink rule above
  const bandY = H * 0.765;
  const bandH = H * 0.15;
  const cols = [FIGMA.orange, FIGMA.salmon, FIGMA.purple, FIGMA.blue, FIGMA.green];
  const n = 25;
  const bw = W / n;
  for (let i = 0; i < n; i++) {
    c.fillStyle = cols[i % 5];
    c.fillRect(i * bw, bandY, bw + 0.5, bandH);
  }
  c.fillStyle = INK;
  c.fillRect(0, bandY - 5, W, 2.5);
  c.fillRect(0, H * 0.05, W, 2.5);
  // tiny ring text along the very top
  c.save();
  c.font = font(12, FONTS.spaceMono, 700);
  c.fillStyle = hexA(INK, 0.75);
  c.textBaseline = 'middle';
  const strip = 'FRESH FRAMES · PACKED IN AUTO LAYOUT · NET WT 1 FILE · 100% VECTOR · ';
  const sw = c.measureText(strip).width;
  const reps = Math.max(1, Math.round(W / sw));
  c.translate(0, H * 0.025);
  c.scale(W / (reps * sw), 1);
  for (let i = 0; i <= reps; i++) c.fillText(strip, i * sw, 0);
  c.restore();

  // ---------- front: logo + wordmark, centred a little right of +Z (the hero pose looks there)
  const midY = H * 0.43;
  const logoH = H * 0.5;
  const word = { size: H * 0.5, family: FONTS.ui, weight: 700, color: INK, tracking: -4 };
  const wordW = measure(c, 'figma', word);
  const gap = H * 0.1;
  const groupW = (logoH * 2) / 3 + gap + wordW;
  const gx = X(FRONT_DEG) - groupW / 2;
  figmaLogo(c, gx + logoH / 3, midY, logoH);
  const wx = gx + (logoH * 2) / 3 + gap;
  text(c, 'figma', wx, midY + H * 0.145, word);
  text(c, 'fresh frames, packed in auto layout', wx + wordW / 2, H * 0.715, { size: 17, family: FONTS.ui, weight: 500, color: hexA(INK, 0.8), align: 'center', tracking: 0.5 });

  // ---------- right: "auto layout in brine" panel
  {
    const x = X(66);
    const y = H * 0.12;
    const w = 210;
    const h = H * 0.56;
    c.save();
    c.fillStyle = INK;
    c.beginPath();
    rrect(c, x, y, w, h, 12);
    c.fill();
    // auto layout glyph: three bars with a spacing arrow
    c.fillStyle = ZEROS.lime;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      rrect(c, x + 16, y + 16 + i * 17, 34, 11, 3);
      c.fill();
    }
    text(c, 'AUTO LAYOUT', x + 62, y + 33, { size: 19, family: FONTS.archivoBlack, color: '#ffffff', maxWidth: w - 74 });
    text(c, 'IN BRINE', x + 62, y + 58, { size: 19, family: FONTS.archivoBlack, color: ZEROS.lime, maxWidth: w - 74 });
    smallPrint(c, ['gap: 16 · pad: 24', 'hug contents', 'NET WT 1 FILE (∞ pages)'], x + 16, y + 82, 11.5, '#d8d8d8', { weight: 700, lineHeight: 14 });
    c.restore();
  }
  // a second, smaller mark further round
  figmaLogo(c, X(104), H * 0.4, H * 0.32);
  text(c, 'Est. 2016', X(104), H * 0.68, { size: 14, family: FONTS.spaceMono, weight: 700, color: INK, align: 'center' });

  // ---------- back: design facts
  c.save();
  c.translate(X(142) - 120, H * 0.08);
  factsPanel(
    c,
    0,
    0,
    240,
    'Design Facts',
    'Serving size: 1 frame',
    [['Frames', '100%', true], ['Components', '48', true], ['Variants', '12'], ['Comments', '3 unread'], ['Cursors', '1']],
    { size: 10.5, paper: '#ffffff' },
  );
  c.restore();

  // ---------- back: a big lime seal straddling the wrap seam
  wrap((ox) => {
    const x = X(180) + ox;
    if (x < -150 || x > W + 150) return;
    c.save();
    c.translate(x, H * 0.4);
    c.rotate(-8 * DEG);
    fillPath(c, starPath(0, 0, 92, 74, 18, 0, 0.35), INK);
    fillPath(c, starPath(0, 0, 84, 67, 18, 0, 0.35), ZEROS.lime);
    text(c, '100%', 0, -14, { size: 38, family: FONTS.archivoBlack, align: 'center', color: INK });
    text(c, 'VECTOR', 0, 18, { size: 27, family: FONTS.archivoBlack, align: 'center', color: INK });
    text(c, 'no raster added', 0, 40, { size: 12, family: FONTS.spaceMono, weight: 700, align: 'center', color: INK });
    c.restore();
  });

  // ---------- left: ingredients + barcode
  {
    const x = X(-112);
    const y = H * 0.12;
    text(c, 'INGREDIENTS', x, y + 16, { size: 17, family: FONTS.archivoBlack, color: FIGMA.purple });
    smallPrint(c, ['frames, components, variants,', 'auto layout, constraints,', '1 cursor, a pinch of chaos.', 'may contain: comments.'], x, y + 26, 12, INK, { lineHeight: 15 });
    fillPath(c, rrPath(X(-72) - 6, y - 2, 128, 98, 6), '#ffffff');
    barcode(c, X(-72), y + 4, 116, 86, 2016, { digits: '0 16 FIG 000 1' });
  }
  // little cursors scattered on the white (multiplayer!)
  const cur = (deg: number, y: number, col: string, name: string) => {
    c.font = font(11, FONTS.ui, 700);
    const nw = c.measureText(name).width + 12;
    wrap((ox) => {
      const x = X(deg) + ox;
      if (x < -200 || x > W + 200) return;
      fillPath(c, cursorPath(x, y, 30), col);
      c.save();
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.beginPath();
      cursorPath(x, y, 30)(c);
      c.stroke();
      c.restore();
      fillPath(c, rrPath(x + 18, y + 26, nw, 17, 5), col);
      c.fillStyle = '#fff';
      c.textBaseline = 'middle';
      c.fillText(name, x + 24, y + 35);
    });
  };
  cur(-46, H * 0.1, FIGMA.blue, 'pm');
  cur(-128, H * 0.46, FIGMA.green, 'dev');
  cur(-151, H * 0.1, FIGMA.orange, 'ceo');

  grain(c, 0, 0, W, H, 5000, 0.04, 21);
}

function paintTinBump(s: Surface): void {
  const c = s.bump!.ctx;
  const half = s.w / 2;
  const k = half / (2 * RM); // px per cm
  const L = { x: half / 2, y: s.h / 2 };
  const B = { x: half * 1.5, y: s.h / 2 };
  const ring = (cx: number, cy: number, r: number, w: number, g: number, blur: number) => {
    c.save();
    c.filter = `blur(${blur * k}px)`;
    c.strokeStyle = `rgb(${g},${g},${g})`;
    c.lineWidth = w * k;
    c.beginPath();
    c.arc(cx, cy, r * k, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  };
  // lid: three raised beads, a score groove inside the countersink, embossed type
  for (const r of [1.25, 2.05, 2.85]) ring(L.x, L.y, r, 0.16, 182, 0.05);
  ring(L.x, L.y, 3.5, 0.05, 90, 0.01);
  arcText(c, 'FIGMA · FRESH FRAMES · PULL TAB · KEEP IT VECTOR ·', L.x, L.y, 3.17 * k, Math.PI / 2, { size: 0.24 * k, family: FONTS.archivoBlack, color: 'rgb(178,178,178)', tracking: 0.03 * k }, true);
  // base: rings, batch code, a raised logo
  for (const r of [0.95, 2.7, 3.35]) ring(B.x, B.y, r, 0.1, 172, 0.03);
  arcText(c, 'BEST BEFORE: SHIP DATE · LOT 0001 · ', B.x, B.y, 1.95 * k, -Math.PI / 2, { size: 0.24 * k, family: FONTS.spaceMono, weight: 700, color: 'rgb(178,178,178)', tracking: 0.02 * k });
  c.save();
  c.filter = `blur(${0.03 * k}px)`;
  c.globalAlpha = 1;
  const g = 'rgb(176,176,176)';
  const sz = 1.3 * k;
  const s3 = sz / 3;
  const r = s3 / 2;
  const x0 = B.x - s3;
  const y0 = B.y - sz / 2;
  c.fillStyle = g;
  for (const [x, y, rr] of [
    [x0, y0, [r, 0, 0, r]],
    [x0 + s3, y0, [0, r, r, 0]],
    [x0, y0 + s3, [r, 0, 0, r]],
    [x0, y0 + 2 * s3, [r, 0, r, r]],
  ] as [number, number, number[]][]) {
    c.beginPath();
    rrect(c, x, y, s3, s3, rr);
    c.fill();
  }
  c.beginPath();
  c.arc(x0 + s3 + r, y0 + s3 + r, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
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
  // multiplayer cursor + name tag
  const cCursor = sheet.alloc(300, 220);
  inCell(sheet, cCursor, (c) => {
    const shape = (q: C2D) => {
      cursorPath(-118, -92, 118)(q);
      rrect(q, -48, -6, 160, 66, 33);
    };
    sticker(c, 0, 0, 0, shape, { border: 13, fill: '#fff', shadow: 0.7 }, (k) => {
      fillPath(k, cursorPath(-118, -92, 118), ZEROS.pink);
      fillPath(k, rrPath(-48, -6, 160, 66, 33), ZEROS.pink);
      text(k, 'founder', 32, 38, { size: 38, family: FONTS.ui, weight: 700, align: 'center', color: '#ffffff', maxWidth: 136 });
    });
  });
  // comment pin
  const cComment = sheet.alloc(380, 170);
  inCell(sheet, cComment, (c) => {
    const shape = rrPath(-170, -66, 340, 132, [66, 66, 66, 4]);
    sticker(c, 0, 0, 0, shape, { border: 0, fill: '#ffffff', shadow: 0.8, edge: '#d9d9d9' }, (k) => {
      fillPath(k, circlePath(-110, 0, 42), ZEROS.ink);
      text(k, 'Z', -110, 18, { size: 50, family: FONTS.bagel, align: 'center', color: ZEROS.lime });
      text(k, 'ship it?', 34, -2, { size: 44, family: FONTS.ui, weight: 700, align: 'center', color: INK });
      smallPrint(k, ['2 replies · just now'], 34, 14, 20, '#8a8a8a', { align: 'center', family: FONTS.ui, weight: 500 });
    });
  });
  // "Frame 1" selection
  const cFrame = sheet.alloc(360, 270);
  inCell(sheet, cFrame, (c) => {
    const shape = rrPath(-170, -125, 340, 250, 18);
    sticker(c, 0, 0, 0, shape, { border: 0, fill: '#ffffff', shadow: 0.7 }, (k) => {
      const blue = '#0D99FF';
      text(k, 'Frame 1', -140, -88, { size: 24, family: FONTS.ui, weight: 500, color: '#6b6b6b' });
      k.strokeStyle = blue;
      k.lineWidth = 4;
      k.strokeRect(-140, -74, 280, 150);
      // a tiny layout inside the frame
      fillPath(k, rrPath(-120, -56, 120, 16, 8), '#e6e6e6');
      fillPath(k, rrPath(-120, -30, 240, 54, 10), FIGMA.purple);
      fillPath(k, rrPath(-120, 32, 80, 28, 14), ZEROS.ink);
      text(k, 'ship', -80, 52, { size: 18, family: FONTS.ui, weight: 700, align: 'center', color: ZEROS.lime });
      for (const [x, y] of [
        [-140, -74],
        [140, -74],
        [-140, 76],
        [140, 76],
      ]) {
        k.fillStyle = '#fff';
        k.fillRect(x - 8, y - 8, 16, 16);
        k.strokeStyle = blue;
        k.lineWidth = 3;
        k.strokeRect(x - 8, y - 8, 16, 16);
      }
      fillPath(k, rrPath(-60, 92, 120, 26, 6), blue);
      text(k, '375 × 812', 0, 111, { size: 18, family: FONTS.ui, weight: 700, align: 'center', color: '#fff' });
    });
  });
  // purple tab
  const cTab = sheet.alloc(330, 96);
  inCell(sheet, cTab, (c) => {
    sticker(c, 0, 0, 0, rrPath(-158, -40, 316, 80, 10), { border: 0, fill: FIGMA.purple, shadow: 0.5 }, (k) => {
      text(k, 'v2 ✦ final', 0, 14, { size: 38, family: FONTS.archivoBlack, align: 'center', color: '#ffffff', maxWidth: 280 });
    });
  });
  // notification badge
  const cBadge = sheet.alloc(140, 140);
  inCell(sheet, cBadge, (c) => {
    sticker(c, 0, 0, 0, circlePath(0, 0, 54), { border: 9, fill: FIGMA.orange, shadow: 0.7 }, (k) => {
      text(k, '3', 0, 22, { size: 64, family: FONTS.ui, weight: 700, align: 'center', color: '#fff' });
    });
  });
  return { cCursor, cComment, cFrame, cTab, cBadge };
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  const SEG = 128;

  // ---------- tin body (seams, beads, lid, base) + ring pull, one embossed aluminium mesh
  const bump = new Surface(1024, 512, bctx, { bump: { base: 0.5, density: 1 }, density: 0.01 });
  paintTinBump(bump);
  const lidUV = (x: number, z: number): [number, number] => [0.25 + (x / RM) * 0.25, 0.5 - (z / RM) * 0.5];
  const baseUV = (x: number, z: number): [number, number] => [0.75 + (x / RM) * 0.25, 0.5 + (z / RM) * 0.5];
  const body = lathe(tinProfile(), { segments: SEG, uv: (x, y, z) => (y > TOP / 2 ? lidUV(x, z) : baseUV(x, z)) });
  const pull = flatUV(ringPull(), 0.5, 0.99);
  pull.rotateX(-0.075); // loop end lifts a little off the lid
  pull.rotateY(0.12);
  pull.translate(0.2, lidY(1.9) + 0.05, -1.9);
  const rivet = flatUV(new THREE.SphereGeometry(0.3, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0.5, 0.99);
  rivet.scale(1, 0.45, 1);
  rivet.translate(0.2, lidY(1.9) + 0.03, -1.9);
  const tinGeo = merge([body, pull, rivet]);
  [body, pull, rivet].forEach((g) => g.dispose());
  const tinMat = new THREE.MeshPhysicalMaterial({
    color: '#e7eaef',
    metalness: 1,
    roughness: 0.2,
    bumpMap: bump.bumpTexture(),
    bumpScale: 1.4,
    clearcoat: 0.35,
    clearcoatRoughness: 0.1,
  });
  inner.add(new THREE.Mesh(tinGeo, tinMat));

  // ---------- printed label
  const circ = 2 * Math.PI * LABEL_R;
  const LW = 2048;
  const LH = Math.round((LW * (LABEL_Y1 - LABEL_Y0)) / circ);
  const label = new Surface(LW, LH, bctx);
  paintLabel(label);
  const labelGeo = lathe(labelProfile(), { segments: SEG, vMode: 'y' });
  const labelMat = new THREE.MeshPhysicalMaterial({ map: label.colorTexture(), roughness: 0.45, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.14 });
  labelMat.color.setScalar(1.12); // bright white print
  inner.add(new THREE.Mesh(labelGeo, labelMat));

  // ---------- stickers
  const sheet = new StickerSheet(1024, 640, bctx, 14);
  const cells = paintStickers(sheet);
  const sheetTex = sheet.surf.colorTexture();
  const side = surfaces.cylinder(LABEL_R);
  const peel = (corner: 'tr' | 'tl' | 'br', amt: number) => (u: number, v: number) => {
    const uu = corner === 'tl' ? 1 - u : u;
    const vv = corner === 'br' ? 1 - v : v;
    const a = THREE.MathUtils.smoothstep(uu, 0.55, 1) * THREE.MathUtils.smoothstep(vv, 0.45, 1);
    return amt * a * a;
  };
  const geos = [
    // cursor pointing at the wordmark, wrapped on the side
    stickerPatch(side, 3.05, 1.78, 2.3, 1.69, -12 * DEG, cells.cCursor.uv, { nx: 14, ny: 8, offset: 0.012 }),
    // "Frame 1" selection on the left side, one corner lifting
    stickerPatch(side, -7.9, 2.55, 2.9, 2.18, 7 * DEG, cells.cFrame.uv, { nx: 16, ny: 10, offset: 0.012, lift: peel('tl', 0.55) }),
    // lid: comment pin, badge, purple tab peeling up at the rim
    stickerPatch(lidSurface, -0.95, -1.95, 3.0, 1.34, 7 * DEG, cells.cComment.uv, { nx: 10, ny: 5, offset: 0.012 }),
    stickerPatch(lidSurface, 2.15, -0.75, 1.15, 1.15, 0, cells.cBadge.uv, { nx: 5, ny: 5, offset: 0.014 }),
    stickerPatch(lidSurface, -2.05, 1.55, 2.6, 0.66, 36 * DEG, cells.cTab.uv, { nx: 12, ny: 3, offset: 0.012, lift: (u) => 0.5 * Math.pow(THREE.MathUtils.smoothstep(1 - u, 0.6, 1), 2) }),
  ];
  const stickersGeo = merge(geos);
  geos.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.38, clearcoat: 0.7 }), '#f1eee7')));

  return finish(inner, trash, undefined, 'figma-tin');
}

export const figma: LibraryDef = {
  kind: 'figma',
  name: 'Figma Tin',
  tagline: 'fresh frames, packed in auto layout',
  category: 'studio',
  defaultRotation: [0.5, -0.14, 0.1],
  build,
};
export default figma;
