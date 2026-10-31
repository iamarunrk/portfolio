import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { lathe, parametric, type P2 } from '../geometry';
import { stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, rng, text, sticker, circlePath, ellipsePath, fillPath, smallPrint, grain, type C2D } from '../paint';
import { valueNoise3, fbm, warp, sweep, capped, toothpick, flag, mergeSimple, inCell, woodMaterial, instanced, alongDir } from './_food';

/*
 * FULL-STACK BURGER: every layer, shipped. Toasted bottom bun, a craggy charred patty,
 * an orange cheese slice melting over its corners, tomato, crinkle-cut pickles, ruffled
 * lettuce, ketchup drips and a glossy domed sesame bun, skewered by a "FULL STACK" flag
 * whose back lists the stack. Centimetres, Y up, normalised afterwards.
 */

const BOT_TOP = 2.1; // bottom bun cut face
const PATTY_Y0 = BOT_TOP;
const PATTY_Y1 = 4.0;
const CHEESE_Y = PATTY_Y1;
const PICKLE_Y = 4.18;
const TOMATO_Y = 4.36;
const LETTUCE_Y = 5.0;
const SAUCE_Y = 5.42;
const BUN_Y0 = 5.52; // top bun base
const BUN_TOP = BUN_Y0 + 0.7 + 3.55;
const BUN_R = 5.5;

// atlas layout (design px)
const BUN_W = 1024;
const BUN_H = 1024;
const TOP_ROWS = 640; // top bun: rows 0..640 (apex at row 0)
const BOT_ROW0 = 672; // bottom bun: rows 672..1024 (cut face at row 672)
const FILL = 1024; // fillings atlas size
const R_PATTY: [number, number, number, number] = [0, 0, 512, 512];
const R_TOMATO: [number, number, number, number] = [512, 0, 512, 512];
const R_LETTUCE: [number, number, number, number] = [0, 512, 512, 256];
const R_PICKLE: [number, number, number, number] = [512, 512, 256, 256];

/** Map a local 0..1 coordinate inside an atlas rect (x right, y down, design px) to texture UV. */
function rectUV(rect: [number, number, number, number], size: number, u: number, v: number): [number, number] {
  return [(rect[0] + u * rect[2]) / size, 1 - (rect[1] + v * rect[3]) / size];
}

// ------------------------------------------------------------------ profiles

function quarter(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

function topBunProfile(): P2[] {
  const y0 = BUN_Y0;
  const pts: P2[] = [];
  for (let r = 0; r < 4.6; r += 0.6) pts.push([r, y0]);
  pts.push(...quarter(4.7, y0 + 0.7, BUN_R - 4.7, 0.7, -Math.PI / 2, 0, 10));
  for (let i = 1; i <= 30; i++) {
    const t = (i / 30) * (Math.PI / 2);
    pts.push([BUN_R * Math.pow(Math.cos(t), 0.7), y0 + 0.7 + 3.55 * Math.pow(Math.sin(t), 1.05)]);
  }
  return pts;
}

function bottomBunProfile(): P2[] {
  const pts: P2[] = [];
  for (let r = 0; r < 4.3; r += 0.6) pts.push([r, 0]);
  pts.push(...quarter(4.4, 0.75, 0.95, 0.75, -Math.PI / 2, 0, 9));
  pts.push(...quarter(4.95, 1.45, 0.4, 0.65, 0, Math.PI / 2, 8).slice(1));
  for (let r = 4.6; r > 0.01; r -= 0.6) pts.push([r, BOT_TOP]);
  pts.push([0, BOT_TOP]);
  return pts;
}

function pattyProfile(): P2[] {
  const pts: P2[] = [];
  for (let r = 0; r < 5.0; r += 0.7) pts.push([r, PATTY_Y0]);
  pts.push(...quarter(5.0, (PATTY_Y0 + PATTY_Y1) / 2, 0.85, (PATTY_Y1 - PATTY_Y0) / 2, -Math.PI / 2, Math.PI / 2, 18));
  for (let r = 4.9; r > 0.01; r -= 0.7) pts.push([r, PATTY_Y1]);
  pts.push([0, PATTY_Y1]);
  return pts;
}

// ------------------------------------------------------------------ paint

function paintBun(s: Surface): void {
  const c = s.c;
  const r = rng(808);
  // --- top bun: apex (row 0) dark golden -> pale band near the base -> crumb underside
  const g = c.createLinearGradient(0, 0, 0, TOP_ROWS);
  g.addColorStop(0, '#9a4d1b');
  g.addColorStop(0.3, '#b05e1f');
  g.addColorStop(0.55, '#c77830');
  g.addColorStop(0.72, '#db984a');
  g.addColorStop(0.81, '#ecc283');
  g.addColorStop(0.9, '#f4dcaa');
  g.addColorStop(1, '#f1ddb2');
  c.fillStyle = g;
  c.fillRect(0, 0, BUN_W, TOP_ROWS);
  // glaze mottling
  for (let i = 0; i < 220; i++) {
    const px = r() * BUN_W;
    const py = r() * TOP_ROWS * 0.8;
    const rad = 8 + r() * 36;
    const gg = c.createRadialGradient(px, py, 0, px, py, rad);
    const dark = r() > 0.55;
    gg.addColorStop(0, dark ? 'rgba(120,52,14,0.28)' : 'rgba(255,214,150,0.22)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gg;
    c.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  // --- bottom bun: cut face (row 672) toasted, side golden, base pale
  const y0 = BOT_ROW0;
  const g2 = c.createLinearGradient(0, y0, 0, BUN_H);
  g2.addColorStop(0, '#c98a3e');
  g2.addColorStop(0.18, '#d99a4f');
  g2.addColorStop(0.42, '#ecc684');
  g2.addColorStop(0.68, '#d6913f');
  g2.addColorStop(0.92, '#cf8a3a');
  g2.addColorStop(1, '#e2b06a');
  c.fillStyle = g2;
  c.fillRect(0, y0 - 16, BUN_W, BUN_H - y0 + 16);
  // bake mottling on the lower bun's side
  for (let i = 0; i < 160; i++) {
    const px = r() * BUN_W;
    const py = y0 + r() * (BUN_H - y0);
    fillPath(c, ellipsePath(px, py, 4 + r() * 16, 2 + r() * 6, r()), r() > 0.5 ? 'rgba(140,72,20,0.25)' : 'rgba(255,225,170,0.25)');
  }
  // pores and flecks everywhere
  for (let i = 0; i < 3200; i++) {
    const px = r() * BUN_W;
    const py = r() * BUN_H;
    c.fillStyle = r() > 0.5 ? 'rgba(255,240,210,0.35)' : 'rgba(110,50,15,0.25)';
    c.fillRect(px, py, 1 + r() * 2, 1 + r() * 2);
  }
  s.bumpDraw((b) => {
    for (let i = 0; i < 2600; i++) {
      const px = r() * BUN_W;
      const py = r() * BUN_H;
      const cut = py > TOP_ROWS * 0.93 && py < TOP_ROWS;
      b.fillStyle = cut ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.12)';
      b.beginPath();
      b.arc(px, py, cut ? 1.5 + r() * 3.5 : 1 + r() * 2, 0, Math.PI * 2);
      b.fill();
    }
  });
  // the flat undersides map onto a single row each (UVs by height): keep those rows plain
  c.fillStyle = '#f1dcb0';
  c.fillRect(0, TOP_ROWS - 14, BUN_W, 22);
  c.fillStyle = '#e0ad66';
  c.fillRect(0, BUN_H - 14, BUN_W, 14);
  s.bumpDraw((b) => {
    b.fillStyle = 'rgb(128,128,128)';
    b.fillRect(0, TOP_ROWS - 14, BUN_W, 22);
    b.fillRect(0, BUN_H - 14, BUN_W, 14);
  });
}

function paintFillings(s: Surface): void {
  const c = s.c;
  const r = rng(515);
  // --- patty: craggy browns with char and a few fat flecks
  {
    const [x0, y0, w, h] = R_PATTY;
    c.fillStyle = '#5b2f16';
    c.fillRect(x0, y0, w, h);
    for (let i = 0; i < 900; i++) {
      const px = x0 + r() * w;
      const py = y0 + r() * h;
      const rad = 2 + r() * 9;
      const t = r();
      c.fillStyle = t > 0.8 ? 'rgba(30,14,6,0.8)' : t > 0.45 ? 'rgba(130,72,34,0.7)' : t > 0.12 ? 'rgba(92,48,22,0.75)' : 'rgba(205,140,90,0.6)';
      c.beginPath();
      c.ellipse(px, py, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    s.bumpDraw((b) => {
      b.fillStyle = 'rgb(128,128,128)';
      b.fillRect(x0, y0, w, h);
      for (let i = 0; i < 1400; i++) {
        const px = x0 + r() * w;
        const py = y0 + r() * h;
        const v = r() > 0.5 ? 235 : 30;
        b.fillStyle = `rgba(${v},${v},${v},0.55)`;
        b.beginPath();
        b.arc(px, py, 1.5 + r() * 6, 0, Math.PI * 2);
        b.fill();
      }
    });
  }
  // --- tomato cross-section (planar): skin ring, flesh, seed chambers
  {
    const [x0, y0, w] = R_TOMATO;
    const cx = x0 + w / 2;
    const cy = y0 + w / 2;
    const R0 = w / 2;
    c.fillStyle = '#c81f12';
    c.fillRect(x0, y0, w, w);
    fillPath(c, circlePath(cx, cy, R0 * 0.93), '#e8402a');
    const gf = c.createRadialGradient(cx, cy, 0, cx, cy, R0 * 0.9);
    gf.addColorStop(0, '#ff8a6a');
    gf.addColorStop(0.5, '#f25236');
    gf.addColorStop(1, '#e33a24');
    fillPath(c, circlePath(cx, cy, R0 * 0.9), gf);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const ox = cx + Math.cos(a) * R0 * 0.48;
      const oy = cy + Math.sin(a) * R0 * 0.48;
      c.save();
      c.translate(ox, oy);
      c.rotate(a);
      fillPath(c, ellipsePath(0, 0, R0 * 0.27, R0 * 0.2, 0), 'rgba(255,170,90,0.85)');
      fillPath(c, ellipsePath(0, 0, R0 * 0.22, R0 * 0.15, 0), 'rgba(255,196,120,0.9)');
      for (let j = 0; j < 7; j++) fillPath(c, ellipsePath((r() - 0.5) * R0 * 0.3, (r() - 0.5) * R0 * 0.18, 5, 3, r() * 3), '#f7e7a4');
      c.restore();
    }
    fillPath(c, circlePath(cx, cy, R0 * 0.16), 'rgba(255,190,170,0.9)');
    c.strokeStyle = 'rgba(255,150,120,0.6)';
    c.lineWidth = 6;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3 + Math.PI / 5;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R0 * 0.16, cy + Math.sin(a) * R0 * 0.16);
      c.lineTo(cx + Math.cos(a) * R0 * 0.86, cy + Math.sin(a) * R0 * 0.86);
      c.stroke();
    }
  }
  // --- lettuce: u around, v from the centre (top of the rect) to the frilly edge (bottom)
  {
    const [x0, y0, w, h] = R_LETTUCE;
    const g = c.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, '#d9f0a2');
    g.addColorStop(0.45, '#8ed25a');
    g.addColorStop(0.8, '#55b23a');
    g.addColorStop(1, '#3e9a2c');
    c.fillStyle = g;
    c.fillRect(x0, y0, w, h);
    c.strokeStyle = 'rgba(235,255,210,0.6)';
    c.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const x = x0 + r() * w;
      c.lineWidth = 2 + r() * 4;
      c.beginPath();
      c.moveTo(x, y0);
      c.bezierCurveTo(x + (r() - 0.5) * 30, y0 + h * 0.4, x + (r() - 0.5) * 40, y0 + h * 0.7, x + (r() - 0.5) * 50, y0 + h);
      c.stroke();
    }
  }
  // --- pickle slice (planar): dark green skin, pale ring, seeds
  {
    const [x0, y0, w] = R_PICKLE;
    const cx = x0 + w / 2;
    const cy = y0 + w / 2;
    c.fillStyle = '#2f6d1f';
    c.fillRect(x0, y0, w, w);
    fillPath(c, circlePath(cx, cy, w * 0.43), '#8fbf4a');
    fillPath(c, circlePath(cx, cy, w * 0.36), '#b9d867');
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      fillPath(c, ellipsePath(cx + Math.cos(a) * w * 0.17, cy + Math.sin(a) * w * 0.17, 7, 4, a), '#e6efb0');
    }
  }
  grain(c, 0, 0, FILL, FILL, 6000, 0.06, 13);
}

function paintFlag(c: C2D, w: number, h: number, front: boolean): void {
  const x0 = -w / 2;
  const y0 = -h / 2;
  c.fillStyle = '#0b0b0d';
  c.fillRect(x0, y0, w, h);
  c.fillStyle = '#ff4fb8';
  c.fillRect(front ? x0 : x0 + w - 56, y0, 56, h);
  const cx = front ? x0 + 56 + (w - 56) * 0.44 : x0 + (w - 56) * 0.48;
  if (front) {
    text(c, 'FULL', cx - 20, -30, { size: 112, family: FONTS.bagel, align: 'center', color: '#d7ff3a', maxWidth: (w - 56) * 0.72 });
    text(c, 'STACK', cx - 20, 86, { size: 112, family: FONTS.bagel, align: 'center', color: '#d7ff3a', maxWidth: (w - 56) * 0.72 });
    smallPrint(c, ['EVERY LAYER, SHIPPED'], cx - 20, 108, 24, '#ffffff', { align: 'center', weight: 700 });
    // a 'v1.0 shipped' sticker slapped on the corner of the flag
    sticker(c, x0 + w - 118, y0 + 92, -14 * DEG, circlePath(0, 0, 62), { border: 7, fill: '#ff4fb8', shadow: 0.8 }, (k) => {
      text(k, 'v1.0', 0, -2, { size: 38, family: FONTS.bagel, align: 'center', color: '#ffffff', maxWidth: 100 });
      smallPrint(k, ['SHIPPED'], 0, 8, 17, '#0b0b0d', { align: 'center', weight: 700, family: FONTS.archivoBlack });
    });
  } else {
    const rows: [string, string][] = [
      ['bun', 'UI'],
      ['lettuce', 'frontend'],
      ['cheese', 'API'],
      ['patty', 'database'],
      ['bun', 'infra'],
    ];
    text(c, 'THE STACK', cx, y0 + 64, { size: 46, family: FONTS.archivoBlack, align: 'center', color: '#d7ff3a', maxWidth: (w - 56) * 0.8 });
    rows.forEach(([a, b], i) => {
      const y = y0 + 112 + i * 52;
      c.font = `700 30px ${FONTS.spaceMono}`;
      c.textBaseline = 'middle';
      c.fillStyle = '#ffffff';
      c.textAlign = 'left';
      c.fillText(a, x0 + 40, y);
      c.textAlign = 'right';
      c.fillStyle = '#ff4fb8';
      c.fillText(b, x0 + w - 56 - 70, y);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(x0 + 40, y + 20, w - 56 - 110, 2);
    });
  }
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  const rand = rng(2024);

  // ---------- buns (one atlas)
  const bun = new Surface(BUN_W, BUN_H, bctx, { bump: { base: 0.5, density: 0.5 } });
  paintBun(bun);
  // v by height: apex -> row 0, top-bun base -> row TOP_ROWS; bottom bun base -> last row, cut face -> BOT_ROW0
  const topGeo = lathe(topBunProfile(), { segments: 72, uv: (_x, y, _z, u) => [u, 1 - (TOP_ROWS * (1 - (y - BUN_Y0) / (BUN_TOP - BUN_Y0)) - 2) / BUN_H] });
  const botGeo = lathe(bottomBunProfile(), { segments: 72, uv: (_x, y, _z, u) => [u, 1 - (BUN_H - 2 - (y / BOT_TOP) * (BUN_H - 2 - BOT_ROW0)) / BUN_H] });
  const bunNoise = valueNoise3(31);
  const lumpy = (amp: number) => (p: THREE.Vector3) => {
    const r = Math.hypot(p.x, p.z) || 1;
    const k = 1 + (amp * fbm(bunNoise, p.x * 0.35, p.y * 0.35, p.z * 0.35, 2)) / r;
    p.x *= k;
    p.z *= k;
  };
  warp(topGeo, lumpy(0.12));
  warp(botGeo, lumpy(0.08));
  const bunGeo = mergeSimple([topGeo, botGeo]);
  topGeo.dispose();
  botGeo.dispose();
  const bunMat = new THREE.MeshPhysicalMaterial({
    map: bun.colorTexture(),
    bumpMap: bun.bumpTexture(),
    bumpScale: 1.2,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
    sheen: 0.35,
    sheenColor: new THREE.Color('#ffd7a0'),
    sheenRoughness: 0.5,
  });
  inner.add(new THREE.Mesh(bunGeo, bunMat));

  // ---------- sesame seeds on the dome
  {
    const seed = new THREE.SphereGeometry(1, 10, 6);
    seed.scale(0.3, 0.09, 0.17);
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const qs = new THREE.Quaternion();
    const tries = 400;
    const placed: THREE.Vector3[] = [];
    const latMin = 0.32;
    for (let i = 0; i < tries && placed.length < 74; i++) {
      // uniform over the dome cap (sin(latitude) uniform)
      const tt = Math.asin(Math.sin(latMin) + rand() * (1 - Math.sin(latMin)) * 0.985);
      const phi = rand() * Math.PI * 2;
      const rr = BUN_R * Math.pow(Math.cos(tt), 0.7);
      const y = BUN_Y0 + 0.7 + 3.55 * Math.pow(Math.sin(tt), 1.05);
      if (y < BUN_Y0 + 1.6) continue;
      const p = new THREE.Vector3(rr * Math.sin(phi), y, rr * Math.cos(phi));
      if (placed.some((o) => o.distanceTo(p) < 0.7)) continue;
      placed.push(p);
      // normal from the profile derivative
      const e = 0.01;
      const tt2 = Math.min(Math.PI / 2, tt + e);
      const r2 = BUN_R * Math.pow(Math.cos(tt2), 0.7);
      const y2 = BUN_Y0 + 0.7 + 3.55 * Math.pow(Math.sin(tt2), 1.05);
      const tan = new THREE.Vector2(r2 - rr, y2 - y).normalize();
      const n = new THREE.Vector3(tan.y * Math.sin(phi), -tan.x, tan.y * Math.cos(phi)).normalize();
      if (n.y < 0) n.negate();
      q.setFromUnitVectors(up, n);
      qs.setFromAxisAngle(up, rand() * Math.PI);
      q.multiply(qs);
      mats.push(new THREE.Matrix4().compose(p.clone().addScaledVector(n, 0.03), q.clone(), new THREE.Vector3(1, 1, 1).multiplyScalar(0.85 + rand() * 0.3)));
      cols.push(new THREE.Color('#f6e6c2').offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.08));
    }
    const seedMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.3, sheenColor: new THREE.Color('#fff4dc') });
    inner.add(instanced(seed, seedMat, mats, cols));
  }

  // ---------- fillings atlas
  const fill = new Surface(FILL, FILL, bctx, { bump: { base: 0.5, density: 0.5 } });
  paintFillings(fill);
  const fillMap = fill.colorTexture();
  const fillBump = fill.bumpTexture();

  // patty: craggy lathe, displaced
  {
    const g = lathe(pattyProfile(), { segments: 80, uv: (_x, _y, _z, u, v) => rectUV(R_PATTY, FILL, u, v) });
    const pn = valueNoise3(77);
    warp(g, (p) => {
      const r = Math.hypot(p.x, p.z) || 1;
      const edge = THREE.MathUtils.smoothstep(r, 4.2, 5.4);
      const n = fbm(pn, p.x * 0.8, p.y * 0.8, p.z * 0.8, 3);
      const k = 1 + (edge * (0.22 * n + 0.08 * Math.sin(Math.atan2(p.x, p.z) * 5))) / r;
      p.x *= k;
      p.z *= k;
      p.y += (1 - edge) * 0.06 * n * Math.sign(p.y - (PATTY_Y0 + PATTY_Y1) / 2);
    });
    const mat = new THREE.MeshPhysicalMaterial({ map: fillMap, bumpMap: fillBump, bumpScale: 3, roughness: 0.55, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.35, sheen: 0.2, sheenColor: new THREE.Color('#ffb080') });
    inner.add(new THREE.Mesh(g, mat));
  }

  // cheese slice, melting over the patty edge (corners droop more)
  {
    const S = 9.9;
    const g = new THREE.BoxGeometry(S, 0.16, S, 44, 1, 44);
    const droop = [1.35, 1.0, 1.55, 1.15];
    warp(g, (p) => {
      const d = Math.hypot(p.x, p.z);
      const ang = Math.atan2(p.z, p.x);
      // which corner is nearest (box corners at 45, 135, -135, -45 degrees)
      const qi = ((Math.round((ang - Math.PI / 4) / (Math.PI / 2)) % 4) + 4) % 4;
      const over = Math.max(0, d - 5.05);
      p.y += CHEESE_Y + 0.09 - droop[qi] * Math.pow(over / 1.85, 1.55) + 0.05 * Math.sin(p.x * 1.3) * Math.sin(p.z * 1.1);
      // hug the patty a little as it falls
      const pull = Math.min(0.35, over * 0.18);
      p.x -= (p.x / (d || 1)) * pull;
      p.z -= (p.z / (d || 1)) * pull;
    });
    g.rotateY(18 * DEG);
    const mat = new THREE.MeshPhysicalMaterial({ color: '#ffab1a', roughness: 0.3, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color('#ffe08a'), emissive: '#ff8a00', emissiveIntensity: 0.06 });
    inner.add(new THREE.Mesh(g, mat));
  }

  // tomato slices
  {
    const slices: [number, number, number][] = [
      [1.35, 0.95, 0.4],
      [-1.55, -0.85, 2.1],
      [0.4, -2.35, 4.0],
    ];
    const geos = slices.map(([x, z, rot]) => {
      const R = 3.25;
      const prof: P2[] = [
        [0, 0],
        [R - 0.3, 0],
        [R - 0.05, 0.12],
        [R, 0.3],
        [R - 0.05, 0.48],
        [R - 0.3, 0.6],
        [0, 0.6],
      ];
      const g = lathe(prof, { segments: 48, uv: (px, _y, pz) => rectUV(R_TOMATO, FILL, 0.5 + px / (2 * R * 1.02), 0.5 + pz / (2 * R * 1.02)) });
      g.rotateY(rot);
      g.translate(x, TOMATO_Y, z);
      return g;
    });
    const g = mergeSimple(geos);
    geos.forEach((q) => q.dispose());
    const mat = new THREE.MeshPhysicalMaterial({ map: fillMap, roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.3, sheenColor: new THREE.Color('#ffb0a0') });
    inner.add(new THREE.Mesh(g, mat));
  }

  // pickles (crinkle cut), peeking out at the front
  {
    const spots: [number, number, number][] = [
      [-30, 4.55, 0.25],
      [16, 4.5, -0.15],
      [152, 4.45, 0.2],
    ];
    const geos = spots.map(([deg, d, tilt], i) => {
      const R = 1.3;
      const prof: P2[] = [
        [0, 0],
        [R - 0.08, 0],
        [R, 0.08],
        [R - 0.08, 0.17],
        [0, 0.17],
      ];
      const g = lathe(prof, {
        segments: 64,
        radial: (phi, j) => (j > 0 && j < 4 ? 0.07 * Math.sin(phi * 14) : 0),
        uv: (px, _y, pz) => rectUV(R_PICKLE, FILL, 0.5 + px / (2 * R * 1.1), 0.5 + pz / (2 * R * 1.1)),
      });
      g.rotateZ(tilt * 0.25);
      g.rotateY(i * 1.7);
      const a = deg * DEG;
      g.translate(Math.sin(a) * d, PICKLE_Y + i * 0.01, Math.cos(a) * d);
      return g;
    });
    const g = mergeSimple(geos);
    geos.forEach((q) => q.dispose());
    const mat = new THREE.MeshPhysicalMaterial({ map: fillMap, roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 });
    inner.add(new THREE.Mesh(g, mat));
  }

  // lettuce: one ruffled leaf sheet with a frilly, drooping edge
  {
    const ln = valueNoise3(9);
    const edgeR = (phi: number) => 6.15 + 0.45 * Math.sin(5 * phi + 1) + 0.25 * Math.sin(9 * phi + 2) + 0.15 * Math.sin(17 * phi + 0.4);
    const g = parametric(
      150,
      26,
      (u, v, out) => {
        const phi = u * Math.PI * 2;
        const r = v * edgeR(phi);
        const ruffle = 0.34 * THREE.MathUtils.smoothstep(r, 3.6, 6.3) * Math.sin(16 * phi + 2.2 * Math.sin(3 * phi) + r * 0.8);
        const sag = -0.55 * Math.pow(THREE.MathUtils.smoothstep(r, 4.6, 6.7), 1.4);
        const n = 0.08 * ln(Math.sin(phi) * 3, Math.cos(phi) * 3, r);
        return out.set(Math.sin(phi) * r, LETTUCE_Y + 0.12 + ruffle + sag + n, Math.cos(phi) * r);
      },
      { uv: (u, v) => rectUV(R_LETTUCE, FILL, u, v) },
    );
    // parametric(u around, v outwards) faces down; flip so the leaf's top faces up
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    g.computeVertexNormals();
    const mat = new THREE.MeshPhysicalMaterial({ map: fillMap, roughness: 0.35, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.15, side: THREE.DoubleSide, sheen: 0.5, sheenColor: new THREE.Color('#e8ffc0'), sheenRoughness: 0.4 });
    inner.add(new THREE.Mesh(g, mat));
  }

  // ketchup ring under the top bun + drips over the lettuce
  {
    const sn = valueNoise3(3);
    const outerR = (phi: number) => 5.55 + 0.3 * Math.sin(7 * phi + 0.6) + 0.18 * sn(Math.sin(phi) * 4, Math.cos(phi) * 4, 0.5);
    const ring = parametric(
      120,
      6,
      (u, v, out) => {
        const phi = u * Math.PI * 2;
        const r0 = 4.0;
        const r1 = outerR(phi);
        const r = r0 + (r1 - r0) * v;
        const bulge = Math.sin(Math.PI * Math.min(1, v * 1.05)) * 0.16;
        return out.set(Math.sin(phi) * r, SAUCE_Y + bulge - 0.12 * Math.pow(v, 6), Math.cos(phi) * r);
      },
      { uv: () => [0.5, 0.5] },
    );
    const idx = ring.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    ring.computeVertexNormals();
    const parts: THREE.BufferGeometry[] = [ring];
    // rounded rim
    const rim: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) {
      const phi = (i / 120) * Math.PI * 2;
      const r = outerR(phi) - 0.05;
      rim.push(new THREE.Vector3(Math.sin(phi) * r, SAUCE_Y - 0.08, Math.cos(phi) * r));
    }
    parts.push(sweep(rim, () => 0.1, 8));
    const drips: [number, number][] = [
      [-0.35, 1.25],
      [0.42, 0.85],
      [1.6, 1.05],
      [2.75, 0.7],
      [-1.4, 0.95],
      [3.7, 1.15],
    ];
    for (const [phi, len] of drips) {
      const r = outerR(phi) - 0.1;
      const dir = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(dir.clone().multiplyScalar(r + 0.12 + 0.18 * Math.sin(t * Math.PI * 0.5)).setY(SAUCE_Y - 0.05 - len * t));
      }
      parts.push(sweep(pts, capped(0.15, 0.3, false, true, (t) => 0.8 + 0.5 * t), 10));
    }
    const g = mergeSimple(parts);
    parts.forEach((q) => q.dispose());
    const mat = new THREE.MeshPhysicalMaterial({ color: '#d4241a', roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.3, sheenColor: new THREE.Color('#ff7a6a') });
    inner.add(new THREE.Mesh(g, mat));
  }

  // ---------- FULL STACK flag on a pick through the whole stack
  const sheet = new StickerSheet(2048, 512, bctx, 12);
  const cFront = sheet.alloc(640, 400);
  const cBack = sheet.alloc(640, 400);
  inCell(sheet, cFront, (c, w, h) => paintFlag(c, w, h, true));
  inCell(sheet, cBack, (c, w, h) => paintFlag(c, w, h, false));
  const pickLen = 13.2;
  const pick = toothpick(pickLen, 0.17);
  const flagW = 5.2;
  const flagH = 3.3;
  const fl = flag(flagW, flagH, cFront.uv, cBack.uv, { wave: 0.4, fork: 0.9, phase: 0.5 });
  fl.translate(0.15, pickLen - flagH / 2 - 0.3, 0);
  const dir = new THREE.Vector3(0.12, 1, 0.05).normalize();
  const base = new THREE.Vector3(0.25, PATTY_Y0 + 0.4, 0.1);
  for (const g of [pick, fl]) alongDir(g, base, dir, 0.42);
  inner.add(new THREE.Mesh(pick, woodMaterial()));
  const paper = fl;
  inner.add(new THREE.Mesh(paper, paperBackfaces(stickerSheet(sheet.surf.colorTexture(), { roughness: 0.45, clearcoat: 0.45 }), '#f2ede3')));

  return finish(inner, trash, undefined, 'full-stack-burger');
}

export const burger: LibraryDef = {
  kind: 'burger',
  name: 'Full-Stack Burger',
  tagline: 'every layer, shipped',
  category: 'food',
  defaultRotation: [0.3, -0.42, 0.08],
  build,
};
export default burger;
