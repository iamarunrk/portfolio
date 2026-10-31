import * as THREE from 'three';
import type { ObjectBuildContext, ObjectDef } from './types';
import { Surface, StickerSheet, type AtlasCell } from './textures';
import { Trash, finish } from './build';
import { parametric, stickerPatch, merge, type SurfacePoint } from './geometry';
import { stickerSheet, paperBackfaces } from './materials';
import { FONTS, DEG, rng, text, sticker, rrPath, fillPath, smallPrint, barcode, factsPanel, halftone, grain, hexA, type C2D } from './paint';

/*
 * Rapid PROTOTYPE chips: a light sky-blue foil pillow bag with crimped seals,
 * a big white wordmark with a thick dark-blue outline, pop-art characters and
 * stickers hanging over the edges. Scene units ~ 10 cm.
 */

const W = 1.56;
const H = 1.8;
const T = 0.3; // max puff per side
const SEAL = 0.078; // seal height as a fraction of H
const PINCH = 0.07;

const SKY = '#62c3ef';
const SKY_LIGHT = '#bfe8fb';
const SKY_DEEP = '#2c8fd6';
const NAVY = '#0b2b6e';
const YELLOW = '#ffd21a';

// ------------------------------------------------------------------ shape

function puffY(v: number): number {
  if (v <= SEAL || v >= 1 - SEAL) return 0;
  const t = (v - SEAL) / (1 - 2 * SEAL);
  return Math.pow(Math.sin(Math.PI * t), 0.5);
}

function puffX(u: number): number {
  const d = Math.abs(2 * u - 1);
  return Math.pow(Math.max(0, 1 - Math.pow(d, 2.4)), 0.55);
}

/** Front surface (side = +1) or back (side = -1); u runs left->right as seen from that side. */
function bagPoint(u: number, v: number, side: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
  const by = puffY(v);
  const bx = puffX(u);
  const xs = side === 1 ? u : 1 - u;
  const x = (xs - 0.5) * W * (1 - PINCH * by);
  const y = (v - 0.5) * H;
  // soft wrinkles near the seal transitions and the corners
  const nearTop = Math.exp(-Math.pow((v - (1 - SEAL - 0.05)) / 0.05, 2));
  const nearBot = Math.exp(-Math.pow((v - (SEAL + 0.05)) / 0.05, 2));
  const wr =
    (nearTop * Math.sin(u * Math.PI * 2 * 7 + 1.3) + nearBot * Math.sin(u * Math.PI * 2 * 6 + 0.4)) * 0.012 * bx +
    Math.sin(u * 9.1 + v * 13.7) * Math.sin(u * 4.3 - v * 7.9) * 0.008 * by * bx;
  let z = T * bx * by + wr;
  // seals: two thin laminated layers
  if (by === 0) z = 0.004;
  z += (1 - by) * 0.004;
  return out.set(x, y, side * z);
}

// ------------------------------------------------------------------ print

function popGuy(c: C2D, x: number, y: number, s: number): void {
  // pop-art founder: cap, sunglasses, big grin
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  // neck + shirt
  fillPath(c, (q) => q.ellipse(0, 150, 120, 70, 0, 0, Math.PI * 2), '#1f2a44');
  // head
  const head = () => {
    c.beginPath();
    c.moveTo(-86, -40);
    c.quadraticCurveTo(-96, 90, -40, 128);
    c.quadraticCurveTo(0, 150, 40, 128);
    c.quadraticCurveTo(96, 90, 86, -40);
    c.closePath();
  };
  head();
  c.fillStyle = '#f2b98a';
  c.fill();
  c.save();
  c.clip();
  halftone(c, -100, -60, 200, 220, 9, 'rgba(190,90,60,0.45)', (u, v) => 0.2 + 0.6 * u * v);
  c.restore();
  head();
  c.lineWidth = 7;
  c.strokeStyle = '#111';
  c.stroke();
  // cap
  c.beginPath();
  c.moveTo(-96, -30);
  c.quadraticCurveTo(-100, -120, 0, -126);
  c.quadraticCurveTo(100, -120, 96, -30);
  c.closePath();
  c.fillStyle = '#132a63';
  c.fill();
  c.stroke();
  c.beginPath();
  c.moveTo(-104, -30);
  c.quadraticCurveTo(10, -58, 132, -18);
  c.lineTo(126, -2);
  c.quadraticCurveTo(10, -38, -100, -14);
  c.closePath();
  c.fillStyle = '#1b3a86';
  c.fill();
  c.stroke();
  text(c, 'Z', 0, -64, { size: 52, family: FONTS.bagel, align: 'center', color: YELLOW });
  // sunglasses
  c.fillStyle = '#111';
  c.beginPath();
  c.roundRect(-78, 6, 68, 40, 14);
  c.roundRect(8, 6, 68, 40, 14);
  c.fill();
  c.fillRect(-12, 16, 22, 8);
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.fillRect(-64, 14, 18, 6);
  c.fillRect(22, 14, 18, 6);
  // grin
  c.beginPath();
  c.moveTo(-46, 74);
  c.quadraticCurveTo(0, 124, 46, 74);
  c.closePath();
  c.fillStyle = '#ffffff';
  c.fill();
  c.lineWidth = 6;
  c.stroke();
  c.restore();
}

function popGirl(c: C2D, x: number, y: number, s: number): void {
  // pop-art designer, startled: "it shipped?!"
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = '#111';
  c.lineWidth = 7;
  // hair back
  fillPath(c, (q) => q.ellipse(0, -10, 112, 120, 0, 0, Math.PI * 2), YELLOW);
  c.beginPath();
  c.ellipse(0, -10, 112, 120, 0, 0, Math.PI * 2);
  c.stroke();
  // face
  const face = () => {
    c.beginPath();
    c.ellipse(4, 18, 72, 92, 0, 0, Math.PI * 2);
  };
  face();
  c.fillStyle = '#f7d2b0';
  c.fill();
  c.save();
  c.clip();
  halftone(c, -80, -80, 170, 200, 9, 'rgba(230,120,110,0.35)', (u) => 0.2 + 0.5 * u);
  c.restore();
  face();
  c.stroke();
  // fringe
  c.beginPath();
  c.moveTo(-74, -10);
  c.quadraticCurveTo(-40, -96, 30, -84);
  c.quadraticCurveTo(70, -76, 78, -20);
  c.quadraticCurveTo(30, -60, -20, -40);
  c.quadraticCurveTo(-50, -30, -74, -10);
  c.closePath();
  c.fillStyle = YELLOW;
  c.fill();
  c.stroke();
  // eyes (wide)
  for (const ex of [-26, 32]) {
    fillPath(c, (q) => q.ellipse(ex, 4, 17, 22, 0, 0, Math.PI * 2), '#ffffff');
    c.beginPath();
    c.ellipse(ex, 4, 17, 22, 0, 0, Math.PI * 2);
    c.stroke();
    fillPath(c, (q) => q.arc(ex + 2, 8, 9, 0, Math.PI * 2), '#1d5fd0');
    fillPath(c, (q) => q.arc(ex + 2, 8, 4, 0, Math.PI * 2), '#111');
  }
  // mouth "o"
  fillPath(c, (q) => q.ellipse(6, 70, 16, 20, 0, 0, Math.PI * 2), '#a8202a');
  c.beginPath();
  c.ellipse(6, 70, 16, 20, 0, 0, Math.PI * 2);
  c.stroke();
  // hand on cheek
  c.beginPath();
  c.ellipse(-70, 80, 30, 44, -0.4, 0, Math.PI * 2);
  c.fillStyle = '#f7d2b0';
  c.fill();
  c.stroke();
  c.restore();
}

function paintFront(s: Surface, x0: number, w: number, h: number): void {
  const c = s.c;
  const cx = x0 + w / 2;
  const seal = SEAL * h;
  c.save();
  c.beginPath();
  c.rect(x0, 0, w, h);
  c.clip();
  // sky-blue foil with a bright oval glow behind the logo
  const g = c.createLinearGradient(x0, 0, x0 + w, h);
  g.addColorStop(0, '#4fb7ea');
  g.addColorStop(0.5, SKY);
  g.addColorStop(1, '#3aa3e0');
  c.fillStyle = g;
  c.fillRect(x0, 0, w, h);
  const rg = c.createRadialGradient(cx, h * 0.47, 40, cx, h * 0.47, w * 0.62);
  rg.addColorStop(0, hexA('#ffffff', 0.85));
  rg.addColorStop(0.55, hexA(SKY_LIGHT, 0.55));
  rg.addColorStop(1, hexA(SKY_LIGHT, 0));
  c.fillStyle = rg;
  c.beginPath();
  c.ellipse(cx, h * 0.47, w * 0.62, h * 0.36, -0.12, 0, Math.PI * 2);
  c.fill();
  // blue swoosh rings around the glow
  c.strokeStyle = hexA(SKY_DEEP, 0.55);
  c.lineWidth = 26;
  c.beginPath();
  c.ellipse(cx, h * 0.5, w * 0.56, h * 0.33, -0.12, Math.PI * 0.95, Math.PI * 2.05);
  c.stroke();
  // yellow diagonal bands (top-right and bottom)
  c.fillStyle = YELLOW;
  c.beginPath();
  c.moveTo(x0 + w * 0.42, 0);
  c.lineTo(x0 + w, 0);
  c.lineTo(x0 + w, h * 0.13);
  c.quadraticCurveTo(x0 + w * 0.6, h * 0.1, x0 + w * 0.3, h * 0.2);
  c.lineTo(x0 + w * 0.26, h * 0.165);
  c.quadraticCurveTo(x0 + w * 0.55, h * 0.06, x0 + w * 0.42, 0);
  c.closePath();
  c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.moveTo(x0, h * 0.2);
  c.quadraticCurveTo(x0 + w * 0.35, h * 0.1, x0 + w, h * 0.16);
  c.lineTo(x0 + w, h * 0.185);
  c.quadraticCurveTo(x0 + w * 0.35, h * 0.13, x0, h * 0.225);
  c.closePath();
  c.fill();
  c.fillStyle = YELLOW;
  c.beginPath();
  c.moveTo(x0, h * 0.86);
  c.quadraticCurveTo(x0 + w * 0.5, h * 0.9, x0 + w, h * 0.8);
  c.lineTo(x0 + w, h * 0.87);
  c.quadraticCurveTo(x0 + w * 0.5, h * 0.96, x0, h * 0.93);
  c.closePath();
  c.fill();
  // seals: crimp stripes + the hang hole
  for (const [y0, y1] of [
    [0, seal + 4],
    [h - seal - 4, h],
  ]) {
    for (let xx = x0; xx < x0 + w; xx += 12) {
      c.fillStyle = hexA('#ffffff', 0.2);
      c.fillRect(xx, y0, 4, y1 - y0);
      c.fillStyle = hexA('#0b3c7a', 0.14);
      c.fillRect(xx + 6, y0, 4, y1 - y0);
    }
    c.fillStyle = hexA('#0b3c7a', 0.35);
    c.fillRect(x0, y0 === 0 ? y1 - 4 : y0, w, 4);
  }
  fillPath(c, rrPath(cx - 70, seal * 0.32, 140, seal * 0.42, seal * 0.21), '#0d2a55');
  edgeShade(c, x0, w, h);

  // pop-art characters (behind the wordmark)
  popGirl(c, x0 + w * 0.22, h * 0.72, 1.32);
  popGuy(c, x0 + w * 0.84, h * 0.72, 1.36);
  // BETA! pop sticker by the guy (the reference's comic sticker spot)
  sticker(s, x0 + w * 0.6, h * 0.74, -6 * DEG, rrPath(-80, -46, 160, 92, 10), { border: 6, fill: '#ff8ad8', shadow: 0.5 }, (q) => {
    halftone(q, -80, -46, 160, 92, 10, 'rgba(160,40,140,0.35)', () => 0.5);
    text(q, 'BETA!', 0, 22, { size: 60, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: '#6a1a8a', width: 10 }] });
  });
  // v2 square (where the reference has its social badge)
  sticker(s, cx - 40, h * 0.69, -10 * DEG, rrPath(-86, -86, 172, 172, 26), { border: 8, fill: '#1f7fd6', shadow: 0.6 }, (q) => {
    text(q, 'v2', 0, 40, { size: 124, family: FONTS.archivoBlack, align: 'center', color: '#ffffff' });
  });

  // wordmark: "Rapid" / "Prototype" / "Chips"
  text(c, 'Rapid', cx - 90, h * 0.275, { size: 80, family: FONTS.archivoBlack, align: 'center', color: '#ffffff', outlines: [{ color: NAVY, width: 16 }] }, -7 * DEG);
  text(
    c,
    'Prototype',
    cx + 4,
    h * 0.475,
    {
      size: 262,
      family: FONTS.shrikhand,
      align: 'center',
      maxWidth: w * 0.97,
      gradient: ['#ffffff', '#d9eefb'],
      outlines: [{ color: NAVY, width: 34 }],
      extrude: { color: NAVY, dx: 10, dy: 16 },
      shadow: { color: 'rgba(0,20,60,0.45)', dx: 6, dy: 14, blur: 16 },
    },
    -7 * DEG,
  );
  text(c, 'Chips', cx + 160, h * 0.585, { size: 128, family: FONTS.shrikhand, align: 'center', color: YELLOW, outlines: [{ color: NAVY, width: 18 }], extrude: { color: NAVY, dx: 5, dy: 7 } }, -7 * DEG);
  text(c, 'Sea Salt & Iteration', cx + 175, h * 0.632, { size: 30, family: FONTS.archivoBlack, align: 'center', color: NAVY }, -7 * DEG);
  // small print
  smallPrint(c, ['NET WT 1 MVP (28 g)'], x0 + 30, h - seal - 56, 22, NAVY, { weight: 700 });
  c.restore();
}

/** Printed shading: darker sides and crinkle shadows where the puff meets the seals. */
function edgeShade(c: C2D, x0: number, w: number, h: number): void {
  const seal = SEAL * h;
  const side = c.createLinearGradient(x0, 0, x0 + w, 0);
  side.addColorStop(0, 'rgba(8,40,90,0.42)');
  side.addColorStop(0.12, 'rgba(8,40,90,0.0)');
  side.addColorStop(0.88, 'rgba(8,40,90,0.0)');
  side.addColorStop(1, 'rgba(8,40,90,0.42)');
  c.fillStyle = side;
  c.fillRect(x0, seal, w, h - seal * 2);
  const r = rng(31);
  for (const top of [true, false]) {
    const y0 = top ? seal + 4 : h - seal - 4;
    const g = c.createLinearGradient(0, y0, 0, y0 + (top ? 70 : -70));
    g.addColorStop(0, 'rgba(8,40,90,0.35)');
    g.addColorStop(1, 'rgba(8,40,90,0)');
    c.fillStyle = g;
    c.fillRect(x0, top ? y0 : y0 - 70, w, 70);
    // crinkle streaks
    for (let i = 0; i < 18; i++) {
      const x = x0 + r() * w;
      const len = 30 + r() * 70;
      const lg = c.createLinearGradient(0, y0, 0, y0 + (top ? len : -len));
      const light = r() > 0.5;
      lg.addColorStop(0, light ? 'rgba(255,255,255,0.35)' : 'rgba(8,40,90,0.35)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = lg;
      c.beginPath();
      c.moveTo(x - 7, y0);
      c.lineTo(x + 7, y0);
      c.lineTo(x + (r() - 0.5) * 20, y0 + (top ? len : -len));
      c.closePath();
      c.fill();
    }
  }
}

function paintBack(s: Surface, x0: number, w: number, h: number): void {
  const c = s.c;
  const seal = SEAL * h;
  c.save();
  c.beginPath();
  c.rect(x0, 0, w, h);
  c.clip();
  const g = c.createLinearGradient(x0, 0, x0 + w, h);
  g.addColorStop(0, '#5cc0ee');
  g.addColorStop(1, '#3a9fdc');
  c.fillStyle = g;
  c.fillRect(x0, 0, w, h);
  for (const [y0, y1] of [
    [0, seal + 4],
    [h - seal - 4, h],
  ]) {
    c.fillStyle = hexA('#1f78c4', 0.55);
    c.fillRect(x0, y0, w, y1 - y0);
    c.fillStyle = hexA('#ffffff', 0.18);
    for (let xx = x0; xx < x0 + w; xx += 12) c.fillRect(xx, y0, 4, y1 - y0);
  }
  fillPath(c, rrPath(x0 + w / 2 - 70, seal * 0.32, 140, seal * 0.42, seal * 0.21), '#0d2a55');
  edgeShade(c, x0, w, h);
  text(c, 'Prototype', x0 + w / 2, seal + 130, { size: 96, family: FONTS.shrikhand, align: 'center', color: '#ffffff', outlines: [{ color: NAVY, width: 14 }] });
  // nutrition facts
  c.save();
  c.translate(x0 + 70, seal + 180);
  const ph = factsPanel(
    c,
    0,
    0,
    470,
    'Nutrition Facts',
    'Serving size: 1 sprint · Servings: ∞',
    [
      ['Calories', '0 (it’s a prototype)', true],
      '-',
      ['Feedback', '120%', true],
      ['Scope creep', '0g', true],
      ['Assumptions', '3g', false],
      ['  validated', '2g', false],
      ['Pixels', '1M', true],
      ['Lorem ipsum', '0%', false],
      ['Coffee', 'lots', true],
    ],
    { size: 26, footer: ['INGREDIENTS: user research, wireframes,', 'sea salt, iteration, a deadline.'] },
  );
  c.restore();
  s.maskPath(rrPath(x0 + 70, seal + 180, 470, ph, 2), 0.45, 0);
  // barcode + recycling text
  sticker(s, x0 + w - 200, h - seal - 210, 0, rrPath(-130, -80, 260, 160, 8), { border: 0, fill: '#ffffff', shadow: 0.4 }, (q) => {
    barcode(q, -112, -64, 224, 128, 77, { digits: '0 12345 67890 2' });
  });
  smallPrint(c, ['Made by a former product designer,', 'now building ZEROS. Best before:', 'ship date. Iterate responsibly.'], x0 + 70, h - seal - 150, 22, '#ffffff', { weight: 700, lineHeight: 28 });
  c.restore();
}

/** Zig-zag cut along the top and bottom edges (alpha). */
function cutTeeth(c: C2D, x0: number, w: number, h: number): void {
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = '#000';
  const n = 46;
  const d = 12;
  for (const top of [true, false]) {
    c.beginPath();
    const y = top ? 0 : h;
    const s = top ? 1 : -1;
    c.moveTo(x0, y);
    for (let i = 0; i <= n; i++) c.lineTo(x0 + (i / n) * w, y + (i % 2 ? d : 0) * s);
    c.lineTo(x0 + w, y - 4 * s);
    c.lineTo(x0, y - 4 * s);
    c.closePath();
    c.fill();
  }
  c.restore();
}

function paintCrimpBump(s: Surface, w: number, h: number): void {
  s.bumpDraw((b) => {
    const seal = SEAL * h;
    for (const y0 of [0, h - seal - 6]) {
      for (let x = 0; x < w * 2; x += 12) {
        const g = b.createLinearGradient(x, 0, x + 12, 0);
        g.addColorStop(0, 'rgb(90,90,90)');
        g.addColorStop(0.5, 'rgb(190,190,190)');
        g.addColorStop(1, 'rgb(90,90,90)');
        b.fillStyle = g;
        b.fillRect(x, y0, 12, seal + 6);
      }
    }
    // a few soft wrinkle lines in the body
    const r = rng(5);
    b.strokeStyle = 'rgba(80,80,80,0.5)';
    b.lineCap = 'round';
    b.filter = 'blur(3px)';
    for (let i = 0; i < 22; i++) {
      const x = r() * w * 2;
      const y = r() > 0.5 ? seal + 10 + r() * 60 : h - seal - 10 - r() * 60;
      b.lineWidth = 4 + r() * 6;
      b.beginPath();
      b.moveTo(x, y);
      b.lineTo(x + (r() - 0.5) * 40, y + (y < h / 2 ? 1 : -1) * (40 + r() * 70));
      b.stroke();
    }
    b.filter = 'none';
  });
}

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- printed foil atlas: left half front, right half back
  const FW = 1024;
  const FH = Math.round((FW * H) / W);
  const atlas = new Surface(FW * 2, FH, bctx, { transparent: true, mask: { rough: 0.2, metal: 0.38 }, bump: { base: 0.5, density: 0.5 } });
  paintFront(atlas, 0, FW, FH);
  paintBack(atlas, FW, FW, FH);
  cutTeeth(atlas.c, 0, FW, FH);
  cutTeeth(atlas.c, FW, FW, FH);
  grain(atlas.c, 0, 0, FW * 2, FH, 9000, 0.05, 6);
  paintCrimpBump(atlas, FW, FH);
  const mask = atlas.maskTexture();
  const bagMat = new THREE.MeshPhysicalMaterial({
    map: atlas.colorTexture(),
    roughnessMap: mask,
    metalnessMap: mask,
    bumpMap: atlas.bumpTexture(),
    bumpScale: 1.2,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    alphaTest: 0.5,
    side: THREE.FrontSide,
  });
  const NU = 72;
  const NV = 96;
  const front = parametric(NU, NV, (u, v, out) => bagPoint(u, v, 1, out), { uv: (u, v) => [u * 0.5, v] });
  const back = parametric(NU, NV, (u, v, out) => bagPoint(u, v, -1, out), { uv: (u, v) => [0.5 + u * 0.5, v] });
  const bagGeo = merge([front, back]);
  front.dispose();
  back.dispose();
  inner.add(new THREE.Mesh(bagGeo, bagMat));

  // ---------- stickers hanging over the edges (NEW badge top-left, BEST BEFORE label top-right)
  const sheet = new StickerSheet(1024, 512, bctx, 12);
  const cNew = sheet.alloc(330, 380);
  inCell(sheet, cNew, (c) => {
    sticker(c, 0, 0, 0, rrPath(-150, -172, 300, 344, 10), { border: 0, fill: '#ffe066', shadow: 0.6 }, (q) => {
      fillPath(q, rrPath(-136, -158, 272, 316, 6), '#ffd21a');
      text(q, 'NEW!', 0, -70, { size: 92, family: FONTS.bagel, align: 'center', color: '#ff9a1a', outlines: [{ color: '#c25a00', width: 6 }] });
      text(q, 'BETA', 0, 22, { size: 84, family: FONTS.bagel, align: 'center', color: '#ffb21a', outlines: [{ color: '#c25a00', width: 6 }] });
      text(q, 'FLAVOR', 0, 112, { size: 72, family: FONTS.bagel, align: 'center', color: '#ffb21a', outlines: [{ color: '#c25a00', width: 6 }], maxWidth: 250 });
    });
  });
  const cBest = sheet.alloc(560, 130);
  inCell(sheet, cBest, (c) => {
    sticker(c, 0, 0, 0, rrPath(-268, -54, 536, 108, 6), { border: 0, fill: '#ffd21a', shadow: 0.6 }, (q) => {
      text(q, 'BEST BEFORE: SHIP DATE', 0, 14, { size: 40, family: FONTS.archivoBlack, align: 'center', color: '#141414', maxWidth: 500 });
    });
  });
  const sheetTex = sheet.surf.colorTexture();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmp3 = new THREE.Vector3();
  // drape over the front surface; beyond the side edges continue flat
  const drape = (x: number, y: number): SurfacePoint => {
    const v = THREE.MathUtils.clamp(y / H + 0.5, 0.0, 1.0);
    const span = W * (1 - PINCH * puffY(v));
    const u = x / span + 0.5;
    const uc = THREE.MathUtils.clamp(u, 0.035, 0.965);
    bagPoint(uc, v, 1, tmp);
    const e = 0.002;
    bagPoint(Math.min(1, uc + e), v, 1, tmp2).sub(bagPoint(Math.max(0, uc - e), v, 1, tmp3));
    const du = tmp2.clone();
    bagPoint(uc, Math.min(1, v + e), 1, tmp2).sub(bagPoint(uc, Math.max(0, v - e), 1, tmp3));
    const n = du.cross(tmp2).normalize();
    if (u !== uc) return { p: new THREE.Vector3(x, tmp.y, tmp.z), n: new THREE.Vector3(0, 0, 1) };
    return { p: tmp.clone(), n };
  };
  const cm = (cell: AtlasCell, wcm: number) => wcm * (cell.h / cell.w);
  const geos = [
    stickerPatch(drape, -0.74, 0.43, 0.4, cm(cNew, 0.4), 9 * DEG, cNew.uv, { nx: 16, ny: 16, offset: 0.008 }),
    stickerPatch(drape, 0.62, 0.62, 0.62, cm(cBest, 0.62), -9 * DEG, cBest.uv, { nx: 20, ny: 6, offset: 0.008 }),
  ];
  const stickersGeo = merge(geos);
  geos.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.4, clearcoat: 0.6 }), '#f3efe6')));

  return finish(inner, trash, undefined, 'prototype-chips');
}

function inCell(sheet: StickerSheet, cell: AtlasCell, fn: (c: C2D) => void): void {
  const c = sheet.surf.c;
  c.save();
  c.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  fn(c);
  c.restore();
}

export const chips: ObjectDef = {
  kind: 'chips',
  name: 'Prototype Chips',
  tagline: 'sea salt & iteration',
  defaultRotation: [0.08, -0.3, 0.05],
  build,
};
