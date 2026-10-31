import * as THREE from 'three';
import type { ObjectBuildContext, ObjectDef } from './types';
import { Surface, StickerSheet } from './textures';
import { Trash, finish } from './build';
import { lathe, fillet, stickerPatch, surfaces, merge, flatUV, place, tint, type P2 } from './geometry';
import { holoFoil } from './materials';
import {
  FONTS,
  DEG,
  text,
  arcText,
  font,
  sticker,
  starPath,
  circlePath,
  rrPath,
  ticketPath,
  barcode,
  waveBand,
  halftone,
  factsPanel,
  smiley,
  smallPrint,
  fillPath,
  grain,
  rrect,
  holoFill,
  sealPath,
} from './paint';

// Real 330 ml can, in centimetres (normalised afterwards).
const R = 3.31;
const PRINT_Y0 = 0.95;
const PRINT_Y1 = 10.42;

const BLUE = '#1747ff';
const BLUE_DEEP = '#0b26b8';
const NAVY = '#07124a';
const YELLOW = '#ffd319';
const PINK = '#ff4fa8';
const CREAM = '#fff4dc';

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
  // round every interior corner a little
  const radii: number[] = raw.map((_, i) => (i === 0 || i === raw.length - 1 ? 0 : 0.12));
  radii[9] = 0.5; // lower taper into the wall
  radii[10] = 0.55; // wall into the shoulder
  radii[11] = 0.3;
  radii[12] = 0.25;
  radii[16] = 0.06;
  radii[17] = 0.08;
  radii[18] = 0.06;
  radii[19] = 0.05;
  return fillet(raw, radii, 6);
}

/** Split a polyline at y thresholds (on the outer wall), inserting exact split points. */
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

function paintLabel(s: Surface): void {
  const c = s.c;
  const W = s.w;
  const H = s.h;
  const X = (deg: number) => W / 2 + (deg / 360) * W;

  // base: electric blue with a deeper bottom
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2a57ff');
  g.addColorStop(0.55, BLUE);
  g.addColorStop(1, BLUE_DEEP);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // halftone sparkle in the lower half
  halftone(c, 0, H * 0.45, W, H * 0.45, 22, 'rgba(255,255,255,0.10)', (u, v) => 0.25 + 0.5 * Math.max(0, Math.sin(u * Math.PI * 12) * (1 - v)));

  // shoulder band with ring text
  c.fillStyle = NAVY;
  c.fillRect(0, 0, W, 64);
  c.fillStyle = PINK;
  c.fillRect(0, 64, W, 8);
  ringText(c, 'ZERO SUGAR • INFINITE IDEAS • FOUNDER FUEL • ', W, 34, font(30, FONTS.rubikMono), YELLOW);

  // big yellow wave band + accent lines (seamless: integer periods)
  waveBand(c, W, 128, 16, 7, 3, 0.4, PINK);
  waveBand(c, W, 228, 36, 128, 3, 0.4, YELLOW, 10);
  // drips under the band
  for (let i = 0; i < 18; i++) {
    const x = (i / 18) * W + 40;
    const base = 228 + 64 + Math.sin((x / W) * Math.PI * 6 + 0.4) * 36 + Math.sin((x / W) * Math.PI * 12 + 0.68) * 10;
    const len = 30 + ((i * 37) % 50);
    c.fillStyle = YELLOW;
    c.beginPath();
    c.moveTo(x - 14, base - 6);
    c.lineTo(x - 14, base + len);
    c.arc(x, base + len, 14, Math.PI, 0, true);
    c.lineTo(x + 14, base - 6);
    c.closePath();
    c.fill();
  }
  waveBand(c, W, 352, 30, 9, 3, 0.4 + Math.PI * 0.15, '#ffffff');

  // bottom band
  c.fillStyle = PINK;
  c.fillRect(0, H - 132, W, 14);
  c.fillStyle = NAVY;
  c.fillRect(0, H - 118, W, 118);
  ringText(c, '330 ml · 11.2 FL OZ · 0 KCAL · 100% FOCUS · KEEP COLD, SHIP HOT · ', W, H - 62, font(26, FONTS.spaceMono, 700), '#ffffff', 0.37);

  // ---------------- front (0deg)
  const fx = X(0);
  text(c, 'ZEROS', fx, 612, {
    size: 240,
    maxWidth: 660,
    family: FONTS.bagel,
    align: 'center',
    gradient: ['#ffffff', '#dfe6ff'],
    outlines: [{ color: NAVY, width: 30 }],
    extrude: { color: NAVY, dx: 10, dy: 16 },
    shadow: { color: 'rgba(0,0,20,0.55)', dx: 8, dy: 18, blur: 18 },
    tracking: -4,
  });
  text(c, 'soda', fx + 268, 676, {
    size: 88,
    family: FONTS.shrikhand,
    align: 'center',
    color: PINK,
    outlines: [
      { color: '#ffffff', width: 22 },
      { color: NAVY, width: 34 },
    ],
  }, -10 * DEG);
  // tagline pill
  fillPath(c, rrPath(fx - 290, 716, 580, 54, 27), NAVY);
  text(c, 'zero sugar · infinite ideas', fx, 754, { size: 32, family: FONTS.spaceMono, weight: 700, align: 'center', color: '#ffffff' });

  // FOUNDER FUEL badge over the wave
  sticker(s, fx - 10, 318, -4 * DEG, rrPath(-205, -40, 410, 80, 40), { border: 8, fill: '#111', shadow: 0.8 }, (k) => {
    text(k, 'FOUNDER FUEL', 0, 15, { size: 40, family: FONTS.rubikMono, align: 'center', color: YELLOW });
  });

  // NEW! starburst
  sticker(s, X(-63), 380, -14 * DEG, starPath(0, 0, 112, 86, 16, -Math.PI / 2, 0.25), { border: 10, fill: YELLOW, shadow: 1 }, (k) => {
    text(k, 'NEW!', 0, 22, { size: 64, family: FONTS.archivoBlack, align: 'center', color: '#ff2d2d', outlines: [{ color: '#111', width: 8 }] });
    text(k, 'now with 0 sugar', 0, 58, { size: 17, family: FONTS.spaceMono, weight: 700, align: 'center', color: '#111' });
  });

  // pink 0 -> 1 sticker
  sticker(s, X(60), 392, 10 * DEG, circlePath(0, 0, 92), { border: 10, fill: PINK, shadow: 1 }, (k) => {
    fillPath(k, circlePath(0, 0, 80), '#ff6fbb');
    text(k, '0→1', 0, 26, { size: 76, family: FONTS.rubikMono, align: 'center', color: '#fff', outlines: [{ color: NAVY, width: 10 }] });
    text(k, 'IDEA TO PRODUCT', 0, 60, { size: 13, family: FONTS.spaceMono, weight: 700, align: 'center', color: NAVY });
  });

  // BATCH ticket
  sticker(s, X(86), 640, 82 * DEG, ticketPath(-150, -46, 300, 92, 16, 8), { border: 0, fill: CREAM, shadow: 0.7 }, (k) => {
    k.strokeStyle = '#e2342d';
    k.setLineDash([6, 6]);
    k.lineWidth = 3;
    k.strokeRect(-128, -34, 256, 68);
    k.setLineDash([]);
    text(k, 'BATCH #0001', 0, 8, { size: 34, family: FONTS.archivoBlack, align: 'center', color: '#e2342d' });
    text(k, 'ADMIT ONE · FOUNDER', 0, 30, { size: 14, family: FONTS.spaceMono, weight: 700, align: 'center', color: '#111' });
  });

  // little smiley near the barcode side
  sticker(s, X(-92), 600, 0, circlePath(0, 0, 52), { border: 8, fill: '#ffd400', shadow: 0.8 }, (k) => smiley(k, 0, 0, 52));

  // ---------------- back
  // nutrition panel (back-right)
  const nx = X(140);
  c.save();
  c.translate(nx - 170, 380);
  const ph = factsPanel(c, 0, 0, 340, 'Nutrition Facts', 'Serving size: 1 big idea', [
    ['Ideas', '100%', true],
    ['Sleep', '0g', true],
    ['Meetings', '0mg', true],
    ['Shipping', 'daily', true],
    '-',
    ['Coffee', 'yes'],
    ['Pixels', '1,000,000'],
    ['Motion', '5 yrs'],
  ], { size: 22, footer: ['* % daily value of ambition', 'based on a 24h startup day'] });
  c.restore();
  s.maskPath(rrPath(nx - 170, 380, 340, ph, 2), 0.42, 0);

  // barcode (vertical, back centre)
  for (const bx of [X(-178), X(-178) + W]) {
    sticker(s, bx, 610, -90 * DEG, rrPath(-150, -62, 300, 124, 8), { border: 0, fill: '#fff', shadow: 0.6 }, (k) => {
      barcode(k, -128, -50, 256, 98, 1337, { digits: '0 00000 00001 0' });
    });
  }

  // ingredients + small print (back-left)
  const ix = X(-140);
  c.save();
  c.fillStyle = 'rgba(7,18,74,0.85)';
  rrect(c, ix - 190, 420, 380, 250, 18);
  c.fill();
  c.restore();
  text(c, 'INGREDIENTS', ix - 168, 466, { size: 26, family: FONTS.archivoBlack, color: YELLOW });
  smallPrint(
    c,
    ['carbonated ambition, natural', 'flavours, 5 years of motion', 'design, a pinch of chaos,', 'late-night figma files, ZERO', 'sugar. contains: big ideas.', '', 'once upon a time i was a', 'product designer.'],
    ix - 168,
    484,
    19,
    '#ffffff',
    { lineHeight: 22 },
  );
  // recycle-ish mark
  c.save();
  c.strokeStyle = '#fff';
  c.lineWidth = 5;
  c.beginPath();
  c.arc(ix + 130, 718, 26, 0, Math.PI * 1.6);
  c.stroke();
  c.restore();
  text(c, 'CAN', ix + 130, 726, { size: 16, family: FONTS.archivoBlack, align: 'center', color: '#fff' });

  // handwritten scribble near the panel
  text(c, 'founder fuel!', X(112), 352, { size: 34, family: FONTS.marker, align: 'center', color: '#ffffff' }, -6 * DEG);


  // subtle print grain
  grain(c, 0, 0, W, H, 9000, 0.05, 11);
}

/** Text repeated around the full wrap, squeezed so it tiles seamlessly. */
function ringText(c: CanvasRenderingContext2D, str: string, W: number, y: number, f: string, color: string, offset = 0): void {
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

function paintLidBump(s: Surface): void {
  // left half: lid seen from above (x right, -z up). right half: base seen from below.
  const c = s.bump!.ctx;
  const half = s.w / 2;
  const k = half / (2 * 2.9); // px per cm
  const L = { cx: half / 2, cy: s.h / 2 };
  const B = { cx: half * 1.5, cy: s.h / 2 };
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // countersink ring + panel rings
  c.strokeStyle = 'rgb(150,150,150)';
  c.lineWidth = 0.1 * k;
  for (const r of [2.2, 2.05]) {
    c.beginPath();
    c.arc(L.cx, L.cy, r * k, 0, Math.PI * 2);
    c.stroke();
  }
  // scored opening (teardrop) on the far side (-z = up in texture)
  c.save();
  c.translate(L.cx, L.cy - 1.05 * k);
  const op = (ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    ctx.moveTo(-0.62 * k, 0.32 * k);
    ctx.quadraticCurveTo(-0.95 * k, -0.55 * k, 0, -0.78 * k);
    ctx.quadraticCurveTo(0.95 * k, -0.55 * k, 0.62 * k, 0.32 * k);
    ctx.quadraticCurveTo(0, 0.5 * k, -0.62 * k, 0.32 * k);
    ctx.closePath();
  };
  // raised bead around the opening
  c.filter = `blur(${0.05 * k}px)`;
  op(c);
  c.strokeStyle = 'rgb(175,175,175)';
  c.lineWidth = 0.3 * k;
  c.stroke();
  c.filter = 'none';
  op(c);
  c.strokeStyle = 'rgb(70,70,70)';
  c.lineWidth = 0.05 * k;
  c.stroke();
  c.restore();
  // tab rivet ring
  c.strokeStyle = 'rgb(160,160,160)';
  c.lineWidth = 0.08 * k;
  c.beginPath();
  c.arc(L.cx, L.cy, 0.42 * k, 0, Math.PI * 2);
  c.stroke();
  // embossed rim text
  arcText(c, 'ZEROS · RECYCLE ME · OPEN HERE', L.cx, L.cy, 1.72 * k, Math.PI / 2, {
    size: 0.26 * k,
    family: FONTS.archivoBlack,
    color: 'rgb(185,185,185)',
    tracking: 0.03 * k,
  }, true);

  // base dome: rings + embossed text
  c.strokeStyle = 'rgb(150,150,150)';
  c.lineWidth = 0.08 * k;
  for (const r of [0.7, 1.9]) {
    c.beginPath();
    c.arc(B.cx, B.cy, r * k, 0, Math.PI * 2);
    c.stroke();
  }
  arcText(c, 'BATCH 0001 · BEST BEFORE: SHIP DATE · ', B.cx, B.cy, 1.32 * k, -Math.PI / 2, {
    size: 0.24 * k,
    family: FONTS.spaceMono,
    weight: 700,
    color: 'rgb(180,180,180)',
    tracking: 0.02 * k,
  });
  text(c, '0', B.cx, B.cy + 0.22 * k, { size: 0.62 * k, family: FONTS.bagel, align: 'center', color: 'rgb(185,185,185)' });
}

function pullTab(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // outline in the XY plane: nose at y = -0.55, ring end at y = +1.7
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
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 2, curveSegments: 18 });
  // lay flat: shape Y -> +Z (towards the front), extrusion -> +Y
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
  const mid = midP;
  let arc = 0;
  for (let i = 1; i < mid.length; i++) arc += Math.hypot(mid[i][0] - mid[i - 1][0], mid[i][1] - mid[i - 1][1]);
  const circ = 2 * Math.PI * R;
  const LW = 2048;
  const LH = Math.round((LW * arc) / circ);
  const label = new Surface(LW, LH, bctx, { mask: { rough: 0.27, metal: 0.55 } });
  paintLabel(label);
  const labelGeo = lathe(mid, { segments: SEG });
  const labelMat = new THREE.MeshPhysicalMaterial({
    map: label.colorTexture(),
    roughnessMap: label.maskTexture(),
    metalnessMap: label.maskTexture(),
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  // share one mask texture for both slots
  labelMat.metalnessMap = labelMat.roughnessMap;
  inner.add(new THREE.Mesh(labelGeo, labelMat));

  // ---------- aluminium (lid + base + tab) with an embossing bump map
  const bump = new Surface(1024, 512, bctx, { bump: { base: 0.5, density: 1 }, density: 0.01 });
  paintLidBump(bump);
  const RM = 2.9;
  const lidUV = (x: number, _y: number, z: number): [number, number] => [0.25 + (x / RM) * 0.25, 0.5 - (z / RM) * 0.5];
  const baseUV = (x: number, _y: number, z: number): [number, number] => [0.75 + (x / RM) * 0.25, 0.5 + (z / RM) * 0.5];
  const topGeo = lathe(topP, { segments: SEG, uv: lidUV });
  const baseGeo = lathe(bottomP, { segments: SEG, uv: baseUV });
  const tab = flatUV(pullTab(), 0.5, 0.98);
  place(tab, [0, 11.06, -0.12], [0.03, 0, 0]);
  const rivet = flatUV(new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0.5, 0.98);
  place(rivet, [0, 11.06, 0], [0, 0, 0], [1, 0.45, 1]);
  tint(topGeo, '#ffffff');
  tint(baseGeo, '#ffffff');
  tint(rivet, '#ffffff');
  tint(tab, '#ff5aa5');
  const aluGeo = merge([topGeo, baseGeo, tab, rivet]);
  [topGeo, baseGeo, tab, rivet].forEach((g) => g.dispose());
  const bumpTex = bump.bumpTexture()!;
  const aluMat = new THREE.MeshPhysicalMaterial({
    color: '#dfe3e8',
    metalness: 1,
    roughness: 0.22,
    bumpMap: bumpTex,
    bumpScale: 1.6,
    clearcoat: 0.3,
    clearcoatRoughness: 0.1,
    vertexColors: true,
  });
  inner.add(new THREE.Mesh(aluGeo, aluMat));

  // ---------- lifted holographic sticker
  const sheet = new StickerSheet(640, 384, bctx, 16);
  const cell = sheet.alloc(600, 344);
  const sc = sheet.surf.c;
  sc.save();
  sc.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  const holoShape = rrPath(-284, -156, 568, 312, 46);
  sticker(sc, 0, 0, 0, holoShape, { border: 0, fill: '#ddd' }, (k) => {
    holoFill(k, holoShape, -290, -160, 580, 320, 5);
    fillPath(k, sealPath(-170, 0, 104, 14, 7), 'rgba(20,20,60,0.85)');
    text(k, '0', -170, 44, { size: 120, family: FONTS.bagel, align: 'center', color: '#fff' });
    text(k, 'LIMITED', 52, -54, { size: 54, family: FONTS.rubikMono, align: 'center', color: '#141433' });
    text(k, "FOUNDER'S CUT", 52, 4, { size: 40, family: FONTS.archivoBlack, align: 'center', color: '#141433' });
    text(k, 'No. 0001 / 0001', 52, 56, { size: 30, family: FONTS.spaceMono, weight: 700, align: 'center', color: '#141433' });
    text(k, 'hologram of authenticity', 52, 100, { size: 22, family: FONTS.spaceMono, align: 'center', color: 'rgba(20,20,51,0.8)' });
  });
  sc.restore();
  const holoTex = sheet.surf.colorTexture();
  const at = surfaces.cylinder(R);
  const holoGeo = stickerPatch(at, -50 * DEG * R, 2.55, 2.5, 1.43, -6 * DEG, cell.uv, {
    nx: 20,
    ny: 12,
    offset: 0.012,
    lift: (u, v) => {
      const a = THREE.MathUtils.smoothstep(u, 0.62, 1);
      const b = THREE.MathUtils.smoothstep(v, 0.4, 1);
      return 0.3 * Math.pow(a * b, 1.6);
    },
  });
  const holoMat = holoFoil(holoTex, { side: THREE.DoubleSide, forceSinglePass: true });
  inner.add(new THREE.Mesh(holoGeo, holoMat));

  return finish(inner, trash, undefined, 'zeros-soda');
}

export const sodaCan: ObjectDef = {
  kind: 'can',
  name: 'Zeros Soda',
  tagline: 'founder fuel, zero sugar',
  defaultRotation: [0.3, 0.16, -0.22],
  build,
};
