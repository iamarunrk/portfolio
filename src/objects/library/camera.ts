import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { atlasRoundedBox, boxFaceDims, lathe, merge, parametric, place, stickerPatch, surfaces, tint, type BoxFaceInfo, type FaceName, type FaceRect, type P2 } from '../geometry';
import { stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, rng, text, arcText, sticker, rrPath, circlePath, fillPath, smallPrint, smiley, hazard, barcode, hexA, type C2D } from '../paint';
import { inCell, translucentPlastic, RAINBOW } from './_computers';

/*
 * INSTANT ZERO: a clear-edition instant camera. A frosted, scuffed transparent wedge
 * body (film pack, gears, mirror and flash capacitor showing through), a dark grey film
 * door with the exit slot, a big ribbed lens, flash window, viewfinder, yellow shutter,
 * a rainbow stripe, and a fresh print sliding out. Centimetres, normalised afterwards.
 */

const W = 13.8; // body width
const BEV = 0.5; // body bevel
const FRONT_Z = 1.7; // body front face (bottom of the lens area)
const PLATE = { w: 14.2, h: 4.6, d: 4.2, r: 0.7, cy: 3.5, cz: 1.6 };
const PLATE_FRONT = PLATE.cz + PLATE.d / 2;
const SLOT_Y = 2.85;
const LENS = { x: 0.45, y: 8.65, r: 3.0 };
const YELLOW = '#ffd21f';
const PINK = '#ff4fb8';

/** z of the (slightly leaning) body front above the film door. */
function frontZ(y: number): number {
  return FRONT_Z - 0.6 * Math.max(0, (y - 5.5) / 6.3);
}

/** Rounded polygon Shape: each corner replaced by a quadratic fillet. */
function roundedPoly(pts: [number, number][], radii: number[]): THREE.Shape {
  const n = pts.length;
  const s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(radii[i], da / 2);
    const rb = Math.min(radii[i], db / 2);
    const s0: [number, number] = [p[0] + ((a[0] - p[0]) / da) * ra, p[1] + ((a[1] - p[1]) / da) * ra];
    const e0: [number, number] = [p[0] + ((b[0] - p[0]) / db) * rb, p[1] + ((b[1] - p[1]) / db) * rb];
    if (i === 0) s.moveTo(s0[0], s0[1]);
    else s.lineTo(s0[0], s0[1]);
    s.quadraticCurveTo(p[0], p[1], e0[0], e0[1]);
  }
  s.closePath();
  return s;
}

/** Side profile (z, y) extruded across X, centred, `width` wide including the bevel. */
function sideExtrude(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const depth = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 14 });
  g.rotateY(-Math.PI / 2); // shape x -> +Z, extrusion -> -X
  g.translate(depth / 2, 0, 0);
  return g;
}

/** Put a geometry built facing +Z onto the body front at (x, y), tilted with the face. */
function onFront(g: THREE.BufferGeometry, x: number, y: number, lift = 0): THREE.BufferGeometry {
  const tilt = Math.atan2(0.6, 6.3);
  g.rotateX(-tilt);
  g.translate(x, y, frontZ(y) + lift);
  return g;
}

// ------------------------------------------------------------------ textures

function paintPlate(s: Surface, faces: Record<FaceName, BoxFaceInfo>): void {
  const c = s.c;
  c.fillStyle = '#2e3136';
  c.fillRect(0, 0, s.w, s.h);
  // front: recessed lighter panel with the wordmark, rainbow stripe at the top edge, pink corner
  {
    const f = faces.pz;
    const k = f.k;
    const P = (x: number, y: number) => f.toPx(x, y);
    const [x0, y0] = P(-f.lu / 2, f.lv / 2);
    const g = c.createLinearGradient(0, y0, 0, y0 + f.rect.h);
    g.addColorStop(0, '#3a3e44');
    g.addColorStop(1, '#25282c');
    c.fillStyle = g;
    c.fillRect(x0, y0, f.rect.w, f.rect.h);
    const [px0, py0] = P(-6.3, 1.75);
    fillPath(c, rrPath(px0, py0, 12.6 * k, 1.45 * k, 0.12 * k), '#4a4f57');
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(px0, py0, 12.6 * k, 0.07 * k);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(px0, py0 + 1.38 * k, 12.6 * k, 0.07 * k);
    const [tx, ty] = P(5.95, 0.72);
    const zw = text(c, 'ZERO', tx, ty, { size: 1.0 * k, family: FONTS.archivoBlack, align: 'right', color: YELLOW });
    text(c, 'INSTANT', tx - zw - 0.18 * k, ty - 0.04 * k, { size: 0.62 * k, family: FONTS.ui, weight: 600, align: 'right', color: '#e9ecef', tracking: 0.06 * k });
    // rainbow at the top edge (continues over the top face)
    const [rx, ry] = P(-0.55, f.lv / 2);
    RAINBOW.forEach((col, i) => {
      c.fillStyle = col;
      c.fillRect(rx + i * 0.3 * k, ry, 0.3 * k, 0.55 * k);
    });
    const [mx, my] = P(-f.lu / 2, f.lv / 2);
    c.fillStyle = PINK;
    c.fillRect(mx, my, 1.4 * k, 0.5 * k);
    // slot shadow + small print
    const [sx, sy] = P(-5.8, SLOT_Y - PLATE.cy + 0.36);
    fillPath(c, rrPath(sx, sy, 11.6 * k, 0.72 * k, 0.3 * k), '#141518');
    smallPrint(c, ['PULL TAB · PRINT EXITS HERE'], P(-5.6, -1.55)[0], P(-5.6, -1.55)[1], 0.26 * k, hexA('#ffffff', 0.35), { weight: 700 });
  }
  // top: rainbow stripes running back + the pink corner
  {
    const f = faces.py;
    const k = f.k;
    const [rx, ry] = f.toPx(-0.55, -f.lv / 2);
    RAINBOW.forEach((col, i) => {
      c.fillStyle = col;
      c.fillRect(rx + i * 0.3 * k, ry - f.rect.h, 0.3 * k, f.rect.h);
    });
    const [mx, my] = f.toPx(-f.lu / 2, -f.lv / 2);
    c.fillStyle = PINK;
    c.fillRect(mx, my - f.rect.h, 1.4 * k, f.rect.h);
  }
}

function paintPrint(s: Surface): void {
  // 8.8 x 6.2 cm visible part of the print; canvas top = at the slot, bottom = the tip (thin border)
  const c = s.c;
  const k = s.w / 8.8;
  c.fillStyle = '#f8f7f2';
  c.fillRect(0, 0, s.w, s.h);
  const ix = 0.45 * k;
  const iw = 7.9 * k;
  const ih = 5.6 * k;
  c.save();
  c.beginPath();
  c.rect(ix, 0, iw, ih);
  c.clip();
  const g = c.createLinearGradient(ix, 0, ix + iw, ih);
  g.addColorStop(0, '#f5b3cf');
  g.addColorStop(0.45, '#fde2b4');
  g.addColorStop(1, '#cdbaf6');
  c.fillStyle = g;
  c.fillRect(ix, 0, iw, ih);
  const r = rng(5);
  for (let i = 0; i < 4; i++) {
    const bx = ix + r() * iw;
    const by = r() * ih;
    const rg = c.createRadialGradient(bx, by, 0, bx, by, 2.5 * k);
    rg.addColorStop(0, hexA(['#ffd0e6', '#fff1c9', '#dccdff', '#ffe0ef'][i], 0.8));
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = rg;
    c.fillRect(ix, 0, iw, ih);
  }
  text(c, 'Once upon', ix + iw / 2, 2.1 * k, { size: 1.55 * k, family: FONTS.serif, italic: true, align: 'center', color: '#121212', maxWidth: iw * 0.9 });
  text(c, 'a time', ix + iw / 2 - 0.9 * k, 3.55 * k, { size: 1.55 * k, family: FONTS.serif, italic: true, align: 'center', color: '#121212' });
  fillPath(c, rrPath(ix + iw / 2 + 0.75 * k, 2.75 * k, 2.6 * k, 1.0 * k, 0.2 * k), '#d7ff3a');
  text(c, 'click.', ix + iw / 2 + 2.05 * k, 3.5 * k, { size: 0.78 * k, family: FONTS.archivoBlack, align: 'center', color: '#111' });
  // a little light leak + grain
  const leak = c.createLinearGradient(ix, 0, ix + 2.5 * k, 0);
  leak.addColorStop(0, 'rgba(255,120,60,0.35)');
  leak.addColorStop(1, 'rgba(255,120,60,0)');
  c.fillStyle = leak;
  c.fillRect(ix, 0, 2.5 * k, ih);
  c.restore();
  smallPrint(c, ['no. 0001'], ix + iw - 0.1 * k, ih + 0.12 * k, 0.32 * k, '#9a968b', { family: FONTS.marker, align: 'right' });
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- clear frosted wedge body
  const prof = roundedPoly(
    [
      [FRONT_Z - BEV, 0.5],
      [-10.5, 0.5],
      [-10.5, 3.7],
      [FRONT_Z - BEV - 0.6, 11.8 - BEV],
      [FRONT_Z - BEV, 5.5],
    ],
    [0.8, 1.0, 1.6, 1.3, 0.3],
  );
  const bodyGeo = sideExtrude(prof, W, BEV);
  const clearGeo = bodyGeo;
  // outward normal and up-direction of the sloped top-back face
  const slopeDZ = FRONT_Z - BEV - 0.6 + 10.5;
  const slopeDY = 11.8 - BEV - 3.7;
  const slopeDir = new THREE.Vector3(0, slopeDY, slopeDZ).normalize();
  const slopeN = new THREE.Vector3(0, slopeDZ, -slopeDY).normalize();
  const slopeAt = (x: number, b: number, lift: number) => new THREE.Vector3(x, 3.7, -10.5).addScaledVector(slopeN, BEV + lift).addScaledVector(slopeDir, b);
  const clearMat = translucentPlastic('#f3f6f8', {
    transmission: 0.94,
    roughness: 0.15,
    specularIntensity: 0.55,
    thickness: 0.8,
    ior: 1.5,
    attenuationColor: new THREE.Color('#dfe6ea'),
    attenuationDistance: 40,
    glow: '#ffffff',
    glowIntensity: 0.05,
    clearcoat: 0.3,
    clearcoatRoughness: 0.1,
  });
  inner.add(new THREE.Mesh(clearGeo, clearMat));

  // ---------- dark grey film door (atlas-painted rounded box)
  const plate = new RoundedBoxGeometry(PLATE.w, PLATE.h, PLATE.d, 4, PLATE.r);
  const dims = boxFaceDims(PLATE.w, PLATE.h, PLATE.d, PLATE.r);
  const k = 60;
  const rects: Record<FaceName, FaceRect> = {
    pz: { x: 0, y: 0, w: Math.round(dims.pz[0] * k), h: Math.round(dims.pz[1] * k) },
    py: { x: 0, y: 270, w: Math.round(dims.py[0] * k), h: Math.round(dims.py[1] * k) },
    nz: { x: 0, y: 515, w: Math.round(dims.nz[0] * k), h: Math.round(dims.nz[1] * k) },
    ny: { x: 0, y: 785, w: Math.round(dims.ny[0] * k), h: Math.round(dims.ny[1] * k) },
    px: { x: 850, y: 0, w: Math.round(dims.px[0] * k), h: Math.round(dims.px[1] * k) },
    nx: { x: 850, y: 270, w: Math.round(dims.nx[0] * k), h: Math.round(dims.nx[1] * k) },
  };
  const faces = atlasRoundedBox(plate, dims, rects, 1100, 1024);
  plate.translate(0, PLATE.cy, PLATE.cz);
  const plateSurf = new Surface(1100, 1024, bctx, { density: 1 });
  paintPlate(plateSurf, faces);
  inner.add(new THREE.Mesh(plate, new THREE.MeshPhysicalMaterial({ map: plateSurf.colorTexture(), roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.16 })));

  // ---------- dark plastic parts: lens barrel, viewfinder, flash frame, badge plate, slot, shield, film pack, lens tube
  const dark: THREE.BufferGeometry[] = [];
  const ribs: P2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = 2.5 - t * 1.05;
    const y = 2.38 - t * 1.62;
    ribs.push([r, y]);
    if (i < 14) ribs.push([r - 0.04, y - 0.06]);
  }
  const lensProfile: P2[] = [[2.85, 0], [3.0, 0.22], [3.0, 2.2], [2.92, 2.45], [2.68, 2.52], ...ribs, [1.42, 0.72], [1.36, 0.7]];
  const barrel = lathe(lensProfile, { segments: 72 });
  barrel.rotateX(Math.PI / 2);
  dark.push(onFront(barrel, LENS.x, LENS.y, -0.25));
  // lens tube inside the body
  dark.push(onFront(new THREE.CylinderGeometry(2.1, 2.1, 3.4, 32, 1, true).rotateX(Math.PI / 2).translate(0, 0, -1.7), LENS.x, LENS.y, 0));
  // viewfinder
  const vf = lathe(
    [
      [0.62, 0],
      [0.82, 0.05],
      [0.85, 0.75],
      [0.75, 0.86],
      [0.5, 0.82],
      [0.45, 0.3],
    ],
    { segments: 40 },
  );
  vf.rotateX(Math.PI / 2);
  dark.push(onFront(vf, 5.25, 6.95, -0.05));
  // flash frame + badge plate
  dark.push(onFront(new RoundedBoxGeometry(3.2, 2.75, 0.5, 3, 0.18), 5.2, 10.05, 0.05));
  dark.push(onFront(new RoundedBoxGeometry(3.7, 1.55, 0.36, 3, 0.3), -4.6, 10.35, 0.08));
  // exit slot + film shield lip
  dark.push(place(new RoundedBoxGeometry(11.6, 0.5, 0.8, 2, 0.2), [0, SLOT_Y, PLATE_FRONT - 0.32]));
  {
    const lip = new RoundedBoxGeometry(11.2, 0.1, 1.3, 2, 0.04);
    lip.translate(0, 0, 0.62);
    lip.rotateX(16 * DEG);
    lip.translate(0, SLOT_Y - 0.36, PLATE_FRONT - 0.1);
    dark.push(lip);
  }
  // viewfinder eyepiece on the back slope
  {
    const eye = new RoundedBoxGeometry(3.2, 2.1, 0.9, 3, 0.35);
    eye.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), slopeN));
    const at = slopeAt(-3.4, 3.6, 0.2);
    eye.translate(at.x, at.y, at.z);
    dark.push(eye);
  }
  // film pack inside
  dark.push(place(new RoundedBoxGeometry(9.4, 1.8, 9.4, 2, 0.25), [0, 2.1, -4.7]));
  // chips on the board
  const rnd = rng(17);
  for (let i = 0; i < 4; i++) dark.push(place(new THREE.BoxGeometry(1 + rnd() * 1.2, 0.8 + rnd() * 0.8, 0.3), [-4 + i * 2.2, 7 + rnd() * 2, -1.05]));
  const darkGeo = merge(dark);
  dark.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(darkGeo, new THREE.MeshPhysicalMaterial({ color: '#2c2f34', roughness: 0.4, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.22 })));

  // ---------- lens glass: black, multi-coated (iridescent)
  {
    const R = 2.4;
    const half = Math.asin(1.42 / R);
    const glass = new THREE.SphereGeometry(R, 40, 10, 0, Math.PI * 2, 0, half);
    glass.translate(0, 0.72 - R * Math.cos(half) + 0.04, 0);
    glass.rotateX(Math.PI / 2);
    onFront(glass, LENS.x, LENS.y, -0.25);
    inner.add(
      new THREE.Mesh(
        glass,
        new THREE.MeshPhysicalMaterial({
          color: '#07080b',
          roughness: 0.04,
          metalness: 0.2,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          iridescence: 0.9,
          iridescenceIOR: 1.7,
          iridescenceThicknessMinimum: 260,
          iridescenceThicknessMaximum: 620,
        }),
      ),
    );
  }

  // ---------- metal: lens ring, rollers, mirror, motor, capacitor caps
  const metal: THREE.BufferGeometry[] = [];
  const ring = new THREE.TorusGeometry(1.42, 0.07, 8, 56);
  metal.push(tint(onFront(ring.translate(0, 0, 0.72), LENS.x, LENS.y, -0.25), '#e9edf1'));
  for (const dy of [0.24, -0.24]) metal.push(tint(place(new THREE.CylinderGeometry(0.2, 0.2, 10.8, 16), [0, SLOT_Y + dy, PLATE.cz - 0.6], [0, 0, Math.PI / 2]), '#c9ced4'));
  {
    const mirror = new THREE.PlaneGeometry(5.5, 5.2);
    mirror.rotateX(-Math.PI / 4);
    mirror.translate(LENS.x, LENS.y - 0.4, -2.6);
    metal.push(tint(mirror, '#dfe6ec'));
  }
  metal.push(tint(place(new THREE.CylinderGeometry(0.75, 0.75, 2.2, 24), [-3.6, 4.9, -2.6], [0, 0, Math.PI / 2]), '#c3c9cf'));
  for (const ex of [2.65, 5.75]) metal.push(tint(place(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 24), [ex, 10.1, -2.4], [0, 0, Math.PI / 2]), '#d7dce1'));
  const metalGeo = merge(metal);
  metal.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(metalGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 1, roughness: 0.22 })));

  // ---------- coloured plastics: shutter button, gears, film card, flash capacitor, green board
  const plastic: THREE.BufferGeometry[] = [];
  const btn = lathe(
    [
      [0, 0.62],
      [0.7, 0.6],
      [0.92, 0.48],
      [0.95, 0],
    ].reverse() as P2[],
    { segments: 40 },
  );
  btn.rotateX(Math.PI / 2);
  plastic.push(tint(onFront(btn, -4.6, 7.35, -0.1), YELLOW));
  plastic.push(tint(onFront(new THREE.CylinderGeometry(1.15, 1.15, 0.2, 40).rotateX(Math.PI / 2), -4.6, 7.35, 0.0), '#3a3d42'));
  const gear = (r: number, teeth: number) =>
    lathe(
      [
        [0, -0.2],
        [r, -0.2],
        [r, 0.2],
        [0, 0.2],
      ],
      { segments: teeth * 4, radial: (phi, j) => (j === 1 || j === 2 ? (Math.sin(phi * teeth) > 0 ? 0.14 : -0.02) : 0) },
    );
  for (const [r, n, y, z] of [
    [1.1, 14, 7.0, -1.5],
    [0.75, 10, 8.75, -2.5],
    [0.6, 8, 5.55, -2.75],
  ] as const) {
    plastic.push(tint(place(gear(r, n), [-5.6, y, z], [0, 0, Math.PI / 2]), '#f2f2ee'));
  }
  plastic.push(tint(place(new THREE.BoxGeometry(8.8, 0.08, 8.8), [0, 3.06, -4.7]), '#f7f5ef'));
  plastic.push(tint(place(new THREE.CylinderGeometry(0.62, 0.62, 3.0, 24), [4.2, 10.1, -2.4], [0, 0, Math.PI / 2]), '#1d2a6b'));
  plastic.push(tint(place(new THREE.BoxGeometry(12, 4.8, 0.18), [0, 8.1, -1.3]), '#1f7a4a'));
  const plasticGeo = merge(plastic);
  plastic.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(plasticGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12 })));

  // ---------- the print sliding out of the slot, curling down
  const printSurf = new Surface(704, 496, bctx, { density: 1 });
  paintPrint(printSurf);
  const L = 6.2;
  const th0 = 14 * DEG;
  const kappa = (24 * DEG) / L;
  const printGeo = parametric(
    6,
    18,
    (u, v, out) => {
      const sArc = (1 - v) * L;
      const th = th0 + kappa * sArc;
      const zz = (Math.sin(th) - Math.sin(th0)) / kappa;
      const yy = (Math.cos(th0) - Math.cos(th)) / kappa;
      out.set((u - 0.5) * 8.8, SLOT_Y - yy, PLATE_FRONT - 0.5 + zz + 0.0);
    },
    { uv: (u, v) => [u, v] },
  );
  const printMat = paperBackfaces(new THREE.MeshPhysicalMaterial({ map: printSurf.colorTexture(), roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.08 }), '#efeee8');
  inner.add(new THREE.Mesh(printGeo, printMat));

  // ---------- stickers (+ the badge face and the flash window)
  const sheet = new StickerSheet(1024, 640, bctx, 12);
  const cCheese = sheet.alloc(230, 230);
  inCell(sheet, cCheese, (c) => {
    sticker(c, 0, 0, 0, circlePath(0, 0, 104), { border: 9, fill: YELLOW, shadow: 0.6 }, (q) => {
      smiley(q, 0, 8, 58, YELLOW, '#141414');
      arcText(q, 'SAY CHEESE', 0, 0, 82, -Math.PI / 2, { size: 26, family: FONTS.rubikMono, color: '#141414', tracking: 2 });
    });
  });
  const cDevelop = sheet.alloc(360, 150);
  inCell(sheet, cDevelop, (c) => {
    sticker(c, 0, 0, 0, rrPath(-170, -62, 340, 124, 12), { border: 8, fill: '#ffffff', shadow: 0.55 }, (q) => {
      fillPath(q, rrPath(-170, -62, 92, 124, 0), PINK);
      // hourglass
      q.fillStyle = '#ffffff';
      q.beginPath();
      q.moveTo(-146, -38);
      q.lineTo(-102, -38);
      q.lineTo(-124, 0);
      q.lineTo(-102, 38);
      q.lineTo(-146, 38);
      q.lineTo(-124, 0);
      q.closePath();
      q.fill();
      text(q, 'DEVELOPS IDEAS', 46, -10, { size: 30, family: FONTS.archivoBlack, align: 'center', color: '#141414', maxWidth: 230 });
      text(q, 'IN 90 SECONDS', 46, 26, { size: 26, family: FONTS.archivoBlack, align: 'center', color: PINK, maxWidth: 230 });
      smallPrint(q, ['shake it like a prototype'], 46, 36, 15, '#555', { align: 'center', weight: 700 });
    });
  });
  const cZeros = sheet.alloc(300, 120);
  inCell(sheet, cZeros, (c) => {
    sticker(c, 0, 0, 0, rrPath(-138, -48, 276, 96, 48), { border: 8, fill: '#d7ff3a', shadow: 0.6 }, (q) => {
      text(q, 'ZEROS', 0, 26, { size: 72, family: FONTS.bagel, align: 'center', color: '#0b0b0d' });
    });
  });
  const cWarn = sheet.alloc(360, 150);
  inCell(sheet, cWarn, (c) => {
    sticker(c, 0, 0, 0, rrPath(-168, -62, 336, 124, 8), { border: 0, fill: '#ffd21f', shadow: 0.5 }, (q) => {
      hazard(q, -168, -62, 336, 22, 12);
      hazard(q, -168, 40, 336, 22, 12);
      text(q, 'FILM INSIDE', 0, 4, { size: 40, family: FONTS.archivoBlack, align: 'center', color: '#141414' });
      smallPrint(q, ['keep away from light & deadlines'], 0, 12, 16, '#141414', { align: 'center', weight: 700 });
    });
  });
  const cBadge = sheet.alloc(260, 110);
  inCell(sheet, cBadge, (c) => {
    fillPath(c, rrPath(-124, -50, 248, 100, 26), '#111215');
    c.strokeStyle = '#8a8f96';
    c.lineWidth = 5;
    c.beginPath();
    rrPathInto(c, -112, -38, 224, 76, 18);
    c.stroke();
    text(c, 'ZERO', 0, 26, { size: 70, family: FONTS.rubikMono, align: 'center', color: '#ffffff', tracking: 4 });
  });
  const cFlash = sheet.alloc(220, 190);
  inCell(sheet, cFlash, (c) => {
    const g = c.createLinearGradient(-104, -88, 104, 88);
    g.addColorStop(0, '#f7fbff');
    g.addColorStop(0.5, '#dfe8f2');
    g.addColorStop(1, '#f2f6fb');
    fillPath(c, rrPath(-104, -88, 208, 176, 10), g);
    c.strokeStyle = 'rgba(120,140,170,0.35)';
    c.lineWidth = 3;
    for (let i = 1; i < 12; i++) {
      c.beginPath();
      c.ellipse(0, 0, i * 11, i * 9, 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillRect(-96, -80, 190, 14);
  });
  const cBottom = sheet.alloc(330, 120);
  inCell(sheet, cBottom, (c) => {
    sticker(c, 0, 0, 0, rrPath(-158, -52, 316, 104, 8), { border: 0, fill: '#ffffff', shadow: 0.4 }, (q) => {
      barcode(q, -146, -40, 130, 72, 600, { digits: '0 00000 00600' });
      text(q, 'INSTANT ZERO', 66, -10, { size: 22, family: FONTS.archivoBlack, align: 'center', color: '#111', maxWidth: 150 });
      smallPrint(q, ['MADE IN ONCE', 'UPON A TIME'], 66, 2, 15, '#444', { align: 'center', weight: 700 });
    });
  });
  const sheetTex = sheet.surf.colorTexture();
  const leftSide = surfaces.plane(new THREE.Vector3(-W / 2 - 0.02, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
  const rightSide = surfaces.plane(new THREE.Vector3(W / 2 + 0.02, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
  const tilt = Math.atan2(0.6, 6.3);
  // front face above the film door: origin at y = 5.5, b = distance up the face
  const frontPlane = (lift: number) => surfaces.plane(new THREE.Vector3(0, 5.5, FRONT_Z + lift), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, Math.cos(tilt), -Math.sin(tilt)));
  // slope (top-back) surface: a = -x (reads from behind), b = distance up the slope from the back edge
  const slope = surfaces.plane(slopeAt(0, 0, 0.02), new THREE.Vector3(-1, 0, 0), slopeDir);
  const bottom = surfaces.plane(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
  const stickerGeos = [
    stickerPatch(leftSide, -4.7, 5.35, 4.2, 4.2, 10 * DEG, cCheese.uv, { nx: 4, ny: 4, offset: 0 }),
    stickerPatch(leftSide, -7.7, 2.2, 4.4, 1.55, -6 * DEG, cZeros.uv, {
      nx: 8,
      ny: 4,
      offset: 0,
      lift: (u, v) => 0.7 * Math.pow(THREE.MathUtils.smoothstep(1 - u + (1 - v) * 0.3, 0.8, 1.3), 2),
    }),
    stickerPatch(rightSide, 4.6, 3.4, 6.4, 2.65, -4 * DEG, cDevelop.uv, { nx: 4, ny: 4, offset: 0 }),
    stickerPatch(slope, 1.2, 6.2, 5.0, 2.1, 4 * DEG, cWarn.uv, { nx: 4, ny: 4, offset: 0 }),
    stickerPatch(bottom, 0.5, -4.5, 6.3, 2.0, 3 * DEG, cBottom.uv, { nx: 2, ny: 2, offset: 0 }),
    stickerPatch(frontPlane(0.27), -4.6, 10.35 - 5.5, 3.45, 1.35, 0, cBadge.uv, { nx: 2, ny: 2, offset: 0 }),
    stickerPatch(frontPlane(0.31), 5.2, 10.05 - 5.5, 2.75, 2.3, 0, cFlash.uv, { nx: 2, ny: 2, offset: 0 }),
  ];
  const stickersGeo = merge(stickerGeos);
  stickerGeos.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.55, clearcoat: 0, specularIntensity: 0.25, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), '#f3efe6')));

  return finish(inner, trash, undefined, 'instant-zero');
}

/** rrect path without beginPath (for strokes inside a clip). */
function rrPathInto(c: C2D, x: number, y: number, w: number, h: number, r: number): void {
  rrPath(x, y, w, h, r)(c);
}

export const camera: LibraryDef = {
  kind: 'camera',
  name: 'Instant Zero',
  tagline: 'develops ideas in 90 seconds',
  category: 'tech',
  defaultRotation: [0.2, 0.5, 0.0],
  build,
};
export default camera;
