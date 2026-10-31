import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { lathe, merge, parametric, place, ribbon, stickerPatch, surfaces, tint } from '../geometry';
import { chrome, glossyPlastic, holoFoil, paperBackfaces, stickerSheet } from '../materials';
import { FONTS, DEG, rng, text, font, sticker, rrPath, rrect, starPath, holoFill, fillPath, smallPrint, grain, hexA, type C2D } from '../paint';
import { circlePathShape, decalPlane, inCell, peelLift, roundRect, roundRectPath, roundRectShape, screwHead, smoothSlab } from './_translucent';

/*
 * MIXTAPE VOL. 0: a chunky compact cassette in candy-pink translucent plastic. White hub
 * splines turn in the hub holes, brown tape packs and the tape path glow through the
 * shell, a cream label with marker handwriting on each side (A: design, B: ship), a holo
 * "hits only" star peeling off the corner and a lime SHIP IT tape wrapped over the top.
 * Centimetres (a real cassette is 10 x 6.4 x 1.2), slightly thickened, normalised after.
 */

const W = 10.2;
const H = 6.5;
const D = 1.56;
const R = 0.52; // plan corner radius
const BEV = 0.15;
const HALF = D / 2; // front cap at z = +HALF

const HUB_X = 2.1;
const HUB_Y = 0.6;
const HOLE_R = 0.66;
const PACK_L = 1.92;
const PACK_R = 1.2;
const PACK_H = 0.4;

const LABEL = { x0: -4.3, x1: 4.3, y0: -1.35, y1: 2.95 };
const LW = LABEL.x1 - LABEL.x0; // 8.6
const LH = LABEL.y1 - LABEL.y0; // 4.3
const WIN = { cx: 0, cy: HUB_Y, w: 5.9, h: 1.95, r: 0.42 };

const TRAP = { y0: -H / 2 + BEV, y1: -1.72, b: 3.75, t: 2.85, lift: 0.13 };
const ROUND_HOLES: [number, number][] = [
  [-2.62, -2.56],
  [2.62, -2.56],
];
const SQUARE_HOLES: [number, number][] = [
  [-1.3, -2.62],
  [1.3, -2.62],
];
const ROLLER_X = 3.98;
const ROLLER_Y = -2.5;
const ROLLER_R = 0.24;
const TAPE_Y = ROLLER_Y - ROLLER_R;

const PINK = '#ff4fb8';
const LIME = '#d7ff3a';
const INK = '#141016';
const CREAM = '#f6f0e3';

// ------------------------------------------------------------------ geometry

function holes(): THREE.Path[] {
  const list: THREE.Path[] = [circlePathShape(-HUB_X, HUB_Y, HOLE_R), circlePathShape(HUB_X, HUB_Y, HOLE_R)];
  for (const [x, y] of ROUND_HOLES) list.push(circlePathShape(x, y, 0.25));
  for (const [x, y] of SQUARE_HOLES) list.push(roundRectPath(x, y, 0.34, 0.26, 0.05));
  return list;
}

/** The shell: one soft-edged slab with the hub and head-area holes. */
function shellBody(): THREE.BufferGeometry {
  const shape = roundRectShape(0, 0, W - 2 * BEV, H - 2 * BEV, R);
  shape.holes.push(...holes());
  return smoothSlab(shape, D, BEV, { bevelSegments: 5, curveSegments: 12 });
}

/** Thin parting line where the two moulded halves meet. */
function seamGeometry(): THREE.BufferGeometry {
  const path = new THREE.Path();
  roundRect(path, 0, 0, W + 0.01, H + 0.01, R + BEV + 0.005);
  const pts = path.getSpacedPoints(220).map((p) => new THREE.Vector3(p.x, p.y, 0));
  pts.push(pts[0].clone());
  const half = new THREE.Vector3(0, 0, 0.022);
  return ribbon(pts, () => half);
}

/** Raised trapezoid plate at the bottom of a face (the head area), with the same holes. */
function trapezoid(sign: number): THREE.BufferGeometry {
  const b = 0.05;
  const s = new THREE.Shape();
  const { y0, y1, b: hb, t: ht } = TRAP;
  const yy0 = y0 + b;
  const yy1 = y1 - b;
  s.moveTo(-hb + b, yy0);
  s.lineTo(hb - b, yy0);
  s.lineTo(ht - b, yy1);
  s.lineTo(-ht + b, yy1);
  s.closePath();
  for (const [x, y] of ROUND_HOLES) s.holes.push(circlePathShape(x, y, 0.25 + b));
  for (const [x, y] of SQUARE_HOLES) s.holes.push(roundRectPath(x, y, 0.34 + 2 * b, 0.26 + 2 * b, 0.08));
  const g = smoothSlab(s, TRAP.lift + 0.06, b, { bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, HALF + (TRAP.lift - 0.06) / 2);
  if (sign < 0) g.rotateY(Math.PI);
  return g;
}

/** White hub: ring with six drive splines, spanning the full thickness. */
function hubGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.absarc(0, 0, HOLE_R - 0.07, 0, Math.PI * 2, false);
  const gear = new THREE.Path();
  const N = 6;
  const steps = N * 8;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const ph = (a * N) / (Math.PI * 2);
    const f = ph - Math.floor(ph);
    const tooth = f < 0.28 ? 1 : 0;
    const r = tooth ? 0.27 : 0.38;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) gear.moveTo(x, y);
    else gear.lineTo(x, y);
  }
  s.holes.push(gear);
  const g = smoothSlab(s, D - 0.16, 0.035, { bevelSegments: 2, curveSegments: 20 });
  // flange where the tape winds
  const flange = lathe(
    [
      [HOLE_R - 0.1, -PACK_H / 2 - 0.02],
      [0.86, -PACK_H / 2 - 0.02],
      [0.86, -PACK_H / 2 - 0.02],
      [0.86, PACK_H / 2 + 0.02],
      [0.86, PACK_H / 2 + 0.02],
      [HOLE_R - 0.1, PACK_H / 2 + 0.02],
    ],
    { segments: 40 },
  );
  flange.rotateX(Math.PI / 2);
  const out = merge([g, flange]);
  g.dispose();
  flange.dispose();
  return out;
}

/** Tape pack: brown ring around a hub, planar UVs for the wound-ring texture. */
function packGeometry(cx: number, cy: number, r: number): THREE.BufferGeometry {
  const a = 0.86;
  const h = PACK_H / 2;
  const g = lathe(
    [
      [a, -h],
      [r, -h],
      [r, -h],
      [r, h],
      [r, h],
      [a, h],
      [a, h],
      [a, -h],
    ],
    { segments: 72, uv: (x, _y, z) => [0.5 + (x / r) * 0.5, 0.5 + (z / r) * 0.5] },
  );
  g.rotateX(Math.PI / 2);
  g.translate(cx, cy, 0);
  return g;
}

/** The tape path: left pack -> left roller -> along the bottom -> right roller -> right pack. */
function tapeGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const push = (x: number, y: number) => pts.push(new THREE.Vector3(x, y, 0));
  const la = 214 * DEG;
  push(-HUB_X + Math.cos(la) * PACK_L, HUB_Y + Math.sin(la) * PACK_L);
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (i / 8) * (Math.PI / 2);
    push(-ROLLER_X + Math.cos(a) * ROLLER_R, ROLLER_Y + Math.sin(a) * ROLLER_R);
  }
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    push(ROLLER_X + Math.cos(a) * ROLLER_R, ROLLER_Y + Math.sin(a) * ROLLER_R);
  }
  const ra = -28 * DEG;
  push(HUB_X + Math.cos(ra) * PACK_R, HUB_Y + Math.sin(ra) * PACK_R);
  const half = new THREE.Vector3(0, 0, PACK_H / 2 - 0.03);
  return ribbon(pts, () => half);
}

// ------------------------------------------------------------------ label artwork

const PX = 1024 / LW; // design px per cm on the label

function lx(x: number): number {
  return (x - LABEL.x0) * PX;
}
function ly(y: number): number {
  return (LABEL.y1 - y) * PX;
}

function heart(c: C2D, x: number, y: number, s: number, color: string): void {
  c.save();
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x, y + s * 0.35);
  c.bezierCurveTo(x - s * 0.7, y - s * 0.1, x - s * 0.35, y - s * 0.62, x, y - s * 0.22);
  c.bezierCurveTo(x + s * 0.35, y - s * 0.62, x + s * 0.7, y - s * 0.1, x, y + s * 0.35);
  c.fill();
  c.restore();
}

interface LabelSpec {
  side: 'A' | 'B';
  title: string;
  line2: string;
  stripes: string[];
  accent: string;
  seed: number;
}

/** One label, drawn into the cell at (0, oy) of the label atlas (1024 x 512 design units). */
function paintLabel(s: Surface, oy: number, spec: LabelSpec): void {
  const c = s.c;
  c.save();
  c.translate(0, oy);
  c.beginPath();
  rrect(c, 0, 0, 1024, 512, 26);
  c.clip();
  // paper
  c.fillStyle = CREAM;
  c.fillRect(0, 0, 1024, 512);

  const wx0 = lx(WIN.cx - WIN.w / 2);
  const wy0 = ly(WIN.cy + WIN.h / 2);
  const ww = WIN.w * PX;
  const wh = WIN.h * PX;

  // colour bands left / right of the window and along the bottom
  const bandTop = wy0 + wh * 0.12;
  const bandBot = 512;
  const sh = (bandBot - bandTop) / spec.stripes.length;
  spec.stripes.forEach((col, i) => {
    c.fillStyle = col;
    c.fillRect(0, bandTop + i * sh, 1024, sh + 0.5);
  });
  // diagonal sweep breaking the stripes (80s label energy)
  c.save();
  c.globalAlpha = 0.18;
  c.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    const x = 40 + i * 190;
    c.moveTo(x, bandTop);
    c.lineTo(x + 60, bandTop);
    c.lineTo(x - 80, bandBot);
    c.lineTo(x - 140, bandBot);
    c.closePath();
    c.fill();
  }
  c.restore();

  // cream panel behind the window (the stripes show around it)
  c.fillStyle = CREAM;
  c.beginPath();
  rrect(c, wx0 - 26, wy0 - 18, ww + 52, wh + 36, 40);
  c.fill();
  // printed window frame + counter ticks
  c.strokeStyle = INK;
  c.lineWidth = 7;
  c.beginPath();
  rrect(c, wx0 - 7, wy0 - 7, ww + 14, wh + 14, WIN.r * PX + 7);
  c.stroke();
  c.fillStyle = INK;
  c.font = font(15, FONTS.spaceMono, 700);
  c.textAlign = 'center';
  c.textBaseline = 'bottom';
  for (let i = 0; i <= 12; i++) {
    const x = wx0 + 90 + i * ((ww - 180) / 12);
    const big = i % 4 === 0;
    c.fillRect(x - 1.5, wy0 + wh + 10, 3, big ? 16 : 9);
    if (big) c.fillText(String(i * 5), x, wy0 + wh + 44);
  }

  // ruled writing area at the top
  c.strokeStyle = hexA('#5b8cff', 0.55);
  c.lineWidth = 2.5;
  for (const y of [62, 112, 158]) {
    c.beginPath();
    c.moveTo(150, y);
    c.lineTo(1000, y);
    c.stroke();
  }
  c.strokeStyle = hexA('#ff4f6a', 0.6);
  c.beginPath();
  c.moveTo(150, 10);
  c.lineTo(150, 168);
  c.stroke();

  // side letter
  c.fillStyle = INK;
  c.beginPath();
  rrect(c, 22, 20, 112, 128, 22);
  c.fill();
  text(c, spec.side, 78, 128, { size: 118, family: FONTS.bagel, align: 'center', color: spec.accent });

  // handwriting (marker)
  const r = rng(spec.seed);
  text(c, spec.title, 176, 98, { size: 70, family: FONTS.marker, color: '#1b1b3a' }, -2 * DEG);
  const w2 = text(c, spec.line2, 186, 151, { size: 40, family: FONTS.marker, color: '#d0145f' }, -1 * DEG);
  heart(c, 186 + w2 + 34, 136, 34, '#ff3b6b');
  // scribbled date / doodles
  c.save();
  c.strokeStyle = '#1b1b3a';
  c.lineWidth = 4;
  c.lineCap = 'round';
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const x = 860 + i * 22 + r() * 6;
    c.moveTo(x, 40 + r() * 6);
    c.lineTo(x + 10, 52 + r() * 6);
  }
  c.stroke();
  c.restore();
  text(c, spec.side === 'A' ? 'NR ON' : 'NR OFF', 930, 96, { size: 30, family: FONTS.marker, color: '#1b1b3a', align: 'center' }, 4 * DEG);

  // left of the window: big C-0 badge; right: zero-noise logo
  const midY = wy0 + wh / 2;
  c.fillStyle = INK;
  c.beginPath();
  c.arc(78, midY + 8, 58, 0, Math.PI * 2);
  c.fill();
  text(c, 'C-0', 78, midY + 18, { size: 36, family: FONTS.rubikMono, align: 'center', color: LIME, maxWidth: 96 });
  smallPrint(c, ['MIN'], 78, midY + 26, 15, '#ffffff', { align: 'center', weight: 700 });
  // zero-noise logo: two zeros in a rounded box
  const nx = 946;
  c.fillStyle = INK;
  c.beginPath();
  rrect(c, nx - 62, midY - 50, 124, 112, 16);
  c.fill();
  c.strokeStyle = CREAM;
  c.lineWidth = 9;
  for (const ox of [-24, 24]) {
    c.beginPath();
    c.ellipse(nx + ox, midY - 8, 17, 25, 0, 0, Math.PI * 2);
    c.stroke();
  }
  smallPrint(c, ['ZERO', 'NOISE'], nx, midY + 22, 15, CREAM, { align: 'center', weight: 700, lineHeight: 16 });

  // brand line in the bottom band
  const by = 486;
  text(c, 'ZEROS', 46, by, { size: 64, family: FONTS.bagel, color: '#ffffff', outlines: [{ color: INK, width: 10 }], extrude: { color: INK, dx: 4, dy: 5 } });
  smallPrint(c, ['TYPE II · HIGH BIAS · 70µs EQ', spec.side === 'A' ? 'ONCE UPON A TIME RECORDS' : 'SHIPPED FROM THE TIMELINE'], 300, 436, 19, INK, { weight: 700, lineHeight: 23 });
  text(c, spec.side === 'A' ? 'HI-FI IDEAS' : 'LO-FI SHIPS', 1000, by - 2, { size: 34, family: FONTS.archivoBlack, align: 'right', color: '#ffffff', outlines: [{ color: INK, width: 7 }] });

  grain(c, 0, 0, 1024, 512, 5000, 0.05, spec.seed + 3);
  c.restore();

  // cut the window out (alpha 0) and mark nothing else
  c.save();
  c.translate(0, oy);
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  rrect(c, wx0, wy0, ww, wh, WIN.r * PX);
  c.fill();
  c.restore();
}

function paintPack(s: Surface): void {
  const c = s.c;
  const N = s.w;
  c.fillStyle = '#3a2116';
  c.fillRect(0, 0, N, N);
  const r = rng(91);
  const cx = N / 2;
  for (let i = 0; i < 70; i++) {
    const rad = (N / 2) * (0.42 + (i / 70) * 0.58);
    c.strokeStyle = r() > 0.5 ? 'rgba(120,70,40,0.55)' : 'rgba(20,10,6,0.5)';
    c.lineWidth = 1 + r() * 2.5;
    c.beginPath();
    c.arc(cx, cx, rad, 0, Math.PI * 2);
    c.stroke();
  }
  // glossy outer edge band
  c.strokeStyle = 'rgba(160,100,60,0.6)';
  c.lineWidth = 5;
  c.beginPath();
  c.arc(cx, cx, N / 2 - 4, 0, Math.PI * 2);
  c.stroke();
}

// ------------------------------------------------------------------ stickers

function paintStickers(sheet: StickerSheet) {
  const star = sheet.alloc(360, 360);
  inCell(sheet, star, (c) => {
    const path = starPath(0, 0, 165, 112, 8, -Math.PI / 2, 0.45);
    sticker(c, 0, 0, 0, path, { border: 12, borderColor: '#f7f7f7', shadow: 0.7 }, (q) => {
      holoFill(q, path, -170, -170, 340, 340, 17);
      text(q, 'HITS', 0, -6, { size: 74, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: '#2a1a5e', width: 12 }] });
      text(q, 'ONLY', 0, 62, { size: 54, family: FONTS.archivoBlack, align: 'center', color: '#2a1a5e' });
    });
  });
  const adv = sheet.alloc(380, 230);
  inCell(sheet, adv, (c) => {
    sticker(c, 0, 0, 0, rrPath(-176, -100, 352, 200, 10), { border: 10, fill: '#ffffff', shadow: 0.7 }, (q) => {
      q.fillStyle = INK;
      q.fillRect(-166, -90, 332, 180);
      q.fillStyle = '#ffffff';
      q.fillRect(-156, -80, 312, 44);
      text(q, 'FOUNDER ADVISORY', 0, -47, { size: 31, family: FONTS.archivoBlack, align: 'center', color: INK, maxWidth: 296 });
      text(q, 'EXPLICIT', 0, 22, { size: 64, family: FONTS.archivoBlack, align: 'center', color: '#ffffff', maxWidth: 300 });
      text(q, 'IDEAS', 0, 76, { size: 50, family: FONTS.archivoBlack, align: 'center', color: LIME, maxWidth: 300 });
    });
  });
  const tape = sheet.alloc(640, 104);
  inCell(sheet, tape, (c) => {
    c.save();
    c.beginPath();
    c.rect(-320, -52, 640, 104);
    c.clip();
    c.fillStyle = LIME;
    c.fillRect(-320, -52, 640, 104);
    c.fillStyle = INK;
    c.fillRect(-320, -52, 640, 9);
    c.fillRect(-320, 43, 640, 9);
    text(c, 'SHIP IT · SHIP IT · SHIP IT', 0, 19, { size: 46, family: FONTS.archivoBlack, align: 'center', color: INK, maxWidth: 600 });
    c.restore();
  });
  const dot = sheet.alloc(210, 210);
  inCell(sheet, dot, (c) => {
    sticker(c, 0, 0, 0, (q) => q.arc(0, 0, 92, 0, Math.PI * 2), { border: 10, fill: PINK, shadow: 0.7 }, (q) => {
      fillPath(q, (p) => p.arc(0, 0, 80, 0, Math.PI * 2), INK);
      q.strokeStyle = PINK;
      q.lineWidth = 16;
      q.beginPath();
      q.ellipse(0, -6, 30, 42, 0, 0, Math.PI * 2);
      q.stroke();
      q.lineWidth = 8;
      q.beginPath();
      q.moveTo(-22, 28);
      q.lineTo(22, -40);
      q.stroke();
      smallPrint(q, ['REC'], 0, 44, 22, '#ffffff', { align: 'center', weight: 700 });
    });
  });
  return { star, adv, tape, dot };
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- shell: two halves (seam groove between them) + raised head-area plates
  const shellParts = [shellBody(), trapezoid(1), trapezoid(-1)];
  const shellGeo = merge(shellParts);
  shellParts.forEach((g) => g.dispose());
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: '#ffb0dc',
    metalness: 0,
    roughness: 0.12,
    transmission: 0.9,
    thickness: 1.2,
    ior: 1.5,
    attenuationColor: new THREE.Color('#ff4fb8'),
    attenuationDistance: 2.2,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    emissive: new THREE.Color(PINK),
    emissiveIntensity: 0.1,
  });
  inner.add(new THREE.Mesh(shellGeo, shellMat));

  // ---------- tape packs (wound brown rings)
  const packSurf = new Surface(256, 256, bctx, { density: 1 });
  paintPack(packSurf);
  const packs = merge([packGeometry(-HUB_X, HUB_Y, PACK_L), packGeometry(HUB_X, HUB_Y, PACK_R)]);
  inner.add(new THREE.Mesh(packs, new THREE.MeshPhysicalMaterial({ map: packSurf.colorTexture(), roughness: 0.3, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.2 })));

  // ---------- hubs (instanced, they turn)
  const hubGeo = hubGeometry();
  const hubs = new THREE.InstancedMesh(hubGeo, glossyPlastic('#fbfbf8', { roughness: 0.3, clearcoat: 0.6 }), 2);
  const hubM = new THREE.Matrix4();
  const hubQ = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const one = new THREE.Vector3(1, 1, 1);
  const hubPos = [new THREE.Vector3(-HUB_X, HUB_Y, 0), new THREE.Vector3(HUB_X, HUB_Y, 0)];
  const setHubs = (aL: number, aR: number) => {
    hubQ.setFromAxisAngle(zAxis, aL);
    hubs.setMatrixAt(0, hubM.compose(hubPos[0], hubQ, one));
    hubQ.setFromAxisAngle(zAxis, aR);
    hubs.setMatrixAt(1, hubM.compose(hubPos[1], hubQ, one));
    hubs.instanceMatrix.needsUpdate = true;
  };
  setHubs(0.2, 0.9);
  hubs.computeBoundingSphere();
  inner.add(hubs);

  // ---------- tape path, guide rollers, pressure pad + spring, inner pins (vertex coloured)
  const bits: THREE.BufferGeometry[] = [];
  bits.push(tint(tapeGeometry(), '#4a2a1a'));
  bits.push(tint(seamGeometry(), '#b8337f'));
  for (const sx of [-1, 1]) {
    const roller = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, PACK_H + 0.12, 24).rotateX(Math.PI / 2);
    bits.push(tint(place(roller, [sx * ROLLER_X, ROLLER_Y, 0]), '#f4f2ec'));
    const pin = new THREE.CylinderGeometry(0.09, 0.09, D - 0.3, 12).rotateX(Math.PI / 2);
    bits.push(tint(place(pin, [sx * 4.45, -1.2, 0]), '#ffd0ec'));
  }
  bits.push(tint(place(new THREE.BoxGeometry(0.95, 0.2, PACK_H), [0, TAPE_Y + 0.17, 0]), '#d9c7a3'));
  bits.push(tint(place(new THREE.BoxGeometry(1.7, 0.05, PACK_H * 0.8), [0, TAPE_Y + 0.36, 0], [0, 0, 0]), '#c79a3a'));
  bits.push(tint(place(new THREE.BoxGeometry(2.6, 0.1, 0.06), [0, TAPE_Y + 0.6, 0]), '#b8b8be'));
  const bitsGeo = merge(bits);
  bits.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(bitsGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1, clearcoat: 0.4, side: THREE.DoubleSide })));

  // ---------- screws: 4 corners + head-area centre, both faces
  const screws: THREE.BufferGeometry[] = [];
  const corner: [number, number][] = [
    [-4.62, 2.8],
    [4.62, 2.8],
    [-4.62, -2.8],
    [4.62, -2.8],
  ];
  const rot = rng(5);
  for (const sign of [1, -1]) {
    for (const [x, y] of corner) {
      const g = screwHead(0.2);
      g.rotateZ(rot() * Math.PI);
      if (sign < 0) g.rotateY(Math.PI);
      screws.push(place(g, [x, y, sign * (HALF - 0.01)]));
    }
    const g = screwHead(0.2);
    g.rotateZ(rot() * Math.PI);
    if (sign < 0) g.rotateY(Math.PI);
    screws.push(place(g, [0, -2.42, sign * (HALF + TRAP.lift - 0.01)]));
  }
  const screwGeo = merge(screws);
  screws.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(screwGeo, chrome({ vertexColors: true, roughness: 0.18 })));

  // ---------- labels (A front, B back) in one atlas with the windows cut out
  const lab = new Surface(1024, 1024, bctx, { density: 1.6, transparent: true });
  paintLabel(lab, 0, { side: 'A', title: 'mixtape vol. 0', line2: 'side A: design', stripes: ['#ff4fb8', '#ff8a1f', '#ffd21f', LIME], accent: LIME, seed: 11 });
  paintLabel(lab, 512, { side: 'B', title: 'mixtape vol. 0', line2: 'side B: ship it', stripes: [LIME, '#38d6ff', '#7b5cff', '#ff4fb8'], accent: '#ff4fb8', seed: 23 });
  const labTex = lab.colorTexture();
  const lcx = (LABEL.x0 + LABEL.x1) / 2;
  const lcy = (LABEL.y0 + LABEL.y1) / 2;
  const front = place(decalPlane(LW, LH, [0, 0.5, 1, 1]), [lcx, lcy, HALF + 0.006]);
  const back = decalPlane(LW, LH, [0, 0, 1, 0.5]);
  back.rotateY(Math.PI);
  place(back, [-lcx, lcy, -HALF - 0.006]);
  const labelGeo = merge([front, back]);
  front.dispose();
  back.dispose();
  const labelMat = paperBackfaces(
    new THREE.MeshPhysicalMaterial({ map: labTex, alphaTest: 0.5, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.25, emissive: '#ffffff', emissiveMap: labTex, emissiveIntensity: 0.22 }),
    '#efe6d2',
  );
  inner.add(new THREE.Mesh(labelGeo, labelMat));

  // ---------- stickers
  const sheet = new StickerSheet(1024, 1024, bctx, 14);
  const cells = paintStickers(sheet);
  const sheetTex = sheet.surf.colorTexture();
  const frontFace = surfaces.plane(new THREE.Vector3(0, 0, HALF + 0.008), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const backFace = surfaces.plane(new THREE.Vector3(0, 0, -HALF - 0.008), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
  const starGeo = stickerPatch(frontFace, -4.05, -2.2, 1.85, 1.85, 12 * DEG, cells.star.uv, { nx: 12, ny: 12, offset: 0.004, lift: peelLift(0.4, 0, 0, 0.42) });
  inner.add(new THREE.Mesh(starGeo, holoFoil(sheetTex, { side: THREE.DoubleSide, forceSinglePass: true, metalness: 0.3, roughness: 0.25 })));
  const paper: THREE.BufferGeometry[] = [];
  paper.push(stickerPatch(frontFace, 3.82, -1.1, 1.95, 1.18, -9 * DEG, cells.adv.uv, { nx: 4, ny: 4, offset: 0.012 }));
  paper.push(stickerPatch(backFace, 3.75, -2.2, 1.3, 1.3, 14 * DEG, cells.dot.uv, { nx: 4, ny: 4, offset: 0.004 }));
  // lime SHIP IT tape wrapped over the top edge (front face -> bevel -> top -> bevel -> back face)
  {
    const yTop = H / 2;
    const zc = HALF - BEV;
    const yc = yTop - BEV;
    const off = 0.012;
    const down = 0.75;
    const arc = (Math.PI / 2) * BEV;
    const flat = 2 * zc;
    const L = down + arc + flat + arc + down;
    const x0 = 2.75;
    const tw = 0.52;
    paper.push(
      parametric(
        48,
        3,
        (u, v, out) => {
          let s = u * L;
          const x = x0 + (0.5 - v) * tw + (u - 0.5) * 0.12;
          if (s < down) {
            out.set(x, yc - (down - s), HALF + off);
            return;
          }
          s -= down;
          if (s < arc) {
            const th = s / BEV;
            out.set(x, yc + Math.sin(th) * (BEV + off), zc + Math.cos(th) * (BEV + off));
            return;
          }
          s -= arc;
          if (s < flat) {
            out.set(x, yTop + off, zc - s);
            return;
          }
          s -= flat;
          if (s < arc) {
            const th = s / BEV;
            out.set(x, yc + Math.cos(th) * (BEV + off), -zc - Math.sin(th) * (BEV + off));
            return;
          }
          s -= arc;
          out.set(x, yc - s, -HALF - off);
        },
        { uv: (u, v) => [cells.tape.uv[0] + u * (cells.tape.uv[2] - cells.tape.uv[0]), cells.tape.uv[1] + v * (cells.tape.uv[3] - cells.tape.uv[1])] },
      ),
    );
  }
  const paperGeo = merge(paper);
  paper.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(paperGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.42, clearcoat: 0.55 }), '#f1ece0')));

  // ---------- idle: the reels turn (constant tape speed, so the small pack spins faster)
  const update = (t: number) => {
    const v = 0.9;
    setHubs(0.2 - (t * v) / PACK_L, 0.9 - (t * v) / PACK_R);
  };
  update(0);

  return finish(inner, trash, update, 'mixtape-vol-0');
}

export const cassette: LibraryDef = {
  kind: 'cassette',
  name: 'Mixtape Vol. 0',
  tagline: 'side A: design, side B: ship',
  category: 'tech',
  defaultRotation: [0.42, -0.5, 0.12],
  build,
};
export default cassette;

