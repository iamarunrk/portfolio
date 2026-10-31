import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet, canvasTexture } from '../textures';
import { Trash, finish } from '../build';
import { lathe, fillet, merge, parametric, place, stickerPatch, surfaces, tint, type P2, type SurfacePoint } from '../geometry';
import { stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, rng, text, sticker, rrPath, circlePath, fillPath, smallPrint, starPath, hexA, type C2D } from '../paint';
import { inCell, sgnpow, superDisc, frameRing, crtFinish, cable } from './_computers';

/*
 * RELAX STATION: a cream retro desktop set. A pillowy CRT monitor on a flat base unit
 * (floppy slot, chunky buttons, side vents), a big-key keyboard and a mouse on a cable,
 * all sticker-bombed. The screen fizzes lime with a black sunrise. Centimetres.
 */

const CREAM = '#efe9dc';
const BASE = { w: 32, h: 7, d: 26, r: 1.6 };
const MON = { w: 30, h: 25, d: 12, r: 3.2, cy: 19.9, cz: 1 };
const MON_FRONT = MON.cz + MON.d / 2; // z = 7
const MON_TOP = MON.cy + MON.h / 2; // y = 32.4
const SCR = { cy: 20.5, hw: 8.8, hh: 6.6 };
const KB = { w: 25, h: 2.2, d: 10.5, cz: 20.3 };
const MOUSE = { x: 21.6, z: 19.6, yaw: -10 * DEG };

// ------------------------------------------------------------------ screen

interface ScreenState {
  surf: Surface;
  tex: THREE.CanvasTexture;
  frame: number;
}

function drawScreen(st: ScreenState, frame: number): void {
  if (frame === st.frame) return;
  st.frame = frame;
  const s = st.surf;
  const c = s.c;
  const W = s.w;
  const H = s.h;
  const g = c.createRadialGradient(W * 0.5, H * 0.42, 40, W * 0.5, H * 0.5, W * 0.72);
  g.addColorStop(0, '#d4ff4a');
  g.addColorStop(1, '#86d81c');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // glitter: fizzing phosphor
  const r = rng(101 + frame * 7919);
  const cols = ['#f1ff9a', '#5fb31a', '#ffffff', '#3d8c12', '#e2ff5c', '#9be22a'];
  for (let i = 0; i < 2600; i++) {
    c.globalAlpha = 0.35 + r() * 0.6;
    c.fillStyle = cols[Math.floor(r() * cols.length)];
    const sz = 1.5 + r() * 3.5;
    c.fillRect(r() * W, r() * H, sz, sz);
  }
  c.globalAlpha = 1;
  // the sunrise pictogram: a black half sun and five fat rays
  c.save();
  c.translate(W / 2, H * 0.74);
  c.fillStyle = '#111311';
  c.beginPath();
  c.arc(0, 0, 66, Math.PI, 0);
  c.closePath();
  c.fill();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.43;
    c.save();
    c.rotate(a + Math.PI / 2);
    fillPath(c, rrPath(-31, -262, 62, 160, 10), '#111311');
    c.restore();
  }
  c.restore();
  crtFinish(c, W, H, 4, 0.12);
  st.tex.needsUpdate = true;
}

// ------------------------------------------------------------------ stickers

function paintStickers(sheet: StickerSheet) {
  const cGood = sheet.alloc(420, 180);
  inCell(sheet, cGood, (c) => {
    sticker(c, 0, 0, 0, rrPath(-200, -78, 400, 156, 78), { border: 10, fill: '#ffffff', shadow: 0.6 }, (q) => {
      const blue = '#2f6bff';
      text(q, 'G', -128, 44, { size: 132, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: blue, width: 22 }] });
      text(q, 'D', 132, 44, { size: 132, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: blue, width: 22 }] });
      for (const [ex, look] of [
        [-36, 0.5],
        [46, 0.5],
      ]) {
        fillPath(q, circlePath(ex, 2, 50), blue);
        fillPath(q, circlePath(ex, 2, 39), '#ffffff');
        fillPath(q, circlePath(ex + 14 * look, 12, 17), '#111');
        fillPath(q, circlePath(ex + 14 * look - 5, 6, 5), '#ffffff');
      }
    });
  });

  const cChili = sheet.alloc(220, 300);
  inCell(sheet, cChili, (c) => {
    const body: (q: C2D) => void = (q) => {
      q.moveTo(-34, -86);
      q.bezierCurveTo(-82, -18, -66, 82, 8, 132);
      q.bezierCurveTo(30, 146, 40, 118, 26, 98);
      q.bezierCurveTo(4, 58, 64, -18, 50, -84);
      q.bezierCurveTo(26, -106, -12, -106, -34, -86);
      q.closePath();
      q.moveTo(46, -100);
      q.ellipse(6, -100, 46, 24, -0.12, 0, Math.PI * 2);
      q.closePath();
    };
    sticker(c, 0, 0, -8 * DEG, body, { border: 10, fill: '#ffffff', shadow: 0.6 }, (q) => {
      const g = q.createLinearGradient(-60, -80, 40, 130);
      g.addColorStop(0, '#ff5a3c');
      g.addColorStop(1, '#d4161c');
      q.beginPath();
      q.moveTo(-34, -86);
      q.bezierCurveTo(-82, -18, -66, 82, 8, 132);
      q.bezierCurveTo(30, 146, 40, 118, 26, 98);
      q.bezierCurveTo(4, 58, 64, -18, 50, -84);
      q.bezierCurveTo(26, -106, -12, -106, -34, -86);
      q.fillStyle = g;
      q.fill();
      fillPath(q, (p) => p.ellipse(6, -100, 46, 24, -0.12, 0, Math.PI * 2), '#3fb54a');
      q.strokeStyle = '#2b8a35';
      q.lineWidth = 12;
      q.lineCap = 'round';
      q.beginPath();
      q.moveTo(8, -110);
      q.quadraticCurveTo(14, -132, 34, -138);
      q.stroke();
      // face
      fillPath(q, (p) => p.ellipse(-28, -30, 13, 17, 0, 0, Math.PI * 2), '#ffffff');
      fillPath(q, (p) => p.ellipse(14, -30, 13, 17, 0, 0, Math.PI * 2), '#ffffff');
      fillPath(q, circlePath(-24, -26, 7), '#111');
      fillPath(q, circlePath(18, -26, 7), '#111');
      fillPath(q, (p) => p.ellipse(-40, -4, 9, 5, 0, 0, Math.PI * 2), hexA('#ffb3c8', 0.85));
      fillPath(q, (p) => p.ellipse(26, -4, 9, 5, 0, 0, Math.PI * 2), hexA('#ffb3c8', 0.85));
      q.strokeStyle = '#111';
      q.lineWidth = 5;
      q.beginPath();
      q.arc(-6, -8, 12, 0.15 * Math.PI, 0.85 * Math.PI);
      q.stroke();
      text(q, 'HOT', -2, 56, { size: 34, family: FONTS.archivoBlack, align: 'center', color: '#fff6c9' }, -0.35);
      text(q, 'TAKE', 2, 88, { size: 26, family: FONTS.archivoBlack, align: 'center', color: '#fff6c9' }, -0.45);
    });
  });

  const cRelax = sheet.alloc(300, 220);
  inCell(sheet, cRelax, (c) => {
    sticker(c, 0, 0, 0, rrPath(-142, -98, 284, 196, 70), { border: 10, fill: '#ffffff', shadow: 0.6 }, (q) => {
      fillPath(q, (p) => p.ellipse(0, -6, 92, 54, 0, 0, Math.PI * 2), '#111');
      fillPath(q, (p) => p.ellipse(0, -6, 84, 46, 0, 0, Math.PI * 2), '#ffd21f');
      text(q, 'RELAX', 0, 10, { size: 46, family: FONTS.archivoBlack, align: 'center', color: '#111' });
      // two cartoon hands cupping the badge
      for (const side of [-1, 1]) {
        q.save();
        q.translate(side * 96, 36);
        q.scale(side, 1);
        q.beginPath();
        q.moveTo(-40, 40);
        q.bezierCurveTo(-56, 6, -46, -30, -18, -40);
        for (let f = 0; f < 4; f++) {
          const fx = -14 + f * 14;
          q.quadraticCurveTo(fx + 4, -66 + f * 6, fx + 12, -40 + f * 3);
        }
        q.bezierCurveTo(48, -26, 50, 18, 30, 44);
        q.closePath();
        q.fillStyle = '#ff9fb6';
        q.fill();
        q.strokeStyle = '#111';
        q.lineWidth = 5;
        q.stroke();
        q.restore();
      }
      smallPrint(q, ['take a deep breath · ship later'], 0, 76, 15, '#444', { align: 'center', weight: 700 });
    });
  });

  const cZeros = sheet.alloc(300, 120);
  inCell(sheet, cZeros, (c) => {
    sticker(c, 0, 0, 0, rrPath(-138, -48, 276, 96, 48), { border: 8, fill: '#d7ff3a', shadow: 0.6 }, (q) => {
      text(q, 'ZEROS', 0, 26, { size: 72, family: FONTS.bagel, align: 'center', color: '#0b0b0d' });
    });
  });

  const cLight = sheet.alloc(380, 150);
  inCell(sheet, cLight, (c) => {
    sticker(c, 0, 0, 0, rrPath(-180, -64, 360, 128, 22), { border: 9, fill: '#ffd21f', shadow: 0.6 }, (q) => {
      // beam
      q.fillStyle = 'rgba(255,255,255,0.75)';
      q.beginPath();
      q.moveTo(-60, -14);
      q.lineTo(30, -56);
      q.lineTo(30, 56);
      q.lineTo(-60, 14);
      q.closePath();
      q.fill();
      // torch
      fillPath(q, rrPath(-160, -16, 92, 32, 8), '#2b2b2e');
      q.fillStyle = '#4a4a50';
      q.beginPath();
      q.moveTo(-70, -16);
      q.lineTo(-52, -26);
      q.lineTo(-52, 26);
      q.lineTo(-70, 16);
      q.closePath();
      q.fill();
      fillPath(q, rrPath(-132, -8, 20, 16, 4), '#ff4fb8');
      text(q, 'LET THERE', 104, -8, { size: 32, family: FONTS.archivoBlack, align: 'center', color: '#111', maxWidth: 150 });
      text(q, 'BE LIGHT', 104, 30, { size: 32, family: FONTS.archivoBlack, align: 'center', color: '#111', maxWidth: 150 });
    });
  });

  const cShip = sheet.alloc(240, 240);
  inCell(sheet, cShip, (c) => {
    sticker(c, 0, 0, 0, starPath(0, 0, 110, 86, 14, -Math.PI / 2, 0.5), { border: 8, fill: '#ff4fb8', shadow: 0.6 }, (q) => {
      text(q, 'SHIP', 0, -2, { size: 54, family: FONTS.archivoBlack, align: 'center', color: '#ffffff' });
      text(q, 'IT!', 0, 46, { size: 46, family: FONTS.archivoBlack, align: 'center', color: '#ffffff' });
    });
  });
  return { cGood, cChili, cRelax, cZeros, cLight, cShip };
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- cream plastic: base unit, monitor (front block + CRT hump + stand), lip around the screen, keyboard deck, mouse, cable
  const cream: THREE.BufferGeometry[] = [];
  cream.push(place(new RoundedBoxGeometry(BASE.w, BASE.h, BASE.d, 4, BASE.r), [0, BASE.h / 2, 0]));
  cream.push(place(new RoundedBoxGeometry(MON.w, MON.h, MON.d, 5, MON.r), [0, MON.cy, MON.cz]));
  cream.push(place(new RoundedBoxGeometry(24, 20, 12, 5, 5.5), [0, 18.6, -8.5]));
  cream.push(place(new THREE.CylinderGeometry(6.5, 7.2, 0.9, 40), [0, BASE.h + 0.4, -1.5]));
  const lip = frameRing(2 * 9.4, 2 * 7.2, 2.6, 0.95, 0.42, 0.12);
  lip.translate(0, SCR.cy, MON_FRONT - 0.05);
  cream.push(lip);
  cream.push(place(new RoundedBoxGeometry(KB.w, KB.h, KB.d, 4, 0.9), [0, KB.h / 2, KB.cz]));
  // mouse: an oval dome
  const mouseProfile: P2[] = fillet(
    [
      [0, 0],
      [2.7, 0],
      [2.9, 0.45],
      [2.75, 1.3],
      [2.1, 2.25],
      [1.1, 2.78],
      [0, 2.9],
    ],
    [0, 0.25, 0.4, 0.6, 0.6, 0.5, 0],
    4,
  );
  const mouse = lathe(mouseProfile, { segments: 48 });
  mouse.scale(1, 1, 1.55);
  mouse.rotateY(MOUSE.yaw);
  mouse.translate(MOUSE.x, 0, MOUSE.z);
  cream.push(mouse);
  const mouseBack = new THREE.Vector3(0, 0.7, -4.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), MOUSE.yaw).add(new THREE.Vector3(MOUSE.x, 0, MOUSE.z));
  cream.push(
    cable(
      [
        mouseBack,
        new THREE.Vector3(mouseBack.x - 0.6, 0.35, mouseBack.z - 1.6),
        new THREE.Vector3(19.4, 0.5, 11.8),
        new THREE.Vector3(17.2, 1.6, 10.2),
        new THREE.Vector3(BASE.w / 2 - 0.2, 2.6, 9.4),
      ],
      0.3,
      48,
    ),
  );
  const creamGeo = merge(cream);
  cream.forEach((g) => g.dispose());
  const creamMat = new THREE.MeshPhysicalMaterial({ color: CREAM, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.28, sheen: 0.3, sheenColor: new THREE.Color('#fff6e6'), sheenRoughness: 0.6 });
  inner.add(new THREE.Mesh(creamGeo, creamMat));

  // ---------- dark: screen surround band, floppy slot, side vents, mouse seam
  const dark: THREE.BufferGeometry[] = [];
  const eS = 2 / 6;
  dark.push(
    parametric(3, 96, (u, v, out) => {
      const phi = v * Math.PI * 2;
      const hw = SCR.hw - 0.25 + u * 1.15;
      const hh = SCR.hh - 0.25 + u * 1.15;
      out.set(hw * sgnpow(Math.cos(phi), eS), SCR.cy + hh * sgnpow(Math.sin(phi), eS), MON_FRONT + 0.03);
    }),
  );
  {
    const slot = new THREE.CapsuleGeometry(0.42, 9.2, 4, 12);
    slot.rotateZ(Math.PI / 2);
    dark.push(place(slot, [4.6, 4.7, BASE.d / 2], [0, 0, 0], [1, 1, 0.55]));
    for (let i = 0; i < 3; i++) {
      const v = new THREE.CapsuleGeometry(0.32, 6, 4, 10);
      v.rotateX(Math.PI / 2);
      dark.push(place(v, [BASE.w / 2, 2.4 + i * 1.25, 6], [0, 0, 0], [0.55, 1, 1]));
    }
    // monitor side vents
    for (let i = 0; i < 4; i++) {
      const v = new THREE.CapsuleGeometry(0.28, 5.2, 4, 10);
      v.rotateX(Math.PI / 2);
      dark.push(place(v, [12.0 - 0.2, 25 - i * 1.2, -9.5], [0, 0, 0], [0.55, 1, 1]));
      const v2 = v.clone();
      dark.push(place(v2, [-12.0 + 0.2, 25 - i * 1.2, -9.5], [0, 0, 0], [0.55, 1, 1]));
    }
  }
  {
    const m = new THREE.Matrix4().makeRotationY(MOUSE.yaw).setPosition(MOUSE.x, 0, MOUSE.z);
    const pts = [
      [0, 1.1, 4.35],
      [0, 2.26, 3.38],
      [0, 2.8, 1.9],
      [0, 2.94, 0.55],
    ].map(([x, y, z]) => new THREE.Vector3(x, y + 0.03, z).applyMatrix4(m));
    dark.push(cable(pts, 0.06, 16));
  }
  const darkGeo = merge(dark);
  dark.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(darkGeo, new THREE.MeshPhysicalMaterial({ color: '#2b2926', roughness: 0.5, clearcoat: 0.3 })));

  // ---------- buttons: yellow square, power button with an orange eye, floppy eject, monitor knob, LED
  const btn: THREE.BufferGeometry[] = [];
  const fz = BASE.d / 2;
  btn.push(tint(place(new RoundedBoxGeometry(2.1, 2.1, 0.9, 3, 0.35), [-12.6, 3.7, fz]), '#ffc21a'));
  btn.push(tint(place(new THREE.CylinderGeometry(1.05, 1.1, 0.8, 32), [-9.4, 3.7, fz], [Math.PI / 2, 0, 0]), '#f6f1e6'));
  btn.push(tint(place(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 24), [-9.4, 3.7, fz + 0.06], [Math.PI / 2, 0, 0]), '#ff7a1a'));
  btn.push(tint(place(new RoundedBoxGeometry(1.5, 0.75, 0.7, 2, 0.25), [8.9, 3.3, fz]), '#d8d0bf'));
  btn.push(tint(place(new THREE.SphereGeometry(0.28, 12, 8), [-6.9, 3.7, fz + 0.05]), '#46e08c'));
  {
    const knob = lathe(
      [
        [0.95, 0],
        [0.95, 0.5],
        [0.75, 0.72],
        [0, 0.76],
      ],
      { segments: 32 },
    );
    knob.rotateX(Math.PI / 2);
    btn.push(tint(place(knob, [10.7, 11.4, MON_FRONT - 0.1]), '#ffb21a'));
  }
  const btnGeo = merge(btn);
  btn.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(btnGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 })));

  // ---------- keycaps: 2 x 4 big tapered caps
  const kw = 5.0;
  const kh = 1.5;
  const kd = 4.0;
  const cap = new RoundedBoxGeometry(kw, kh, kd, 3, 0.6);
  {
    const pos = cap.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const f = 1 - 0.1 * THREE.MathUtils.clamp((pos.getY(i) + kh / 2) / kh, 0, 1);
      pos.setX(i, pos.getX(i) * f);
      pos.setZ(i, pos.getZ(i) * f);
      // a soft dish in the top
      if (pos.getY(i) > kh / 2 - 0.01) pos.setY(i, pos.getY(i) - 0.12 * (1 - (pos.getX(i) / (kw / 2)) ** 2) * (1 - (pos.getZ(i) / (kd / 2)) ** 2));
    }
    pos.needsUpdate = true;
    cap.computeVertexNormals();
  }
  const keys = new THREE.InstancedMesh(cap, new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.18 }), 8);
  const keyCols = ['#f3eee3', '#ece5d6', '#f3eee3', '#e6dfcf', '#ece5d6', '#f3eee3', '#e6dfcf', '#d7ff3a'];
  const rk = rng(4);
  const mtx = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  const col = new THREE.Color();
  for (let i = 0; i < 8; i++) {
    const row = Math.floor(i / 4);
    const k = i % 4;
    qq.setFromEuler(new THREE.Euler(0, (rk() - 0.5) * 0.05, 0));
    mtx.compose(new THREE.Vector3(-8.55 + k * 5.7, KB.h + kh / 2 - 0.05, KB.cz - 2.4 + row * 4.8), qq, new THREE.Vector3(1, 1, 1));
    keys.setMatrixAt(i, mtx);
    keys.setColorAt(i, col.set(keyCols[i]));
  }
  keys.instanceMatrix.needsUpdate = true;
  if (keys.instanceColor) keys.instanceColor.needsUpdate = true;
  keys.computeBoundingSphere();
  inner.add(keys);

  // ---------- screen
  const screenSurf = new Surface(800, 600, bctx, { density: 1 });
  const screenTex = canvasTexture(screenSurf.color.canvas, bctx, true);
  const scr: ScreenState = { surf: screenSurf, tex: screenTex, frame: -1 };
  drawScreen(scr, 0);
  const screenGeo = superDisc(
    SCR.hw,
    SCR.hh,
    6,
    (x, y) => {
      const qx = x / SCR.hw;
      const qy = (y - SCR.cy) / SCR.hh;
      return MON_FRONT + 0.05 + 0.34 * Math.max(0, 1 - qx * qx) * Math.max(0, 1 - qy * qy);
    },
    { cy: SCR.cy, nr: 10, nphi: 80 },
  );
  inner.add(
    new THREE.Mesh(
      screenGeo,
      new THREE.MeshPhysicalMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: screenTex, emissiveIntensity: 1.05, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    ),
  );

  // ---------- stickers
  const sheet = new StickerSheet(1024, 768, bctx, 14);
  const cells = paintStickers(sheet);
  const sheetTex = sheet.surf.colorTexture();
  // monitor's front-top edge: front face -> quarter round (r) -> top; a = x, b = arc length from y = top - r
  const edgeR = MON.r;
  const edge = (a: number, b: number): SurfacePoint => {
    const yEdge = MON_TOP - edgeR;
    const zEdge = MON_FRONT - edgeR;
    const arc = (Math.PI / 2) * edgeR;
    if (b <= 0) return { p: new THREE.Vector3(a, yEdge + b, MON_FRONT), n: new THREE.Vector3(0, 0, 1) };
    if (b >= arc) return { p: new THREE.Vector3(a, MON_TOP, zEdge - (b - arc)), n: new THREE.Vector3(0, 1, 0) };
    const th = b / edgeR;
    const n = new THREE.Vector3(0, Math.sin(th), Math.cos(th));
    return { p: new THREE.Vector3(a, yEdge + edgeR * Math.sin(th), zEdge + edgeR * Math.cos(th)), n };
  };
  const monRight = surfaces.plane(new THREE.Vector3(MON.w / 2 + 0.01, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
  const baseFront = surfaces.plane(new THREE.Vector3(0, 0, BASE.d / 2 + 0.01), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const baseRight = surfaces.plane(new THREE.Vector3(BASE.w / 2 + 0.01, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
  const baseTop = surfaces.plane(new THREE.Vector3(0, BASE.h + 0.01, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1));
  const humpBack = surfaces.plane(new THREE.Vector3(0, 0, -14.5 - 0.01), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
  const geos = [
    stickerPatch(edge, -1.2, 2.3, 10.4, 4.45, -4 * DEG, cells.cGood.uv, { nx: 12, ny: 10, offset: 0.03 }),
    stickerPatch(monRight, 0.6, 21, 5.4, 7.4, 6 * DEG, cells.cChili.uv, { nx: 4, ny: 4, offset: 0 }),
    stickerPatch(baseFront, -2.2, 3.6, 6.6, 4.85, -5 * DEG, cells.cRelax.uv, { nx: 4, ny: 4, offset: 0 }),
    stickerPatch(baseRight, -3.2, 3.6, 6.2, 2.5, 4 * DEG, cells.cZeros.uv, {
      nx: 8,
      ny: 4,
      offset: 0,
      lift: (u, v) => 0.9 * Math.pow(THREE.MathUtils.smoothstep(u + (1 - v) * 0.25, 0.85, 1.25), 2),
    }),
    stickerPatch(baseTop, -9.4, -10.2, 8.4, 3.3, 8 * DEG, cells.cLight.uv, { nx: 4, ny: 4, offset: 0 }),
    stickerPatch(humpBack, 2.5, 18.5, 5.4, 5.4, -12 * DEG, cells.cShip.uv, { nx: 4, ny: 4, offset: 0 }),
  ];
  const stickersGeo = merge(geos);
  geos.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.42, clearcoat: 0.55 }), '#f3efe6')));

  const update = (t: number) => drawScreen(scr, Math.floor(t * 6) % 4);
  return finish(inner, trash, update, 'relax-station');
}

export const desktop: LibraryDef = {
  kind: 'desktop',
  name: 'Relax Station',
  tagline: 'boot, relax, design',
  category: 'tech',
  defaultRotation: [0.34, -0.5, 0.0],
  build,
};
export default desktop;
