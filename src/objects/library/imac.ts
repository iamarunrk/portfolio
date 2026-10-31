import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObjectBuildContext } from '../types';
import type { LibraryDef } from './types';
import { Surface, StickerSheet, canvasTexture } from '../textures';
import { Trash, finish } from '../build';
import { lathe, fillet, merge, parametric, place, stickerPatch, tint, flatUV, type P2, type SurfacePoint } from '../geometry';
import { stickerSheet, paperBackfaces } from '../materials';
import { FONTS, DEG, rng, text, font, sticker, rrPath, circlePath, fillPath, smallPrint, sealPath, barcode, hexA, type C2D } from '../paint';
import { sgnpow, inCell, numSurface, superDisc, frameRing, crtFinish, translucentPlastic, cable, RAINBOW } from './_computers';

/*
 * iMac G3 (1998, Bondi Blue): a translucent gumdrop all-in-one. Frosted "ice" bezel
 * around a slightly convex CRT saying hello, a Bondi chin with speaker grilles and the
 * CD slot, the egg-shaped blue back with the carry handle, and the CRT funnel, yoke and
 * boards glowing through the shell. Modelled in centimetres, normalised afterwards.
 */

const W2 = 19; // half width of the front rim
const H = 40; // rim height
const LIFT = 1.3; // body bottom above the ground (feet)
const DB = 42; // body depth behind the rim
const POLE = 14.5; // height of the rounded back end above the body bottom
const N0 = 5.5; // squareness of the front outline
const RHO1 = 0.92; // where the flat bezel face meets its edge fillet
const FIL = 1.8; // fillet depth (z)
const BULGE = 0.5; // bezel convexity at the centre
const YC0 = LIFT + H / 2;
const SCR = { cy: LIFT + 23.3, hw: 13.4, hh: 10.05 }; // visible CRT
const SUR = { hw: 14.7, hh: 11.3 }; // dark inner surround
const CHIN_Y = LIFT + 7.7; // top edge of the Bondi chin band
const LOGO_Y = LIFT + 10.3;
const SPK = { x: 12.3, y: LIFT + 4.2, r: 2.7 };
const SLOT_Y = LIFT + 4.4;

const BONDI = '#14a7cc';
const BONDI_DEEP = '#0a7fa6';
const ICE = '#eef8fc';

// ------------------------------------------------------------------ shape

interface Section {
  w: number;
  yc: number;
  h: number;
  n: number;
  z: number;
}

/** Body cross-section at depth s (0 = front rim, 1 = back pole): a superellipse sitting on a flat-ish bottom. */
function section(s: number): Section {
  const Wt = Math.pow(Math.max(0, 1 - Math.pow(s, 2.2)), 1 / 2.2);
  const Tt = Math.pow(Math.max(0, 1 - Math.pow(s, 1.85)), 1 / 1.85);
  const Bt = Math.pow(Math.max(0, 1 - Math.pow(s, 5)), 1 / 5);
  const top = POLE + (H - POLE) * Tt;
  const bottom = POLE * (1 - Bt);
  return { w: W2 * Wt, yc: LIFT + (top + bottom) / 2, h: (top - bottom) / 2, n: N0 - 2.6 * s, z: -s * DB };
}

function bodyPoint(s: number, phi: number, out: THREE.Vector3): THREE.Vector3 {
  const S = section(s);
  const e = 2 / S.n;
  return out.set(S.w * sgnpow(Math.cos(phi), e), S.yc + S.h * sgnpow(Math.sin(phi), e), S.z);
}

/** Bezel height profile: flat-ish convex face, then a quarter-round fillet back to the rim (z = 0). */
function capZ(rho: number): number {
  if (rho <= RHO1) {
    const q = 1 - (rho / RHO1) ** 2;
    return FIL + BULGE * q * q;
  }
  const th = Math.asin(Math.min(1, (rho - RHO1) / (1 - RHO1)));
  return FIL * Math.cos(th);
}

function rhoAt(x: number, y: number): number {
  return Math.pow(Math.pow(Math.abs(x / W2), N0) + Math.pow(Math.abs((y - YC0) / (H / 2)), N0), 1 / N0);
}

/** z of the bezel surface at (x, y) (inside the flat face). */
function faceZ(x: number, y: number): number {
  return capZ(rhoAt(x, y));
}

/** Point on a side of the body: a = along the side (right: backwards, left: forwards), b = height. */
function sidePoint(side: 1 | -1) {
  return (a: number, b: number, out: THREE.Vector3): THREE.Vector3 => {
    const z = side === 1 ? -a : a;
    const S = section(THREE.MathUtils.clamp(-z / DB, 0, 1));
    const q = Math.min(1, Math.abs((b - S.yc) / S.h));
    const x = S.w * Math.pow(Math.max(0, 1 - Math.pow(q, S.n)), 1 / S.n);
    return out.set(side * x, b, z);
  };
}

/** Point on the top of the body: a = x, b = distance back from the rim. */
function topPoint(a: number, b: number, out: THREE.Vector3): THREE.Vector3 {
  const S = section(THREE.MathUtils.clamp(b / DB, 0, 1));
  const q = Math.min(1, Math.abs(a / S.w));
  const y = S.yc + S.h * Math.pow(Math.max(0, 1 - Math.pow(q, S.n)), 1 / S.n);
  return out.set(a, y, -b);
}

/** A superellipse patch laid on a surface (positions from `at`, pushed out along its normal). */
function superPatch(at: (a: number, b: number) => SurfacePoint, a0: number, b0: number, hw: number, hh: number, n: number, offset: number): THREE.BufferGeometry {
  const e = 2 / n;
  const tmp = new THREE.Vector3();
  return parametric(6, 48, (u, v, out) => {
    const phi = v * Math.PI * 2;
    const sp = at(a0 + u * hw * sgnpow(Math.cos(phi), e), b0 + u * hh * sgnpow(Math.sin(phi), e));
    out.copy(sp.p).add(tmp.copy(sp.n).multiplyScalar(offset));
  });
}

/** Apple silhouette (body + leaf; the bite is painted over in the background colour). */
function apple(c: C2D, cx: number, cy: number, s: number, fill: string | CanvasGradient, bg: string): void {
  c.save();
  c.beginPath();
  c.moveTo(cx, cy - 0.3 * s);
  c.bezierCurveTo(cx + 0.16 * s, cy - 0.44 * s, cx + 0.5 * s, cy - 0.4 * s, cx + 0.5 * s, cy - 0.02 * s);
  c.bezierCurveTo(cx + 0.5 * s, cy + 0.32 * s, cx + 0.3 * s, cy + 0.58 * s, cx + 0.16 * s, cy + 0.58 * s);
  c.bezierCurveTo(cx + 0.06 * s, cy + 0.58 * s, cx + 0.04 * s, cy + 0.52 * s, cx, cy + 0.52 * s);
  c.bezierCurveTo(cx - 0.04 * s, cy + 0.52 * s, cx - 0.06 * s, cy + 0.58 * s, cx - 0.16 * s, cy + 0.58 * s);
  c.bezierCurveTo(cx - 0.3 * s, cy + 0.58 * s, cx - 0.5 * s, cy + 0.32 * s, cx - 0.5 * s, cy - 0.02 * s);
  c.bezierCurveTo(cx - 0.5 * s, cy - 0.4 * s, cx - 0.16 * s, cy - 0.44 * s, cx, cy - 0.3 * s);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.beginPath();
  c.arc(cx + 0.58 * s, cy - 0.04 * s, 0.17 * s, 0, Math.PI * 2);
  c.fillStyle = bg;
  c.fill();
  c.beginPath();
  c.ellipse(cx + 0.07 * s, cy - 0.5 * s, 0.085 * s, 0.17 * s, 0.62, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  c.restore();
}

// ------------------------------------------------------------------ textures

/** Bezel map, planar over the front (x: -W2..W2, y: LIFT..LIFT+H): ice face, Bondi chin, speakers, logo. */
function paintBezel(s: Surface): void {
  const c = s.c;
  const k = s.w / (2 * W2); // px per cm
  const px = (x: number) => (x + W2) * k;
  const py = (y: number) => (LIFT + H - y) * k;
  const g = c.createLinearGradient(0, 0, 0, s.h);
  g.addColorStop(0, '#f6fbfd');
  g.addColorStop(1, '#e6f3f8');
  c.fillStyle = g;
  c.fillRect(0, 0, s.w, s.h);
  // Bondi chin
  const chin = c.createLinearGradient(0, py(CHIN_Y), 0, s.h);
  chin.addColorStop(0, '#2bb8da');
  chin.addColorStop(1, BONDI);
  c.fillStyle = chin;
  c.fillRect(0, py(CHIN_Y), s.w, s.h - py(CHIN_Y));
  c.fillStyle = hexA('#0a6f92', 0.55);
  c.fillRect(0, py(CHIN_Y) - 0.12 * k, s.w, 0.24 * k);
  // speaker grilles: hex-packed holes over a darker disc
  for (const sx of [-SPK.x, SPK.x]) {
    fillPath(c, circlePath(px(sx), py(SPK.y), SPK.r * k), hexA('#0b6d8f', 0.5));
    c.save();
    c.beginPath();
    c.arc(px(sx), py(SPK.y), (SPK.r - 0.25) * k, 0, Math.PI * 2);
    c.clip();
    const gap = 0.5 * k;
    c.fillStyle = '#063f55';
    for (let j = -8, row = 0; j <= 8; j++, row++) {
      for (let i = -8; i <= 8; i++) {
        const hx = px(sx) + (i + (row % 2 ? 0.5 : 0)) * gap;
        const hy = py(SPK.y) + j * gap * 0.866;
        c.beginPath();
        c.arc(hx, hy, 0.15 * k, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }
  // shadow behind the CD slot
  fillPath(c, rrPath(px(-7.2), py(SLOT_Y + 0.9), 14.4 * k, 1.8 * k, 0.9 * k), hexA('#086080', 0.45));
  // the logo: translucent Bondi apple under the screen
  apple(c, px(0), py(LOGO_Y), 2.5 * k, '#27a9cf', ICE);
  // tiny print along the chin
  smallPrint(c, ['iMac'], px(-SPK.x), py(SPK.y - SPK.r - 0.55), 0.62 * k, hexA('#e9fbff', 0.85), { family: FONTS.ui, weight: 600, align: 'center' });
  // bump: speaker holes + chin seam
  s.bumpDraw((b) => {
    b.fillStyle = 'rgb(70,70,70)';
    for (const sx of [-SPK.x, SPK.x]) {
      b.save();
      b.beginPath();
      b.arc(px(sx), py(SPK.y), (SPK.r - 0.25) * k, 0, Math.PI * 2);
      b.clip();
      const gap = 0.5 * k;
      for (let j = -8, row = 0; j <= 8; j++, row++) {
        for (let i = -8; i <= 8; i++) {
          b.beginPath();
          b.arc(px(sx) + (i + (row % 2 ? 0.5 : 0)) * gap, py(SPK.y) + j * gap * 0.866, 0.16 * k, 0, Math.PI * 2);
          b.fill();
        }
      }
      b.restore();
    }
    b.fillStyle = 'rgb(90,90,90)';
    b.fillRect(0, py(CHIN_Y) - 0.1 * k, s.w, 0.2 * k);
  });
}

interface ScreenState {
  surf: Surface;
  tex: THREE.CanvasTexture;
  key: string;
}

const HELLO_STOPS = ['#5fd0ff', '#7d7bff', '#c86bff', '#ff5fa8', '#ff8f3d', '#ffd23a', '#7fe37c'];

function drawScreen(st: ScreenState, t: number): void {
  // 9 s loop: hold "hello" (blinking cursor), fade, write it on again
  const T = 9;
  const tt = ((t % T) + T) % T;
  let reveal = 1;
  let alpha = 1;
  if (tt >= 5.6 && tt < 6.2) alpha = 1 - (tt - 5.6) / 0.6;
  else if (tt >= 6.2) {
    const p = Math.min(1, (tt - 6.2) / 2.1);
    reveal = p * p * (3 - 2 * p);
  }
  const cursorOn = Math.floor(t * 1.8) % 2 === 0;
  const key = `${reveal.toFixed(2)}:${alpha.toFixed(2)}:${cursorOn}`;
  if (key === st.key) return;
  st.key = key;

  const s = st.surf;
  const c = s.c;
  const W = s.w;
  const Hh = s.h;
  // deep Bondi desktop
  const bg = c.createRadialGradient(W * 0.45, Hh * 0.5, 40, W * 0.5, Hh * 0.55, W * 0.75);
  bg.addColorStop(0, '#1d5fbf');
  bg.addColorStop(0.55, '#133f93');
  bg.addColorStop(1, '#0a1f57');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, Hh);
  // soft desktop pattern
  c.save();
  c.globalAlpha = 0.08;
  c.strokeStyle = '#9fd0ff';
  c.lineWidth = 3;
  for (let i = -6; i < 16; i++) {
    c.beginPath();
    c.moveTo(i * 90, Hh);
    c.lineTo(i * 90 + Hh * 0.6, 0);
    c.stroke();
  }
  c.restore();
  // menu bar
  c.fillStyle = '#e9edf2';
  c.fillRect(0, 0, W, 44);
  c.fillStyle = '#9aa3ad';
  c.fillRect(0, 44, W, 3);
  const rb = c.createLinearGradient(0, 8, 0, 38);
  RAINBOW.forEach((col, i) => {
    rb.addColorStop(i / RAINBOW.length, col);
    rb.addColorStop((i + 1) / RAINBOW.length, col);
  });
  apple(c, 40, 23, 30, rb, '#e9edf2');
  c.font = font(23, FONTS.ui, 600);
  c.fillStyle = '#1b1f24';
  c.textBaseline = 'middle';
  ['File', 'Edit', 'View', 'Special', 'Ship'].forEach((w, i) => c.fillText(w, 82 + i * 92, 23));
  c.textAlign = 'right';
  c.fillText('1998', W - 24, 23);
  c.textAlign = 'left';
  // desktop icons
  const icon = (x: number, y: number, label: string, kind: 'hd' | 'trash') => {
    if (kind === 'hd') {
      fillPath(c, rrPath(x - 34, y - 22, 68, 40, 6), '#d6dbe2');
      fillPath(c, rrPath(x - 34, y + 8, 68, 10, 3), '#9aa3ad');
      fillPath(c, circlePath(x + 24, y + 13, 3), '#3cff7a');
    } else {
      fillPath(c, rrPath(x - 22, y - 26, 44, 50, 6), '#d6dbe2');
      fillPath(c, rrPath(x - 28, y - 32, 56, 9, 4), '#b9c0c9');
      c.fillStyle = '#9aa3ad';
      for (let i = -1; i <= 1; i++) c.fillRect(x + i * 12 - 2, y - 16, 4, 34);
    }
    c.font = font(17, FONTS.ui, 600);
    c.textAlign = 'center';
    c.textBaseline = 'top';
    fillPath(c, rrPath(x - 52, y + 30, 104, 24, 4), hexA('#0a1f57', 0.55));
    c.fillStyle = '#ffffff';
    c.fillText(label, x, y + 33);
    c.textAlign = 'left';
  };
  icon(W - 80, 110, 'Zeros HD', 'hd');
  icon(W - 80, Hh - 110, 'Trash', 'trash');

  // hello
  const hx = W * 0.47;
  const hy = Hh * 0.6;
  const st0 = { size: 300, family: FONTS.serif, italic: true, align: 'center' as const };
  const tw = 640;
  const grad = c.createLinearGradient(hx - tw / 2, 0, hx + tw / 2, 0);
  HELLO_STOPS.forEach((col, i) => grad.addColorStop(i / (HELLO_STOPS.length - 1), col));
  c.save();
  c.globalAlpha = alpha;
  c.beginPath();
  c.rect(hx - tw / 2 - 40, 0, (tw + 80) * reveal, Hh);
  c.clip();
  c.save();
  c.shadowColor = 'rgba(150,200,255,0.55)';
  c.shadowBlur = 26 * (c.getTransform().a || 1);
  text(c, 'hello', hx, hy, { ...st0, color: grad, outlines: [{ color: grad as unknown as string, width: 9 }] });
  c.restore();
  text(c, 'hello', hx, hy, { ...st0, color: grad, outlines: [{ color: grad as unknown as string, width: 9 }] });
  c.restore();
  // cursor: blinking i-beam after the word (or riding the reveal edge)
  const cx = hx - tw / 2 - 40 + (tw + 80) * reveal + (reveal >= 1 ? -6 : 0);
  if (cursorOn || reveal < 1) {
    c.fillStyle = '#ffffff';
    c.fillRect(cx, hy - 170, 7, 200);
  }
  // tagline
  c.globalAlpha = 1;
  smallPrint(c, ['once upon a time · a computer said'], hx, Hh - 92, 22, hexA('#cfe6ff', 0.75), { family: FONTS.spaceMono, weight: 700, align: 'center' });
  crtFinish(c, W, Hh, 4, 0.16);
  st.tex.needsUpdate = true;
}

// ------------------------------------------------------------------ build

function build(bctx: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  const e0 = 2 / N0;

  // ---------- Bondi body shell (egg-shaped, translucent)
  const NU = 72;
  const sOf = (u: number) => 1 - Math.pow(1 - u, 1.7);
  const bodyShell = parametric(NU, 128, (u, v, out) => bodyPoint(sOf(u), v * Math.PI * 2, out));
  {
    const nor = bodyShell.getAttribute('normal') as THREE.BufferAttribute;
    for (let j = 0; j <= 128; j++) nor.setXYZ(j * (NU + 1) + NU, 0, 0, -1);
    nor.needsUpdate = true;
  }
  // handle: a raised lip around the slot on the top back
  const topAt = numSurface(topPoint, 0.05);
  const HANDLE = { b: 0.71 * DB, hw: 9.6, hh: 2.3, n: 8 };
  const lipPts: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) {
    const phi = (i / 48) * Math.PI * 2;
    const sp = topAt(HANDLE.hw * 1.08 * sgnpow(Math.cos(phi), 2 / HANDLE.n), HANDLE.b + HANDLE.hh * 1.25 * sgnpow(Math.sin(phi), 2 / HANDLE.n));
    lipPts.push(sp.p.add(sp.n.multiplyScalar(0.12)));
  }
  const lip = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lipPts, true, 'centripetal'), 96, 0.42, 8, true);
  const bodyGeo = merge([bodyShell, lip]);
  bodyShell.dispose();
  lip.dispose();
  const bodyMat = translucentPlastic('#1cb3d9', {
    transmission: 0.86,
    roughness: 0.16,
    thickness: 2.5,
    attenuationColor: new THREE.Color('#0aa0c8'),
    attenuationDistance: 26,
    glow: '#0e9cc4',
    glowIntensity: 0.18,
  });
  inner.add(new THREE.Mesh(bodyGeo, bodyMat));

  // ---------- ice bezel (front cap with fillet) + the raised ring around the screen + feet
  const A = 0.78;
  const capProfile = (u: number): [number, number] => {
    if (u <= A) {
      const rho = RHO1 * (u / A);
      return [rho, capZ(rho)];
    }
    const th = ((u - A) / (1 - A)) * (Math.PI / 2);
    return [RHO1 + (1 - RHO1) * Math.sin(th), FIL * Math.cos(th)];
  };
  const capXY = (u: number, v: number): [number, number, number] => {
    const [rho, z] = capProfile(u);
    const phi = v * Math.PI * 2;
    return [rho * W2 * sgnpow(Math.cos(phi), e0), YC0 + rho * (H / 2) * sgnpow(Math.sin(phi), e0), z];
  };
  const cap = parametric(
    44,
    128,
    (u, v, out) => {
      const [x, y, z] = capXY(u, v);
      out.set(x, y, z);
    },
    {
      uv: (u, v) => {
        const [x, y] = capXY(u, v);
        return [(x + W2) / (2 * W2), (y - LIFT) / H];
      },
    },
  );
  // ring: follows the bezel bulge (z displaced per vertex, normals kept)
  const ring = frameRing(SUR.hw * 2 - 0.5, SUR.hh * 2 - 0.5, 4.2, 0.95, 0.5, 0.18);
  {
    const pos = ring.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i) + SCR.cy;
      pos.setXYZ(i, x, y, pos.getZ(i) + faceZ(x, y) - 0.15);
    }
    pos.needsUpdate = true;
  }
  flatUV(ring, 0.5, 0.97);
  const ICE_UV: [number, number] = [0.5, 0.97];
  const iceParts: THREE.BufferGeometry[] = [cap, ring];
  // the flip-out front leg in ice
  {
    const foot = new THREE.CapsuleGeometry(0.75, 9, 6, 16);
    foot.rotateZ(Math.PI / 2);
    iceParts.push(flatUV(place(foot, [0, 0.8, -3.2], [0, 0, 0], [1, 1, 1.8]), ...ICE_UV));
  }
  const iceGeo = merge(iceParts);
  iceParts.forEach((g) => g.dispose());
  const bezel = new Surface(1024, Math.round((1024 * H) / (2 * W2)), bctx, { density: 1, bump: { base: 0.5, density: 0.5 } });
  paintBezel(bezel);
  const bezelTex = bezel.colorTexture();
  const iceMat = translucentPlastic('#ffffff', {
    map: bezelTex,
    emissiveMap: bezelTex,
    glow: '#ffffff',
    glowIntensity: 0.16,
    bumpMap: bezel.bumpTexture(),
    bumpScale: 1.2,
    transmission: 0.32,
    roughness: 0.34,
    thickness: 2.5,
    attenuationColor: new THREE.Color('#e3f4fb'),
    attenuationDistance: 60,
    clearcoatRoughness: 0.12,
  });
  inner.add(new THREE.Mesh(iceGeo, iceMat));

  // ---------- dark parts: screen surround band, CD slot, internals (CRT funnel, chips), speaker magnets
  const dark: THREE.BufferGeometry[] = [];
  {
    // surround as a ring patch between the screen and the surround outline
    const eS = 2 / 6;
    const band = parametric(
      4,
      96,
      (u, v, out) => {
        const phi = v * Math.PI * 2;
        const hw = SCR.hw - 0.3 + u * (SUR.hw - SCR.hw + 0.3);
        const hh = SCR.hh - 0.3 + u * (SUR.hh - SCR.hh + 0.3);
        const x = hw * sgnpow(Math.cos(phi), eS);
        const y = SCR.cy + hh * sgnpow(Math.sin(phi), eS);
        out.set(x, y, faceZ(x, y) + 0.06);
      },
    );
    dark.push(band);
  }
  {
    const slot = new THREE.CapsuleGeometry(0.34, 12, 4, 12);
    slot.rotateZ(Math.PI / 2);
    dark.push(place(slot, [0, SLOT_Y, faceZ(0, SLOT_Y) - 0.12], [0, 0, 0], [1, 1, 0.6]));
  }
  // CRT funnel + neck (lathe along -Z)
  const funnelProfile: P2[] = fillet(
    [
      [0, 0],
      [13.6, 0],
      [14.2, 1.6],
      [11.5, 5.5],
      [6, 11],
      [3.1, 14.6],
      [1.9, 16.6],
      [1.9, 27.5],
      [1.5, 28.6],
      [0, 28.8],
    ],
    [0, 0.6, 1.2, 1.5, 1.5, 1.0, 0.6, 0.3, 0.2, 0],
    4,
  );
  const funnel = lathe(funnelProfile, { segments: 48 });
  funnel.rotateX(-Math.PI / 2);
  funnel.translate(0, SCR.cy, 0.4);
  dark.push(funnel);
  // speaker magnets behind the grilles
  for (const sx of [-SPK.x, SPK.x]) dark.push(place(new THREE.CylinderGeometry(2.3, 2.3, 2.2, 28).rotateX(Math.PI / 2), [sx, SPK.y, -0.6]));
  // chips on the logic board
  const rnd = rng(7);
  for (let i = 0; i < 7; i++) {
    dark.push(place(new THREE.BoxGeometry(1.6 + rnd() * 2.6, 0.5, 1.4 + rnd() * 2.2), [(rnd() - 0.5) * 16, LIFT + 2.4, -6 - rnd() * 13]));
  }
  // the carry-handle opening on the top back
  dark.push(superPatch(topAt, 0, HANDLE.b, HANDLE.hw, HANDLE.hh, HANDLE.n, 0.07));
  // rubber feet at the back
  for (const fx of [-7.5, 7.5]) dark.push(place(new THREE.CylinderGeometry(1.4, 1.6, LIFT + 0.6, 20), [fx, (LIFT + 0.6) / 2, -24]));
  const darkGeo = merge(dark);
  dark.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(darkGeo, new THREE.MeshPhysicalMaterial({ color: '#1a1f24', roughness: 0.42, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.2 })));

  // ---------- metal: copper yoke, CD drive, shields, capacitor tops
  const metal: THREE.BufferGeometry[] = [];
  const yoke = lathe(
    fillet(
      [
        [2.4, 14.2],
        [4.7, 14.4],
        [5.0, 16.6],
        [4.7, 18.8],
        [2.4, 19.0],
      ],
      [0, 0.4, 0.8, 0.4, 0],
      3,
    ),
    { segments: 40 },
  );
  yoke.rotateX(-Math.PI / 2);
  yoke.translate(0, SCR.cy, 0.4);
  metal.push(tint(yoke, '#c8743a'));
  metal.push(tint(place(new THREE.BoxGeometry(13.6, 1.7, 13), [0, SLOT_Y, -7.6]), '#cfd5db'));
  for (let i = 0; i < 6; i++) {
    const r = 0.45 + rnd() * 0.45;
    metal.push(tint(place(new THREE.CylinderGeometry(r, r, 1.6 + rnd() * 1.4, 16), [(rnd() - 0.5) * 18, LIFT + 3.2, -8 - rnd() * 12]), '#b7bec6'));
  }
  // heat sink fins
  for (let i = 0; i < 7; i++) metal.push(tint(place(new THREE.BoxGeometry(0.18, 2.4, 5), [5 + i * 0.6, LIFT + 3.5, -15]), '#d9dee3'));
  const metalGeo = merge(metal);
  metal.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(metalGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 1, roughness: 0.3, clearcoat: 0.3 })));

  // ---------- green boards
  const pcb: THREE.BufferGeometry[] = [];
  pcb.push(place(new THREE.BoxGeometry(22, 0.25, 17), [0, LIFT + 2.0, -13]));
  pcb.push(place(new THREE.BoxGeometry(6, 6, 0.25), [0, SCR.cy, -28.8]));
  const pcbGeo = merge(pcb);
  pcb.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(pcbGeo, new THREE.MeshStandardMaterial({ color: '#1e7d4c', roughness: 0.5, metalness: 0.1 })));

  // ---------- inner ice-white CRT housing (reads through the blue sides like on the real one) + colour wires
  const plastic: THREE.BufferGeometry[] = [];
  plastic.push(tint(place(new RoundedBoxGeometry(31, 33, 12.5, 4, 4), [0, YC0 - 0.3, -7.6]), '#e2eef3'));
  const wireCols = ['#ff3b3b', '#ffd21f', '#f4f4f4', '#2f6bff'];
  wireCols.forEach((col, i) => {
    const dx = (i - 1.5) * 0.9;
    plastic.push(
      tint(
        cable(
          [
            new THREE.Vector3(dx, SCR.cy - 2.6, -28.4),
            new THREE.Vector3(dx * 2 + 2, SCR.cy - 7, -27),
            new THREE.Vector3(dx * 3 + 4, LIFT + 6, -23),
            new THREE.Vector3(dx * 3 + 5, LIFT + 2.5, -19),
          ],
          0.28,
          32,
        ),
        col,
      ),
    );
  });
  const plasticGeo = merge(plastic);
  plastic.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(plasticGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.3 })));

  // ---------- CRT glass (emissive canvas)
  const screenSurf = new Surface(1024, 768, bctx, { density: 1 });
  const screenTex = canvasTexture(screenSurf.color.canvas, bctx, true);
  const scr: ScreenState = { surf: screenSurf, tex: screenTex, key: '' };
  drawScreen(scr, 0);
  const screenGeo = superDisc(
    SCR.hw,
    SCR.hh,
    7,
    (x, y) => {
      const qx = x / SCR.hw;
      const qy = (y - SCR.cy) / SCR.hh;
      return faceZ(x, y) + 0.04 + 0.42 * Math.max(0, 1 - qx * qx) * Math.max(0, 1 - qy * qy);
    },
    { cy: SCR.cy, nr: 12, nphi: 96 },
  );
  const screenMat = new THREE.MeshPhysicalMaterial({
    color: '#000000',
    emissive: '#ffffff',
    emissiveMap: screenTex,
    emissiveIntensity: 1.25,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  inner.add(new THREE.Mesh(screenGeo, screenMat));

  // ---------- stickers
  const sheet = new StickerSheet(1024, 512, bctx, 14);
  const cZeros = sheet.alloc(330, 140);
  inCell(sheet, cZeros, (c) => {
    sticker(c, 0, 0, 0, rrPath(-150, -56, 300, 112, 56), { border: 9, fill: '#d7ff3a', shadow: 0.6 }, (k) => {
      text(k, 'ZEROS', 0, 30, { size: 84, family: FONTS.bagel, align: 'center', color: '#0b0b0d' });
    });
  });
  const cShip = sheet.alloc(330, 220);
  inCell(sheet, cShip, (c) => {
    sticker(c, 0, 0, 0, rrPath(-150, -96, 300, 192, 14), { border: 10, fill: '#fbfaf6', shadow: 0.6 }, (k) => {
      RAINBOW.forEach((col, i) => fillPath(k, rrPath(-138, -84 + i * 15, 70, 15, 0), col));
      apple(k, -103, 34, 54, '#111', '#fbfaf6');
      text(k, 'ship', 34, -12, { size: 62, family: FONTS.serif, italic: true, align: 'center', color: '#111' });
      text(k, 'different.', 34, 44, { size: 54, family: FONTS.serif, italic: true, align: 'center', color: '#111' });
      smallPrint(k, ['ZEROS · EST. ONCE UPON A TIME'], 34, 64, 13, '#555', { align: 'center', weight: 700 });
    });
  });
  const cHello = sheet.alloc(340, 180);
  inCell(sheet, cHello, (c) => {
    sticker(c, 0, 0, 0, rrPath(-156, -74, 312, 148, 26), { border: 10, fill: BONDI_DEEP, shadow: 0.6 }, (k) => {
      const g = k.createLinearGradient(-130, 0, 130, 0);
      HELLO_STOPS.forEach((col, i) => g.addColorStop(i / (HELLO_STOPS.length - 1), col));
      text(k, 'hello', -6, 18, { size: 108, family: FONTS.serif, italic: true, align: 'center', color: '#ffffff', outlines: [{ color: '#ffffff', width: 3 }] });
      text(k, '(again)', 70, 56, { size: 34, family: FONTS.serif, italic: true, align: 'center', color: '#bdf0ff' });
      fillPath(k, rrPath(-140, -64, 280, 8, 4), g);
    });
  });
  const cY2K = sheet.alloc(190, 190);
  inCell(sheet, cY2K, (c) => {
    sticker(c, 0, 0, 0, sealPath(0, 0, 82, 14, 5), { border: 7, fill: '#ffd21f', shadow: 0.7 }, (k) => {
      fillPath(k, circlePath(0, 0, 64), '#ff4fb8');
      text(k, 'Y2K', 0, 2, { size: 50, family: FONTS.archivoBlack, align: 'center', color: '#fff', outlines: [{ color: '#0b0b0d', width: 8 }] });
      text(k, 'READY ✓', 0, 34, { size: 19, family: FONTS.rubikMono, align: 'center', color: '#0b0b0d' });
    });
  });
  const cBar = sheet.alloc(250, 110);
  inCell(sheet, cBar, (c) => {
    sticker(c, 0, 0, 0, rrPath(-115, -44, 230, 88, 6), { border: 0, fill: '#ffffff', shadow: 0.5 }, (k) => {
      barcode(k, -100, -34, 120, 64, 1998, { digits: 'M6709LL/A' });
      text(k, '233', 64, -2, { size: 30, family: FONTS.archivoBlack, align: 'center', color: '#111' });
      smallPrint(k, ['MHz · G3'], 64, 8, 15, '#111', { align: 'center', weight: 700 });
    });
  });
  const sheetTex = sheet.surf.colorTexture();
  const right = numSurface(sidePoint(1), 0.05);
  const left = numSurface(sidePoint(-1), 0.05);
  const front = numSurface((a, b, out) => out.set(a, b, faceZ(a, b)), 0.05);
  const stickerGeos = [
    stickerPatch(right, 10.5, LIFT + 27.5, 9.6, 4.1, 7 * DEG, cZeros.uv, { nx: 10, ny: 6, offset: 0.08 }),
    stickerPatch(right, 21.5, LIFT + 15.5, 9.4, 6.3, -9 * DEG, cShip.uv, { nx: 10, ny: 8, offset: 0.08 }),
    stickerPatch(left, -15, LIFT + 25, 9.8, 4.6, -6 * DEG, cHello.uv, { nx: 10, ny: 6, offset: 0.08 }),
    stickerPatch(front, 12.6, LIFT + 9.6, 5.4, 5.4, 14 * DEG, cY2K.uv, {
      nx: 8,
      ny: 8,
      offset: 0.05,
      lift: (u, v) => 0.9 * Math.pow(THREE.MathUtils.smoothstep(u + (1 - v) * 0.6, 1.05, 1.6), 2),
    }),
    stickerPatch(left, -27, LIFT + 12, 6.6, 2.9, 4 * DEG, cBar.uv, { nx: 8, ny: 4, offset: 0.08 }),
  ];
  const stickersGeo = merge(stickerGeos);
  stickerGeos.forEach((g) => g.dispose());
  inner.add(new THREE.Mesh(stickersGeo, paperBackfaces(stickerSheet(sheetTex, { roughness: 0.42, clearcoat: 0.6 }), '#f3efe6')));

  const update = (t: number) => drawScreen(scr, t);
  return finish(inner, trash, update, 'imac-g3');
}

export const imac: LibraryDef = {
  kind: 'imac',
  name: 'iMac G3',
  tagline: 'hello (again)',
  category: 'tech',
  defaultRotation: [0.2, -0.62, 0],
  build,
};
export default imac;
