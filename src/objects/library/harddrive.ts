import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { lathe, merge, parametric, place, ribbon, stickerPatch, surfaces, tint } from '../geometry';
import { brushedAluminium, chrome, paperBackfaces, stickerSheet } from '../materials';
import { FONTS, DEG, rng, text, sticker, rrPath, fillPath, smallPrint, barcode, hazard, type C2D } from '../paint';
import { clearPlastic, inCell, peelLift, roundRectShape, screwHead, smoothSlab } from './_translucent';

/*
 * COLD STORAGE: a bare hard drive sealed in a chunky clear acrylic case. Mirror platter
 * on a chrome clamp (it spins), a brushed actuator arm that seeks now and then, copper
 * flex, a green controller board with a blinking activity LED and a USB-C port poking
 * out of the bottom. Stickers on the acrylic: a retro inline COLD STORAGE logo, a
 * yellow BACKUP bubble sticker and DO NOT DROP tape over the edge. Centimetres.
 */

const W = 8.6;
const H = 11.4;
const D = 2.5;
const HALF = D / 2;
const BEV = 0.55;
const CORNER = 1.35;

const PLATTER = { x: 0, y: 1.5, r: 3.15, z: -0.2 };
const PIVOT = { x: 2.75, y: -1.4 };
const HEAD = { x: 0.72, y: 0.32 };
const PCB = { y0: -5.25, y1: -2.55, z: -0.5 };
const BASE = { y0: -2.75, y1: 5.0, z: -0.75 };

const LIME = '#d7ff3a';
const INK = '#111214';
const YELLOW = '#ffdf2e';
const RED = '#e8231a';

// ------------------------------------------------------------------ textures

function paintPlatterRough(s: Surface): void {
  // roughness (G) rings for a machined mirror: mostly glassy with faint lathe bands
  const c = s.c;
  const N = s.w;
  c.fillStyle = 'rgb(0,18,255)';
  c.fillRect(0, 0, N, N);
  const r = rng(13);
  for (let i = 0; i < 120; i++) {
    const rad = (N / 2) * (0.3 + 0.7 * r());
    const g = Math.round(8 + r() * 40);
    c.strokeStyle = `rgb(0,${g},255)`;
    c.lineWidth = 1 + r() * 3;
    c.beginPath();
    c.arc(N / 2, N / 2, rad, 0, Math.PI * 2);
    c.stroke();
  }
}

function paintPCB(s: Surface): void {
  const c = s.c;
  c.fillStyle = '#16603a';
  c.fillRect(0, 0, s.w, s.h);
  const r = rng(29);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (let i = 0; i < 70; i++) {
    c.strokeStyle = r() > 0.3 ? 'rgba(214,180,90,0.9)' : 'rgba(150,230,170,0.55)';
    c.lineWidth = 2 + r() * 3;
    let x = r() * s.w;
    let y = r() * s.h;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      if (r() > 0.5) x += (r() - 0.5) * 220;
      else y += (r() - 0.5) * 140;
      c.lineTo(x, y);
    }
    c.stroke();
    fillPath(c, (p) => p.arc(x, y, 5, 0, Math.PI * 2), '#e7c96a');
  }
  // gold edge fingers and silkscreen
  c.fillStyle = '#e2c25e';
  for (let i = 0; i < 18; i++) c.fillRect(40 + i * 22, s.h - 34, 12, 30);
  smallPrint(c, ['COLD STORAGE CTRL REV.7', 'final_final_v7 inside', 'DO NOT DROP · DO NOT FORMAT'], 470, 40, 22, '#e9fff1', { weight: 700, lineHeight: 26 });
}

function paintDriveLabel(c: C2D): void {
  // the classic drive-top label, seen through the acrylic back
  c.fillStyle = '#f2f2f0';
  c.fillRect(-300, -380, 600, 760);
  c.fillStyle = INK;
  c.fillRect(-300, -380, 600, 120);
  text(c, 'COLD', -270, -296, { size: 64, family: FONTS.rubikMono, color: '#ffffff' });
  text(c, 'STORAGE', -270, -276 + 4, { size: 26, family: FONTS.rubikMono, color: LIME });
  text(c, '1 TB', 270, -300, { size: 58, family: FONTS.archivoBlack, align: 'right', color: '#ffffff' });
  text(c, 'of ideas', 270, -272, { size: 22, family: FONTS.spaceMono, weight: 700, align: 'right', color: LIME });
  smallPrint(
    c,
    ['MODEL: CS-0 · 5400 RPM · USB-C', 'CONTENTS: final.fig, final_final.fig,', 'final_final_v7.fig, final_REAL.fig', 'BACKED UP DAILY SINCE ONCE UPON A TIME', 'MADE BY ZEROS · DESIGNED IN THE TIMELINE'],
    -276,
    -236,
    20,
    INK,
    { weight: 700, lineHeight: 25 },
  );
  barcode(c, -270, -100, 300, 120, 707, { digits: 'CS0 0000 0007' });
  // warning panel
  c.save();
  c.translate(-276, 60);
  hazard(c, 0, 0, 552, 30, 16, YELLOW, INK);
  c.restore();
  text(c, 'HANDLE WITH CARE', 0, 150, { size: 40, family: FONTS.archivoBlack, align: 'center', color: INK });
  smallPrint(c, ['Contains every version you swore', 'was the last one. Do not open,', 'do not drop, do not format.'], 0, 172, 20, INK, { weight: 700, align: 'center', lineHeight: 24 });
  c.strokeStyle = INK;
  c.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(-180 + i * 180, 320, 34, 0, Math.PI * 2);
    c.stroke();
  }
  text(c, 'CE?', -180, 332, { size: 26, family: FONTS.archivoBlack, align: 'center', color: INK });
  text(c, 'RoHS', 0, 330, { size: 22, family: FONTS.archivoBlack, align: 'center', color: INK });
  text(c, '0', 180, 336, { size: 44, family: FONTS.bagel, align: 'center', color: INK });
}

function paintStickers(sheet: StickerSheet) {
  // retro inline logo, cream die-cut
  const logo = sheet.alloc(560, 330);
  inCell(sheet, logo, (c) => {
    sticker(c, 0, 0, 0, rrPath(-262, -150, 524, 300, 64), { border: 0, fill: '#f1ead6', shadow: 0.7, edge: 'rgba(0,0,0,0.25)' }, (q) => {
      const inline = { family: FONTS.rubikMono, align: 'center' as const, color: '#f1ead6', outlines: [{ color: INK, width: 26 }, { color: '#f1ead6', width: 15 }, { color: INK, width: 6 }] };
      text(q, 'COLD', 0, 18, { ...inline, size: 128, maxWidth: 470 });
      text(q, 'STORAGE', -14, 112, { ...inline, size: 54, maxWidth: 400, outlines: [{ color: INK, width: 14 }, { color: '#f1ead6', width: 8 }, { color: INK, width: 3 }] });
      q.strokeStyle = INK;
      q.lineWidth = 5;
      q.beginPath();
      q.arc(214, 94, 20, 0, Math.PI * 2);
      q.stroke();
      text(q, 'R', 214, 104, { size: 26, family: FONTS.archivoBlack, align: 'center', color: INK });
    });
  });
  // yellow bubble BACKUP, set vertically
  const bub = sheet.alloc(620, 220);
  inCell(sheet, bub, (c) => {
    sticker(c, 0, 0, 0, rrPath(-298, -96, 596, 192, 60), { border: 0, fill: YELLOW, shadow: 0.7 }, (q) => {
      // checker band
      for (let i = 0; i < 40; i++) {
        q.fillStyle = i % 2 ? RED : YELLOW;
        q.fillRect(-298 + i * 15, -96, 15, 12);
        q.fillStyle = i % 2 ? YELLOW : RED;
        q.fillRect(-298 + i * 15, 84, 15, 12);
      }
      text(q, 'BACKUP', 0, 46, { size: 132, family: FONTS.bagel, align: 'center', color: YELLOW, maxWidth: 540, outlines: [{ color: RED, width: 22 }, { color: YELLOW, width: 12 }, { color: RED, width: 5 }] });
    });
  });
  // DO NOT DROP tape
  const tape = sheet.alloc(700, 110);
  inCell(sheet, tape, (c) => {
    c.save();
    c.beginPath();
    c.rect(-350, -55, 700, 110);
    c.clip();
    hazard(c, -350, -55, 700, 110, 26, YELLOW, INK);
    c.fillStyle = YELLOW;
    c.fillRect(-250, -36, 500, 72);
    text(c, 'DO NOT DROP', 0, 22, { size: 54, family: FONTS.archivoBlack, align: 'center', color: INK, maxWidth: 480 });
    c.restore();
  });
  // small typed file label + lime dot (back)
  const file = sheet.alloc(420, 190);
  inCell(sheet, file, (c) => {
    sticker(c, 0, 0, 0, rrPath(-196, -82, 392, 164, 10), { border: 0, fill: '#ffffff', shadow: 0.6 }, (q) => {
      q.fillStyle = '#ff4fb8';
      q.fillRect(-196, -82, 392, 30);
      smallPrint(q, ['FILE NAME'], -180, -76, 18, '#ffffff', { weight: 700 });
      text(q, 'final_final_v7.fig', -180, -14, { size: 30, family: FONTS.spaceMono, weight: 700, color: INK, maxWidth: 360 });
      text(q, '(actually final)', -180, 22, { size: 26, family: FONTS.marker, color: '#d0145f' }, -2 * DEG);
      barcode(q, -180, 36, 220, 38, 77);
    });
  });
  const dot = sheet.alloc(190, 190);
  inCell(sheet, dot, (c) => {
    sticker(c, 0, 0, 0, (q) => q.arc(0, 0, 82, 0, Math.PI * 2), { border: 9, fill: LIME, shadow: 0.7 }, (q) => {
      q.strokeStyle = INK;
      q.lineWidth = 15;
      q.beginPath();
      q.ellipse(0, 0, 32, 46, 0, 0, Math.PI * 2);
      q.stroke();
      q.lineWidth = 8;
      q.beginPath();
      q.moveTo(-26, 36);
      q.lineTo(26, -38);
      q.stroke();
    });
  });
  const label = sheet.alloc(480, 608);
  inCell(sheet, label, (c) => {
    c.scale(0.8, 0.8);
    paintDriveLabel(c);
  });
  return { logo, bub, tape, file, dot, label };
}

// ------------------------------------------------------------------ parts

function platterGeometry(): THREE.BufferGeometry {
  const R = PLATTER.r;
  const t = 0.09;
  const disc = lathe(
    [
      [0.98, -t / 2],
      [R - 0.02, -t / 2],
      [R, -t / 2 + 0.02],
      [R, t / 2 - 0.02],
      [R - 0.02, t / 2],
      [0.98, t / 2],
    ],
    { segments: 96, uv: (x, _y, z) => [0.5 + (x / R) * 0.5, 0.5 + (z / R) * 0.5] },
  );
  const clamp = lathe(
    [
      [0, 0.2],
      [0.6, 0.2],
      [0.66, 0.17],
      [0.98, 0.1],
      [1.02, 0.06],
      [1.02, t / 2],
      [0.98, -0.2],
    ],
    { segments: 64, uv: () => [0.5, 0.5] },
  );
  const centre = lathe(
    [
      [0, 0.26],
      [0.22, 0.26],
      [0.26, 0.2],
    ],
    { segments: 32, uv: () => [0.5, 0.5] },
  );
  const parts = [tint(disc, '#ffffff'), tint(clamp, '#e9edf2'), tint(centre, '#c9ced6')];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const s = screwHead(0.1, '#e0e4ea', '#33363c');
    s.rotateX(-Math.PI / 2);
    s.translate(Math.cos(a) * 0.48, 0.18, Math.sin(a) * 0.48);
    parts.push(s);
  }
  const g = merge(parts);
  parts.forEach((p) => p.dispose());
  g.rotateX(Math.PI / 2); // axis +Y -> +Z
  return g;
}

/** Actuator arm assembly in local coords (pivot at origin, arm along +X), vertex coloured. */
function armGeometry(len: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const s = new THREE.Shape();
  s.moveTo(0, -0.42);
  s.lineTo(len * 0.55, -0.22);
  s.lineTo(len - 0.12, -0.08);
  s.quadraticCurveTo(len + 0.05, 0, len - 0.12, 0.08);
  s.lineTo(len * 0.55, 0.22);
  s.lineTo(0, 0.42);
  s.absarc(0, 0, 0.42, Math.PI / 2, (Math.PI * 3) / 2, false);
  const hole = new THREE.Path();
  hole.moveTo(len * 0.22, -0.12);
  hole.lineTo(len * 0.5, -0.07);
  hole.lineTo(len * 0.5, 0.07);
  hole.lineTo(len * 0.22, 0.12);
  hole.closePath();
  s.holes.push(hole);
  const arm = smoothSlab(s, 0.07, 0.015, { bevelSegments: 1, curveSegments: 10 });
  parts.push(tint(arm, '#cfd4db'));
  // head slider + its lead
  parts.push(tint(place(new THREE.BoxGeometry(0.2, 0.14, 0.09), [len - 0.05, 0, -0.07]), '#2a2b30'));
  parts.push(tint(place(new THREE.BoxGeometry(len * 0.75, 0.025, 0.02), [len * 0.55, 0.05, 0.05]), '#d9792a'));
  // pivot bearing
  const bearing = lathe(
    [
      [0, -0.5],
      [0.38, -0.5],
      [0.4, -0.46],
      [0.4, 0.14],
      [0.34, 0.2],
      [0.14, 0.22],
      [0, 0.22],
    ],
    { segments: 36 },
  );
  bearing.rotateX(Math.PI / 2);
  parts.push(tint(bearing, '#e7eaee'));
  // voice coil on the far side: copper loop
  const coil = new THREE.Shape();
  coil.moveTo(-0.3, -0.5);
  coil.lineTo(-1.2, -0.75);
  coil.quadraticCurveTo(-1.45, 0, -1.2, 0.75);
  coil.lineTo(-0.3, 0.5);
  coil.closePath();
  const inside = new THREE.Path();
  inside.moveTo(-0.5, -0.32);
  inside.lineTo(-1.05, -0.48);
  inside.quadraticCurveTo(-1.2, 0, -1.05, 0.48);
  inside.lineTo(-0.5, 0.32);
  inside.closePath();
  coil.holes.push(inside);
  parts.push(tint(smoothSlab(coil, 0.12, 0.03, { bevelSegments: 2, curveSegments: 8 }), '#c96a2a'));
  const g = merge(parts);
  parts.forEach((p) => p.dispose());
  return g;
}

function usbC(): THREE.BufferGeometry {
  // rounded slot shell along -Y (the bottom edge), dark tongue inside
  const outer = roundRectShape(0, 0, 1.0, 0.38, 0.19);
  const hole = new THREE.Path();
  const ih = roundRectShape(0, 0, 0.86, 0.26, 0.13);
  hole.setFromPoints(ih.getPoints(12));
  outer.holes.push(hole);
  const shell = tint(smoothSlab(outer, 0.9, 0.02, { bevelSegments: 1, curveSegments: 10 }), '#e8ebef');
  const back = tint(place(new THREE.BoxGeometry(0.9, 0.3, 0.05), [0, 0, -0.42]), '#16171a');
  const tongue = tint(place(new THREE.BoxGeometry(0.6, 0.07, 0.6), [0, 0, 0.05]), '#16171a');
  const g = merge([shell, back, tongue]);
  [shell, back, tongue].forEach((p) => p.dispose());
  g.rotateX(Math.PI / 2); // extrusion +Z -> -Y
  return g;
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- clear acrylic case
  const caseGeo = smoothSlab(roundRectShape(0, 0, W - 2 * BEV, H - 2 * BEV, CORNER - BEV), D, BEV, { bevelSegments: 6 });
  const caseMat = clearPlastic('#f4f8fb', {
    roughness: 0.04,
    thickness: 0.7,
    ior: 1.49,
    attenuationColor: new THREE.Color('#dbe8f2'),
    attenuationDistance: 14,
    emissive: new THREE.Color('#cfdae6'),
    emissiveIntensity: 0.05,
    sheen: 1,
    sheenColor: new THREE.Color('#dfe8f2'),
    sheenRoughness: 0.32,
  });
  inner.add(new THREE.Mesh(caseGeo, caseMat));

  // ---------- aluminium base casting
  const baseShape = roundRectShape(0, (BASE.y0 + BASE.y1) / 2, 7.3, BASE.y1 - BASE.y0, [0.7, 0.7, 0.5, 0.5]);
  const baseGeo = smoothSlab(baseShape, 0.22, 0.05, { bevelSegments: 2 });
  baseGeo.translate(0, 0, BASE.z);
  inner.add(new THREE.Mesh(baseGeo, brushedAluminium({ color: '#c9ced5', roughness: 0.38, anisotropy: 0 })));

  // ---------- spinning platter + clamp
  const rough = new Surface(512, 512, bctx, { density: 0.5 });
  paintPlatterRough(rough);
  const platterGeo = platterGeometry();
  const roughTex = rough.colorTexture();
  roughTex.colorSpace = THREE.NoColorSpace;
  const platterMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 1, roughness: 1, roughnessMap: roughTex, clearcoat: 0.4, clearcoatRoughness: 0.05 });
  const platter = new THREE.Mesh(platterGeo, platterMat);
  platter.position.set(PLATTER.x, PLATTER.y, PLATTER.z);
  inner.add(platter);

  // ---------- actuator arm (seeks)
  const armLen = Math.hypot(HEAD.x - PIVOT.x, HEAD.y - PIVOT.y);
  const armBase = Math.atan2(HEAD.y - PIVOT.y, HEAD.x - PIVOT.x);
  const arm = new THREE.Mesh(armGeometry(armLen), new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.28, clearcoat: 0.3 }));
  arm.position.set(PIVOT.x, PIVOT.y, -0.08);
  arm.rotation.z = armBase;
  inner.add(arm);

  // ---------- dark static parts: magnet, chips, spindle motor base, small SMDs
  const dark: THREE.BufferGeometry[] = [];
  dark.push(tint(place(smoothSlab(roundRectShape(0, 0, 1.9, 1.35, 0.2), 0.3, 0.05, { bevelSegments: 1 }), [PIVOT.x + 0.55, PIVOT.y - 0.15, BASE.z + 0.25], [0, 0, armBase + Math.PI]), '#141518'));
  dark.push(tint(place(new THREE.CylinderGeometry(1.15, 1.2, 0.4, 40).rotateX(Math.PI / 2), [PLATTER.x, PLATTER.y, BASE.z + 0.28]), '#2b2e33'));
  const chips: [number, number, number, number][] = [
    [-1.55, -3.85, 1.35, 1.35],
    [0.45, -3.5, 0.95, 0.7],
    [1.75, -4.35, 0.8, 0.55],
    [-2.9, -4.6, 0.6, 0.45],
  ];
  for (const [x, y, w, h] of chips) dark.push(tint(place(smoothSlab(roundRectShape(0, 0, w, h, 0.05), 0.16, 0.02, { bevelSegments: 1, curveSegments: 2 }), [x, y, PCB.z + 0.14]), '#16171b'));
  const r = rng(8);
  for (let i = 0; i < 30; i++) {
    const x = -3.1 + r() * 6.2;
    const y = PCB.y0 + 0.35 + r() * (PCB.y1 - PCB.y0 - 0.7);
    dark.push(tint(place(new THREE.BoxGeometry(0.18, 0.09, 0.07), [x, y, PCB.z + 0.1], [0, 0, r() > 0.5 ? Math.PI / 2 : 0]), r() > 0.6 ? '#c9a54a' : r() > 0.3 ? '#5b4636' : '#9aa0a8'));
  }
  // copper flex from the arm to the board
  {
    const pts = [
      new THREE.Vector3(PIVOT.x - 0.3, PIVOT.y - 0.3, -0.12),
      new THREE.Vector3(PIVOT.x - 0.9, PIVOT.y - 0.55, -0.2),
      new THREE.Vector3(PIVOT.x - 1.3, PIVOT.y - 0.75, -0.3),
      new THREE.Vector3(PIVOT.x - 1.45, PIVOT.y - 1.15, -0.38),
      new THREE.Vector3(PIVOT.x - 1.4, PIVOT.y - 1.6, -0.42),
    ];
    const side = new THREE.Vector3(0, 0, 0.16);
    dark.push(tint(ribbon(pts, () => side), '#ff8a3a'));
  }
  const darkGeo = merge(dark);
  dark.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(darkGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.25, clearcoat: 0.4, side: THREE.DoubleSide })));

  // ---------- green controller board
  const pcbSurf = new Surface(1024, 400, bctx, { density: 0.7 });
  paintPCB(pcbSurf);
  const pcbW = 7.0;
  const pcbH = PCB.y1 - PCB.y0;
  const pcbGeo = smoothSlab(roundRectShape(0, (PCB.y0 + PCB.y1) / 2, pcbW, pcbH, [0.2, 0.2, 0.6, 0.6]), 0.12, 0.02, { bevelSegments: 1, curveSegments: 6, keepUV: true });
  pcbGeo.translate(0, 0, PCB.z);
  const pcbTex = pcbSurf.colorTexture();
  pcbTex.wrapS = THREE.RepeatWrapping;
  pcbTex.wrapT = THREE.RepeatWrapping;
  pcbTex.repeat.set(1 / pcbW, 1 / pcbH);
  pcbTex.offset.set(0.5, -PCB.y0 / pcbH);
  inner.add(new THREE.Mesh(pcbGeo, new THREE.MeshStandardMaterial({ map: pcbTex, roughness: 0.5, metalness: 0.1 })));

  // ---------- chrome: USB-C, case screws on the back corners
  const chr: THREE.BufferGeometry[] = [];
  chr.push(place(usbC(), [0, -H / 2 + 0.12, PCB.z + 0.12]));
  for (const [x, y] of [
    [-3.15, 4.55],
    [3.15, 4.55],
    [-3.15, -4.55],
    [3.15, -4.55],
  ] as [number, number][]) {
    const g = screwHead(0.24);
    g.rotateZ(x * y);
    g.rotateY(Math.PI);
    chr.push(place(g, [x, y, -HALF + 0.01]));
  }
  const chrGeo = merge(chr);
  chr.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(chrGeo, chrome({ vertexColors: true, roughness: 0.14 })));

  // ---------- activity LED
  const ledGeo = place(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), [2.6, -3.15, PCB.z + 0.06]);
  const ledMat = new THREE.MeshPhysicalMaterial({ color: '#7cf0ff', emissive: '#29d3ff', emissiveIntensity: 2.4, roughness: 0.2, clearcoat: 1 });
  inner.add(new THREE.Mesh(ledGeo, ledMat));

  // ---------- stickers (on the acrylic) + the drive label (on the base, seen through the back)
  const sheet = new StickerSheet(2048, 1024, bctx, 14);
  const cells = paintStickers(sheet);
  const sheetTex = sheet.surf.colorTexture();
  const front = surfaces.plane(new THREE.Vector3(0, 0, HALF + 0.008), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const backFace = surfaces.plane(new THREE.Vector3(0, 0, -HALF - 0.008), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
  const baseBack = surfaces.plane(new THREE.Vector3(0, 0, BASE.z - 0.115), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
  const paper: THREE.BufferGeometry[] = [];
  paper.push(stickerPatch(front, 0.75, 3.3, 3.7, 2.1, -5 * DEG, cells.logo.uv, { nx: 6, ny: 4, offset: 0.004, lift: peelLift(0.22, 1, 1, 0.35) }));
  paper.push(stickerPatch(front, -2.72, 0.5, 4.2, 1.49, 92 * DEG, cells.bub.uv, { nx: 8, ny: 4, offset: 0.004 }));
  paper.push(stickerPatch(backFace, -1.2, -3.6, 3.2, 1.45, 4 * DEG, cells.file.uv, { nx: 4, ny: 4, offset: 0.004 }));
  paper.push(stickerPatch(backFace, 2.55, 4.1, 1.3, 1.3, -10 * DEG, cells.dot.uv, { nx: 4, ny: 4, offset: 0.006 }));
  paper.push(stickerPatch(baseBack, 0, 1.15, 5.6, 7.1, 0, cells.label.uv, { nx: 2, ny: 2, offset: 0.002 }));
  // DO NOT DROP tape wrapped over the right edge (front face -> bevel -> side)
  {
    const xc = W / 2 - BEV;
    const zc = HALF - BEV;
    const off = 0.012;
    const flat = 1.2;
    const arc = (Math.PI / 2) * BEV;
    const side = 0.75;
    const L = flat + arc + side;
    const y0 = -3.35;
    const tw = 0.62;
    paper.push(
      parametric(
        40,
        3,
        (u, v, out) => {
          let s = u * L;
          const y = y0 + (v - 0.5) * tw + (u - 0.5) * 0.35;
          if (s < flat) {
            out.set(xc - flat + s, y, HALF + off);
            return;
          }
          s -= flat;
          if (s < arc) {
            const th = s / BEV;
            out.set(xc + Math.sin(th) * (BEV + off), y, zc + Math.cos(th) * (BEV + off));
            return;
          }
          s -= arc;
          out.set(W / 2 + off, y, zc - s);
        },
        { uv: (u, v) => [cells.tape.uv[0] + u * (cells.tape.uv[2] - cells.tape.uv[0]), cells.tape.uv[1] + v * (cells.tape.uv[3] - cells.tape.uv[1])] },
      ),
    );
  }
  const paperGeo = merge(paper);
  paper.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(paperGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.4, clearcoat: 0.6, emissive: '#ffffff', emissiveMap: sheetTex, emissiveIntensity: 0.22 }), '#f1ece0')));

  // ---------- idle: platter spins, the arm seeks, the LED blinks on seeks
  const update = (t: number) => {
    platter.rotation.z = -t * 0.9;
    const seek = Math.sin(t * 0.7) * 0.5 + Math.sin(t * 2.3 + 1) * 0.25;
    arm.rotation.z = armBase + 0.09 * seek;
    const blink = Math.sin(t * 9) > 0.2 && Math.sin(t * 0.7 + 0.6) > -0.3 ? 1 : 0.15;
    ledMat.emissiveIntensity = 0.5 + 2.4 * blink;
  };
  update(0);

  return finish(inner, trash, update, 'cold-storage');
}

export const harddrive: LibraryDef = {
  kind: 'harddrive',
  name: 'Cold Storage',
  tagline: 'every final_final_v7, backed up',
  category: 'tech',
  defaultRotation: [0.36, -0.34, 0.34],
  build,
};
export default harddrive;

