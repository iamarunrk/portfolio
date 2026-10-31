import * as THREE from 'three';
import { fromPx, toPx } from '../layout';
import { titleLive } from '../hero/titleLive';
import { useStore, type Transform } from '../store';
import { engineRef } from './engineRef';
import {
  AXES,
  AXIS_COLOR,
  GIZMO_AXIS,
  RING_BASIS,
  RING_SCALE,
  RING_SEGMENTS,
  gizmoFrame,
  pushGizmoFrame,
  type Axis,
  type DragMode,
  type Handle,
} from './gizmo';
import { applyPose, frameRef, registry, worldSphere, type LiveObject } from './registry';

const TAU = Math.PI * 2;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3.2;
const SNAP = THREE.MathUtils.degToRad(15);

interface PointerInfo {
  x: number;
  y: number;
  type: string;
}

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><g fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='M21 9.5A8 8 0 1 0 22 16' stroke='white' stroke-width='5'/><path d='M22 4.5v5.5h-5.5' stroke='white' stroke-width='5'/><path d='M21 9.5A8 8 0 1 0 22 16' stroke='black' stroke-width='2'/><path d='M22 4.5v5.5h-5.5' stroke='black' stroke-width='2'/></g></svg>`,
)}") 14 14, grab`;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _sphere = new THREE.Sphere();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const VIEW_AXIS = new THREE.Vector3(0, 0, 1);

function quatToArr(q: THREE.Quaternion): Transform['q'] {
  return [q.x, q.y, q.z, q.w];
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/**
 * Owns every pointer/touch/wheel/keyboard interaction on the canvas: picking
 * objects, moving them in the canvas plane, rotating them with the gizmo rings,
 * scaling (knob, wheel, pinch), twisting with two fingers, and moving/scaling
 * the hero title frame. Also computes the gizmo overlay geometry each frame.
 */
export class InteractionController {
  private raycaster = new THREE.Raycaster();
  private pointers = new Map<number, PointerInfo>();
  private mode: DragMode = 'idle';
  private target: LiveObject | null = null;
  private hover: Handle | null = null;
  private pendingDeselect = false;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private moved = false;
  private pointerType = 'mouse';
  private shift = false;

  // move
  private offNx = 0;
  private offNy = 0;
  // rotate
  private rotAxis: Axis = 'y';
  private rotMode: 'plane' | 'tangent' = 'plane';
  private rotV0 = new THREE.Vector3();
  private rotPrev = new THREE.Vector3();
  private rotRaw = 0;
  private rotApplied = 0;
  private rotQ0 = new THREE.Quaternion();
  private tanDir = new THREE.Vector2();
  private tanPxPerRad = 1;
  // scale
  private s0 = 1;
  private d0 = 1;
  // pinch
  private pinch = { d0: 1, a0: 0, mx0: 0, my0: 0, s0: 1, q0: new THREE.Quaternion(), nx0: 0, ny0: 0 };
  // title
  private title0 = { nx: 0, ny: 0, s: 1, d0: 1 };
  // taps
  private lastTap = { t: 0, id: '', x: 0, y: 0 };
  // wheel commit debounce
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;
  private wheelTarget: LiveObject | null = null;
  // gizmo geometry cache for hit-testing
  private ringPts: Record<Axis, Float32Array> = {
    x: new Float32Array((RING_SEGMENTS + 1) * 2),
    y: new Float32Array((RING_SEGMENTS + 1) * 2),
    z: new Float32Array((RING_SEGMENTS + 1) * 2),
  };
  private ringFront: Record<Axis, Uint8Array> = {
    x: new Uint8Array(RING_SEGMENTS + 1),
    y: new Uint8Array(RING_SEGMENTS + 1),
    z: new Uint8Array(RING_SEGMENTS + 1),
  };
  private gizmoValidFor: string | null = null;
  private hoverAt: [number, number] | null = null;
  private knob: [number, number] = [0, 0];
  private center: [number, number] = [0, 0];
  private ringPx = 0;
  private cursor = '';

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
  ) {}

  attach() {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('pointerleave', this.onLeave);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    clearTimeout(this.wheelTimer);
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private project(p: THREE.Vector3): [number, number] {
    const f = frameRef.current;
    _v.copy(p).project(this.camera);
    return [(_v.x * 0.5 + 0.5) * f.widthPx, (-_v.y * 0.5 + 0.5) * f.heightPx];
  }

  private setRay(x: number, y: number) {
    const f = frameRef.current;
    _ndc.set((x / f.widthPx) * 2 - 1, -(y / f.heightPx) * 2 + 1);
    this.raycaster.setFromCamera(_ndc, this.camera);
  }

  /** Screen radius (px) of a world sphere. */
  private projectedRadius(s: THREE.Sphere): number {
    const [cx] = this.project(s.center);
    _v2.copy(s.center).x += s.radius;
    const [rx] = this.project(_v2);
    return Math.abs(rx - cx);
  }

  private selectedObject(): LiveObject | null {
    const sel = useStore.getState().selected;
    if (!sel || sel === 'title') return null;
    const o = registry.get(sel);
    return o && o.built ? o : null;
  }

  private setCursor(c: string) {
    if (this.cursor !== c) {
      this.cursor = c;
      this.canvas.style.cursor = c;
    }
  }

  private commit(o: LiveObject) {
    useStore.getState().commitTransform(o.id, { nx: o.cur.nx, ny: o.cur.ny, s: o.cur.s, q: quatToArr(o.cur.q) });
  }

  /** Sets both rendered and target pose (no easing) while the visitor manipulates. */
  private setPose(o: LiveObject, p: { nx?: number; ny?: number; s?: number; q?: THREE.Quaternion }) {
    if (p.nx !== undefined) o.cur.nx = o.tgt.nx = THREE.MathUtils.clamp(p.nx, -1.12, 1.12);
    if (p.ny !== undefined) o.cur.ny = o.tgt.ny = THREE.MathUtils.clamp(p.ny, -1.12, 1.12);
    if (p.s !== undefined) o.cur.s = o.tgt.s = THREE.MathUtils.clamp(p.s, MIN_SCALE, MAX_SCALE);
    if (p.q) {
      o.cur.q.copy(p.q);
      o.tgt.q.copy(p.q);
    }
  }

  // ───────────────────────────── picking ─────────────────────────────

  private pickObject(x: number, y: number): LiveObject | null {
    this.setRay(x, y);
    let best: LiveObject | null = null;
    let bestDist = Infinity;
    for (const o of registry.values()) {
      if (!o.built || o.appear < 0.6) continue;
      worldSphere(o, _sphere);
      const [cx, cy] = this.project(_sphere.center);
      const rpx = this.projectedRadius(_sphere);
      const d = Math.hypot(x - cx, y - cy);
      if (d > rpx * 1.02) continue;
      const hits = this.raycaster.intersectObject(o.inner, true);
      let dist = Infinity;
      for (const h of hits) {
        if (h.object.visible) {
          dist = h.distance;
          break;
        }
      }
      // Generous fallback near the centre so thin/glassy shapes are still easy to grab.
      if (!Number.isFinite(dist) && d < rpx * 0.5) dist = this.camera.position.distanceTo(_sphere.center);
      if (dist < bestDist) {
        bestDist = dist;
        best = o;
      }
    }
    return best;
  }

  private hitTitle(x: number, y: number): 'body' | number | null {
    const f = frameRef.current;
    const r = titleLive.rect(f);
    if (!r) return null;
    const sel = useStore.getState().selected === 'title';
    if (sel) {
      const tol = this.pointerType === 'touch' ? 22 : 12;
      const corners: [number, number][] = [
        [r.x - r.w / 2, r.y - r.h / 2],
        [r.x + r.w / 2, r.y - r.h / 2],
        [r.x + r.w / 2, r.y + r.h / 2],
        [r.x - r.w / 2, r.y + r.h / 2],
      ];
      for (let i = 0; i < 4; i++) if (Math.hypot(x - corners[i][0], y - corners[i][1]) < tol) return i;
    }
    if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(y - r.y) <= r.h / 2) return 'body';
    return null;
  }

  private hitTest(x: number, y: number): Handle | null {
    const touch = this.pointerType === 'touch';
    const o = this.selectedObject();
    if (o && this.gizmoValidFor === o.id) {
      const tolKnob = touch ? 26 : 15;
      if (Math.hypot(x - this.knob[0], y - this.knob[1]) < tolKnob) return { type: 'scale' };
      const tol = touch ? 18 : 9;
      let bestAxis: Axis | null = null;
      let bestD = tol;
      for (const axis of AXES) {
        const pts = this.ringPts[axis];
        const front = this.ringFront[axis];
        for (let i = 0; i < RING_SEGMENTS; i++) {
          const d =
            distToSegment(x, y, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]) + (front[i] ? 0 : 3.5);
          if (d < bestD) {
            bestD = d;
            bestAxis = axis;
          }
        }
      }
      if (bestAxis) return { type: 'ring', axis: bestAxis };
    }
    const t = useStore.getState().selected === 'title' ? this.hitTitle(x, y) : null;
    if (typeof t === 'number') return { type: 'title-corner', corner: t as 0 | 1 | 2 | 3 };
    const picked = this.pickObject(x, y);
    if (picked) return { type: 'object', id: picked.id };
    const tb = t ?? this.hitTitle(x, y);
    if (tb === 'body') return { type: 'title' };
    return null;
  }

  // ───────────────────────────── pointer events ─────────────────────────────

  private onContextMenu = (e: Event) => {
    if (this.mode !== 'idle') e.preventDefault();
  };

  private onLeave = () => {
    this.hoverAt = null;
    if (this.mode === 'idle') this.setHover(null);
  };

  private onBlur = () => {
    this.shift = false;
  };

  private setHover(h: Handle | null) {
    this.hover = h;
    const hoveredId = h?.type === 'object' ? h.id : h?.type === 'title' ? 'title' : null;
    for (const o of registry.values()) o.hoverTarget = o.id === hoveredId ? 1 : 0;
    const st = useStore.getState();
    if (st.hovered !== hoveredId) st.hover(hoveredId);
    if (!h) this.setCursor('');
    else if (h.type === 'object') this.setCursor('grab');
    else if (h.type === 'ring') this.setCursor(ROTATE_CURSOR);
    else if (h.type === 'scale') this.setCursor('nwse-resize');
    else if (h.type === 'title') this.setCursor('move');
    else if (h.type === 'title-corner') this.setCursor(h.corner % 2 === 0 ? 'nwse-resize' : 'nesw-resize');
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y, type: e.pointerType });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.pointerType = e.pointerType;
    this.shift = e.shiftKey;

    if (this.pointers.size === 2) {
      const o = this.target ?? this.selectedObject();
      if (o) this.startPinch(o);
      return;
    }
    if (this.pointers.size > 2) return;

    this.downX = this.lastX = x;
    this.downY = this.lastY = y;
    this.moved = false;
    this.pendingDeselect = false;

    const hit = this.hitTest(x, y);
    const st = useStore.getState();
    if (st.islandTab) st.setIslandTab(null);

    if (!hit) {
      this.mode = 'idle';
      this.pendingDeselect = true;
      this.target = null;
      return;
    }
    e.preventDefault();

    switch (hit.type) {
      case 'ring': {
        const o = this.selectedObject();
        if (o) this.startRotate(o, hit.axis, x, y);
        break;
      }
      case 'scale': {
        const o = this.selectedObject();
        if (o) {
          this.mode = 'scale';
          this.target = o;
          o.dragging = true;
          this.s0 = o.cur.s;
          this.d0 = Math.max(8, Math.hypot(x - this.center[0], y - this.center[1]));
          this.setCursor('nwse-resize');
        }
        break;
      }
      case 'object': {
        const o = registry.get(hit.id)!;
        if (st.selected !== o.id) st.select(o.id);
        st.bringToFront(o.id);
        this.mode = 'move';
        this.target = o;
        const [pnx, pny] = fromPx(x, y, frameRef.current);
        this.offNx = o.cur.nx - pnx;
        this.offNy = o.cur.ny - pny;
        this.setCursor('grabbing');
        break;
      }
      case 'title': {
        if (st.selected !== 'title') st.select('title');
        this.mode = 'title-move';
        this.target = null;
        const [pnx, pny] = fromPx(x, y, frameRef.current);
        this.offNx = titleLive.cur.nx - pnx;
        this.offNy = titleLive.cur.ny - pny;
        titleLive.dragging = true;
        this.setCursor('move');
        break;
      }
      case 'title-corner': {
        const r = titleLive.rect(frameRef.current);
        if (!r) break;
        this.mode = 'title-scale';
        titleLive.dragging = true;
        this.title0 = { ...titleLive.cur, d0: Math.max(8, Math.hypot(x - r.x, y - r.y)) };
        break;
      }
    }
  };

  private startRotate(o: LiveObject, axis: Axis, x: number, y: number) {
    this.mode = 'rotate';
    this.target = o;
    o.dragging = true;
    this.rotAxis = axis;
    this.rotRaw = 0;
    this.rotApplied = 0;
    this.rotQ0.copy(o.cur.q);
    const n = GIZMO_AXIS[axis];
    const C = o.outer.position;
    this.setRay(x, y);
    const facing = Math.abs(this.raycaster.ray.direction.dot(n));
    if (facing > 0.22) {
      this.rotMode = 'plane';
      _plane.setFromNormalAndCoplanarPoint(n, C);
      if (this.raycaster.ray.intersectPlane(_plane, _v)) {
        this.rotV0.copy(_v).sub(C).normalize();
        this.rotPrev.copy(this.rotV0);
      } else {
        this.rotMode = 'tangent';
      }
    } else {
      this.rotMode = 'tangent';
    }
    if (this.rotMode === 'tangent') {
      // Closest ring sample to the grab point gives the tangent direction on screen.
      const pts = this.ringPts[axis];
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < RING_SEGMENTS; i++) {
        const d = Math.hypot(x - pts[i * 2], y - pts[i * 2 + 1]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const [u, w] = RING_BASIS[axis];
      const th = (bi / RING_SEGMENTS) * TAU;
      worldSphere(o, _sphere);
      const R = _sphere.radius * RING_SCALE;
      const G = new THREE.Vector3().copy(u).multiplyScalar(Math.cos(th)).addScaledVector(w, Math.sin(th));
      this.rotV0.copy(G).normalize();
      const T = new THREE.Vector3().crossVectors(n, G).normalize();
      const delta = 0.05;
      const p0 = this.project(_v.copy(C).addScaledVector(G, R));
      const p1 = this.project(_v.copy(C).addScaledVector(G, R).addScaledVector(T, R * delta));
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) {
        this.tanDir.set(1, 0);
        this.tanPxPerRad = Math.max(40, this.ringPx);
      } else {
        this.tanDir.set(dx / len, dy / len);
        this.tanPxPerRad = len / delta;
      }
    }
    this.setCursor(ROTATE_CURSOR);
  }

  private startPinch(o: LiveObject) {
    const [a, b] = [...this.pointers.values()];
    this.mode = 'pinch';
    this.target = o;
    o.dragging = true;
    const st = useStore.getState();
    if (st.selected !== o.id) st.select(o.id);
    this.pinch = {
      d0: Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)),
      a0: Math.atan2(b.y - a.y, b.x - a.x),
      mx0: (a.x + b.x) / 2,
      my0: (a.y + b.y) / 2,
      s0: o.cur.s,
      q0: o.cur.q.clone(),
      nx0: o.cur.nx,
      ny0: o.cur.ny,
    };
  }

  private onMove = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = x;
      p.y = y;
    }
    this.shift = e.shiftKey;
    const f = frameRef.current;
    engineRef.current?.setPointer(x / f.widthPx, 1 - y / f.heightPx);

    if (this.mode === 'pinch') {
      this.updatePinch();
      return;
    }
    if (this.pointers.size > 1) return;

    if (this.mode === 'idle') {
      // Hover picking raycasts real geometry: coalesce to once per frame (see update()).
      if (e.pointerType === 'mouse' && e.buttons === 0) this.hoverAt = [x, y];
      return;
    }

    const threshold = e.pointerType === 'touch' ? 6 : 3;
    if (!this.moved && Math.hypot(x - this.downX, y - this.downY) < threshold) return;
    if (!this.moved) {
      this.moved = true;
      if (this.target) this.target.dragging = true;
    }
    this.lastX = x;
    this.lastY = y;
    const o = this.target;

    switch (this.mode) {
      case 'move': {
        if (!o) break;
        const [pnx, pny] = fromPx(x, y, f);
        this.setPose(o, { nx: pnx + this.offNx, ny: pny + this.offNy });
        break;
      }
      case 'rotate': {
        if (!o) break;
        this.updateRotate(o, x, y);
        break;
      }
      case 'scale': {
        if (!o) break;
        const d = Math.hypot(x - this.center[0], y - this.center[1]);
        this.setPose(o, { s: (this.s0 * d) / this.d0 });
        break;
      }
      case 'title-move': {
        const [pnx, pny] = fromPx(x, y, f);
        titleLive.cur.nx = THREE.MathUtils.clamp(pnx + this.offNx, -1.05, 1.05);
        titleLive.cur.ny = THREE.MathUtils.clamp(pny + this.offNy, -1.05, 1.05);
        titleLive.apply(f);
        break;
      }
      case 'title-scale': {
        const r = titleLive.rect(f);
        if (!r) break;
        const d = Math.hypot(x - r.x, y - r.y);
        titleLive.cur.s = THREE.MathUtils.clamp((this.title0.s * d) / this.title0.d0, 0.35, 2.6);
        titleLive.apply(f);
        break;
      }
    }
  };

  private updateRotate(o: LiveObject, x: number, y: number) {
    const n = GIZMO_AXIS[this.rotAxis];
    if (this.rotMode === 'plane') {
      this.setRay(x, y);
      _plane.setFromNormalAndCoplanarPoint(n, o.outer.position);
      if (!this.raycaster.ray.intersectPlane(_plane, _v)) return;
      _v.sub(o.outer.position);
      if (_v.lengthSq() < 1e-8) return;
      _v.normalize();
      const cross = _v2.crossVectors(this.rotPrev, _v);
      const delta = Math.atan2(cross.dot(n), this.rotPrev.dot(_v));
      this.rotRaw += delta;
      this.rotPrev.copy(_v);
    } else {
      const dx = x - this.downX;
      const dy = y - this.downY;
      this.rotRaw = (dx * this.tanDir.x + dy * this.tanDir.y) / this.tanPxPerRad;
    }
    this.rotApplied = this.shift ? Math.round(this.rotRaw / SNAP) * SNAP : this.rotRaw;
    _q.setFromAxisAngle(n, this.rotApplied).multiply(this.rotQ0);
    this.setPose(o, { q: _q });
  }

  private updatePinch() {
    const o = this.target;
    if (!o || this.pointers.size < 2) return;
    const [a, b] = [...this.pointers.values()];
    const d = Math.max(10, Math.hypot(b.x - a.x, b.y - a.y));
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const f = frameRef.current;
    const p = this.pinch;
    let da = ang - p.a0;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    _q.setFromAxisAngle(VIEW_AXIS, -da).multiply(p.q0);
    this.setPose(o, {
      s: (p.s0 * d) / p.d0,
      q: _q,
      nx: p.nx0 + ((mx - p.mx0) / f.widthPx) * 2,
      ny: p.ny0 - ((my - p.my0) / f.heightPx) * 2,
    });
    this.moved = true;
  }

  private onUp = (e: PointerEvent) => {
    const had = this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!had) return;
    const st = useStore.getState();

    if (this.mode === 'pinch') {
      if (this.target) this.commit(this.target);
      if (this.pointers.size === 1 && this.target) {
        // Continue as a one-finger move with the remaining finger.
        const [rest] = [...this.pointers.values()];
        const [pnx, pny] = fromPx(rest.x, rest.y, frameRef.current);
        this.offNx = this.target.cur.nx - pnx;
        this.offNy = this.target.cur.ny - pny;
        this.downX = rest.x;
        this.downY = rest.y;
        this.mode = 'move';
        this.moved = true;
        return;
      }
      this.endDrag();
      return;
    }
    if (this.pointers.size > 0) return;

    const [x, y] = this.local(e);
    if (this.mode === 'idle') {
      if (this.pendingDeselect && !this.moved) {
        if (st.selected) st.select(null);
        const f = frameRef.current;
        engineRef.current?.pulse(x / f.widthPx, 1 - y / f.heightPx);
      }
      this.pendingDeselect = false;
      return;
    }

    if (this.mode === 'move' && !this.moved && this.target) {
      // A tap. Double-tap/double-click gives the toy a playful spin.
      const now = performance.now();
      const o = this.target;
      if (this.lastTap.id === o.id && now - this.lastTap.t < 340 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 24) {
        o.spin += TAU;
        this.lastTap.t = 0;
      } else {
        this.lastTap = { t: now, id: o.id, x, y };
      }
    }

    if (this.target && this.moved) this.commit(this.target);
    if ((this.mode === 'title-move' || this.mode === 'title-scale') && this.moved) {
      st.setTitle({ ...titleLive.cur });
    }
    this.endDrag();
    if (e.pointerType === 'mouse') this.setHover(this.hitTest(x, y));
  };

  private endDrag() {
    if (this.target) this.target.dragging = false;
    titleLive.dragging = false;
    this.target = null;
    this.mode = 'idle';
    this.moved = false;
    gizmoFrame.pill = null;
    if (this.pointerType !== 'mouse') this.setCursor('');
  }

  private onWheel = (e: WheelEvent) => {
    const [x, y] = this.local(e);
    let o: LiveObject | null = null;
    const h = this.hitTest(x, y);
    if (h?.type === 'object') o = registry.get(h.id) ?? null;
    else if (h && (h.type === 'ring' || h.type === 'scale')) o = this.selectedObject();
    if (!o) {
      const sel = this.selectedObject();
      if (sel) {
        worldSphere(sel, _sphere);
        const [cx, cy] = this.project(_sphere.center);
        if (Math.hypot(x - cx, y - cy) < this.projectedRadius(_sphere) * RING_SCALE * 1.3) o = sel;
      }
    }
    if (!o) return;
    e.preventDefault();
    const st = useStore.getState();
    if (st.selected !== o.id) st.select(o.id);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (e.shiftKey && !e.ctrlKey) {
      _q.setFromAxisAngle(VIEW_AXIS, -dy * 0.004).multiply(o.cur.q);
      this.setPose(o, { q: _q });
    } else {
      const k = e.ctrlKey ? 0.012 : 0.0016;
      this.setPose(o, { s: o.cur.s * Math.exp(-dy * k) });
    }
    o.dragging = true;
    this.wheelTarget = o;
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => {
      const t = this.wheelTarget;
      if (t) {
        t.dragging = false;
        this.commit(t);
      }
      this.wheelTarget = null;
    }, 220);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.shift = e.shiftKey;
  };

  private onKey = (e: KeyboardEvent) => {
    this.shift = e.shiftKey;
    if (isTypingTarget(e.target)) return;
    const st = useStore.getState();
    if (e.key === 'Escape') {
      if (st.selected) st.select(null);
      return;
    }
    if (!st.selected) return;
    if (st.selected === 'title') {
      const step = e.shiftKey ? 0.05 : 0.01;
      const f = frameRef.current;
      let handled = true;
      if (e.key === 'ArrowLeft') titleLive.cur.nx -= step;
      else if (e.key === 'ArrowRight') titleLive.cur.nx += step;
      else if (e.key === 'ArrowUp') titleLive.cur.ny += step;
      else if (e.key === 'ArrowDown') titleLive.cur.ny -= step;
      else if (e.key === '[' || e.key === '-') titleLive.cur.s = Math.max(0.35, titleLive.cur.s / 1.06);
      else if (e.key === ']' || e.key === '=' || e.key === '+') titleLive.cur.s = Math.min(2.6, titleLive.cur.s * 1.06);
      else if (e.key === 'r' || e.key === 'R') {
        st.setTitle(null);
        return;
      } else handled = false;
      if (handled) {
        e.preventDefault();
        titleLive.apply(f);
        st.setTitle({ ...titleLive.cur });
      }
      return;
    }
    const o = registry.get(st.selected);
    if (!o) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    let handled = true;
    if (e.key === 'ArrowLeft') this.setPose(o, { nx: o.cur.nx - step });
    else if (e.key === 'ArrowRight') this.setPose(o, { nx: o.cur.nx + step });
    else if (e.key === 'ArrowUp') this.setPose(o, { ny: o.cur.ny + step });
    else if (e.key === 'ArrowDown') this.setPose(o, { ny: o.cur.ny - step });
    else if (e.key === '[' || e.key === '-') this.setPose(o, { s: o.cur.s / 1.06 });
    else if (e.key === ']' || e.key === '=' || e.key === '+') this.setPose(o, { s: o.cur.s * 1.06 });
    else if (e.key === 'r' || e.key === 'R') {
      st.resetObject(o.id);
      return;
    } else if (e.key === ' ') {
      o.spin += TAU;
    } else handled = false;
    if (handled) {
      e.preventDefault();
      if (e.key !== ' ') this.commit(o);
    }
  };

  // ───────────────────────────── per frame ─────────────────────────────

  /** Computes the gizmo overlay geometry; call once per frame after poses update. */
  update() {
    const f = frameRef.current;
    const st = useStore.getState();
    if (this.hoverAt && this.mode === 'idle') {
      this.setHover(this.hitTest(this.hoverAt[0], this.hoverAt[1]));
    }
    this.hoverAt = null;
    const o = this.selectedObject();
    const camPos = this.camera.position;

    gizmoFrame.object = null;
    this.gizmoValidFor = null;
    if (o && o.appear > 0.9) {
      applyPose(o, f);
      worldSphere(o, _sphere);
      const C = _sphere.center;
      const R = _sphere.radius * RING_SCALE;
      const [cx, cy] = this.project(C);
      const rpx = this.projectedRadius(_sphere) * RING_SCALE;
      this.center = [cx, cy];
      this.ringPx = rpx;
      const toCam = _v2.copy(camPos).sub(C).normalize();
      const rings = {} as Record<Axis, { front: string; back: string }>;
      for (const axis of AXES) {
        const [u, w] = RING_BASIS[axis];
        const pts = this.ringPts[axis];
        const front = this.ringFront[axis];
        let fd = '';
        let bd = '';
        let prevFront = -1;
        for (let i = 0; i <= RING_SEGMENTS; i++) {
          const th = (i / RING_SEGMENTS) * TAU;
          const c = Math.cos(th);
          const s = Math.sin(th);
          const dx = u.x * c + w.x * s;
          const dy = u.y * c + w.y * s;
          const dz = u.z * c + w.z * s;
          _v.set(C.x + dx * R, C.y + dy * R, C.z + dz * R);
          const isFront = dx * toCam.x + dy * toCam.y + dz * toCam.z > -0.02 ? 1 : 0;
          const [px, py] = this.project(_v);
          pts[i * 2] = px;
          pts[i * 2 + 1] = py;
          front[i] = isFront;
          const seg = `${px.toFixed(1)} ${py.toFixed(1)}`;
          if (isFront) {
            fd += prevFront === 1 ? ` L${seg}` : ` M${seg}`;
            if (prevFront === 0) bd += ` L${seg}`;
          } else {
            bd += prevFront === 0 ? ` L${seg}` : ` M${seg}`;
            if (prevFront === 1) fd += ` L${seg}`;
          }
          prevFront = isFront;
        }
        rings[axis] = { front: fd, back: bd };
      }
      // Scale knob sits at the ring's lower-right; flip it inward when that would leave the screen.
      const k = (rpx + 18) * Math.SQRT1_2;
      const kx = cx + k > f.widthPx - 14 ? cx - k : cx + k;
      const ky = cy + k > f.heightPx - 14 ? cy - k : cy + k;
      this.knob = [kx, ky];

      let wedge: { d: string; axis: Axis } | null = null;
      if (this.mode === 'rotate' && this.target === o && this.moved) {
        const n = GIZMO_AXIS[this.rotAxis];
        const v0 = this.rotV0;
        const perp = _v2.crossVectors(n, v0);
        const sweep = THREE.MathUtils.clamp(this.rotApplied, -TAU, TAU);
        const steps = Math.max(2, Math.ceil((Math.abs(sweep) / TAU) * 96));
        let d = `M${cx.toFixed(1)} ${cy.toFixed(1)}`;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * sweep;
          const c = Math.cos(a);
          const s = Math.sin(a);
          _v.set(
            C.x + (v0.x * c + perp.x * s) * R,
            C.y + (v0.y * c + perp.y * s) * R,
            C.z + (v0.z * c + perp.z * s) * R,
          );
          const [px, py] = this.project(_v);
          d += ` L${px.toFixed(1)} ${py.toFixed(1)}`;
        }
        d += ' Z';
        wedge = { d, axis: this.rotAxis };
      }

      const hoverAxis = this.mode === 'idle' && this.hover?.type === 'ring' ? this.hover.axis : null;
      gizmoFrame.object = {
        id: o.id,
        cx,
        cy,
        r: rpx,
        rings,
        activeAxis: this.mode === 'rotate' && this.target === o ? this.rotAxis : null,
        hoverAxis,
        knob: this.knob,
        knobActive: this.mode === 'scale' && this.target === o,
        knobHover: this.mode === 'idle' && this.hover?.type === 'scale',
        wedge,
        moving: (this.mode === 'move' || this.mode === 'pinch') && this.target === o && this.moved,
      };
      this.gizmoValidFor = o.id;
    }

    // Title frame box.
    gizmoFrame.title = null;
    const titleSelected = st.selected === 'title';
    const titleHover = this.mode === 'idle' && this.hover?.type === 'title';
    if (titleSelected || titleHover || this.mode === 'title-move' || this.mode === 'title-scale') {
      const r = titleLive.rect(f);
      if (r) {
        gizmoFrame.title = {
          x: r.x - r.w / 2,
          y: r.y - r.h / 2,
          w: r.w,
          h: r.h,
          hover: titleHover,
          selected: titleSelected,
          activeCorner: this.mode === 'title-scale' ? 1 : -1,
        };
      }
    }

    // Value pill next to the pointer while dragging.
    gizmoFrame.pill = null;
    if (this.moved && this.mode !== 'idle') {
      const px = Math.min(this.lastX + 18, f.widthPx - 120);
      const py = Math.max(this.lastY - 34, 8);
      if (this.mode === 'rotate') {
        const deg = THREE.MathUtils.radToDeg(this.rotApplied);
        const txt = `${this.rotAxis.toUpperCase()} ${deg < 0 ? '−' : ''}${Math.abs(deg).toFixed(1)}°`;
        gizmoFrame.pill = { text: txt, x: px, y: py, color: AXIS_COLOR[this.rotAxis] };
      } else if (this.mode === 'scale' && this.target) {
        gizmoFrame.pill = { text: `${this.target.cur.s.toFixed(2)}×`, x: px, y: py, color: '#141416' };
      } else if (this.mode === 'pinch' && this.target) {
        const [a] = [...this.pointers.values()];
        const [tx, ty] = toPx(this.target.cur.nx, this.target.cur.ny, f);
        gizmoFrame.pill = {
          text: `${this.target.cur.s.toFixed(2)}×`,
          x: (a?.x ?? tx) + 18,
          y: (a?.y ?? ty) - 54,
          color: '#141416',
        };
      } else if (this.mode === 'move' && this.target) {
        const [tx, ty] = toPx(this.target.cur.nx, this.target.cur.ny, f);
        gizmoFrame.pill = { text: `X ${Math.round(tx)}  Y ${Math.round(ty)}`, x: px, y: py, color: '#141416' };
      } else if (this.mode === 'title-move') {
        const [tx, ty] = toPx(titleLive.cur.nx, titleLive.cur.ny, f);
        gizmoFrame.pill = { text: `X ${Math.round(tx)}  Y ${Math.round(ty)}`, x: px, y: py, color: '#141416' };
      } else if (this.mode === 'title-scale') {
        gizmoFrame.pill = { text: `${titleLive.cur.s.toFixed(2)}×`, x: px, y: py, color: '#141416' };
      }
    }
    pushGizmoFrame();
  }
}
