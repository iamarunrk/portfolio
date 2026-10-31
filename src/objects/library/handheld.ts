import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet, canvasTexture } from '../textures';
import { Trash, finish } from '../build';
import { lathe, merge, place, ribbon, stickerPatch, surfaces, tint } from '../geometry';
import { chrome, glossyPlastic, holoFoil, paperBackfaces, stickerSheet } from '../materials';
import { FONTS, DEG, rng, text, sticker, rrPath, rrect, starPath, holoFill, fillPath, smallPrint, barcode, grain } from '../paint';
import { decalPlane, frostedPlastic, inCell, peelLift, roundRectShape, screwHead, smoothSlab, type Corners } from './_translucent';

/*
 * POCKET ZERO: our own handheld in "cloudy plastic" (after the frosted render the user
 * pinned). Milky translucent shell with the PCB, chips, membranes, AAA cells and flex cable
 * glowing through, a big black glass panel with a lime dot-matrix display (the Zeros
 * mascot pushing a box to the SHIP flag), a black D-pad, red S (ship) and D (design)
 * buttons, a teal menu pill and a round slotted speaker. Centimetres, normalised after.
 */

const W = 8.6;
const H = 13.8;
const D = 2.4;
const HALF = D / 2;
const BEV = 0.3;
const SEAM = 0.03;
const CORNERS: Corners = [0.75, 0.75, 2.1, 0.9];

const PANEL = { cx: 0, cy: 3.55, w: 7.4, h: 5.7, r: 0.42, t: 0.1 };
const DISP = { dx: 0, dy: 0.3, w: 6.0, h: 4.5 }; // relative to the panel centre
const DPAD = { x: -2.15, y: -1.55 };
const BTN_S = { x: 1.3, y: -1.3 };
const BTN_D = { x: 2.9, y: -1.3 };
const BTN_R = 0.6;
const PILL = { x: -2.2, y: -3.95 };
const GRILLE = { x: 2.35, y: -4.62, r: 1.05 };
const SLOTS = [-0.72, -0.36, 0, 0.36, 0.72];

const LIME = '#d7ff3a';
const PINK = '#ff4fb8';
const INK = '#0b0b0d';
const RED = '#ec2d27';
const TEAL = '#25c6d8';
const PIX = ['#0e1605', '#305612', '#86b81f', '#d7ff3a'];

// ------------------------------------------------------------------ pixel display

const FONT5x7: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

function pixText(c: CanvasRenderingContext2D, str: string, x: number, y: number, scale: number, color: string): number {
  c.fillStyle = color;
  let cx = x;
  for (const ch of str) {
    const g = FONT5x7[ch] ?? FONT5x7[' '];
    g.forEach((row, j) => {
      for (let i = 0; i < 5; i++) if (row[i] === '#') c.fillRect(cx + i * scale, y + j * scale, scale, scale);
    });
    cx += 6 * scale;
  }
  return cx - x - scale;
}

/** One frame of the 120 x 90 dot-matrix scene. */
function drawPixels(c: CanvasRenderingContext2D, frame: number): void {
  const [P0, P1, P2, P3] = PIX;
  c.fillStyle = P3;
  c.fillRect(0, 0, 120, 90);
  // title
  const tw = 5 * 12 - 2;
  pixText(c, 'ZEROS', 60 - tw / 2 + 1, 6, 2, P1);
  pixText(c, 'ZEROS', 60 - tw / 2, 5, 2, P0);
  // clouds drift
  const cloud = (x: number, y: number) => {
    c.fillStyle = P2;
    c.fillRect(x + 2, y, 6, 1);
    c.fillRect(x, y + 1, 11, 2);
    c.fillRect(x + 1, y + 3, 9, 1);
  };
  const drift = (frame * 0.5) % 140;
  cloud(((100 - drift + 140) % 140) - 12, 25);
  cloud(((40 - drift * 0.7 + 140) % 140) - 12, 31);
  // blinking prompt (on for most of the cycle, and at frame 0)
  if (frame % 12 < 8) pixText(c, 'PRESS S TO SHIP', 15, 40, 1, P0);
  // ground with scrolling dashes
  c.fillStyle = P0;
  c.fillRect(0, 77, 120, 1);
  c.fillStyle = P1;
  for (let x = -(frame * 2) % 8; x < 120; x += 8) c.fillRect(x, 80, 4, 1);
  for (let x = -(frame * 2 + 4) % 12; x < 120; x += 12) c.fillRect(x, 84, 2, 1);
  // flag
  c.fillStyle = P0;
  c.fillRect(104, 57, 1, 20);
  c.fillStyle = P1;
  for (let j = 0; j < 7; j++) c.fillRect(105, 57 + j, 8 - Math.abs(3 - j) * 2, 1);
  // the mascot: a walking zero with eyes, pushing a box
  const walk = frame % 2;
  const mx = 36 + ((frame * 2) % 24);
  const my = 63;
  c.fillStyle = P0;
  // ring body (8 x 11)
  const ring = ['..####..', '.#....#.', '#......#', '#......#', '#......#', '#......#', '#......#', '#......#', '#......#', '.#....#.', '..####..'];
  ring.forEach((row, j) => {
    for (let i = 0; i < 8; i++) if (row[i] === '#') c.fillRect(mx + i, my + j, 1, 1);
  });
  c.fillStyle = P1;
  c.fillRect(mx + 2, my + 1, 4, 1);
  c.fillStyle = P0;
  c.fillRect(mx + 3, my + 3, 1, 2);
  c.fillRect(mx + 5, my + 3, 1, 2);
  // arms out to the box
  c.fillRect(mx + 8, my + 6, 2, 1);
  // legs (two frames)
  if (walk) {
    c.fillRect(mx + 2, my + 11, 1, 3);
    c.fillRect(mx + 5, my + 11, 1, 2);
    c.fillRect(mx + 6, my + 13, 1, 1);
  } else {
    c.fillRect(mx + 2, my + 11, 1, 2);
    c.fillRect(mx + 1, my + 13, 1, 1);
    c.fillRect(mx + 5, my + 11, 1, 3);
  }
  // box
  const bx = mx + 10;
  const by = 66;
  c.fillStyle = P0;
  c.fillRect(bx, by, 11, 11);
  c.fillStyle = P2;
  c.fillRect(bx + 1, by + 1, 9, 9);
  c.fillStyle = P1;
  c.fillRect(bx + 5, by + 1, 1, 9);
  c.fillRect(bx + 1, by + 4, 9, 1);
  c.fillStyle = P0;
  c.fillRect(bx + 2, by + 6, 2, 1);
  c.fillRect(bx + 3, by + 7, 1, 1);
  c.fillRect(bx + 2, by + 8, 2, 1);
  // little hearts above when the box reaches the flag
  if (mx + 21 > 96) {
    c.fillStyle = P1;
    c.fillRect(bx + 3, by - 6, 1, 1);
    c.fillRect(bx + 5, by - 6, 1, 1);
    c.fillRect(bx + 3, by - 5, 3, 1);
    c.fillRect(bx + 4, by - 4, 1, 1);
  }
}

interface Display {
  surf: Surface;
  tex: THREE.CanvasTexture;
  low: HTMLCanvasElement;
  frame: number;
}

const PANEL_PX = 100; // design px per cm on the panel textures
const PW = PANEL.w * PANEL_PX;
const PH = PANEL.h * PANEL_PX;
const DISP_PX = {
  x: (PANEL.w / 2 + DISP.dx - DISP.w / 2) * PANEL_PX,
  y: (PANEL.h / 2 - DISP.dy - DISP.h / 2) * PANEL_PX,
  w: DISP.w * PANEL_PX,
  h: DISP.h * PANEL_PX,
};

function drawDisplay(d: Display, frame: number): void {
  d.frame = frame;
  const lc = d.low.getContext('2d')!;
  drawPixels(lc, frame);
  const c = d.surf.c;
  c.fillStyle = '#000';
  c.fillRect(0, 0, PW, PH);
  c.save();
  c.imageSmoothingEnabled = false;
  c.drawImage(d.low, DISP_PX.x, DISP_PX.y, DISP_PX.w, DISP_PX.h);
  c.restore();
  // dot-matrix gaps
  const cell = DISP_PX.w / 120;
  c.fillStyle = 'rgba(70,100,10,0.32)';
  for (let i = 0; i <= 120; i++) c.fillRect(DISP_PX.x + i * cell - 0.6, DISP_PX.y, 1.2, DISP_PX.h);
  for (let j = 0; j <= 90; j++) c.fillRect(DISP_PX.x, DISP_PX.y + j * cell - 0.6, DISP_PX.w, 1.2);
  // soft vignette towards the corners of the LCD
  const v = c.createRadialGradient(DISP_PX.x + DISP_PX.w / 2, DISP_PX.y + DISP_PX.h / 2, DISP_PX.h * 0.35, DISP_PX.x + DISP_PX.w / 2, DISP_PX.y + DISP_PX.h / 2, DISP_PX.w * 0.68);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.38)');
  c.fillStyle = v;
  c.fillRect(DISP_PX.x, DISP_PX.y, DISP_PX.w, DISP_PX.h);
  d.tex.needsUpdate = true;
}

/** Printed black glass: frame around the LCD, wordmark, battery LED label. */
function paintGlass(s: Surface): void {
  const c = s.c;
  const g = c.createLinearGradient(0, 0, PW, PH);
  g.addColorStop(0, '#131418');
  g.addColorStop(1, '#08090b');
  c.fillStyle = g;
  c.fillRect(0, 0, PW, PH);
  c.fillStyle = '#030303';
  c.fillRect(DISP_PX.x, DISP_PX.y, DISP_PX.w, DISP_PX.h);
  c.strokeStyle = 'rgba(215,255,58,0.55)';
  c.lineWidth = 3;
  c.beginPath();
  rrect(c, DISP_PX.x - 12, DISP_PX.y - 12, DISP_PX.w + 24, DISP_PX.h + 24, 10);
  c.stroke();
  const by = DISP_PX.y + DISP_PX.h + 58;
  text(c, 'POCKET', PW / 2 - 10, by, { size: 34, family: FONTS.rubikMono, align: 'right', color: '#e9e9ee' });
  text(c, 'ZERO', PW / 2 + 4, by, { size: 34, family: FONTS.rubikMono, align: 'left', color: LIME });
  smallPrint(c, ['BATTERY'], 70, by - 8, 13, '#9a9aa2', { weight: 700 });
  smallPrint(c, ['DOT MATRIX', '4 SHADES OF LIME'], PW - 40, by - 30, 13, '#9a9aa2', { weight: 700, align: 'right', lineHeight: 15 });
  grain(c, 0, 0, PW, PH, 2500, 0.04, 8);
}

// ------------------------------------------------------------------ printed shell + stickers

const PRINT = { x0: -4.0, x1: 4.0, y0: -6.6, y1: 0.55 };
const PRINT_PX = 110;

function paintPrint(s: Surface): void {
  const c = s.c;
  const P = (x: number, y: number): [number, number] => [(x - PRINT.x0) * PRINT_PX, (PRINT.y1 - y) * PRINT_PX];
  const ink = 'rgba(40,44,52,0.86)';
  const label = (str: string, x: number, y: number, size = 24) => {
    const [px, py] = P(x, y);
    text(c, str, px, py, { size, family: FONTS.archivoBlack, align: 'center', color: ink, tracking: 2 });
  };
  label('SHIP', BTN_S.x, BTN_S.y - 0.95);
  label('DESIGN', BTN_D.x, BTN_D.y - 0.95);
  label('MENU', PILL.x, PILL.y - 0.62, 20);
  // D-pad arrows ring
  {
    const [cx, cy] = P(DPAD.x, DPAD.y);
    c.strokeStyle = 'rgba(40,44,52,0.35)';
    c.lineWidth = 3;
    c.setLineDash([6, 9]);
    c.beginPath();
    c.arc(cx, cy, 1.72 * PRINT_PX, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
  }
  // speaker ring print
  {
    const [cx, cy] = P(GRILLE.x, GRILLE.y);
    c.strokeStyle = ink;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(cx, cy, (GRILLE.r + 0.28) * PRINT_PX, 0.9 * Math.PI, 2.1 * Math.PI);
    c.stroke();
  }
  const [bx, by] = P(-3.55, -6.05);
  smallPrint(c, ['ZEROS · PZ-0'], bx, by, 18, ink, { weight: 700 });
  const [hx, hy] = P(0.15, -6.05);
  smallPrint(c, ['◀ PHONES'], hx, hy, 15, 'rgba(40,44,52,0.6)', { weight: 700 });
}

function paintButtons(s: Surface): void {
  const c = s.c;
  for (const [i, ch] of [
    [0, 'S'],
    [1, 'D'],
  ] as const) {
    const cx = 128 + i * 256;
    const g = c.createRadialGradient(cx - 40, 90, 10, cx, 128, 150);
    g.addColorStop(0, '#ff5b4a');
    g.addColorStop(1, RED);
    c.fillStyle = g;
    c.fillRect(i * 256, 0, 256, 256);
    text(c, ch, cx + 3, 128 + 44, { size: 120, family: FONTS.archivoBlack, align: 'center', color: 'rgba(255,190,170,0.55)' });
    text(c, ch, cx, 128 + 40, { size: 120, family: FONTS.archivoBlack, align: 'center', color: '#8e1410' });
  }
}

function paintPCB(s: Surface): void {
  const c = s.c;
  c.fillStyle = '#183a2c';
  c.fillRect(0, 0, s.w, s.h);
  const r = rng(77);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (let i = 0; i < 90; i++) {
    c.strokeStyle = r() > 0.25 ? 'rgba(201,168,74,0.9)' : 'rgba(120,200,160,0.5)';
    c.lineWidth = 2 + r() * 4;
    let x = r() * s.w;
    let y = r() * s.h;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      if (r() > 0.5) x += (r() - 0.5) * 260;
      else y += (r() - 0.5) * 260;
      c.lineTo(x, y);
    }
    c.stroke();
    fillPath(c, (p) => p.arc(x, y, 6, 0, Math.PI * 2), '#e3c463');
  }
  smallPrint(c, ['POCKET ZERO MAIN REV.0', 'S = SHIP  D = DESIGN', '(c) ONCE UPON A TIME'], 40, s.h - 120, 26, '#d8f5e4', { weight: 700, lineHeight: 30 });
}

function paintStickers(sheet: StickerSheet) {
  const ship = sheet.alloc(420, 210);
  inCell(sheet, ship, (c) => {
    sticker(c, 0, 0, 0, rrPath(-196, -92, 392, 184, 92), { border: 12, fill: LIME, shadow: 0.7 }, (q) => {
      text(q, 'PRESS S', -16, -6, { size: 62, family: FONTS.bagel, align: 'center', color: INK });
      text(q, 'TO SHIP', -16, 56, { size: 50, family: FONTS.archivoBlack, align: 'center', color: INK, tracking: 2 });
      // pixel arrow
      q.fillStyle = INK;
      const px = 120;
      const py = -30;
      const s = 9;
      const rows = ['#....', '##...', '###..', '####.', '###..', '##...', '#....'];
      rows.forEach((row, j) => {
        for (let i = 0; i < 5; i++) if (row[i] === '#') q.fillRect(px + i * s, py + j * s, s, s);
      });
    });
  });
  const z = sheet.alloc(170, 170);
  inCell(sheet, z, (c) => {
    sticker(c, 0, 0, 0, (q) => q.arc(0, 0, 74, 0, Math.PI * 2), { border: 9, fill: PINK, shadow: 0.7 }, (q) => {
      q.strokeStyle = '#ffffff';
      q.lineWidth = 15;
      q.beginPath();
      q.ellipse(0, 0, 30, 42, 0, 0, Math.PI * 2);
      q.stroke();
      q.lineWidth = 8;
      q.beginPath();
      q.moveTo(-24, 32);
      q.lineTo(24, -34);
      q.stroke();
    });
  });
  const back = sheet.alloc(640, 470);
  inCell(sheet, back, (c) => {
    sticker(c, 0, 0, 0, rrPath(-306, -222, 612, 444, 22), { border: 0, fill: '#f4efe2', shadow: 0.5 }, (q) => {
      q.fillStyle = INK;
      q.fillRect(-306, -222, 612, 92);
      text(q, 'POCKET', -40, -158, { size: 46, family: FONTS.rubikMono, align: 'right', color: '#ffffff' });
      text(q, 'ZERO', -24, -158, { size: 46, family: FONTS.rubikMono, align: 'left', color: LIME });
      smallPrint(
        q,
        ['MODEL NO. PZ-0', 'INPUT: 2 x AAA  (or one big idea)', 'BUTTONS: S = SHIP, D = DESIGN', 'DISPLAY: 4 SHADES OF LIME', 'DESIGNED IN THE TIMELINE', 'BY A FORMER PRODUCT DESIGNER.', 'MADE BY ZEROS.'],
        -280,
        -108,
        24,
        INK,
        { weight: 700, lineHeight: 30 },
      );
      barcode(q, 92, 96, 190, 96, 2024, { digits: '0 00000 00000 0' });
      q.strokeStyle = INK;
      q.lineWidth = 4;
      q.beginPath();
      q.arc(-230, 160, 34, 0, Math.PI * 2);
      q.stroke();
      text(q, 'CE?', -230, 172, { size: 30, family: FONTS.archivoBlack, align: 'center', color: INK });
      text(q, 'NO', -150, 172, { size: 30, family: FONTS.archivoBlack, align: 'center', color: INK });
    });
  });
  const star = sheet.alloc(300, 300);
  inCell(sheet, star, (c) => {
    const path = starPath(0, 0, 136, 88, 7, -Math.PI / 2, 0.5);
    sticker(c, 0, 0, 0, path, { border: 11, borderColor: '#f7f7f7', shadow: 0.7 }, (q) => {
      holoFill(q, path, -140, -140, 280, 280, 33);
      text(q, 'LVL', 0, -4, { size: 50, family: FONTS.archivoBlack, align: 'center', color: '#2a1a5e' });
      text(q, '0', 0, 70, { size: 84, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: '#2a1a5e', width: 12 }] });
    });
  });
  return { ship, z, back, star };
}

// ------------------------------------------------------------------ geometry

function bodyShape(): THREE.Shape {
  const c = CORNERS.map((r) => r - BEV) as Corners;
  return roundRectShape(0, 0, W - 2 * BEV, H - 2 * BEV, c);
}

function shellHalf(sign: number): THREE.BufferGeometry {
  const s = bodyShape();
  if (sign > 0) {
    for (const dx of SLOTS) {
      const half = Math.sqrt(Math.max(0, GRILLE.r * GRILLE.r - dx * dx)) - 0.12;
      s.holes.push(slotPath(GRILLE.x + dx, GRILLE.y, 0.09, half - 0.09));
    }
  }
  const depth = HALF - SEAM;
  const g = smoothSlab(s, depth, BEV, { bevelSegments: 4, curveSegments: 10 });
  g.translate(0, 0, sign * (SEAM + depth / 2));
  return g;
}

/** Vertical stadium slot (low-poly, built from points so the extrusion stays light). */
function slotPath(cx: number, cy: number, r: number, halfLen: number): THREE.Path {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI;
    pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + halfLen + Math.sin(a) * r));
  }
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI + (i / 6) * Math.PI;
    pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy - halfLen + Math.sin(a) * r));
  }
  return new THREE.Path(pts);
}

function ring(r0: number, r1: number, h: number, z: number, x: number, y: number): THREE.BufferGeometry {
  const g = lathe(
    [
      [r0, 0],
      [r0, h * 0.7],
      [r0 + (r1 - r0) * 0.3, h],
      [r1 - (r1 - r0) * 0.3, h],
      [r1, h * 0.7],
      [r1, 0],
    ],
    { segments: 48 },
  );
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function dpad(): THREE.BufferGeometry {
  const a = 0.39;
  const L = 1.2;
  const s = new THREE.Shape();
  const r = 0.1;
  const pts: [number, number][] = [
    [a, L],
    [a, a],
    [L, a],
    [L, -a],
    [a, -a],
    [a, -L],
    [-a, -L],
    [-a, -a],
    [-L, -a],
    [-L, a],
    [-a, a],
    [-a, L],
  ];
  // rounded outer corners (every second point pair are arm tips)
  s.moveTo(-a + r, L);
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const outer = Math.abs(Math.abs(x) - L) < 1e-6 || Math.abs(Math.abs(y) - L) < 1e-6;
    if (!outer) {
      s.lineTo(x, y);
      continue;
    }
    const prev = pts[(i + pts.length - 1) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const toward = (p: [number, number], k: number): [number, number] => {
      const dx = p[0] - x;
      const dy = p[1] - y;
      const l = Math.hypot(dx, dy);
      return [x + (dx / l) * k, y + (dy / l) * k];
    };
    const p0 = toward(prev, r);
    const p1 = toward(next, r);
    s.lineTo(p0[0], p0[1]);
    s.quadraticCurveTo(x, y, p1[0], p1[1]);
  }
  s.closePath();
  const body = tint(smoothSlab(s, 0.42, 0.1, { bevelSegments: 3, curveSegments: 6 }), '#17181b');
  body.translate(0, 0, 0.21);
  const parts = [body];
  const dimple = tint(new THREE.CircleGeometry(0.2, 24), '#2c2e33');
  dimple.translate(0, 0, 0.423);
  parts.push(dimple);
  for (let k = 0; k < 4; k++) {
    const tri = new THREE.Shape();
    tri.moveTo(0, 0.13);
    tri.lineTo(0.11, -0.05);
    tri.lineTo(-0.11, -0.05);
    tri.closePath();
    const g = tint(new THREE.ShapeGeometry(tri), '#4b4f57');
    g.translate(0, 0.86, 0.424);
    g.rotateZ((k * Math.PI) / 2);
    parts.push(g);
  }
  const out = merge(parts);
  parts.forEach((g) => g.dispose());
  return out;
}

function button(u0: number): THREE.BufferGeometry {
  const R = BTN_R;
  const g = lathe(
    [
      [0, 0],
      [R, 0],
      [R + 0.02, 0.1],
      [R, 0.24],
      [R * 0.8, 0.36],
      [R * 0.45, 0.41],
      [0, 0.42],
    ],
    { segments: 40, uv: (x, _y, z) => [u0 + (x / (2 * R) + 0.5) * 0.5, 0.5 - z / (2 * R)] },
  );
  g.rotateX(Math.PI / 2);
  return g;
}

/** Knurled thumb wheel, axis +Z. */
function wheel(r: number, t: number): THREE.BufferGeometry {
  const g = lathe(
    [
      [0, -t / 2],
      [r * 0.9, -t / 2],
      [r, -t / 2 + 0.05],
      [r, t / 2 - 0.05],
      [r * 0.9, t / 2],
      [0, t / 2],
    ],
    { segments: 72, radial: (phi, j) => (j === 2 || j === 3 ? 0.03 * Math.cos(phi * 36) : 0) },
  );
  g.rotateX(Math.PI / 2);
  return g;
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  const front = HALF;

  // ---------- cloudy shell (two halves) + raised rims and the battery door
  const shellParts: THREE.BufferGeometry[] = [shellHalf(1), shellHalf(-1)];
  shellParts.push(ring(1.42, 1.62, 0.14, front - 0.02, DPAD.x, DPAD.y));
  shellParts.push(ring(BTN_R + 0.1, BTN_R + 0.26, 0.12, front - 0.02, BTN_S.x, BTN_S.y));
  shellParts.push(ring(BTN_R + 0.1, BTN_R + 0.26, 0.12, front - 0.02, BTN_D.x, BTN_D.y));
  shellParts.push(ring(GRILLE.r + 0.06, GRILLE.r + 0.2, 0.08, front - 0.02, GRILLE.x, GRILLE.y));
  {
    const door = smoothSlab(roundRectShape(0, 0, 6.4, 3.8, 0.45), 0.16, 0.05, { bevelSegments: 2 });
    door.rotateY(Math.PI);
    door.translate(0, -3.95, -front - 0.04);
    shellParts.push(door);
    for (let i = 0; i < 5; i++) {
      const rib = smoothSlab(roundRectShape(0, 0, 1.6, 0.09, 0.04), 0.1, 0.02, { bevelSegments: 1, curveSegments: 4 });
      rib.translate(0, -4.95 + i * 0.22, -front - 0.15);
      shellParts.push(rib);
    }
  }
  const shellGeo = merge(shellParts);
  shellParts.forEach((g) => g.dispose());
  const shellMat = frostedPlastic('#f6f8fb', {
    roughness: 0.4,
    transmission: 0.9,
    thickness: 2.2,
    attenuationColor: new THREE.Color('#e6edf4'),
    attenuationDistance: 10,
    clearcoat: 0.85,
    clearcoatRoughness: 0.2,
    emissive: new THREE.Color('#dfe6ee'),
    emissiveIntensity: 0.1,
  });
  inner.add(new THREE.Mesh(shellGeo, shellMat));

  // ---------- black glass panel + printed glass / emissive LCD on one plane
  const panelGeo = smoothSlab(roundRectShape(0, 0, PANEL.w - 0.08, PANEL.h - 0.08, PANEL.r), PANEL.t + 0.08, 0.04, { bevelSegments: 2 });
  panelGeo.translate(PANEL.cx, PANEL.cy, front + PANEL.t / 2 - 0.04);
  const glassSurf = new Surface(PW, PH, bctx, { density: 1.1 });
  paintGlass(glassSurf);
  const dispSurf = new Surface(PW, PH, bctx, { density: 0.9 });
  const low = document.createElement('canvas');
  low.width = 120;
  low.height = 90;
  const dispTex = canvasTexture(dispSurf.color.canvas, bctx, true);
  dispTex.generateMipmaps = false;
  dispTex.minFilter = THREE.LinearFilter;
  const disp: Display = { surf: dispSurf, tex: dispTex, low, frame: -1 };
  drawDisplay(disp, 0);
  const screenGeo = place(decalPlane(PANEL.w - 0.1, PANEL.h - 0.1, [0.0068, 0.0088, 0.9932, 0.9912]), [PANEL.cx, PANEL.cy, front + PANEL.t + 0.004]);
  const screenMat = new THREE.MeshPhysicalMaterial({
    map: glassSurf.colorTexture(),
    emissive: '#ffffff',
    emissiveMap: dispTex,
    emissiveIntensity: 1.15,
    roughness: 0.2,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
  inner.add(new THREE.Mesh(screenGeo, screenMat));

  // ---------- printed legends on the frosted face
  const print = new Surface((PRINT.x1 - PRINT.x0) * PRINT_PX, (PRINT.y1 - PRINT.y0) * PRINT_PX, bctx, { density: 0.8, transparent: true });
  paintPrint(print);
  const printGeo = place(decalPlane(PRINT.x1 - PRINT.x0, PRINT.y1 - PRINT.y0, [0, 0, 1, 1]), [(PRINT.x0 + PRINT.x1) / 2, (PRINT.y0 + PRINT.y1) / 2, front + 0.004]);
  inner.add(new THREE.Mesh(printGeo, new THREE.MeshPhysicalMaterial({ map: print.colorTexture(), transparent: true, alphaTest: 0.02, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));

  // ---------- D-pad, gaskets, wheel, power slider, ports (dark plastic, vertex coloured)
  const darkParts: THREE.BufferGeometry[] = [tint(panelGeo, '#0b0c0e')];
  darkParts.push(place(dpad(), [DPAD.x, DPAD.y, front + 0.02]));
  darkParts.push(tint(place(new THREE.CircleGeometry(1.42, 48), [DPAD.x, DPAD.y, front + 0.01]), '#3a3d44'));
  for (const b of [BTN_S, BTN_D]) darkParts.push(tint(place(new THREE.CircleGeometry(BTN_R + 0.1, 40), [b.x, b.y, front + 0.01]), '#3a3d44'));
  {
    const gasket = new THREE.CapsuleGeometry(0.3, 1.05, 6, 16).rotateZ(Math.PI / 2);
    gasket.scale(1, 1, 0.2);
    darkParts.push(tint(place(gasket, [PILL.x, PILL.y, front]), '#3a3d44'));
  }
  darkParts.push(tint(place(wheel(0.78, 0.34), [W / 2 - 0.42, -1.75, -0.25]), '#202227'));
  darkParts.push(tint(place(new THREE.BoxGeometry(0.95, 0.3, 0.5), [-2.5, H / 2 + 0.02, 0.15]), '#202227'));
  darkParts.push(tint(place(new THREE.BoxGeometry(0.62, 0.04, 0.2), [-2.5, H / 2 + 0.18, 0.15]), '#d7ff3a'));
  // bottom ports: USB-C and phones jack (dark holes)
  darkParts.push(tint(place(new THREE.CapsuleGeometry(0.14, 0.6, 4, 12).rotateZ(Math.PI / 2), [0.9, -H / 2 + 0.02, 0], [0, 0, 0], [1, 1, 1]), '#08090b'));
  darkParts.push(tint(place(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 20), [-1.3, -H / 2 + 0.02, 0]), '#08090b'));
  // dark floors inside the speaker slots
  for (const dx of SLOTS) {
    const half = Math.sqrt(Math.max(0, GRILLE.r * GRILLE.r - dx * dx)) - 0.12;
    darkParts.push(tint(place(new THREE.BoxGeometry(0.16, half * 2, 0.04), [GRILLE.x + dx, GRILLE.y, front - 0.35]), '#0c0d10'));
  }
  {
    const pill = new THREE.CapsuleGeometry(0.23, 0.95, 8, 20).rotateZ(Math.PI / 2);
    pill.scale(1, 1, 0.75);
    darkParts.push(tint(place(pill, [PILL.x, PILL.y, front + 0.1]), TEAL));
  }
  const darkGeo = merge(darkParts);
  darkParts.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(darkGeo, glossyPlastic('#ffffff', { vertexColors: true, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08 })));

  // ---------- S / D buttons
  const btnSurf = new Surface(512, 256, bctx, { density: 0.8 });
  paintButtons(btnSurf);
  const bs = place(button(0), [BTN_S.x, BTN_S.y, front + 0.02]);
  const bd = place(button(0.5), [BTN_D.x, BTN_D.y, front + 0.02]);
  const btnGeo = merge([bs, bd]);
  bs.dispose();
  bd.dispose();
  inner.add(new THREE.Mesh(btnGeo, new THREE.MeshPhysicalMaterial({ map: btnSurf.colorTexture(), roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 })));

  // ---------- chrome: back screws, port rims
  const chr: THREE.BufferGeometry[] = [];
  for (const [x, y] of [
    [-3.45, 6.0],
    [3.45, 6.0],
    [-3.4, -6.0],
    [2.75, -5.55],
  ] as [number, number][]) {
    const g = screwHead(0.24);
    g.rotateZ(x * 3.1);
    g.rotateY(Math.PI);
    chr.push(place(g, [x, y, -front + 0.01]));
  }
  chr.push(tint(place(new THREE.TorusGeometry(0.21, 0.04, 8, 24).rotateX(Math.PI / 2), [-1.3, -H / 2 + 0.05, 0]), '#e8ebef'));
  const chromeGeo = merge(chr);
  chr.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(chromeGeo, chrome({ vertexColors: true, roughness: 0.15 })));

  // ---------- internals glowing through the cloudy plastic
  const pcbSurf = new Surface(1024, 1024, bctx, { density: 0.5 });
  paintPCB(pcbSurf);
  const pcbShape = roundRectShape(0, -2.75, 7.5, 7.3, [0.4, 0.4, 1.8, 0.6]);
  const pcbGeo = smoothSlab(pcbShape, 0.12, 0.02, { bevelSegments: 1, curveSegments: 8, keepUV: true });
  const pcbTex = pcbSurf.colorTexture();
  pcbTex.wrapS = THREE.RepeatWrapping;
  pcbTex.wrapT = THREE.RepeatWrapping;
  pcbTex.repeat.set(1 / 7.5, 1 / 7.3);
  pcbTex.offset.set(0.5, 0.5 + 2.75 / 7.3);
  inner.add(new THREE.Mesh(pcbGeo, new THREE.MeshStandardMaterial({ map: pcbTex, roughness: 0.55, metalness: 0.1 })));

  const guts: THREE.BufferGeometry[] = [];
  const rr = rng(4);
  // chips on the PCB front
  const chips: [number, number, number, number][] = [
    [0.1, -2.9, 1.5, 1.5],
    [-0.4, -5.0, 1.1, 0.7],
    [1.2, -3.3, 0.6, 0.5],
    [-3.2, -5.3, 0.8, 0.6],
    [0.2, 0.25, 2.4, 0.5],
  ];
  for (const [x, y, w, h] of chips) guts.push(tint(place(new THREE.BoxGeometry(w, h, 0.16), [x, y, 0.14]), '#1a1b1f'));
  for (let i = 0; i < 26; i++) guts.push(tint(place(new THREE.BoxGeometry(0.16, 0.08, 0.06), [(rr() - 0.5) * 6.5, -0.6 - rr() * 5.4, 0.09]), rr() > 0.5 ? '#c9a54a' : '#5a5f68'));
  // membranes under the buttons
  guts.push(tint(place(new THREE.CylinderGeometry(1.2, 1.2, 0.12, 40).rotateX(Math.PI / 2), [DPAD.x, DPAD.y, 0.2]), '#4a4e57'));
  for (const b of [BTN_S, BTN_D]) guts.push(tint(place(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 32).rotateX(Math.PI / 2), [b.x, b.y, 0.2]), '#4a4e57'));
  // speaker
  guts.push(tint(place(new THREE.CylinderGeometry(1.0, 0.8, 0.34, 40).rotateX(Math.PI / 2), [GRILLE.x, GRILLE.y, 0.35]), '#141518'));
  guts.push(tint(place(new THREE.CylinderGeometry(0.34, 0.34, 0.36, 24).rotateX(Math.PI / 2), [GRILLE.x, GRILLE.y, 0.36]), '#8d9199'));
  // LCD module behind the glass
  guts.push(tint(place(new THREE.BoxGeometry(6.9, 5.3, 0.55), [0, 3.65, 0.62]), '#2a2c31'));
  guts.push(tint(place(new THREE.BoxGeometry(6.2, 4.4, 0.04), [0, 3.65, 0.32]), '#a9adb5'));
  // AAA cells across the back: lime wraps with black caps and chrome tips
  for (const y of [-3.35, -4.5]) {
    guts.push(tint(place(new THREE.CylinderGeometry(0.48, 0.48, 3.9, 28).rotateZ(Math.PI / 2), [0, y, -0.62]), LIME));
    guts.push(tint(place(new THREE.CylinderGeometry(0.485, 0.485, 0.9, 28).rotateZ(Math.PI / 2), [-1.7, y, -0.62]), '#121314'));
    guts.push(tint(place(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 16).rotateZ(Math.PI / 2), [2.08, y, -0.62]), '#d9dde2'));
  }
  // amber flex cable from the LCD down to the board
  {
    const pts = [new THREE.Vector3(-1.4, 1.0, 0.45), new THREE.Vector3(-1.4, 0.75, 0.3), new THREE.Vector3(-1.4, 0.4, 0.13), new THREE.Vector3(-1.4, -0.4, 0.1)];
    const side = new THREE.Vector3(0.6, 0, 0);
    guts.push(tint(ribbon(pts, () => side), '#e08a22'));
  }
  const gutsGeo = merge(guts);
  guts.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(gutsGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15, clearcoat: 0.3, side: THREE.DoubleSide })));

  // ---------- battery LED (on the glass, pulses gently)
  const ledGeo = new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
  place(ledGeo, [PANEL.cx - PANEL.w / 2 + 0.4, PANEL.cy - PANEL.h / 2 + 0.52, front + PANEL.t], [0, 0, 0], [1, 1, 0.7]);
  const ledMat = new THREE.MeshPhysicalMaterial({ color: '#ff2a1a', emissive: '#ff2414', emissiveIntensity: 2.2, roughness: 0.15, clearcoat: 1 });
  inner.add(new THREE.Mesh(ledGeo, ledMat));

  // ---------- stickers
  const sheet = new StickerSheet(1024, 1024, bctx, 14);
  const cells = paintStickers(sheet);
  const sheetTex = sheet.surf.colorTexture();
  const frontFace = surfaces.plane(new THREE.Vector3(0, 0, front + 0.01), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const glassFace = surfaces.plane(new THREE.Vector3(0, 0, front + PANEL.t + 0.012), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const backFace = surfaces.plane(new THREE.Vector3(0, 0, -front - 0.012), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
  const paper: THREE.BufferGeometry[] = [];
  paper.push(stickerPatch(frontFace, -1.95, -5.55, 2.7, 1.35, -9 * DEG, cells.ship.uv, { nx: 10, ny: 6, offset: 0.004, lift: peelLift(0.35, 0, 0, 0.4) }));
  paper.push(stickerPatch(glassFace, 2.95, 1.12, 0.95, 0.95, 12 * DEG, cells.z.uv, { nx: 3, ny: 3, offset: 0.002 }));
  paper.push(stickerPatch(backFace, 0, 2.65, 6.2, 4.5, 0, cells.back.uv, { nx: 4, ny: 4, offset: 0.002 }));
  const paperGeo = merge(paper);
  paper.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(paperGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.42, clearcoat: 0.55, emissive: '#ffffff', emissiveMap: sheetTex, emissiveIntensity: 0.12 }), '#f1ece0')));
  const starGeo = stickerPatch(backFace, 2.25, -1.35, 2.0, 2.0, -14 * DEG, cells.star.uv, { nx: 10, ny: 10, offset: 0.004, lift: peelLift(0.3, 1, 1, 0.4) });
  inner.add(new THREE.Mesh(starGeo, holoFoil(sheetTex, { side: THREE.DoubleSide, forceSinglePass: true, metalness: 0.3, roughness: 0.25 })));

  // ---------- idle: the LCD animates at 8 fps, the LED breathes
  const update = (t: number) => {
    const f = Math.floor(t * 8);
    if (f !== disp.frame) drawDisplay(disp, f);
    const p = 0.5 + 0.5 * Math.sin(t * 2.4);
    ledMat.emissiveIntensity = 1.2 + 1.6 * p;
  };
  update(0);

  return finish(inner, trash, update, 'pocket-zero');
}

export const handheld: LibraryDef = {
  kind: 'handheld',
  name: 'Pocket Zero',
  tagline: 'cloudy plastic, crunchy pixels',
  category: 'tech',
  defaultRotation: [0.22, -0.38, 0.32],
  build,
};
export default handheld;

