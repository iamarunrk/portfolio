import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { lathe, merge, stickerPatch, type SurfacePoint } from '../geometry';
import { chrome, stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, text, sticker, rrPath, fillPath, starPath, smallPrint, barcode, grain, hexA } from '../paint';
import { ZEROS, roundedRect } from './_studio';

/*
 * SWATCH FAN: a colour fan deck. Seven coated card strips fanned ~100 degrees on a
 * chrome rivet: an ink cover strip at the back, then violet, blue, teal, pink and
 * orange families, and ZEROS LIME on top. Glossy ink chips, matte card, tiny names
 * and hex codes, a peeling NEW SHADE sticker. Centimetres, normalised afterwards.
 */

const SW = 4.0; // strip width
const SL = 14.0; // strip length
const SR = 0.38; // corner radius
const PIVOT = 0.95; // rivet distance from the strip's bottom end
const GAP = 0.13; // z spacing between strips (toy-thick card)
const THICK = 0.07;
const BEVEL = 0.02;
const FAN_FROM = 66 * DEG; // back strip leans left
const FAN_TO = -34 * DEG; // top strip leans a little right

const PX = 56; // atlas px per cm
const RW = SW * PX; // 224
const RH = SL * PX; // 784
const AW = 2048;
const AH = RH;

const INK = '#141418';
const CARD = '#fbfaf7';

interface Family {
  name: string;
  chips: [string, string][]; // [hex, name], far end first
}

const FAMILIES: Family[] = [
  { name: 'cover', chips: [] },
  {
    name: 'violet',
    chips: [
      ['#8B4DFF', 'PITCH DECK'],
      ['#6A2BE8', 'DEEP WORK'],
      ['#A97BFF', 'MOODBOARD'],
      ['#C9AEFF', 'LAVENDER UI'],
      ['#E6DAFF', 'GHOST STATE'],
    ],
  },
  {
    name: 'blue',
    chips: [
      ['#2B4BFF', 'FOUNDER BLUE'],
      ['#1730C4', 'NIGHT SHIFT'],
      ['#5D78FF', 'LINK HOVER'],
      ['#9DB0FF', 'FOCUS RING'],
      ['#D3DCFF', 'EMPTY STATE'],
    ],
  },
  {
    name: 'teal',
    chips: [
      ['#12C9A2', 'SERIES A'],
      ['#0A9B7C', 'RUNWAY'],
      ['#4FDDBE', 'SUCCESS'],
      ['#95EDD9', 'TOAST'],
      ['#CFF7EE', 'MINT CONDITION'],
    ],
  },
  {
    name: 'pink',
    chips: [
      ['#FF4FB8', 'ZEROS PINK'],
      ['#E0158C', 'HOT FIX'],
      ['#FF7DCB', 'BUBBLEGUM'],
      ['#FFB0DE', 'SOFT LAUNCH'],
      ['#FFDDF0', 'BLUSH'],
    ],
  },
  {
    name: 'orange',
    chips: [
      ['#FF5A1F', 'SHIP-IT ORANGE'],
      ['#D63C08', 'DEADLINE'],
      ['#FF8A4F', 'HOT TAKE'],
      ['#FFB98F', 'APRICOT'],
      ['#FFE2CC', 'BETA CREAM'],
    ],
  },
  {
    name: 'lime',
    chips: [
      ['#D7FF3A', 'ZEROS LIME'],
      ['#A8D400', 'GO LIVE'],
      ['#E6FF85', 'HIGHLIGHTER'],
      ['#F1FFC2', 'FRESH START'],
      ['#6F8F00', 'OLIVE BRANCH'],
    ],
  },
];
const N = FAMILIES.length;
const COMMON_BACK = N; // atlas slot
const COVER_BACK = N + 1;

const slotX = (slot: number) => slot * RW;

// ------------------------------------------------------------------ print

function paintFront(s: Surface, i: number): void {
  const c = s.c;
  const x0 = slotX(i);
  const fam = FAMILIES[i];
  c.save();
  c.beginPath();
  c.rect(x0, 0, RW, RH);
  c.clip();
  if (fam.name === 'cover') {
    c.fillStyle = INK;
    c.fillRect(x0, 0, RW, RH);
    // lime band + mark at the far end
    c.fillStyle = ZEROS.lime;
    c.fillRect(x0, 0, RW, 150);
    text(c, 'Z', x0 + 22, 122, { size: 120, family: FONTS.bagel, color: INK });
    text(c, 'ZEROS', x0 + 112, 64, { size: 26, family: FONTS.archivoBlack, color: INK, maxWidth: 100 });
    text(c, 'colour', x0 + 112, 94, { size: 20, family: FONTS.spaceMono, weight: 700, color: INK, maxWidth: 100 });
    text(c, 'guide', x0 + 112, 118, { size: 20, family: FONTS.spaceMono, weight: 700, color: INK, maxWidth: 100 });
    // the title runs from the far end towards the rivet, hugging the left edge: the side
    // of the back strip that stays visible when the deck is fanned
    c.save();
    c.translate(x0 + 18, 178);
    c.rotate(Math.PI / 2);
    text(c, 'SWATCH FAN', 0, 0, { size: 62, family: FONTS.bagel, color: ZEROS.lime, maxWidth: 560 });
    text(c, '#D7FF3A and friends', 6, -74, { size: 28, family: FONTS.marker, color: '#ffffff', maxWidth: 520 });
    c.restore();
    smallPrint(c, ['ZEROS · Z-00'], x0 + 16, RH - 34, 15, hexA('#ffffff', 0.6), { weight: 700 });
    s.maskPath((q) => q.rect(x0, 0, RW, RH), 0.32, 0);
    c.restore();
    return;
  }
  c.fillStyle = CARD;
  c.fillRect(x0, 0, RW, RH);
  const pad = 12;
  const labelH = 36;
  let y = 12;
  fam.chips.forEach(([hex, name], k) => {
    const hero = k === 0;
    const ch = hero ? 150 : 98;
    c.fillStyle = hex;
    c.fillRect(x0 + pad, y, RW - pad * 2, ch);
    s.maskPath((q) => q.rect(x0 + pad, y, RW - pad * 2, ch), 0.16, 0);
    // names sit on the left: the right side of every strip hides under its neighbour
    text(c, name, x0 + pad + 2, y + ch + 17, { size: hero ? 17 : 14.5, family: FONTS.archivoBlack, color: INK, maxWidth: RW - pad * 2 - 4 });
    smallPrint(c, [`${hex} · Z ${String(i * 100 + k * 7 + 11).padStart(4, '0')} C`], x0 + pad + 2, y + ch + 21, 11, hexA(INK, 0.7), { weight: 700 });
    y += ch + labelH;
  });
  // pivot end: strip number + brand
  smallPrint(c, [`Z-0${i}`, 'ZEROS SWATCH'], x0 + 14, RH - 64, 13, hexA(INK, 0.75), { weight: 700, lineHeight: 15 });
  c.restore();
}

function paintBacks(s: Surface): void {
  const c = s.c;
  // common back: card with small print running along the strip
  {
    const x0 = slotX(COMMON_BACK);
    c.fillStyle = CARD;
    c.fillRect(x0, 0, RW, RH);
    c.save();
    c.translate(x0 + RW / 2 + 6, RH / 2);
    c.rotate(-Math.PI / 2);
    text(c, 'ZEROS SWATCH FAN', 0, -24, { size: 30, family: FONTS.archivoBlack, align: 'center', color: hexA(INK, 0.22) });
    smallPrint(c, ['coated stock · keep out of direct sunlight', 'colours may vary from your screen (they always do)'], 0, -8, 12, hexA(INK, 0.4), { align: 'center', weight: 700, lineHeight: 15 });
    c.restore();
    s.maskPath((q) => q.rect(x0, 0, RW, RH), 0.62, 0);
  }
  // back cover: ink with the big wordmark and a barcode
  {
    const x0 = slotX(COVER_BACK);
    c.fillStyle = INK;
    c.fillRect(x0, 0, RW, RH);
    c.fillStyle = ZEROS.pink;
    c.fillRect(x0, RH - 170, RW, 170);
    c.save();
    c.translate(x0 + RW / 2 - 10, RH / 2 - 60);
    c.rotate(-Math.PI / 2);
    text(c, 'SWATCH FAN', 0, 22, { size: 70, family: FONTS.bagel, align: 'center', color: ZEROS.lime, maxWidth: 520 });
    text(c, '#D7FF3A and friends', 0, 62, { size: 28, family: FONTS.marker, align: 'center', color: '#ffffff' });
    c.restore();
    fillPath(c, rrPath(x0 + 22, RH - 150, RW - 44, 100, 8), '#ffffff');
    barcode(c, x0 + 32, RH - 142, RW - 64, 84, 3712, { digits: '0 D7FF3A 0000' });
    smallPrint(c, ['est. once upon a time'], x0 + RW / 2, RH - 40, 13, '#141418', { align: 'center', weight: 700 });
    s.maskPath((q) => q.rect(x0, 0, RW, RH), 0.32, 0);
  }
}

// ------------------------------------------------------------------ geometry

/** One strip in strip-local space: pivot end at y = 0, far end at y = SL, front face at +Z. */
function stripGeometry(front: number, back: number): THREE.BufferGeometry {
  const shape = roundedRect(new THREE.Shape(), SW - 2 * BEVEL, SL - 2 * BEVEL, SR - BEVEL, 0, SL / 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -THICK / 2);
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const nz = nor.getZ(k);
    const s = THREE.MathUtils.clamp((x + SW / 2) / SW, 0, 1);
    const t = THREE.MathUtils.clamp(1 - y / SL, 0, 1);
    if (nz > 0.6) uv.setXY(k, (slotX(front) + s * RW) / AW, 1 - (t * RH) / AH);
    else if (nz < -0.6) uv.setXY(k, (slotX(back) + (1 - s) * RW) / AW, 1 - (t * RH) / AH);
    else uv.setXY(k, (slotX(COMMON_BACK) + 4) / AW, 1 - (RH - 4) / AH); // card edge
  }
  uv.needsUpdate = true;
  return g;
}

function rivet(z0: number, z1: number): { metal: THREE.BufferGeometry; washer: THREE.BufferGeometry } {
  const head = (z: number, dir: 1 | -1, r: number) => {
    const g = lathe(
      [
        [0, 0.24 * r],
        [0.3 * r, 0.22 * r],
        [0.52 * r, 0.15 * r],
        [0.64 * r, 0.06 * r],
        [0.66 * r, 0],
        [0, 0],
      ].map(([a, b]) => [a, b] as [number, number]),
      { segments: 48 },
    );
    // lathe is around +Y: point the dome along +Z (front head) or -Z (back head)
    g.rotateX(dir === 1 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(0, 0, z);
    return g;
  };
  const post = new THREE.CylinderGeometry(0.26, 0.26, z1 - z0 + 0.3, 28);
  post.rotateX(Math.PI / 2);
  post.translate(0, 0, (z0 + z1) / 2);
  // lime plastic washers between the heads and the card
  const washer = (z: number, dir: 1 | -1) => {
    const g = lathe(
      [
        [0.3, 0],
        [0.78, 0],
        [0.84, 0.05],
        [0.84, 0.13],
        [0.78, 0.18],
        [0.3, 0.18],
      ].map(([a, b]) => [a, b] as [number, number]),
      { segments: 48 },
    );
    g.rotateX(dir === 1 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(0, 0, z);
    return g;
  };
  const wf = washer(z1, 1);
  const wb = washer(z0, -1);
  const front = head(z1 + 0.18, 1, 1);
  const back = head(z0 - 0.18, -1, 1);
  const metal = merge([post, front, back]);
  const washers = merge([wf, wb]);
  [post, front, back, wf, wb].forEach((q) => q.dispose());
  return { metal, washer: washers };
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  const atlas = new Surface(AW, AH, bctx, { density: 1, mask: { rough: 0.6, metal: 0 } });
  atlas.c.fillStyle = CARD;
  atlas.c.fillRect(0, 0, AW, AH);
  FAMILIES.forEach((_, i) => paintFront(atlas, i));
  paintBacks(atlas);
  grain(atlas.c, 0, 0, AW, AH, 6000, 0.03, 9);

  // ---------- strips fanned around the rivet (pivot at the origin)
  const strips: THREE.BufferGeometry[] = [];
  const zOf = (i: number) => (i - (N - 1) / 2) * GAP;
  const angleOf = (i: number) => THREE.MathUtils.lerp(FAN_FROM, FAN_TO, i / (N - 1)) + Math.sin(i * 2.7) * 0.8 * DEG;
  for (let i = 0; i < N; i++) {
    const g = stripGeometry(i, i === 0 ? COVER_BACK : COMMON_BACK);
    g.translate(0, -PIVOT, 0);
    g.rotateZ(angleOf(i));
    g.translate(0, 0, zOf(i));
    strips.push(g);
  }
  const stripGeo = merge(strips);
  strips.forEach((g) => g.dispose());
  const mask = atlas.maskTexture();
  const cardMat = new THREE.MeshPhysicalMaterial({
    map: atlas.colorTexture(),
    roughnessMap: mask,
    roughness: 1,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.12,
  });
  inner.add(new THREE.Mesh(stripGeo, cardMat));

  // ---------- chrome rivet through the stack
  const zBack = zOf(0) - THICK / 2 - BEVEL - 0.005;
  const zFront = zOf(N - 1) + THICK / 2 + BEVEL + 0.005;
  const rv = rivet(zBack, zFront);
  inner.add(new THREE.Mesh(rv.metal, chrome({ roughness: 0.1 })));
  inner.add(new THREE.Mesh(rv.washer, new THREE.MeshPhysicalMaterial({ color: ZEROS.lime, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 })));

  // ---------- NEW SHADE sticker on the lime strip, overhanging its edge and peeling up
  const sheet = new StickerSheet(768, 384, bctx, 16);
  const cell = sheet.alloc(300, 300);
  const cellHolo = sheet.alloc(200, 200);
  {
    const c = sheet.surf.c;
    c.save();
    c.translate(cellHolo.x + 100, cellHolo.y + 100);
    const path = starPath(0, 0, 92, 50, 5, -Math.PI / 2, 0.5);
    sticker(c, 0, 0, 0, path, { border: 9, fill: '#ffffff', shadow: 0.6, holo: true }, (k) => {
      text(k, 'v2', 0, 16, { size: 46, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: INK, width: 7 }] });
    }, [-100, -100, 200, 200]);
    c.restore();
  }
  {
    const c = sheet.surf.c;
    c.save();
    c.translate(cell.x + 150, cell.y + 150);
    const path = starPath(0, 0, 132, 104, 14, -Math.PI / 2, 0.45);
    sticker(c, 0, 0, 0, path, { border: 11, fill: ZEROS.pink, shadow: 0.7 }, (k) => {
      text(k, 'NEW', 0, -12, { size: 62, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: INK, width: 8 }] });
      text(k, 'SHADE!', 0, 40, { size: 44, family: FONTS.archivoBlack, align: 'center', color: INK });
    });
    c.restore();
  }
  // strip-local (x, distance from the pivot) -> world, on the front face of strip i
  const onStrip =
    (i: number) =>
    (u: number, v: number): SurfacePoint => {
      const a = angleOf(i);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const z = zOf(i) + THICK / 2 + BEVEL;
      return { p: new THREE.Vector3(u * ca - v * sa, u * sa + v * ca, z), n: new THREE.Vector3(0, 0, 1) };
    };
  const newShade = stickerPatch(onStrip(N - 1), 1.55, SL - PIVOT - 4.15, 2.3, 2.3, 14 * DEG, cell.uv, {
    nx: 10,
    ny: 10,
    offset: 0.006,
    lift: (u, v) => {
      const k = THREE.MathUtils.smoothstep(u, 0.62, 1) * THREE.MathUtils.smoothstep(1 - v, 0.2, 1);
      return 0.45 * k * k;
    },
  });
  const holo = stickerPatch(onStrip(1), -1.35, SL - PIVOT - 0.75, 1.5, 1.5, -18 * DEG, cellHolo.uv, {
    nx: 6,
    ny: 6,
    offset: 0.006,
    lift: (u, v) => 0.12 * Math.pow(THREE.MathUtils.smoothstep(1 - u, 0.6, 1) * THREE.MathUtils.smoothstep(v, 0.5, 1), 2),
  });
  const stick = merge([newShade, holo]);
  newShade.dispose();
  holo.dispose();
  inner.add(new THREE.Mesh(stick, paperBackfaces(stickerSheet(sheet.surf.colorTexture(), { roughness: 0.35, clearcoat: 0.8 }), '#f4f0e8')));

  return finish(inner, trash, undefined, 'swatch-fan');
}

export const swatches: LibraryDef = {
  kind: 'swatches',
  name: 'Swatch Fan',
  tagline: '#D7FF3A and friends',
  category: 'studio',
  defaultRotation: [-0.12, 0.32, 0.04],
  build,
};
export default swatches;
