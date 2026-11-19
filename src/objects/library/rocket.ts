import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet, grey } from '../textures';
import { Trash, finish } from '../build';
import { lathe, fillet, merge, stickerPatch, surfaces, type P2 } from '../geometry';
import { chrome, glossyPlastic, stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, text, arcText, smallPrint, sticker, ribbonPath, circlePath, fillPath, smiley, starPath, grain, hexA, font, type C2D } from '../paint';
import { inCell } from './_founder';

/*
 * LAUNCH DAY: a chunky cream toy rocket with a hot pink ogive nose and fins, a lime
 * "ZEROS AEROSPACE" band, a checker ring, a chrome porthole with a tiny founder inside,
 * stickers wrapped round the body and a flickering candy flame. Units ~ 10 cm.
 */

const RB = 0.56;
const Y_BOT = -1.2;
const Y_CYL0 = -0.66;
const Y_CYL1 = 0.92;
const NOSE_L = 1.34;
const PORT = { y: 0.5, r: 0.19 };

const CREAM = '#f6f0e4';
const PINK = '#ff4fb8';
const PINK_DEEP = '#e63598';
const LIME = '#d7ff3a';
const INK = '#141016';
const NAVY = '#16205a';

// ------------------------------------------------------------------ profile

function bodyProfile(): P2[] {
  const raw: P2[] = [
    [0, Y_BOT],
    [0.27, Y_BOT],
    [0.32, Y_BOT + 0.04],
    [0.47, -0.95],
    [RB, Y_CYL0],
    [RB, Y_CYL1],
  ];
  const radii = [0, 0.03, 0.03, 0.14, 0.22, 0];
  const pts = fillet(raw, radii, 6);
  // tangent ogive nose with a softly rounded tip
  const rho = (RB * RB + NOSE_L * NOSE_L) / (2 * RB);
  const N = 30;
  let lastY = Y_CYL1;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const x = NOSE_L * (1 - t);
    const r = Math.sqrt(rho * rho - (NOSE_L - x) * (NOSE_L - x)) + RB - rho;
    if (r < 0.085) break;
    lastY = Y_CYL1 + NOSE_L * t;
    pts.push([r, lastY]);
  }
  const r0 = pts[pts.length - 1][0];
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push([r0 * Math.cos(a), lastY + r0 * 0.9 * Math.sin(a)]);
  }
  return pts;
}

/** Arc length along the profile at height y (profile is monotonic in y above the base disc). */
function arcAtY(pts: P2[], y: number): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (b[1] >= y && a[1] <= y && b[1] > a[1]) return acc + seg * ((y - a[1]) / (b[1] - a[1]));
    acc += seg;
  }
  return acc;
}

function totalArc(pts: P2[]): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return acc;
}

// ------------------------------------------------------------------ print

interface Wrap {
  W: number;
  H: number;
  /** px per unit (same both ways on the cylinder). */
  k: number;
  /** Canvas y of a height on the body. */
  Y: (y: number) => number;
  /** Canvas x of an arc position (0 = front, + towards +X). */
  X: (a: number) => number;
}

function paintBody(s: Surface, w: Wrap): void {
  const c = s.c;
  const { W, H, k, Y, X } = w;
  // cream body, pink nose and boat tail
  const g = c.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#e9e1d2');
  g.addColorStop(0.5, CREAM);
  g.addColorStop(1, '#e9e1d2');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.fillStyle = PINK;
  c.fillRect(0, 0, W, Y(Y_CYL1));
  c.fillRect(0, Y(Y_CYL0 + 0.02), W, H - Y(Y_CYL0 + 0.02));
  const ng = c.createLinearGradient(0, 0, 0, Y(Y_CYL1));
  ng.addColorStop(0, 'rgba(255,255,255,0.18)');
  ng.addColorStop(1, 'rgba(160,0,90,0.12)');
  c.fillStyle = ng;
  c.fillRect(0, 0, W, Y(Y_CYL1));
  // white pinstripe at the nose joint
  c.fillStyle = '#ffffff';
  c.fillRect(0, Y(Y_CYL1) - 0.012 * k, W, 0.024 * k);

  // lime band with ring text
  const b0 = Y(0.9);
  const b1 = Y(0.75);
  c.fillStyle = LIME;
  c.fillRect(0, b0, W, b1 - b0);
  {
    const str = 'ZEROS AEROSPACE ✦ T-MINUS ZERO ✦ ';
    c.save();
    c.font = font(0.075 * k, FONTS.archivoBlack);
    c.fillStyle = INK;
    c.textBaseline = 'middle';
    const tw = c.measureText(str).width;
    const n = Math.max(1, Math.round(W / tw));
    const sx = W / (n * tw);
    c.translate(0, (b0 + b1) / 2 + 0.004 * k);
    c.scale(sx, 1);
    for (let i = 0; i <= n; i++) c.fillText(str, i * tw, 0);
    c.restore();
  }
  // checker ring
  {
    const y0 = Y(-0.42);
    const y1 = Y(-0.56);
    const rows = 2;
    const cols = 48;
    const cw = W / cols;
    const ch = (y1 - y0) / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      c.fillStyle = (i + j) % 2 ? INK : CREAM;
      c.fillRect(i * cw, y0 + j * ch, cw + 0.5, ch + 0.5);
    }
  }
  // panel seams (rings + verticals in line with the fins) with rivets
  const seamRings = [0.33, -0.12];
  const seamCols = [-135, -45, 45, 135].map((d) => X(((d * DEG) * RB)));
  c.fillStyle = 'rgba(70,55,40,0.32)';
  for (const sy of seamRings) c.fillRect(0, Y(sy) - 2, W, 4);
  for (const sx of seamCols) c.fillRect(sx - 2, Y(0.74), 4, Y(-0.4) - Y(0.74));
  const rivets: [number, number][] = [];
  for (const sy of seamRings) for (let x = 12; x < W; x += 0.075 * k) rivets.push([x, Y(sy) + 0.03 * k]);
  for (const sx of seamCols) for (let y = Y(0.7); y < Y(-0.36); y += 0.075 * k) rivets.push([sx + 0.03 * k, y]);
  c.fillStyle = 'rgba(120,100,80,0.45)';
  c.beginPath();
  for (const [x, y] of rivets) {
    c.moveTo(x + 0.011 * k, y);
    c.arc(x, y, 0.011 * k, 0, Math.PI * 2);
  }
  c.fill();
  s.bumpDraw((b) => {
    b.fillStyle = grey(0.25);
    for (const sy of seamRings) b.fillRect(0, Y(sy) - 3, W, 6);
    for (const sx of seamCols) b.fillRect(sx - 3, Y(0.74), 6, Y(-0.4) - Y(0.74));
    b.fillRect(0, Y(Y_CYL1) - 3, W, 6);
    b.fillStyle = grey(0.85);
    b.beginPath();
    for (const [x, y] of rivets) {
      b.moveTo(x + 0.012 * k, y);
      b.arc(x, y, 0.012 * k, 0, Math.PI * 2);
    }
    b.fill();
  });

  // porthole interior: deep space with a tiny founder
  {
    const px = X(0);
    const py = Y(PORT.y);
    const rr = PORT.r * k;
    const sg = c.createRadialGradient(px - rr * 0.3, py - rr * 0.3, rr * 0.1, px, py, rr);
    sg.addColorStop(0, '#2a3a9a');
    sg.addColorStop(1, '#0b0f33');
    fillPath(c, circlePath(px, py, rr), sg);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const d = rr * (0.45 + 0.4 * ((i * 37) % 10) / 10);
      fillPath(c, starPath(px + Math.cos(a) * d, py + Math.sin(a) * d, 0.012 * k, 0.004 * k, 4, 0), '#fff8d0');
    }
    // helmet + smiley face
    fillPath(c, circlePath(px, py + rr * 0.12, rr * 0.5), 'rgba(220,235,255,0.9)');
    smiley(c, px, py + rr * 0.14, rr * 0.36, '#ffd21f', INK);
    s.maskPath(circlePath(px, py, rr), 0.55, 0);
  }

  // ---------- wrapped stickers (painted, with die-cut borders and shadows)
  // LAUNCH DAY banner under the porthole
  sticker(s, X(0), Y(0.07), -3 * DEG, ribbonPath(-0.42 * k, -0.1 * k, 0.84 * k, 0.2 * k, 0.07 * k), { border: 0.018 * k, fill: LIME, shadow: 0.7, rough: 0.35 }, (q) => {
    text(q, 'LAUNCH DAY', 0, 0.042 * k, { size: 0.12 * k, family: FONTS.archivoBlack, align: 'center', color: INK, maxWidth: 0.62 * k });
  });
  // mission patch, right of the porthole
  sticker(s, X(0.4), Y(0.5), 8 * DEG, circlePath(0, 0, 0.165 * k), { border: 0.012 * k, borderColor: '#f2c94c', fill: NAVY, shadow: 0.6, rough: 0.7 }, (q) => {
    q.save();
    q.strokeStyle = '#f2c94c';
    q.lineWidth = 0.006 * k;
    q.setLineDash([0.012 * k, 0.008 * k]);
    q.beginPath();
    q.arc(0, 0, 0.148 * k, 0, Math.PI * 2);
    q.stroke();
    q.restore();
    arcText(q, 'ZEROS AEROSPACE', 0, 0, 0.118 * k, -Math.PI / 2, { size: 0.03 * k, family: FONTS.archivoBlack, color: '#f2c94c', tracking: 0.003 * k });
    arcText(q, 'MISSION 0', 0, 0, 0.128 * k, Math.PI / 2, { size: 0.03 * k, family: FONTS.archivoBlack, color: '#ffffff', tracking: 0.003 * k }, true);
    // tiny rocket + orbit
    q.strokeStyle = PINK;
    q.lineWidth = 0.008 * k;
    q.beginPath();
    q.ellipse(0, 0.005 * k, 0.085 * k, 0.035 * k, -0.4, 0, Math.PI * 2);
    q.stroke();
    fillPath(q, (p) => {
      p.moveTo(0, -0.07 * k);
      p.quadraticCurveTo(0.03 * k, -0.03 * k, 0.025 * k, 0.04 * k);
      p.lineTo(-0.025 * k, 0.04 * k);
      p.quadraticCurveTo(-0.03 * k, -0.03 * k, 0, -0.07 * k);
    }, '#ffffff');
    fillPath(q, circlePath(0, -0.015 * k, 0.012 * k), LIME);
  });
  // "ship it" holo-ish star on the left
  sticker(s, X(-0.42), Y(0.36), -12 * DEG, starPath(0, 0, 0.13 * k, 0.075 * k, 8, -Math.PI / 2, 0.5), { border: 0.014 * k, fill: '#ffd21f', shadow: 0.6 }, (q) => {
    text(q, 'SHIP', 0, -0.004 * k, { size: 0.05 * k, family: FONTS.archivoBlack, align: 'center', color: INK });
    text(q, 'IT!', 0, 0.045 * k, { size: 0.05 * k, family: FONTS.archivoBlack, align: 'center', color: INK });
  });
  // back: big vertical wordmark + small print on the left side
  for (const ox of [0, W]) {
    c.save();
    c.translate(X(-Math.PI * RB) + ox, Y(0.08));
    c.rotate(-Math.PI / 2);
    text(c, 'ZEROS', 0, 0.075 * k, { size: 0.24 * k, family: FONTS.bagel, align: 'center', color: PINK, outlines: [{ color: INK, width: 0.016 * k }] });
    c.restore();
  }
  c.save();
  c.translate(X(-Math.PI * RB * 0.5), Y(0.05));
  c.rotate(-Math.PI / 2);
  smallPrint(c, ['DO NOT LAUNCH INDOORS', 'MADE ONCE UPON A TIME', 'FUEL: COFFEE + IDEAS'], 0, -0.05 * k, 0.03 * k, hexA(INK, 0.7), { align: 'center', weight: 700, lineHeight: 0.036 * k });
  c.restore();
  grain(c, 0, 0, W, H, 5000, 0.035, 4);
}

// ------------------------------------------------------------------ parts

function finGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // x = radial distance, y = height
  s.moveTo(0.3, -1.12);
  s.lineTo(0.5, -0.32);
  s.quadraticCurveTo(0.54, -0.2, 0.62, -0.3);
  s.quadraticCurveTo(0.9, -0.62, 1.0, -0.96);
  s.quadraticCurveTo(1.06, -1.18, 1.03, -1.38);
  s.quadraticCurveTo(1.01, -1.47, 0.93, -1.45);
  s.quadraticCurveTo(0.6, -1.32, 0.38, -1.2);
  s.quadraticCurveTo(0.31, -1.17, 0.3, -1.12);
  const t = 0.07;
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 4, curveSegments: 14 });
  g.translate(0, 0, -t / 2);
  return g;
}

function nozzleGeometry(): THREE.BufferGeometry {
  const prof: P2[] = fillet(
    [
      [0, -1.21],
      [0.17, -1.215],
      [0.25, -1.33],
      [0.335, -1.5],
      [0.372, -1.52],
      [0.392, -1.5],
      [0.31, -1.3],
      [0.27, -1.17],
      [0.25, -1.13],
    ],
    [0, 0.04, 0.05, 0.02, 0.012, 0.012, 0.06, 0.03, 0],
    5,
  );
  return lathe(prof, { segments: 56 });
}

function flameGeometry(scale: number, licks: number, seed: number, ramp: [number, string][]): THREE.BufferGeometry {
  const prof: P2[] = [
    [0, -2.5],
    [0.05, -2.38],
    [0.14, -2.12],
    [0.25, -1.82],
    [0.31, -1.58],
    [0.3, -1.42],
    [0.21, -1.3],
    [0, -1.27],
  ];
  const g = lathe(
    fillet(prof, [0, 0.05, 0.12, 0.15, 0.12, 0.08, 0.04, 0], 6),
    {
      segments: 48,
      radial: (phi, _j, p) => {
        const down = THREE.MathUtils.clamp((-1.4 - p[1]) / 1.0, 0, 1);
        return down * 0.06 * Math.sin(phi * licks + seed + p[1] * 5);
      },
    },
  );
  // scale about the nozzle mouth
  g.translate(0, 1.3, 0);
  g.scale(scale, scale * (0.9 + 0.1 * scale), scale);
  g.translate(0, -1.3, 0);
  // colour ramp from the mouth (t = 0) to the tip (t = 1)
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const yTip = -1.3 - 1.2 * scale * (0.9 + 0.1 * scale);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) + 1.3) / (yTip + 1.3), 0, 1);
    let k = 0;
    for (; k < ramp.length - 2 && t > ramp[k + 1][0]; k++);
    const [t0, c0] = ramp[k];
    const [t1, c1] = ramp[k + 1];
    c.set(c0).lerp(new THREE.Color(c1), THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1));
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

/** Bend a geometry built facing +Z (z = height above the surface) onto the cylinder of radius rc. */
function wrapToCylinder(g: THREE.BufferGeometry, rc: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const phi = x / rc;
    const R = rc + z;
    pos.setX(i, R * Math.sin(phi));
    pos.setZ(i, R * Math.cos(phi));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function paintT0(c: C2D): void {
  sticker(c, 0, 0, 0, circlePath(0, 0, 92), { border: 10, fill: PINK, shadow: 0.6 }, (k) => {
    fillPath(k, circlePath(0, 0, 76), PINK_DEEP);
    text(k, 'T-0', 0, 22, { size: 66, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: INK, width: 9 }] });
    text(k, 'GO FOR LAUNCH', 0, 56, { size: 15, family: FONTS.archivoBlack, align: 'center', color: '#ffffff' });
  });
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- body (one lathe, wrapped print)
  const prof = bodyProfile();
  const S = totalArc(prof);
  const C = 2 * Math.PI * RB;
  const TW = 2048;
  const TH = Math.round((TW * S) / C);
  const k = TW / C;
  const wrap: Wrap = {
    W: TW,
    H: TH,
    k,
    Y: (y) => (1 - arcAtY(prof, y) / S) * TH,
    X: (a) => TW * (0.5 + a / C),
  };
  const surf = new Surface(TW, TH, bctx, { mask: { rough: 0.2, metal: 0 }, bump: { base: 0.5, density: 0.5 } });
  paintBody(surf, wrap);
  const mask = surf.maskTexture();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: surf.colorTexture(),
    roughnessMap: mask,
    metalnessMap: mask,
    roughness: 1,
    metalness: 1,
    bumpMap: surf.bumpTexture(),
    bumpScale: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  inner.add(new THREE.Mesh(lathe(prof, { segments: 112 }), bodyMat));

  // ---------- fins (4, at 45 degrees to the print)
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const f = finGeometry();
    // shape x is radial: rotate so the fin's radial axis points at angle phi (from +Z towards +X)
    const phi = (45 + i * 90) * DEG;
    f.rotateY(phi - Math.PI / 2);
    fins.push(f);
  }
  const finGeo = merge(fins);
  fins.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(finGeo, glossyPlastic(PINK, { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 })));

  // ---------- nozzle
  inner.add(
    new THREE.Mesh(
      nozzleGeometry(),
      new THREE.MeshPhysicalMaterial({ color: '#3b3f48', metalness: 1, roughness: 0.32, anisotropy: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.2, side: THREE.DoubleSide }),
    ),
  );

  // ---------- porthole: chrome ring + glass dome, bent onto the body
  const ring = wrapToCylinder(new THREE.TorusGeometry(PORT.r + 0.02, 0.04, 14, 64).translate(0, 0, 0.012), RB);
  ring.translate(0, PORT.y, 0);
  const bolts: THREE.BufferGeometry[] = [ring];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const b = new THREE.SphereGeometry(0.016, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
    b.translate(Math.cos(a) * (PORT.r + 0.075), Math.sin(a) * (PORT.r + 0.075), 0.002);
    const w = wrapToCylinder(b, RB);
    w.translate(0, PORT.y, 0);
    bolts.push(w);
  }
  const chromeGeo = merge(bolts);
  bolts.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(chromeGeo, chrome({ roughness: 0.08 })));
  const dome = new THREE.SphereGeometry(PORT.r + 0.01, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
  dome.scale(1, 1, 0.22);
  wrapToCylinder(dome, RB);
  dome.translate(0, PORT.y, 0);
  inner.add(
    new THREE.Mesh(
      dome,
      new THREE.MeshPhysicalMaterial({ color: '#dff3ff', transparent: true, opacity: 0.2, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false }),
    ),
  );

  // ---------- flame: candy core + translucent outer layers, flickering
  // unlit colour ramps keep the flame candy-bright on dark and light backgrounds alike
  const core = flameGeometry(0.6, 5, 0.5, [
    [0, '#fffef0'],
    [0.6, '#fff3a0'],
    [1, '#ffd23a'],
  ]);
  const mid = flameGeometry(0.88, 6, 1.7, [
    [0, '#fff0a0'],
    [0.35, '#ffc21a'],
    [1, '#ff7a12'],
  ]);
  const outer = flameGeometry(1.16, 7, 3.1, [
    [0, '#ffb31f'],
    [0.45, '#ff6a1a'],
    [1, '#ff2d6e'],
  ]);
  const coreMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const midMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.88, depthWrite: false });
  const outerMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.6, depthWrite: false });
  const flame = new THREE.Group();
  const coreMesh = new THREE.Mesh(core, coreMat);
  const midMesh = new THREE.Mesh(mid, midMat);
  const outerMesh = new THREE.Mesh(outer, outerMat);
  coreMesh.renderOrder = 1;
  midMesh.renderOrder = 2;
  outerMesh.renderOrder = 3;
  flame.add(coreMesh, midMesh, outerMesh);
  // scale the flame from the nozzle mouth
  flame.position.set(0, -1.3, 0);
  for (const m of flame.children) m.position.set(0, 1.3, 0);
  inner.add(flame);

  // ---------- a little exhaust cloud around the flame tip
  {
    const puffs: [number, number, number, number][] = [
      [0.0, -2.5, -0.12, 0.2],
      [0.26, -2.42, 0.02, 0.18],
      [-0.25, -2.42, 0.04, 0.17],
      [0.14, -2.47, 0.2, 0.14],
      [-0.14, -2.5, 0.18, 0.13],
      [0.44, -2.33, -0.06, 0.12],
      [-0.43, -2.32, -0.04, 0.11],
      [0.02, -2.62, 0.06, 0.12],
      [0.3, -2.56, -0.2, 0.1],
    ];
    const geos = puffs.map(([x, y, z, r]) => new THREE.SphereGeometry(r, 24, 14).scale(1, 0.86, 1).translate(x, y, z));
    const cloud = merge(geos);
    geos.forEach((g) => g.dispose());
    inner.add(
      new THREE.Mesh(
        cloud,
        new THREE.MeshPhysicalMaterial({ color: '#fff8f2', roughness: 0.75, sheen: 1, sheenColor: new THREE.Color('#ffd6c2'), sheenRoughness: 0.5, emissive: '#ff9a5a', emissiveIntensity: 0.12 }),
      ),
    );
  }

  // ---------- peeling T-0 sticker (3D, front-right, between the banner and the checker ring)
  const sheet = new StickerSheet(256, 256, bctx, 12);
  const cT0 = sheet.alloc(200, 200);
  inCell(sheet, cT0, paintT0);
  const t0 = stickerPatch(surfaces.cylinder(RB), 0.3, -0.24, 0.24, 0.24, -12 * DEG, cT0.uv, {
    nx: 10,
    ny: 10,
    offset: 0.006,
    lift: (u, v) => 0.05 * Math.pow(THREE.MathUtils.smoothstep(u, 0.6, 1) * THREE.MathUtils.smoothstep(1 - v, 0.4, 1), 2),
  });
  inner.add(new THREE.Mesh(t0, paperBackfaces(stickerSheet(sheet.surf.colorTexture(), { roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1 }), '#f3efe6')));

  // ---------- animation: flame flicker
  const update = (t: number) => {
    const f1 = 1 + 0.07 * Math.sin(t * 23.0) + 0.05 * Math.sin(t * 37.0 + 1.3);
    flame.scale.set(1 + 0.03 * Math.sin(t * 31), f1, 1 + 0.03 * Math.cos(t * 27));
    outerMesh.rotation.y = t * 1.7;
    midMesh.rotation.y = -t * 2.3;
    outerMat.opacity = 0.56 + 0.08 * Math.sin(t * 19);
  };
  update(0);

  return finish(inner, trash, update, 'launch-day');
}

export const rocket: LibraryDef = {
  kind: 'rocket',
  name: 'Launch Day',
  tagline: 't-minus zero',
  category: 'founder',
  defaultRotation: [0.12, -0.3, -0.52],
  build,
};
export default rocket;
