import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObjectBuildContext, ObjectDef } from './types';
import { Surface, StickerSheet } from './textures';
import { Trash, finish } from './build';
import { atlasRoundedBox, boxFaceDims, lathe, merge, place, tint, parametric, stickerPatch, surfaces, type FaceName, type FaceRect, type BoxFaceInfo } from './geometry';
import { chrome, holoFoil, stickerSheet, glossyPlastic, paperBackfaces } from './materials';
import { FONTS, DEG, text, sticker, starPath, circlePath, rrPath, fillPath, smallPrint, hazard, grain, holoFill, barcode, type C2D } from './paint';

/*
 * MOTION keyframe fuzz: a chunky orange effects pedal shown face-on (+Z is the
 * printed top plate). Scene units ~ 10 cm.
 */

const BW = 1.0;
const BH = 1.06;
const BD = 0.6;
const BR = 0.17;
const ZF = BD / 2;

const ORANGE = '#ff6a14';
const INK = '#1b1410';
const CREAM = '#f3efe8';

const KNOBS = [
  { id: 'EASE', x: -0.265, y: 0.265, r: 0.082, angle: 35 * DEG, big: false },
  { id: 'DELAY', x: 0.255, y: 0.33, r: 0.082, angle: -30 * DEG, big: false },
  { id: 'BOUNCE', x: 0.05, y: 0.02, r: 0.235, angle: 38 * DEG, big: true },
];
const TOGGLE = { x: -0.03, y: 0.355 };
const LED = { x: 0.108, y: 0.445 };
const FOOT = { x: 0.2, y: -0.335 };
const PANEL = { top: -0.115, bottom: -0.405 };
const JACK_Y = -0.03;

// ------------------------------------------------------------------ print

function paintFront(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const { x: rx, y: ry, w: rw, h: rh } = f.rect;
  const P = f.toPx;
  const k = f.k;
  const bleed = 16;
  c.save();
  c.beginPath();
  c.rect(rx - bleed, ry - bleed, rw + bleed * 2, rh + bleed * 2);
  c.clip();
  const g = c.createLinearGradient(0, ry, 0, ry + rh);
  g.addColorStop(0, '#ff7322');
  g.addColorStop(1, ORANGE);
  c.fillStyle = g;
  c.fillRect(rx - bleed, ry - bleed, rw + bleed * 2, rh + bleed * 2);

  // cream panel band with the inline wordmark
  const [, pTop] = P(0, PANEL.top);
  const [, pBot] = P(0, PANEL.bottom);
  c.fillStyle = CREAM;
  c.fillRect(rx - bleed, pTop, rw + bleed * 2, pBot - pTop);
  // second thin cream strip near the bottom edge (as in the reference)
  const [, sTop] = P(0, -0.455);
  const [, sBot] = P(0, -0.53);
  c.fillRect(rx - bleed, sTop, rw + bleed * 2, sBot - sTop);
  {
    const [mx, my] = P(-0.11, -0.335);
    const st = { size: 0.2 * k, family: FONTS.rubikMono, align: 'center' as const, maxWidth: 0.66 * k };
    // inline letters: thick orange body with a thin cream line tracing the outline
    text(c, 'MOTION', mx, my, { ...st, color: ORANGE, outlines: [{ color: ORANGE, width: 0.03 * k }] });
    text(c, 'MOTION', mx, my, { ...st, color: 'rgba(0,0,0,0)', outlines: [{ color: CREAM, width: 0.0075 * k }] });
    const [bx, by] = P(-0.47, -0.262);
    c.strokeStyle = ORANGE;
    c.lineWidth = 0.012 * k;
    c.strokeRect(bx - 0.03 * k, by - 0.045 * k, 0.06 * k, 0.09 * k);
  }
  // orange box with vertical small type on the right of the panel
  {
    const [bx, by] = P(0.405, -0.26);
    fillPath(c, rrPath(bx - 0.06 * k, by - 0.13 * k, 0.12 * k, 0.26 * k, 0.008 * k), ORANGE);
    c.save();
    c.translate(bx, by);
    c.rotate(-Math.PI / 2);
    smallPrint(c, ['KEYFRAME', 'FUZZ · MF-5', '60 FPS'], 0, -0.045 * k, 0.026 * k, CREAM, { align: 'center', weight: 700, lineHeight: 0.031 * k, family: FONTS.archivoBlack });
    c.restore();
  }

  // label plates above the small knobs (cream with ink type, like the reference)
  const plate = (label: string, x: number, y: number, w: number) => {
    const [px, py] = P(x, y);
    fillPath(c, rrPath(px - (w * k) / 2, py - 0.032 * k, w * k, 0.064 * k, 0.008 * k), CREAM);
    text(c, label, px, py + 0.018 * k, { size: 0.048 * k, family: FONTS.archivoBlack, align: 'center', color: '#c8361a', maxWidth: (w - 0.02) * k });
  };
  plate('EASE', -0.25, 0.415, 0.17);
  plate('DELAY', 0.255, 0.475, 0.19);
  plate('BOUNCE', -0.3, -0.075, 0.19);
  // tick ring around the big knob
  {
    const kn = KNOBS[2];
    const [cx, cy] = P(kn.x, kn.y);
    const R0 = (kn.r + 0.03) * k;
    c.strokeStyle = 'rgba(255,240,225,0.9)';
    c.lineCap = 'round';
    for (let i = 0; i <= 10; i++) {
      const a = (-225 + i * 27) * DEG;
      c.lineWidth = i % 5 === 0 ? 5 : 3;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0);
      c.lineTo(cx + Math.cos(a) * (R0 + 0.02 * k), cy + Math.sin(a) * (R0 + 0.02 * k));
      c.stroke();
    }
  }
  // INPUT / OUTPUT labels with arrows (white type in thin frames)
  const io = (label: string, x: number, y: number) => {
    const [ax, ay] = P(x, y);
    c.save();
    c.translate(ax, ay);
    c.strokeStyle = 'rgba(255,245,235,0.95)';
    c.lineWidth = 3;
    c.strokeRect(-0.085 * k, -0.034 * k, 0.17 * k, 0.05 * k);
    text(c, label, 0, 0.004 * k, { size: 0.036 * k, family: FONTS.archivoBlack, align: 'center', color: '#fff4ea', maxWidth: 0.16 * k });
    c.strokeStyle = '#fff4ea';
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(0.05 * k, 0.06 * k);
    c.lineTo(-0.05 * k, 0.06 * k);
    c.moveTo(-0.03 * k, 0.042 * k);
    c.lineTo(-0.05 * k, 0.06 * k);
    c.lineTo(-0.03 * k, 0.078 * k);
    c.stroke();
    c.restore();
  };
  io('INPUT', 0.355, 0.165);
  io('OUTPUT', -0.33, 0.06);
  {
    const [x, y] = P(FOOT.x, FOOT.y);
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x, y, 0.105 * k, 0, Math.PI * 2);
    c.stroke();
    const [x2, y2] = P(-0.14, -0.49);
    text(c, 'made with bezier curves · 5 yrs of motion', x2, y2, { size: 0.02 * k, family: FONTS.spaceMono, weight: 700, align: 'center', color: INK });
  }
  grain(c, rx, ry, rw, rh, 5000, 0.05, 21);
  c.restore();
}

function paintSide(s: Surface, f: BoxFaceInfo, label: string): void {
  const c = s.c;
  const { x, y, w, h } = f.rect;
  const P = f.toPx;
  const k = f.k;
  c.save();
  c.beginPath();
  c.rect(x - 14, y - 14, w + 28, h + 28);
  c.clip();
  c.fillStyle = ORANGE;
  c.fillRect(x - 14, y - 14, w + 28, h + 28);
  // the cream panel wraps around the sides
  const [, pTop] = P(0, PANEL.top);
  const [, pBot] = P(0, PANEL.bottom);
  c.fillStyle = CREAM;
  c.fillRect(x - 14, pTop, w + 28, pBot - pTop);
  const [, sTop] = P(0, -0.455);
  const [, sBot] = P(0, -0.53);
  c.fillRect(x - 14, sTop, w + 28, sBot - sTop);
  const [jx, jy] = P(0, JACK_Y);
  text(c, label, jx, jy + 0.21 * k, { size: 0.05 * k, family: FONTS.archivoBlack, align: 'center', color: INK });
  smallPrint(c, ['9V DC · TRUE BYPASS'], jx, jy - 0.28 * k, 0.022 * k, '#fff4ea', { align: 'center', weight: 700 });
  c.restore();
}

function paintTop(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const { x, y, w, h } = f.rect;
  const P = f.toPx;
  const k = f.k;
  c.fillStyle = ORANGE;
  c.fillRect(x - 14, y - 14, w + 28, h + 28);
  const [cx, cy] = P(0, 0);
  text(c, '9V DC', cx + 0.16 * k, cy + 0.012 * k, { size: 0.04 * k, family: FONTS.archivoBlack, align: 'center', color: INK });
}

function paintBottom(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const { x, y, w, h } = f.rect;
  c.fillStyle = CREAM;
  c.fillRect(x - 14, y - 14, w + 28, h + 28);
}

function paintBack(s: Surface, f: BoxFaceInfo): void {
  const c = s.c;
  const { x, y, w, h } = f.rect;
  const P = f.toPx;
  const k = f.k;
  c.fillStyle = ORANGE;
  c.fillRect(x - 14, y - 14, w + 28, h + 28);
  const [px0, py0] = P(-0.36, 0.38);
  const [px1, py1] = P(0.36, -0.38);
  const g = c.createLinearGradient(px0, py0, px1, py1);
  g.addColorStop(0, '#3a3a3e');
  g.addColorStop(1, '#232326');
  fillPath(c, rrPath(px0, py0, px1 - px0, py1 - py0, 0.05 * k), g);
  const [sx, sy] = P(0, 0.02);
  sticker(s, sx, sy, -2 * DEG, rrPath(-0.27 * k, -0.22 * k, 0.54 * k, 0.44 * k, 0.03 * k), { border: 0, fill: '#f5f1e8', shadow: 0.6 }, (q) => {
    text(q, 'MOTION', 0, -0.12 * k, { size: 0.075 * k, family: FONTS.rubikMono, align: 'center', color: ORANGE });
    text(q, 'KEYFRAME FUZZ · MF-5', 0, -0.07 * k, { size: 0.026 * k, family: FONTS.archivoBlack, align: 'center', color: INK });
    smallPrint(q, ['SERIAL  2019-2024 (5 YRS)', 'INPUT   ideas, sketches', 'OUTPUT  smooth motion', 'POWER   coffee, 9V DC', 'MADE IN THE TIMELINE'], -0.23 * k, -0.045 * k, 0.024 * k, INK, {
      weight: 700,
      lineHeight: 0.031 * k,
    });
    barcode(q, -0.11 * k, 0.115 * k, 0.22 * k, 0.075 * k, 55, { digits: '5 YEARS 0F M0TI0N' });
  });
}

// ------------------------------------------------------------------ parts

/** Small knob: black cap over a dark red skirt, white pointer. Axis +Z, unit radius. */
function smallKnob(): THREE.BufferGeometry {
  const skirt = tint(
    lathe(
      [
        [0, 0],
        [1.12, 0],
        [1.16, 0.06],
        [1.12, 0.24],
        [0.9, 0.3],
        [0, 0.3],
      ],
      { segments: 40 },
    ),
    '#5a0f0c',
  );
  const cap = tint(
    lathe(
      [
        [0.86, 0.28],
        [0.86, 1.02],
        [0.8, 1.12],
        [0.66, 1.16],
        [0, 1.17],
      ],
      { segments: 40, radial: (phi, j) => (j === 0 || j === 1 ? 0.025 * Math.cos(phi * 18) : 0) },
    ),
    '#121214',
  );
  const pointer = tint(place(new THREE.BoxGeometry(0.16, 0.04, 0.62), [0, 1.17, -0.4]), '#f4f1ea');
  const pointerSide = tint(place(new THREE.BoxGeometry(0.16, 0.6, 0.05), [0, 0.74, -0.875]), '#f4f1ea');
  const g = merge([skirt, cap, pointer, pointerSide]);
  [skirt, cap, pointer, pointerSide].forEach((q) => q.dispose());
  g.rotateX(Math.PI / 2);
  return g;
}

/** Big "bar" knob: wide black body, chamfered top, a raised fin with a white pointer. */
function bigKnob(): THREE.BufferGeometry {
  const ring = tint(
    lathe(
      [
        [0, 0],
        [1.08, 0],
        [1.1, 0.05],
        [1.06, 0.1],
        [0, 0.1],
      ],
      { segments: 64 },
    ),
    '#3a3c40',
  );
  const body = tint(
    lathe(
      [
        [0.98, 0.08],
        [1.0, 0.12],
        [1.0, 0.36],
        [0.95, 0.44],
        [0.86, 0.47],
        [0, 0.48],
      ],
      { segments: 64 },
    ),
    '#101012',
  );
  const fin = tint(place(new RoundedBoxGeometry(0.34, 0.16, 1.78, 2, 0.06), [0, 0.52, 0]), '#141416');
  const pointer = tint(place(new RoundedBoxGeometry(0.2, 0.04, 0.62, 1, 0.015), [0, 0.6, -0.5]), '#f4f1ea');
  const g = merge([ring, body, fin, pointer]);
  [ring, body, fin, pointer].forEach((q) => q.dispose());
  g.rotateX(Math.PI / 2);
  return g;
}

function hexNut(r: number, h: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, 6, 1);
  g.rotateY(Math.PI / 6);
  return g;
}

function footswitchBase(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(place(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 40), [0, 0.006, 0]));
  parts.push(place(hexNut(0.082, 0.032), [0, 0.028, 0]));
  parts.push(
    lathe(
      [
        [0, 0.04],
        [0.06, 0.04],
        [0.06, 0.1],
        [0.054, 0.108],
        [0, 0.108],
      ],
      { segments: 40, radial: (phi, j) => (j === 1 || j === 2 ? 0.003 * Math.cos(phi * 20) : 0) },
    ),
  );
  const g = merge(parts);
  parts.forEach((q) => q.dispose());
  g.rotateX(Math.PI / 2);
  return g;
}

function footswitchCap(): THREE.BufferGeometry {
  const g = lathe(
    [
      [0, 0.1],
      [0.05, 0.1],
      [0.052, 0.18],
      [0.046, 0.195],
      [0.03, 0.202],
      [0, 0.204],
    ],
    { segments: 40, radial: (phi, j) => (j === 1 || j === 2 ? 0.0025 * Math.cos(phi * 24) : 0) },
  );
  g.rotateX(Math.PI / 2);
  return g;
}

function toggleSwitch(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(place(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 32), [0, 0.006, 0]));
  parts.push(place(hexNut(0.05, 0.03), [0, 0.027, 0]));
  parts.push(place(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 24), [0, 0.06, 0]));
  const bat = lathe(
    [
      [0, 0],
      [0.014, 0],
      [0.012, 0.09],
      [0.018, 0.11],
      [0.016, 0.125],
      [0, 0.13],
    ],
    { segments: 20 },
  );
  bat.scale(1, 0.58, 1);
  bat.rotateX(-0.5);
  bat.rotateY(0.7);
  bat.translate(0, 0.075, 0);
  parts.push(bat);
  const g = merge(parts);
  parts.forEach((q) => q.dispose());
  g.rotateX(Math.PI / 2);
  return g;
}

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- body + atlas
  const body = new RoundedBoxGeometry(BW, BH, BD, 6, BR);
  const dims = boxFaceDims(BW, BH, BD, BR);
  const AW = 2048;
  const AH = 2048;
  const fw = 1240;
  const rects: Record<FaceName, FaceRect> = {
    pz: { x: 0, y: 0, w: fw, h: Math.round((fw * dims.pz[1]) / dims.pz[0]) },
    px: { x: 1270, y: 0, w: 360, h: Math.round((360 * dims.px[1]) / dims.px[0]) },
    nx: { x: 1660, y: 0, w: 360, h: Math.round((360 * dims.nx[1]) / dims.nx[0]) },
    nz: { x: 1270, y: 860, w: 700, h: Math.round((700 * dims.nz[1]) / dims.nz[0]) },
    py: { x: 0, y: 1360, w: 620, h: Math.round((620 * dims.py[1]) / dims.py[0]) },
    ny: { x: 650, y: 1360, w: 580, h: Math.round((580 * dims.ny[1]) / dims.ny[0]) },
  };
  const faces = atlasRoundedBox(body, dims, rects, AW, AH);
  const atlas = new Surface(AW, AH, bctx, { mask: { rough: 0.3, metal: 0.2 } });
  atlas.c.fillStyle = ORANGE;
  atlas.c.fillRect(0, 0, AW, AH);
  paintFront(atlas, faces.pz);
  paintSide(atlas, faces.px, 'IN');
  paintSide(atlas, faces.nx, 'OUT');
  paintTop(atlas, faces.py);
  paintBottom(atlas, faces.ny);
  paintBack(atlas, faces.nz);
  // the round 60 FPS sticker lives on the right side
  {
    const [x, y] = faces.px.toPx(0.02, 0.22);
    const k = faces.px.k;
    sticker(atlas, x, y, 12 * DEG, circlePath(0, 0, 0.07 * k), { border: 0.011 * k, fill: '#2b2bff', shadow: 0.9 }, (q) => {
      fillPath(q, circlePath(0, 0, 0.058 * k), '#3d5bff');
      text(q, '60', 0, 0.006 * k, { size: 0.05 * k, family: FONTS.bagel, align: 'center', color: '#fff' });
      text(q, 'FPS', 0, 0.036 * k, { size: 0.02 * k, family: FONTS.rubikMono, align: 'center', color: '#ffd23a' });
    });
  }
  const maskTex = atlas.maskTexture();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: atlas.colorTexture(),
    roughnessMap: maskTex,
    metalnessMap: maskTex,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
  });
  inner.add(new THREE.Mesh(body, bodyMat));

  // ---------- knobs: small (instanced x2) + big
  const knobMat = glossyPlastic('#ffffff', { vertexColors: true, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.12 });
  const small = new THREE.InstancedMesh(smallKnob(), knobMat, 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  KNOBS.filter((kn) => !kn.big).forEach((kn, i) => {
    q.setFromAxisAngle(zAxis, kn.angle);
    m.compose(new THREE.Vector3(kn.x, kn.y, ZF - 0.004), q, new THREE.Vector3(kn.r, kn.r, kn.r));
    small.setMatrixAt(i, m);
  });
  small.instanceMatrix.needsUpdate = true;
  small.computeBoundingSphere();
  inner.add(small);
  const big = KNOBS[2];
  const bigGeo = bigKnob();
  bigGeo.rotateZ(big.angle);
  bigGeo.scale(big.r, big.r, big.r);
  bigGeo.translate(big.x, big.y, ZF - 0.004);
  inner.add(new THREE.Mesh(bigGeo, knobMat));

  // ---------- chrome hardware
  const chromeParts: THREE.BufferGeometry[] = [];
  chromeParts.push(place(footswitchBase(), [FOOT.x, FOOT.y, ZF - 0.002], [0, 0, 0], 1.12));
  chromeParts.push(place(toggleSwitch(), [TOGGLE.x, TOGGLE.y, ZF - 0.002], [0, 0, 0], 1.35));
  chromeParts.push(
    place(
      lathe(
        [
          [0.022, 0],
          [0.034, 0],
          [0.036, 0.01],
          [0.032, 0.016],
          [0.024, 0.018],
        ],
        { segments: 28 },
      ).rotateX(Math.PI / 2),
      [LED.x, LED.y, ZF - 0.002],
    ),
  );
  // jack plates on both sides: rounded plate + nut + sleeve
  for (const sgn of [1, -1]) {
    const plate = new RoundedBoxGeometry(0.05, 0.27, 0.23, 3, 0.022);
    const nut = place(hexNut(0.085, 0.034), [0, 0.017, 0]);
    const sleeve = lathe(
      [
        [0.034, 0.0],
        [0.056, 0.0],
        [0.056, 0.045],
        [0.052, 0.052],
        [0.034, 0.052],
        [0.03, 0.026],
      ],
      { segments: 32 },
    );
    const jack = merge([nut, sleeve]);
    nut.dispose();
    sleeve.dispose();
    jack.rotateZ(-sgn * Math.PI / 2);
    jack.translate(sgn * 0.012, 0, 0);
    const all = merge([plate, jack]);
    plate.dispose();
    jack.dispose();
    chromeParts.push(place(all, [sgn * (BW / 2 + 0.008), JACK_Y, -0.005]));
  }
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    chromeParts.push(place(new THREE.SphereGeometry(0.03, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), [sx * 0.36, sy * 0.37, -ZF + 0.006], [0, 0, 0], [1, 1, 0.45]));
  }
  const chromeGeo = merge(chromeParts);
  chromeParts.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(chromeGeo, chrome({ roughness: 0.1, color: '#e9ecef' })));

  // ---------- dark bits: footswitch cap, jack holes, DC jack, rubber feet
  const dark: THREE.BufferGeometry[] = [];
  dark.push(place(footswitchCap(), [FOOT.x, FOOT.y, ZF - 0.002], [0, 0, 0], 1.12));
  for (const sgn of [1, -1]) {
    const hole = new THREE.CylinderGeometry(0.031, 0.031, 0.04, 24);
    hole.rotateZ(Math.PI / 2);
    dark.push(place(hole, [sgn * (BW / 2 + 0.03), JACK_Y, -0.005]));
  }
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    dark.push(place(new THREE.CylinderGeometry(0.055, 0.055, 0.025, 24).rotateX(Math.PI / 2), [sx * 0.28, sy * 0.3, -ZF - 0.008]));
  }
  dark.push(place(new RoundedBoxGeometry(0.15, 0.05, 0.15, 2, 0.015), [-0.18, BH / 2 + 0.012, -0.02]));
  const darkGeo = merge(dark);
  dark.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(darkGeo, glossyPlastic('#2a2b2e', { roughness: 0.45, clearcoat: 0.4 })));

  // ---------- LED (pulses)
  const ledGeo = new THREE.SphereGeometry(0.022, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
  place(ledGeo, [LED.x, LED.y, ZF + 0.008], [0, 0, 0], [1, 1, 0.9]);
  const ledMat = new THREE.MeshPhysicalMaterial({ color: '#ff2a1a', emissive: '#ff2414', emissiveIntensity: 2, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  inner.add(new THREE.Mesh(ledGeo, ledMat));

  // ---------- stickers: holo star (upper left, overhanging) + DO NOT BEND tape on the back-right edge
  const sheet = new StickerSheet(1024, 512, bctx, 12);
  const starCell = sheet.alloc(320, 320);
  paintHoloStar(sheet.surf.c, starCell.x + 160, starCell.y + 160, 138);
  const tapeCell = sheet.alloc(620, 110);
  paintTape(sheet.surf.c, tapeCell.x, tapeCell.y, tapeCell.w, tapeCell.h);
  const sheetTex = sheet.surf.colorTexture();

  const front = surfaces.plane(new THREE.Vector3(0, 0, ZF), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const starGeo = stickerPatch(front, -0.47, 0.18, 0.37, 0.37, 10 * DEG, starCell.uv, {
    nx: 10,
    ny: 10,
    offset: 0.004,
    lift: (u) => 0.035 * Math.pow(THREE.MathUtils.smoothstep(1 - u, 0.55, 1), 2),
  });
  const starMat = holoFoil(sheetTex, { side: THREE.DoubleSide, forceSinglePass: true, metalness: 0.25, roughness: 0.25 });
  inner.add(new THREE.Mesh(starGeo, starMat));

  // tape wraps from the right side over the back-right vertical edge
  const a = BW / 2 - BR;
  const zc = -(ZF - BR);
  const arcLen = (Math.PI / 2) * BR;
  const tapeY = 0.3;
  const s0 = -0.12;
  const s1 = arcLen + 0.14;
  const off = 0.004;
  const tapeGeo = parametric(
    36,
    4,
    (u, v, out) => {
      const sArc = s0 + u * (s1 - s0);
      const yy = tapeY + (0.5 - v) * 0.075 + (u - 0.5) * 0.03;
      if (sArc < 0) out.set(BW / 2 + off, yy, zc - sArc);
      else if (sArc < arcLen) {
        const th = sArc / BR;
        out.set(a + Math.cos(th) * (BR + off), yy, zc - Math.sin(th) * (BR + off));
      } else out.set(a - (sArc - arcLen), yy, -ZF - off);
    },
    { uv: (u, v) => [tapeCell.uv[0] + u * (tapeCell.uv[2] - tapeCell.uv[0]), tapeCell.uv[1] + v * (tapeCell.uv[3] - tapeCell.uv[1])] },
  );
  inner.add(new THREE.Mesh(tapeGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.6, clearcoat: 0.2 }), '#efe6cf')));

  const update = (t: number) => {
    const p = 0.5 + 0.5 * Math.sin(t * 3.2);
    ledMat.emissiveIntensity = 0.5 + 2.6 * p * p;
  };
  update(0);
  return finish(inner, trash, update, 'motion-pedal');
}

function paintTape(c: C2D, x: number, y: number, w: number, h: number): void {
  c.save();
  c.beginPath();
  const teeth = 7;
  c.moveTo(x + 10, y);
  c.lineTo(x + w - 10, y);
  for (let i = 0; i <= teeth; i++) c.lineTo(x + w - (i % 2 ? 0 : 12), y + (h * i) / teeth);
  c.lineTo(x + 10, y + h);
  for (let i = teeth; i >= 0; i--) c.lineTo(x + (i % 2 ? 0 : 12), y + (h * i) / teeth);
  c.closePath();
  c.fillStyle = '#f7f0dc';
  c.fill();
  c.clip();
  hazard(c, x, y, w, 14, 12, '#ffd21f', '#1b1410');
  hazard(c, x, y + h - 14, w, 14, 12, '#ffd21f', '#1b1410');
  text(c, 'DO NOT BEND • DO NOT BEND', x + w / 2, y + h / 2 + 17, { size: 46, family: FONTS.archivoBlack, align: 'center', color: '#e2231a', maxWidth: w - 50 });
  c.restore();
}

function paintHoloStar(c: C2D, cx: number, cy: number, r: number): void {
  const path = starPath(0, 0, r, r * 0.6, 6, -Math.PI / 2, 0.6);
  c.save();
  c.translate(cx, cy);
  sticker(c, 0, 0, 0, path, { border: 10, borderColor: '#f4f4f4' }, (q) => {
    holoFill(q, path, -r, -r, r * 2, r * 2, 9);
    // white cartoon face, like the reference star
    q.fillStyle = '#ffffff';
    q.beginPath();
    q.ellipse(-r * 0.2, -r * 0.12, r * 0.08, r * 0.12, 0, 0, Math.PI * 2);
    q.ellipse(r * 0.2, -r * 0.12, r * 0.08, r * 0.12, 0, 0, Math.PI * 2);
    q.fill();
    q.beginPath();
    q.moveTo(-r * 0.32, r * 0.08);
    q.quadraticCurveTo(0, r * 0.5, r * 0.32, r * 0.08);
    q.closePath();
    q.fill();
  });
  c.restore();
}

export const pedal: ObjectDef = {
  kind: 'pedal',
  name: 'Motion Fuzz',
  tagline: 'five years of keyframes',
  defaultRotation: [-0.08, 0.72, 0.13],
  build,
};
