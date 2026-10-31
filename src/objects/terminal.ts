import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObjectBuildContext, ObjectDef } from './types';
import { Surface, StickerSheet, canvasTexture, type AtlasCell } from './textures';
import { Trash, finish } from './build';
import { merge, place, stickerPatch, surfaces } from './geometry';
import { chrome, stickerSheet, paperBackfaces } from './materials';
import { FONTS, DEG, rng, text, font, sticker, rrPath, circlePath, fillPath, barcode, smiley, smallPrint, hexA, type C2D } from './paint';

/*
 * ONCE UPON OS: a translucent mint-green terminal. Keyboard deck with chunky
 * candy keycaps in front, an upright screen housing with a thick bezel behind,
 * an emissive CRT that types the story in a loop. Scene units ~ 10 cm.
 */

const BW = 2.0; // width
const BASE_D = 1.5; // base depth
const BASE_H = 0.5;
const HOUSE_D = 0.66;
const HOUSE_H = 1.36;
const HOUSE_Z0 = -BASE_D / 2 + 0.02; // back of the housing
const HOUSE_Z1 = HOUSE_Z0 + HOUSE_D; // front (bottom edge)
const TILT = 9 * DEG; // housing front leans back

const SCREEN = { w: 1.3, h: 0.76, cx: -0.2, cy: 0.74 }; // on the housing front, relative to its bottom-front edge

const LINES = ['> once upon a time_', '> i was a product designer', '> now: building ZEROS'];

// ------------------------------------------------------------------ geometry helpers

/** Housing: rounded side profile (trapezoid with a big rounded top-front corner) extruded across the width. */
function housingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const z0 = HOUSE_Z0;
  const z1 = HOUSE_Z1;
  const lean = Math.tan(TILT) * HOUSE_H;
  const r = 0.26;
  // shape in (z, y): x = z, y = y
  s.moveTo(z0, 0);
  s.lineTo(z1, 0);
  s.lineTo(z1 - lean * ((HOUSE_H - r) / HOUSE_H), HOUSE_H - r);
  s.quadraticCurveTo(z1 - lean, HOUSE_H, z1 - lean - r, HOUSE_H);
  s.lineTo(z0 + 0.12, HOUSE_H);
  s.quadraticCurveTo(z0, HOUSE_H, z0, HOUSE_H - 0.12);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: BW - 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 4, curveSegments: 10 });
  // extrusion along +Z -> across X; shape x (=z) -> Z, shape y -> Y
  g.rotateY(-Math.PI / 2);
  // after rotateY(-90): shape x -> +Z? (x,y,z) -> (-z, y, x): shape x -> Z, extrusion z -> -X
  g.translate(BW / 2 - 0.06, BASE_H, 0);
  return g;
}

/** Point on the housing's leaning front face: (a across, b up the face) -> world. */
function housingFront(a: number, b: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(a, BASE_H + b * Math.cos(TILT), HOUSE_Z1 + 0.06 - b * Math.sin(TILT));
}

function frameRing(w: number, h: number, r: number, t: number, depth: number): THREE.BufferGeometry {
  const outer = new THREE.Shape();
  const o = (x: number, y: number, ww: number, hh: number, rr: number, p: THREE.Shape | THREE.Path) => {
    p.moveTo(x + rr, y);
    p.lineTo(x + ww - rr, y);
    p.quadraticCurveTo(x + ww, y, x + ww, y + rr);
    p.lineTo(x + ww, y + hh - rr);
    p.quadraticCurveTo(x + ww, y + hh, x + ww - rr, y + hh);
    p.lineTo(x + rr, y + hh);
    p.quadraticCurveTo(x, y + hh, x, y + hh - rr);
    p.lineTo(x, y + rr);
    p.quadraticCurveTo(x, y, x + rr, y);
  };
  o(-w / 2 - t, -h / 2 - t, w + 2 * t, h + 2 * t, r + t, outer);
  const hole = new THREE.Path();
  o(-w / 2, -h / 2, w, h, r, hole);
  outer.holes.push(hole);
  return new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 8 });
}

/** Orient a geometry built in the XY plane (facing +Z) onto the housing front at (a, b). */
function onFront(g: THREE.BufferGeometry, a: number, b: number, lift = 0): THREE.BufferGeometry {
  g.rotateX(-TILT);
  const p = housingFront(a, b);
  const n = new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT));
  p.addScaledVector(n, lift);
  g.translate(p.x, p.y, p.z);
  return g;
}

// ------------------------------------------------------------------ textures

function paintPCB(s: Surface): void {
  const c = s.c;
  c.fillStyle = '#0d2e22';
  c.fillRect(0, 0, s.w, s.h);
  const r = rng(12);
  c.strokeStyle = '#c9a54a';
  c.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    c.lineWidth = 2 + r() * 3;
    let x = r() * s.w;
    let y = r() * s.h;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      if (r() > 0.5) x += (r() - 0.5) * 200;
      else y += (r() - 0.5) * 200;
      c.lineTo(x, y);
    }
    c.stroke();
    fillPath(c, circlePath(x, y, 5), '#e0c060');
  }
  smallPrint(c, ['ONCE UPON OS · REV 0', 'designed in the timeline'], 30, s.h - 70, 22, '#9fd8b8', { weight: 700 });
}

function paintLegends(s: Surface, legends: string[]): void {
  // 4x4 grid of keycap legends on white; tinted by the instance colour
  const c = s.c;
  const cell = s.w / 4;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, s.w, s.h);
  legends.forEach((lg, i) => {
    const cx = (i % 4) * cell + cell / 2;
    const cy = Math.floor(i / 4) * cell + cell / 2;
    if (lg.startsWith('!')) {
      // inverted (light glyph on dark) for the dark key
      fillPath(c, rrPath(cx - cell * 0.42, cy - cell * 0.42, cell * 0.84, cell * 0.84, 8), '#2a2a2a');
      text(c, lg.slice(1), cx, cy + cell * 0.14, { size: cell * 0.42, family: FONTS.bagel, align: 'center', color: '#ffffff' });
      return;
    }
    if (lg === 'heart') {
      c.fillStyle = '#e8203a';
      c.beginPath();
      c.moveTo(cx, cy + cell * 0.2);
      c.bezierCurveTo(cx - cell * 0.42, cy - cell * 0.05, cx - cell * 0.2, cy - cell * 0.36, cx, cy - cell * 0.14);
      c.bezierCurveTo(cx + cell * 0.2, cy - cell * 0.36, cx + cell * 0.42, cy - cell * 0.05, cx, cy + cell * 0.2);
      c.fill();
      return;
    }
    if (lg === 'smile') {
      smiley(c, cx, cy, cell * 0.26, '#ffd21f', '#222');
      return;
    }
    if (lg === 'note') {
      text(c, '♪', cx, cy + cell * 0.16, { size: cell * 0.5, family: FONTS.ui, weight: 700, align: 'center', color: '#222' });
      return;
    }
    text(c, lg, cx, cy + cell * 0.14, { size: cell * 0.36, family: FONTS.archivoBlack, align: 'center', color: '#3a2a2a', maxWidth: cell * 0.8 });
  });
}

interface ScreenState {
  surf: Surface;
  tex: THREE.CanvasTexture;
  last: number;
}

function drawScreen(st: ScreenState, t: number): void {
  const c = st.surf.c;
  const W = st.surf.w;
  const H = st.surf.h;
  // phosphor base
  const g = c.createRadialGradient(W * 0.45, H * 0.45, 40, W / 2, H / 2, W * 0.75);
  g.addColorStop(0, '#2a8a3c');
  g.addColorStop(1, '#0e3d1a');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const GREEN = '#7dff9a';
  c.save();
  c.shadowColor = 'rgba(70,255,120,0.75)';
  c.shadowBlur = 14 * (c.getTransform().a || 1);
  // header
  c.font = font(18, FONTS.spaceMono, 700);
  c.fillStyle = hexA(GREEN, 0.75);
  c.textBaseline = 'top';
  c.fillText('ONCE UPON OS v1.0', 24, 18);
  c.textAlign = 'right';
  c.fillText('MEM 640K OK', W - 24, 18);
  c.textAlign = 'left';
  // logo: a chunky zero ring + wordmark (where the reference has its brand mark)
  const lx = 118;
  const ly = 132;
  c.strokeStyle = GREEN;
  c.lineWidth = 22;
  c.beginPath();
  c.ellipse(lx, ly, 46, 58, 0, 0, Math.PI * 2);
  c.stroke();
  c.lineWidth = 10;
  c.beginPath();
  c.moveTo(lx - 30, ly + 40);
  c.lineTo(lx + 30, ly - 40);
  c.stroke();
  text(c, 'Once Upon OS', lx + 82, ly + 26, { size: 66, family: FONTS.ui, weight: 700, color: GREEN, maxWidth: W - lx - 110 });
  // typing area
  const cps = 14;
  const pause = 1.1;
  const total = LINES.reduce((a, l) => a + l.length / cps + pause, 0) + 1.6;
  const tt = t % total;
  let acc = 0;
  c.font = font(28, FONTS.spaceMono, 700);
  c.fillStyle = GREEN;
  let cursorX = 40;
  let cursorY = 238;
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i].replace(/_$/, '');
    const dur = line.length / cps;
    const y = 238 + i * 40;
    if (tt < acc) break;
    const n = Math.min(line.length, Math.floor((tt - acc) * cps));
    const shown = line.slice(0, n);
    c.fillText(shown, 40, y);
    cursorX = 40 + c.measureText(shown).width + 4;
    cursorY = y;
    acc += dur + pause;
  }
  if (Math.floor(t * 2.2) % 2 === 0) c.fillRect(cursorX, cursorY + 2, 16, 28);
  c.restore();
  // scanlines + vignette
  c.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  st.tex.needsUpdate = true;
}

function inCell(sheet: StickerSheet, cell: AtlasCell, fn: (c: C2D) => void): void {
  const c = sheet.surf.c;
  c.save();
  c.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  fn(c);
  c.restore();
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();

  // ---------- translucent mint shell: base (two slabs), keyboard frame, housing, bezel, vent ribs
  const shellParts: THREE.BufferGeometry[] = [];
  shellParts.push(place(new RoundedBoxGeometry(BW + 0.04, 0.16, BASE_D + 0.04, 4, 0.07), [0, 0.08, 0]));
  shellParts.push(place(new RoundedBoxGeometry(BW, BASE_H - 0.16, BASE_D, 4, 0.08), [0, 0.16 + (BASE_H - 0.16) / 2, 0]));
  // keyboard well frame (rim around the keys)
  const kb = frameRing(1.84, 0.64, 0.06, 0.05, 0.07);
  kb.rotateX(-Math.PI / 2);
  kb.translate(0, BASE_H - 0.01, 0.415);
  shellParts.push(kb);
  shellParts.push(housingGeometry());
  // thick bezel around the screen
  shellParts.push(onFront(frameRing(SCREEN.w, SCREEN.h, 0.08, 0.07, 0.05), SCREEN.cx, SCREEN.cy, 0));
  // vent ribs under the right part of the screen
  for (let i = 0; i < 13; i++) shellParts.push(onFront(new RoundedBoxGeometry(0.02, 0.12, 0.05, 1, 0.008), 0.14 + i * 0.036, 0.19, 0.02));
  const shellGeo = merge(shellParts);
  shellParts.forEach((g) => g.dispose());
  // milky frosted mint: partly transmissive, with a soft inner glow so it reads light on dark backgrounds
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: '#8ff5c6',
    metalness: 0,
    roughness: 0.3,
    transmission: 0.6,
    thickness: 0.6,
    ior: 1.45,
    attenuationColor: new THREE.Color('#7ff0c0'),
    attenuationDistance: 1.6,
    clearcoat: 0.8,
    clearcoatRoughness: 0.18,
    emissive: '#2fd58f',
    emissiveIntensity: 0.34,
  });
  inner.add(new THREE.Mesh(shellGeo, shellMat));

  // ---------- PCB visible through the base
  const pcb = new Surface(1024, 768, bctx, { density: 0.6 });
  paintPCB(pcb);
  const pcbGeo = new THREE.PlaneGeometry(BW - 0.2, BASE_D - 0.2);
  pcbGeo.rotateX(-Math.PI / 2);
  pcbGeo.translate(0, 0.24, 0);
  inner.add(new THREE.Mesh(pcbGeo, new THREE.MeshStandardMaterial({ map: pcb.colorTexture(), roughness: 0.5, metalness: 0.2 })));

  // ---------- dark parts: chips on the PCB, screen slot, grille slots, knob panel
  const dark: THREE.BufferGeometry[] = [];
  const rnd = rng(3);
  for (let i = 0; i < 6; i++) dark.push(place(new THREE.BoxGeometry(0.2 + rnd() * 0.15, 0.04, 0.14 + rnd() * 0.1), [(rnd() - 0.5) * 1.5, 0.27, (rnd() - 0.5) * 1.0]));
  dark.push(onFront(new RoundedBoxGeometry(0.86, 0.05, 0.04, 1, 0.012), -0.42, 0.19, 0.03));
  for (let i = 0; i < 5; i++) dark.push(onFront(new RoundedBoxGeometry(0.2, 0.035, 0.04, 1, 0.012), 0.72, 0.92 - i * 0.07, 0.025));
  dark.push(onFront(new RoundedBoxGeometry(0.24, 0.24, 0.05, 2, 0.04), 0.72, 0.42, 0.02));
  const darkGeo = merge(dark);
  dark.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(darkGeo, new THREE.MeshPhysicalMaterial({ color: '#16211d', roughness: 0.45, clearcoat: 0.5 })));

  // ---------- chrome: knob, screws
  const chr: THREE.BufferGeometry[] = [];
  chr.push(onFront(new THREE.CylinderGeometry(0.07, 0.075, 0.07, 28).rotateX(Math.PI / 2), 0.72, 0.42, 0.08));
  for (const [x, z] of [
    [-0.94, 0.7],
    [0.94, 0.7],
    [-0.94, 0.1],
    [0.94, 0.1],
  ]) {
    chr.push(place(new THREE.SphereGeometry(0.035, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), [x, BASE_H - 0.004, z], [0, 0, 0], [1, 0.45, 1]));
  }
  const chromeGeo = merge(chr);
  chr.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(chromeGeo, chrome({ roughness: 0.12 })));

  // ---------- amber power button
  const amber = onFront(new THREE.CylinderGeometry(0.065, 0.07, 0.06, 28).rotateX(Math.PI / 2), 0.72, 1.1, 0.04);
  inner.add(new THREE.Mesh(amber, new THREE.MeshPhysicalMaterial({ color: '#ffb02e', emissive: '#ff9a1a', emissiveIntensity: 0.6, roughness: 0.2, clearcoat: 1 })));

  // ---------- screen (emissive canvas, redrawn while typing)
  const screenSurf = new Surface(640, 400, bctx, { density: 1 });
  const screenTex = canvasTexture(screenSurf.color.canvas, bctx, true);
  screenTex.generateMipmaps = false;
  screenTex.minFilter = THREE.LinearFilter;
  const st: ScreenState = { surf: screenSurf, tex: screenTex, last: -1 };
  drawScreen(st, 0);
  const screenGeo = onFront(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), SCREEN.cx, SCREEN.cy, 0.016);
  const screenMat = new THREE.MeshPhysicalMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: screenTex, emissiveIntensity: 1.6, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04 });
  inner.add(new THREE.Mesh(screenGeo, screenMat));

  // ---------- keycaps: 2 rows x 6, instanced, per-instance legend cell
  const legends = ['Z', 'E', 'R', 'O', 'S', 'heart', '!0', 'NO', 'smile', 'note', 'OK', '↵', 'GO', '?', '★', '1'];
  const legendSurf = new Surface(512, 512, bctx, { density: 1 });
  paintLegends(legendSurf, legends);
  const kw = 0.272;
  const kh = 0.2;
  const cap = new RoundedBoxGeometry(kw, kh, kw, 2, 0.045);
  {
    // taper the top and remap UVs: top face -> legend cell (0,0), others -> blank margin
    const pos = cap.getAttribute('position') as THREE.BufferAttribute;
    const uv = cap.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const f = 1 - 0.13 * THREE.MathUtils.clamp((y + kh / 2) / kh, 0, 1);
      pos.setX(i, pos.getX(i) * f);
      pos.setZ(i, pos.getZ(i) * f);
    }
    const top = cap.groups.find((g) => g.materialIndex === 2)!;
    for (let i = 0; i < uv.count; i++) {
      if (i >= top.start && i < top.start + top.count) uv.setXY(i, 0.02 + uv.getX(i) * 0.21, 0.77 + uv.getY(i) * 0.21);
      else uv.setXY(i, 0.006, 0.756);
    }
    cap.clearGroups();
    pos.needsUpdate = true;
    uv.needsUpdate = true;
  }
  const keyColors = ['#ffd21f', '#ff8a1f', '#22c99a', '#f4f1ea', '#46e08c', '#ff7ac8', '#ff3b3b', '#f4f1ea', '#f4f1ea', '#8b5cf6', '#2f6bff', '#ffd21f'];
  const keyLegend = [0, 1, 2, 5, 6, 3, 7, 8, 9, 10, 11, 4];
  const keys = new THREE.InstancedMesh(cap, new THREE.MeshPhysicalMaterial({ map: canvasTexture(legendSurf.color.canvas, bctx, true), roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }), 12);
  const offsets = new Float32Array(12 * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  for (let i = 0; i < 12; i++) {
    const row = Math.floor(i / 6);
    const k = i % 6;
    const x = -0.76 + k * 0.302 + (row ? 0.03 : 0);
    const z = 0.27 + row * 0.3;
    q.setFromEuler(new THREE.Euler(0, (rnd() - 0.5) * 0.06, 0));
    m.compose(new THREE.Vector3(x, BASE_H + kh / 2 - 0.005, z), q, new THREE.Vector3(1, 1, 1));
    keys.setMatrixAt(i, m);
    keys.setColorAt(i, col.set(keyColors[i]));
    const li = keyLegend[i];
    offsets[i * 2] = (li % 4) / 4;
    offsets[i * 2 + 1] = -Math.floor(li / 4) / 4;
  }
  cap.setAttribute('legendOffset', new THREE.InstancedBufferAttribute(offsets, 2));
  const keyMat = keys.material as THREE.MeshPhysicalMaterial;
  keyMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 legendOffset;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv += legendOffset;\n#endif');
  };
  keyMat.customProgramCacheKey = () => 'keycap-legends';
  keys.instanceMatrix.needsUpdate = true;
  if (keys.instanceColor) keys.instanceColor.needsUpdate = true;
  keys.computeBoundingSphere();
  inner.add(keys);

  // ---------- stickers: yellow hello (front-left), yellow price/barcode (front-right), ZEROS + smiley on the housing side
  const sheet = new StickerSheet(1024, 512, bctx, 12);
  const cHello = sheet.alloc(300, 200);
  inCell(sheet, cHello, (c) => {
    sticker(c, 0, 0, 0, rrPath(-136, -84, 272, 168, 10), { border: 0, fill: '#ffd21f', shadow: 0.5 }, (k) => {
      text(k, 'hello', 0, 10, { size: 86, family: FONTS.shrikhand, align: 'center', color: '#e8213a' });
      smallPrint(k, ['my name is: OS'], 0, 30, 24, '#5a3a00', { align: 'center', weight: 700 });
    });
  });
  const cPrice = sheet.alloc(340, 190);
  inCell(sheet, cPrice, (c) => {
    sticker(c, 0, 0, 0, rrPath(-156, -80, 312, 160, 8), { border: 0, fill: '#ffe14d', shadow: 0.5 }, (k) => {
      barcode(k, -136, -64, 170, 96, 41, {});
      text(k, 'PRICE', 92, -34, { size: 30, family: FONTS.archivoBlack, align: 'center', color: '#222' });
      text(k, '$0.00', 92, 6, { size: 36, family: FONTS.archivoBlack, align: 'center', color: '#e8213a' });
      smallPrint(k, ['priceless · 0 0000 0001'], -20, 44, 20, '#222', { align: 'center', weight: 700 });
    });
  });
  const cZeros = sheet.alloc(280, 140);
  inCell(sheet, cZeros, (c) => {
    sticker(c, 0, 0, 0, rrPath(-124, -54, 248, 108, 54), { border: 10, fill: '#141414', shadow: 0.6 }, (k) => {
      text(k, 'ZEROS', 0, 26, { size: 72, family: FONTS.bagel, align: 'center', color: '#ffffff' });
    });
  });
  const cSmile = sheet.alloc(150, 150);
  inCell(sheet, cSmile, (c) => {
    sticker(c, 0, 0, 0, circlePath(0, 0, 62), { border: 8, fill: '#ffd21f', shadow: 0.6 }, (k) => smiley(k, 0, 0, 62));
  });
  const sheetTex = sheet.surf.colorTexture();
  const frontFace = surfaces.plane(new THREE.Vector3(0, 0, BASE_D / 2 + 0.032), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const rightSide = surfaces.plane(new THREE.Vector3(BW / 2 + 0.006, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
  const geos = [
    stickerPatch(frontFace, -0.55, 0.22, 0.36, 0.24, -16 * DEG, cHello.uv, { nx: 6, ny: 6, offset: 0, lift: (u, v) => 0.06 * Math.pow(THREE.MathUtils.smoothstep(1 - v, 0.5, 1) * THREE.MathUtils.smoothstep(1 - u, 0.3, 1), 2) }),
    stickerPatch(frontFace, 0.42, 0.22, 0.4, 0.22, 24 * DEG, cPrice.uv, { nx: 6, ny: 6, offset: 0 }),
    stickerPatch(rightSide, -0.25 + HOUSE_Z0 * -1 - 0.02, BASE_H + 0.75, 0.38, 0.19, 12 * DEG, cZeros.uv, { nx: 4, ny: 4, offset: 0.004 }),
    stickerPatch(rightSide, -0.05 + HOUSE_Z0 * -1, BASE_H + 0.42, 0.2, 0.2, -8 * DEG, cSmile.uv, { nx: 4, ny: 4, offset: 0.006 }),
  ];
  const stickersGeo = merge(geos);
  geos.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.4, clearcoat: 0.6 }), '#f3efe6')));

  // ---------- typing animation (redraw at <= 15 fps)
  const update = (t: number) => {
    if (t - st.last < 1 / 15 && t >= st.last) return;
    st.last = t;
    drawScreen(st, t);
  };

  return finish(inner, trash, update, 'once-upon-os');
}

export const terminal: ObjectDef = {
  kind: 'terminal',
  name: 'Once Upon OS',
  tagline: 'the story machine',
  defaultRotation: [0.3, -0.22, 0.0],
  build,
};
