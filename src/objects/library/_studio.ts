import * as THREE from 'three';
import { fillPath, rrect, type C2D, type PathFn } from '../paint';

/*
 * Helpers shared by the studio shelf objects (figma tin, paintbox, swatch fan).
 */

/** The five Figma brand colours. */
export const FIGMA = {
  orange: '#F24E1E',
  salmon: '#FF7262',
  purple: '#A259FF',
  blue: '#1ABCFE',
  green: '#0ACF83',
} as const;

export const ZEROS = {
  lime: '#D7FF3A',
  pink: '#FF4FB8',
  ink: '#0B0B0D',
  cream: '#EFE9DF',
} as const;

/**
 * The Figma mark: five rounded shapes on a 2 x 3 grid (38 x 57 units). Drawn with its
 * centre at (cx, cy) and height h (design units).
 */
export function figmaLogo(c: C2D, cx: number, cy: number, h: number, opts: { outline?: { color: string; width: number } } = {}): void {
  const s = h / 3; // one cell
  const r = s / 2;
  const x0 = cx - s;
  const y0 = cy - h / 2;
  const parts: [PathFn, string][] = [
    [(q) => rrect(q, x0, y0, s, s, [r, 0, 0, r]), FIGMA.orange],
    [(q) => rrect(q, x0 + s, y0, s, s, [0, r, r, 0]), FIGMA.salmon],
    [(q) => rrect(q, x0, y0 + s, s, s, [r, 0, 0, r]), FIGMA.purple],
    [
      (q) => {
        q.moveTo(x0 + s + s, y0 + s + r);
        q.arc(x0 + s + r, y0 + s + r, r, 0, Math.PI * 2);
        q.closePath();
      },
      FIGMA.blue,
    ],
    [(q) => rrect(q, x0, y0 + 2 * s, s, s, [r, 0, r, r]), FIGMA.green],
  ];
  if (opts.outline) {
    c.save();
    c.lineJoin = 'round';
    c.strokeStyle = opts.outline.color;
    c.lineWidth = opts.outline.width;
    for (const [p] of parts) {
      c.beginPath();
      p(c);
      c.stroke();
    }
    c.restore();
  }
  for (const [p, col] of parts) fillPath(c, p, col);
}

/** Figma-style multiplayer cursor arrow with its tip at (x, y), pointing up-left. `s` = arrow height. */
export const cursorPath =
  (x: number, y: number, s: number): PathFn =>
  (q) => {
    const k = s / 100;
    q.moveTo(x, y);
    q.lineTo(x + 0 * k, y + 92 * k);
    q.lineTo(x + 24 * k, y + 70 * k);
    q.lineTo(x + 40 * k, y + 104 * k);
    q.lineTo(x + 56 * k, y + 97 * k);
    q.lineTo(x + 41 * k, y + 64 * k);
    q.lineTo(x + 72 * k, y + 62 * k);
    q.closePath();
  };

/** Rounded rectangle as a THREE.Shape (or a hole Path), centred at (cx, cy). */
export function roundedRect<T extends THREE.Shape | THREE.Path>(p: T, w: number, h: number, r: number, cx = 0, cy = 0): T {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  return p;
}

/**
 * Open tray walls: a rounded-rect ring (outer w x d, wall thickness t) extruded upwards by
 * `h` with a soft rolled lip. Lies on y = 0 .. h, centred on the origin.
 */
export function trayWalls(w: number, d: number, r: number, t: number, h: number, bevel = 0.05): THREE.BufferGeometry {
  const outer = roundedRect(new THREE.Shape(), w - 2 * bevel, d - 2 * bevel, Math.max(0.01, r - bevel));
  const hole = roundedRect(new THREE.Path(), w - 2 * t + 2 * bevel, d - 2 * t + 2 * bevel, Math.max(0.01, r - t + bevel));
  outer.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(outer, { depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  // shape in XY, extruded along +Z -> lay it down: shape Y -> -Z, extrusion -> +Y
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

/**
 * Vertex colours by facing: vertices whose normal points away from the vertical axis
 * through the origin (outer walls) get `outer`, the ones facing inwards get `inner`.
 * Mostly-horizontal faces (lips, floors) get `top`.
 */
export function colourByFacing(g: THREE.BufferGeometry, outer: THREE.ColorRepresentation, inner: THREE.ColorRepresentation, top: THREE.ColorRepresentation = outer): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const co = new THREE.Color(outer);
  const ci = new THREE.Color(inner);
  const ct = new THREE.Color(top);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    let col: THREE.Color;
    if (Math.abs(ny) > 0.8) col = ct;
    else col = nx * px + nz * pz >= 0 ? co : ci;
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return g;
}
