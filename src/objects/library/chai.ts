import * as THREE from 'three';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet } from '../textures';
import { Trash, finish } from '../build';
import { lathe, fillet, resample, stickerPatch, merge, type P2 } from '../geometry';
import { glass, stickerSheet, paperBackfaces, brushedAluminium } from '../materials';
import { FONTS, DEG, rng, text, arcText, sticker, circlePath, rrPath, starPath, fillPath, smallPrint, grain } from '../paint';
import { revolveSurface, inCell, steam } from './_desi';

/*
 * CUTTING CHAI: the fluted half-glass from every tapri, filled with milky masala chai
 * under a frothy top, standing in a brushed-steel saucer with a SHIP-G biscuit leaning
 * on it. Steam curls up. A truck-art sticker on the glass, a lime "no meeting without
 * chai" sticker on the saucer and a peeling price sticker round the back.
 * Units ~ cm, normalised afterwards.
 */

const SAUCER_Y = 0.22; // the glass stands on the saucer's well floor
const FILL_Y = 5.75; // chai level inside the glass (glass coordinates)
const FLUTES = 14;

// ------------------------------------------------------------------ shapes

/** Glass profile: outer wall (fluted later) up to a smooth flared rim band, down the inner wall, thick base. */
function glassProfile(): { prof: P2[]; iTop: number } {
  const raw: P2[] = [
    [0, 0],
    [1.88, 0],
    [2.08, 0.16],
    [2.12, 0.6],
    [2.6, 5.85],
    [2.76, 7.06],
    [2.72, 7.22],
    [2.6, 7.12],
    [2.47, 5.95],
    [1.97, 0.9],
    [1.62, 0.78],
    [0, 0.74],
  ];
  const radii = [0, 0.12, 0.12, 0.2, 0.6, 0.06, 0.05, 0.06, 0.5, 0.2, 0.3, 0];
  const prof = resample(fillet(raw, radii, 6), 150);
  let iTop = 0;
  prof.forEach((p, i) => {
    if (p[1] > prof[iTop][1]) iTop = i;
  });
  return { prof, iTop };
}

/** Inner radius of the glass at height y (straight inner wall). */
function innerR(y: number): number {
  return 1.97 + ((y - 0.9) * (2.47 - 1.97)) / (5.95 - 0.9);
}

function fluteFade(y: number): number {
  return THREE.MathUtils.smoothstep(y, 0.5, 1.0) * (1 - THREE.MathUtils.smoothstep(y, 5.35, 5.95));
}

/** Rounded ribs with tight valleys. */
function flute(phi: number): number {
  return Math.pow(0.5 + 0.5 * Math.cos(FLUTES * phi), 0.45);
}

function saucerProfile(): P2[] {
  return fillet(
    [
      [0, 0.1],
      [2.15, 0.1],
      [2.38, 0],
      [2.72, 0.05],
      [3.95, 0.32],
      [4.62, 0.56],
      [4.66, 0.7],
      [4.46, 0.7],
      [3.6, 0.44],
      [2.5, 0.3],
      [2.32, SAUCER_Y],
      [0, SAUCER_Y],
    ],
    [0, 0.08, 0.08, 0.3, 0.4, 0.08, 0.06, 0.08, 0.5, 0.08, 0.06, 0],
    5,
  );
}

/** Rounded-rectangle biscuit in the XY plane (thickness along Z), UVs: caps -> whole texture, edges -> the rim strip. */
function biscuitGeometry(w: number, h: number, t: number): THREE.BufferGeometry {
  const r = 0.26;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -t / 2);
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    if (Math.abs(nor.getZ(i)) > 0.7) uv.setXY(i, 0.04 + 0.92 * (x / w + 0.5), 0.04 + 0.92 * (y / h + 0.5));
    else uv.setXY(i, 0.012 + 0.006 * (x / w + 0.5), 0.5 + 0.3 * (y / h));
  }
  uv.needsUpdate = true;
  return g;
}

// ------------------------------------------------------------------ textures

function paintFroth(s: Surface): void {
  const c = s.c;
  const W = s.w;
  const g = c.createRadialGradient(W * 0.48, W * 0.46, W * 0.05, W / 2, W / 2, W * 0.5);
  g.addColorStop(0, '#e2ad74');
  g.addColorStop(0.62, '#d79a5c');
  g.addColorStop(0.86, '#c47c3e');
  g.addColorStop(1, '#a9612a');
  c.fillStyle = g;
  c.fillRect(0, 0, W, W);
  const r = rng(31);
  // foam bubbles, denser towards the middle
  for (let i = 0; i < 900; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.7) * W * 0.44;
    const x = W / 2 + Math.cos(a) * d;
    const y = W / 2 + Math.sin(a) * d;
    const rad = 2 + r() * (d < W * 0.3 ? 9 : 5);
    c.beginPath();
    c.arc(x, y, rad, 0, Math.PI * 2);
    c.fillStyle = `rgba(250,226,190,${0.25 + r() * 0.35})`;
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(140,80,30,0.3)';
    c.stroke();
  }
  // spice specks (elaichi, ginger)
  for (let i = 0; i < 140; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * W * 0.42;
    c.fillStyle = r() > 0.5 ? 'rgba(90,45,15,0.7)' : 'rgba(60,30,10,0.6)';
    c.fillRect(W / 2 + Math.cos(a) * d, W / 2 + Math.sin(a) * d, 2 + r() * 3, 2 + r() * 2);
  }
  // a glossy ring where the foam thins at the glass
  c.strokeStyle = 'rgba(120,60,20,0.55)';
  c.lineWidth = W * 0.035;
  c.beginPath();
  c.arc(W / 2, W / 2, W * 0.47, 0, Math.PI * 2);
  c.stroke();
}

function paintBiscuit(s: Surface): void {
  const c = s.c;
  const W = s.w;
  const H = s.h;
  const g = c.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.62);
  g.addColorStop(0, '#f0bd62');
  g.addColorStop(0.7, '#e3a64c');
  g.addColorStop(1, '#b8732a');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // baked edge strip (sampled by the sides)
  c.fillStyle = '#c47e33';
  c.fillRect(0, 0, W * 0.03, H);
  const r = rng(8);
  const holes: [number, number][] = [];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 6; i++) {
      if ((j === 1 || j === 2) && i > 0 && i < 5) continue;
      holes.push([W * (0.14 + i * 0.144), H * (0.17 + j * 0.22)]);
    }
  }
  for (const [x, y] of holes) {
    c.fillStyle = 'rgba(150,85,25,0.75)';
    c.beginPath();
    c.arc(x, y, 6, 0, Math.PI * 2);
    c.fill();
  }
  text(c, 'SHIP-G', W / 2, H * 0.58, { size: H * 0.24, family: FONTS.archivoBlack, align: 'center', color: '#f6c977', tracking: 4, shadow: { color: 'rgba(120,60,10,0.6)', dx: 2, dy: 3, blur: 3 } });
  grain(c, 0, 0, W, H, 2500, 0.12, 6);
  for (let i = 0; i < 220; i++) {
    c.fillStyle = 'rgba(255,245,215,0.7)';
    c.fillRect(r() * W, r() * H, 1.6, 1.6);
  }
  s.bumpDraw((b) => {
    b.fillStyle = 'rgb(118,118,118)';
    b.fillRect(0, 0, W, H);
    const eg = b.createLinearGradient(0, 0, 0, H);
    eg.addColorStop(0, 'rgb(100,100,100)');
    eg.addColorStop(0.1, 'rgb(130,130,130)');
    eg.addColorStop(0.9, 'rgb(130,130,130)');
    eg.addColorStop(1, 'rgb(100,100,100)');
    b.fillStyle = eg;
    b.fillRect(W * 0.03, 0, W * 0.97, H);
    for (const [x, y] of holes) {
      b.fillStyle = 'rgb(50,50,50)';
      b.beginPath();
      b.arc(x, y, 6, 0, Math.PI * 2);
      b.fill();
    }
    text(b, 'SHIP-G', W / 2, H * 0.58, { size: H * 0.24, family: FONTS.archivoBlack, align: 'center', color: 'rgb(200,200,200)', tracking: 4 });
    for (let i = 0; i < 700; i++) {
      b.fillStyle = r() > 0.5 ? 'rgba(160,160,160,0.6)' : 'rgba(90,90,90,0.6)';
      b.fillRect(r() * W, r() * H, 2, 2);
    }
  });
}

function paintStickers(sheet: StickerSheet) {
  // truck-art "CUTTING CHAI" sticker for the glass
  const cMain = sheet.alloc(600, 380);
  inCell(sheet, cMain, (c) => {
    const shape = rrPath(-280, -170, 560, 340, 60);
    sticker(c, 0, 0, 0, shape, { border: 16, fill: '#e8197a', shadow: 0.7 }, (q) => {
      // painted scallop border
      q.strokeStyle = '#ffd21f';
      q.lineWidth = 7;
      q.beginPath();
      q.roundRect(-256, -146, 512, 292, 44);
      q.stroke();
      for (let i = 0; i < 18; i++) {
        const x = -238 + i * 28;
        fillPath(q, circlePath(x, -146, 6), '#22c3a6');
        fillPath(q, circlePath(x, 146, 6), '#22c3a6');
      }
      text(q, 'cutting', 0, -42, { size: 92, family: FONTS.shrikhand, align: 'center', color: '#ffd21f', outlines: [{ color: '#5a0730', width: 14 }], extrude: { color: '#5a0730', dx: 0, dy: 6 } });
      text(q, 'CHAI', 0, 84, { size: 132, family: FONTS.bagel, align: 'center', color: '#ffffff', outlines: [{ color: '#5a0730', width: 16 }], extrude: { color: '#22c3a6', dx: 6, dy: 8 } });
      smallPrint(q, ['STANDUP FUEL · ½ GLASS, FULL POWER'], 0, 112, 21, '#fff2c4', { align: 'center', weight: 700 });
    });
  });
  // lime saucer sticker
  const cLime = sheet.alloc(250, 250);
  inCell(sheet, cLime, (c) => {
    sticker(c, 0, 0, 0, circlePath(0, 0, 112), { border: 10, fill: '#d7ff3a', shadow: 0.6 }, (q) => {
      arcText(q, 'NO MEETING WITHOUT', 0, 0, 82, -Math.PI / 2, { size: 23, family: FONTS.archivoBlack, color: '#0b0b0d', tracking: 1 });
      text(q, 'CHAI', 0, 30, { size: 56, family: FONTS.bagel, align: 'center', color: '#0b0b0d' });
      // tiny glass pictogram
      q.fillStyle = '#0b0b0d';
      q.beginPath();
      q.moveTo(-16, -34);
      q.lineTo(16, -34);
      q.lineTo(12, -6);
      q.lineTo(-12, -6);
      q.closePath();
      q.fill();
      q.strokeStyle = '#0b0b0d';
      q.lineWidth = 3;
      q.lineCap = 'round';
      for (const sx of [-7, 3]) {
        q.beginPath();
        q.moveTo(sx, -40);
        q.quadraticCurveTo(sx - 6, -48, sx + 2, -56);
        q.stroke();
      }
      text(q, 'zeros kitchen', 0, 66, { size: 20, family: FONTS.marker, align: 'center', color: '#0b0b0d' });
    });
  });
  // yellow price burst (peels)
  const cPrice = sheet.alloc(250, 250);
  inCell(sheet, cPrice, (c) => {
    sticker(c, 0, 0, 0, starPath(0, 0, 112, 92, 16, -Math.PI / 2, 0.4), { border: 8, fill: '#ffd21f', shadow: 0.6 }, (q) => {
      text(q, 'CHAI', 0, -26, { size: 34, family: FONTS.archivoBlack, align: 'center', color: '#c4122f' });
      text(q, '10/-', 0, 32, { size: 66, family: FONTS.bagel, align: 'center', color: '#c4122f' });
      smallPrint(q, ['refills free*'], 0, 46, 17, '#5a1a00', { align: 'center', weight: 700 });
    });
  });
  return { cMain, cLime, cPrice };
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- brushed-steel saucer (concentric brushing follows the lathe UVs)
  const saucerGeo = lathe(saucerProfile(), { segments: 96 });
  inner.add(new THREE.Mesh(saucerGeo, brushedAluminium({ color: '#e1e5ea', roughness: 0.2, anisotropy: 0.7, clearcoat: 0.5, clearcoatRoughness: 0.08 })));

  // ---------- fluted glass
  const { prof, iTop } = glassProfile();
  const glassGeo = lathe(prof, {
    segments: FLUTES * 12,
    radial: (phi, j, p) => (j < iTop ? 0.085 * flute(phi) * fluteFade(p[1]) : 0),
  });
  glassGeo.translate(0, SAUCER_Y, 0);
  const glassMat = glass({
    color: '#f4fff8',
    roughness: 0.03,
    thickness: 0.9,
    ior: 1.5,
    attenuationColor: new THREE.Color('#cfeedd'),
    attenuationDistance: 5,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    side: THREE.DoubleSide,
  });
  inner.add(new THREE.Mesh(glassGeo, glassMat));

  // ---------- chai: liquid volume inside the glass with a frothy top
  const liq: P2[] = [];
  liq.push([0.01, 0.8]);
  liq.push([1.6, 0.84]);
  for (let k = 0; k <= 12; k++) {
    const y = 0.92 + (k / 12) * (FILL_Y - 0.06 - 0.92);
    liq.push([innerR(y) - 0.025, y]);
  }
  liq.push([innerR(FILL_Y) - 0.06, FILL_Y]);
  const liqGeo = lathe(fillet(liq, liq.map((_, i) => (i === 0 || i === liq.length - 1 ? 0 : 0.05)), 3), { segments: 72 });
  liqGeo.translate(0, SAUCER_Y, 0);
  inner.add(new THREE.Mesh(liqGeo, new THREE.MeshPhysicalMaterial({ color: '#b66a31', roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1, sheen: 0.4, sheenColor: new THREE.Color('#f3c08a') })));
  const froth = new Surface(512, 512, bctx);
  paintFroth(froth);
  const topR = innerR(FILL_Y) - 0.02;
  const top = lathe(
    fillet(
      [
        [topR, FILL_Y - 0.02],
        [topR - 0.12, FILL_Y + 0.05],
        [1.2, FILL_Y + 0.1],
        [0.01, FILL_Y + 0.12],
      ],
      [0, 0.08, 0.3, 0],
      4,
    ),
    { segments: 72, uv: (x, _y, z) => [0.5 + x / (2 * topR), 0.5 - z / (2 * topR)] },
  );
  top.translate(0, SAUCER_Y, 0);
  inner.add(new THREE.Mesh(top, new THREE.MeshPhysicalMaterial({ map: froth.colorTexture(), roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new THREE.Color('#fff0d8') })));

  // ---------- SHIP-G biscuit leaning on the glass
  const bis = new Surface(512, 340, bctx, { bump: { base: 0.5, density: 0.6 } });
  paintBiscuit(bis);
  const BW = 2.25;
  const BH = 3.4;
  const bisGeo = biscuitGeometry(BW, BH, 0.3);
  {
    const a = 30 * DEG;
    const radial = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const base = radial.clone().multiplyScalar(3.55).setY(0.62);
    const tip = radial.clone().multiplyScalar(2.52).setY(3.6);
    const up = tip.clone().sub(base).normalize();
    const out = radial.clone().addScaledVector(up, -radial.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, out).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, out);
    m.setPosition(base.clone().add(tip).multiplyScalar(0.5).addScaledVector(out, 0.17));
    const spin = new THREE.Matrix4().makeRotationZ(-5 * DEG);
    bisGeo.applyMatrix4(spin);
    bisGeo.applyMatrix4(m);
  }
  inner.add(
    new THREE.Mesh(
      bisGeo,
      new THREE.MeshPhysicalMaterial({ map: bis.colorTexture(), bumpMap: bis.bumpTexture(), bumpScale: 3, roughness: 0.72, sheen: 0.6, sheenColor: new THREE.Color('#ffe2a8'), sheenRoughness: 0.5 }),
    ),
  );

  // ---------- stickers
  const sheet = new StickerSheet(1024, 704, bctx, 12);
  const cells = paintStickers(sheet);
  const sheetTex = sheet.surf.colorTexture();
  // glass wall (rib tops) for the main sticker and the price burst
  const ribTop: P2[] = [];
  for (let k = 0; k <= 16; k++) {
    const y = 0.7 + (k / 16) * 5.0;
    ribTop.push([2.12 + ((y - 0.6) * (2.6 - 2.12)) / (5.85 - 0.6) + 0.085 * fluteFade(y), y + SAUCER_Y]);
  }
  const wall = revolveSurface(ribTop);
  const cm = (cell: { w: number; h: number }, w: number) => (w * cell.h) / cell.w;
  const patches: THREE.BufferGeometry[] = [];
  patches.push(stickerPatch(wall.at, 0, wall.sAtY(3.35 + SAUCER_Y), 3.7, cm(cells.cMain, 3.7), 3 * DEG, cells.cMain.uv, { nx: 20, ny: 8, offset: 0.012 }));
  patches.push(
    stickerPatch(wall.at, -Math.PI * 2.4 * 0.78, wall.sAtY(2.3 + SAUCER_Y), 1.55, 1.55, 14 * DEG, cells.cPrice.uv, {
      nx: 10,
      ny: 10,
      offset: 0.012,
      lift: (u, v) => 0.3 * Math.pow(THREE.MathUtils.smoothstep(1 - u, 0.55, 1) * THREE.MathUtils.smoothstep(v, 0.4, 1), 1.5),
    }),
  );
  // saucer: conforming to the dished top surface (walked from the rim inwards, so +b points at the centre)
  {
    const sp = saucerProfile();
    let iRim = 0;
    sp.forEach((p, i) => {
      if (p[1] > sp[iRim][1]) iRim = i;
    });
    const topSurf = revolveSurface(sp.slice(iRim).filter((p) => p[0] > 2.4));
    const b = topSurf.length * 0.5;
    const r0 = topSurf.at(0, b).p.z;
    patches.push(stickerPatch(topSurf.at, -42 * DEG * r0, b, 1.3, 1.3, -6 * DEG, cells.cLime.uv, { nx: 8, ny: 8, offset: 0.02 }));
  }
  const stickersGeo = merge(patches);
  patches.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.38, clearcoat: 0.7 }), '#f4ecdc')));

  // ---------- steam (added after normalising so it doesn't shrink the glass)
  const st = steam(bctx, { base: new THREE.Vector3(0, FILL_Y + SAUCER_Y + 0.15, 0), spread: 1.3, height: 4.6, width: 1.9, count: 3, opacity: 0.42, seed: 9 });
  const built = finish(inner, trash, st.update, 'cutting-chai');
  inner.add(st.mesh);
  trash.add(st.mesh.geometry);
  trash.add(st.mesh.material as THREE.Material);
  trash.add((st.mesh.material as THREE.MeshBasicMaterial).map!);
  return built;
}

export const chai: LibraryDef = {
  kind: 'chai',
  name: 'Cutting Chai',
  tagline: 'standup fuel',
  category: 'food',
  defaultRotation: [0.34, -0.3, 0.04],
  build,
};
export default chai;
