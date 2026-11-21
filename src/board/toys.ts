import * as THREE from 'three';
import { ensureFonts } from '../fonts';
import { loadLibraryDef } from '../objects/library/load';
import type { LibraryDef } from '../objects/library/types';
import type { BuiltObject, ObjectBuildContext } from '../objects/types';
import { createStudioEnvironment } from '../scene/studioEnv';
import { onTheme } from '../theme/live';
import { clamp, h } from './dom';
import type { ToySpot } from './layout';

/**
 * The shelf collectibles, lying on the board.
 *
 * Like the shelf page (src/showcase), all of them share ONE transparent WebGL canvas: it sits over
 * the board's frames (and under the homepage frame), and each frame it draws every toy that is on
 * screen into that toy's own square (viewport + scissor), so 18 toys cost one GL context, one studio
 * environment and one transmission buffer. The squares come straight from the board camera, so the
 * toys pan and zoom with the canvas exactly like everything else on it.
 *
 *  - Toys are built in idle slices at a reduced texture scale, nearest to the view first. On desktop
 *    that starts a few seconds after the homepage settles (only in truly idle time, so it never
 *    competes with the homepage), and the first trip to the board finds them ready. Phones wait
 *    until the board is first on screen.
 *  - The canvas only redraws when something moved: the camera, a toy being hovered, spun or still
 *    settling, or a toy big enough on screen for its idle bob to show.
 *  - Built toys outlive a board rebuild (turning a phone lays the board out again, not the toys).
 *
 * Each toy has a hit area in the board (a DOM square under the canvas): hover lifts it and shows its
 * name, a drag spins it, a click gives it a twirl. With the marker, stamps or notes they step aside.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const FOV = 30;
/** How much of its square a toy's bounding sphere fills. */
const FILL = 0.84;
/** On-screen size (px) from which a toy bobs and sways by itself. */
const IDLE_PX = 110;
const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Toy {
  kind: string;
  def: LibraryDef | null;
  built: BuiltObject | null;
  scene: THREE.Scene;
  rig: THREE.Group;
  state: 'idle' | 'loading' | 'ready' | 'error';
  bornAt: number;
}

interface GL {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  env: THREE.Texture;
  cam: THREE.PerspectiveCamera;
  ctx: ObjectBuildContext;
}

let gl: GL | null | undefined; // undefined: not tried yet, null: no WebGL here
const shelf = new Map<string, Toy>();
const floor = new THREE.Color('#101012');
let clock = 0;
let dirty = true;

onTheme((t) => {
  floor.set(t.floor);
  dirty = true;
});

function getGL(): GL | null {
  if (gl !== undefined) return gl;
  try {
    const canvas = document.createElement('canvas');
    canvas.className = 'bd-toys';
    canvas.setAttribute('aria-hidden', 'true');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    // a mostly empty overlay: keep its buffers modest (the homepage has a full-screen canvas too)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    const env = createStudioEnvironment(renderer);
    const small = matchMedia('(max-width: 640px)').matches;
    // the toys are small on the board most of the time: lighter stickers than the shelf's close-ups
    // (all 18 at 0.42 come to roughly 55 MB of textures, at 0.3 about 30 MB)
    const g: GL = {
      renderer,
      canvas,
      env,
      cam: new THREE.PerspectiveCamera(FOV, 1, 0.1, 100),
      ctx: { renderer, textureScale: small ? 0.3 : 0.42, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() },
    };
    gl = g;
    // three.js re-uploads geometry and painted textures after a lost context, but the studio
    // lighting was rendered on the GPU: make it again
    canvas.addEventListener('webglcontextrestored', () => {
      g.env = createStudioEnvironment(renderer);
      for (const t of shelf.values()) if (t.built) t.scene.environment = g.env;
      dirty = true;
    });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[board] no WebGL for the collectibles', err);
    gl = null;
  }
  return gl;
}

function toyOf(kind: string): Toy {
  let t = shelf.get(kind);
  if (!t) {
    const scene = new THREE.Scene();
    const rig = new THREE.Group();
    scene.add(rig);
    t = { kind, def: null, built: null, scene, rig, state: 'idle', bornAt: 0 };
    shelf.set(kind, t);
  }
  return t;
}

// builds run in idle time, a few per idle slice. `urgent` (the board is showing) gives the idle
// callbacks a deadline; otherwise they wait for genuinely idle time.
let building = false;
let urgent = false;
let picker: (() => Toy | null) | null = null;
let defs: Promise<unknown> | null = null;
type Deadline = { timeRemaining(): number };
// while the visitor is doing something, background (non-urgent) builds wait
let lastInput = 0;
if (typeof window !== 'undefined') {
  const mark = () => (lastInput = performance.now());
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) window.addEventListener(type, mark, { passive: true, capture: true });
}
type Win = Window & {
  requestIdleCallback?: (cb: (d: Deadline) => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};
/** The next build step waiting for its slot (a background one can be hurried along). */
let pending: { id: number; urgent: boolean; ric: boolean; fn: (d?: Deadline) => void } | null = null;
const idle = (fn: (d?: Deadline) => void) => {
  const w = window as Win;
  const run = (d?: Deadline) => {
    pending = null;
    fn(d);
  };
  pending = w.requestIdleCallback
    ? { id: w.requestIdleCallback(run, urgent ? { timeout: 400 } : undefined), urgent, ric: true, fn }
    : { id: window.setTimeout(() => run(), urgent ? 24 : 120), urgent, ric: false, fn };
};
/** The board just came on screen: a step that was waiting for genuinely idle time gets a deadline. */
function hurry() {
  if (!pending || pending.urgent) return;
  const { id, ric, fn } = pending;
  if (ric) (window as Win).cancelIdleCallback?.(id);
  else clearTimeout(id);
  pending = null;
  idle(fn);
}

/** Import every toy's module at once (they are small; building is what costs). */
function loadDefs(kinds: string[]): Promise<unknown> {
  defs ??= Promise.allSettled(
    kinds.map((k) =>
      loadLibraryDef(k).then(
        (def) => void (toyOf(k).def = def),
        (err) => {
          toyOf(k).state = 'error';
          console.warn(`[board] collectible "${k}" failed to load`, err);
        },
      ),
    ),
  );
  return defs;
}

function buildNow(t: Toy, g: GL) {
  const def = t.def;
  if (!def) {
    t.state = 'error';
    return;
  }
  t.state = 'loading';
  try {
    const built = def.build(g.ctx);
    const [rx, ry, rz] = def.defaultRotation;
    built.root.rotation.set(rx, ry, rz);
    t.rig.add(built.root);
    t.scene.environment = g.env;
    t.built = built;
  } catch (err) {
    t.state = 'error';
    console.warn(`[board] collectible "${t.kind}" failed to build`, err);
    return;
  }
  const ready = () => {
    t.bornAt = clock;
    t.state = 'ready';
    dirty = true;
  };
  // let the GPU compile its shaders off the main thread where it can
  g.renderer.compileAsync(t.scene, g.cam).then(ready, ready);
}

function pump(kinds: string[]) {
  if (building) return;
  building = true;
  void Promise.all([ensureFonts(), loadDefs(kinds)]).then(() => {
    const step = (deadline?: Deadline) => {
      const g = gl;
      if (g && !urgent && performance.now() - lastInput < 700) {
        idle(step);
        return;
      }
      for (let n = 0; g; n++) {
        const t = picker?.() ?? null;
        if (!t) {
          building = false;
          return;
        }
        buildNow(t, g);
        if (!deadline || deadline.timeRemaining() < 14 || n >= 2) break;
      }
      if (!g) {
        building = false;
        return;
      }
      idle(step);
    };
    idle(step);
  });
}

export interface ToyView {
  /** The board camera as a CSS transform: screen = t + board * z. */
  tx: number;
  ty: number;
  z: number;
  W: number;
  H: number;
}

export interface BoardToys {
  /** The hit areas (one per toy, in board order). */
  els: HTMLElement[];
  /** How far a toy has popped in while the board assembles (0..1). */
  setAppear(i: number, k: number): void;
  /** Every frame from the board loop. `show`: the board is (at least partly) on screen. */
  render(view: ToyView, show: boolean, now: number): void;
  destroy(): void;
}

interface Item {
  spot: ToySpot;
  toy: Toy;
  el: HTMLElement;
  label: HTMLElement;
  appear: number;
  yaw: number;
  pitch: number;
  vYaw: number;
  vPitch: number;
  hovering: boolean;
  hover: number;
  dragging: boolean;
  px: number;
  py: number;
  lx: number;
  ly: number;
  sx: number;
  sy: number;
  size: number;
}

const qYaw = new THREE.Quaternion();
const qPitch = new THREE.Quaternion();
const qRoll = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const settle = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/** A pop with a little overshoot when a toy has just been built. */
function entrance(age: number): number {
  if (reduceMotion) return 1;
  const x = clamp(age / 0.9, 0, 1) - 1;
  return 0.55 + 0.45 * (1 + 2.70158 * x * x * x + 1.70158 * x * x);
}

/** Lay the collectibles on a board: hit areas in `under`, name tags in `top`, the canvas in `stage`. */
export function mountBoardToys(o: { under: HTMLElement; top: HTMLElement; stage: HTMLElement; spots: ToySpot[] }): BoardToys {
  const ac = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void) =>
    el.addEventListener(type, fn as EventListener, { signal: ac.signal });

  const kinds = o.spots.map((sp) => sp.kind);
  const items: Item[] = o.spots.map((spot) => {
    const el = h('div', { class: 'bd-toy', style: `left:${spot.x - spot.d / 2}px;top:${spot.y - spot.d / 2}px;width:${spot.d}px;height:${spot.d}px`, role: 'img' }, h('i'));
    const label = h('div', { class: 'bd-toylabel', style: `left:${spot.x}px;top:${spot.y + spot.d * 0.47}px` }, h('b'), h('span'));
    o.under.append(el);
    o.top.append(label);
    const it: Item = { spot, toy: toyOf(spot.kind), el, label, appear: 1, yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, hovering: false, hover: 0, dragging: false, px: 0, py: 0, lx: 0, ly: 0, sx: 0, sy: 0, size: 0 };
    return it;
  });

  const describe = (it: Item) => {
    const def = it.toy.def;
    if (!def || it.el.dataset.named) return;
    it.el.dataset.named = '1';
    it.el.setAttribute('aria-label', `${def.name}: ${def.tagline}`);
    it.label.querySelector('b')!.textContent = def.name;
    it.label.querySelector('span')!.textContent = def.tagline;
  };
  const spin = (it: Item) => {
    it.vYaw += 13 * (Math.random() < 0.5 ? -1 : 1);
    dirty = true;
  };

  for (const it of items) {
    let press: { id: number; x: number; y: number; t: number; moved: boolean } | null = null;
    let touched = false;
    const local = (e: PointerEvent) => {
      const r = it.el.getBoundingClientRect();
      it.px = clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1);
      it.py = clamp(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1, -1, 1);
    };
    on(it.el, 'pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      it.hovering = true;
      describe(it);
      if (it.toy.state === 'ready') it.label.classList.add('is-on');
      dirty = true;
    });
    on(it.el, 'pointerleave', () => {
      it.hovering = false;
      it.label.classList.remove('is-on');
      dirty = true;
    });
    on(it.el, 'pointerdown', (e) => {
      touched = e.pointerType === 'touch';
      // fingers keep panning and pinching the board; a tap still twirls the toy (click, below)
      if (touched || e.button !== 0 || it.toy.state !== 'ready') return;
      e.stopPropagation();
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false };
      it.lx = e.clientX;
      it.ly = e.clientY;
      try {
        it.el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    on(it.el, 'pointermove', (e) => {
      local(e);
      if (it.hovering) dirty = true;
      if (!press || e.pointerId !== press.id) return;
      if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
        press.moved = true;
        it.dragging = true;
        it.el.classList.add('is-dragging');
      }
      if (press.moved) {
        const dx = (e.clientX - it.lx) * 0.012;
        const dy = (e.clientY - it.ly) * 0.012;
        const s = Math.max(0.008, (e.timeStamp - press.t) / 1000);
        it.yaw += dx;
        it.pitch = clamp(it.pitch + dy, -1.2, 1.2);
        it.vYaw = it.vYaw * 0.4 + (dx / s) * 0.6;
        it.vPitch = it.vPitch * 0.4 + (dy / s) * 0.6;
        dirty = true;
      }
      it.lx = e.clientX;
      it.ly = e.clientY;
      press.t = e.timeStamp;
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!press || e.pointerId !== press.id) return;
      const click = !press.moved && !cancelled;
      if (e.timeStamp - press.t > 90) {
        it.vYaw = 0;
        it.vPitch = 0;
      }
      press = null;
      it.dragging = false;
      it.el.classList.remove('is-dragging');
      if (click) spin(it);
    };
    on(it.el, 'pointerup', (e) => end(e, false));
    on(it.el, 'pointercancel', (e) => end(e, true));
    on(it.el, 'click', () => {
      if (touched && it.toy.state === 'ready') spin(it);
    });
  }

  let attached = false;
  let lastNow = 0;
  let lastKey = '';
  let cw = 0;
  let ch = 0;

  /** The unbuilt toy nearest to the middle of the view (null once all are built, or when it should wait). */
  let view: ToyView = { tx: 0, ty: 0, z: 1, W: 1, H: 1 };
  let shownAt = -1e9;
  const warm = typeof matchMedia !== 'undefined' && !matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const next = (): Toy | null => {
    const shown = performance.now() - shownAt < 2500;
    urgent = shown;
    // off the board: desktop keeps going in idle time, phones pause until the board shows again
    if (!shown && !warm) return null;
    const mx = (view.W / 2 - view.tx) / view.z, my = (view.H / 2 - view.ty) / view.z;
    let best: Item | null = null;
    let bd = Infinity;
    for (const it of items) {
      if (it.toy.state !== 'idle') continue;
      const d = Math.hypot(it.spot.x - mx, it.spot.y - my);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best?.toy ?? null;
  };

  // desktop: get the toys ready while the visitor is still on the homepage
  const warmT = warm
    ? window.setTimeout(() => {
        if (!getGL()) return;
        // nearest to the middle of the work first (those show first when the camera pulls back)
        const cx = o.spots.reduce((a, sp) => a + sp.x, 0) / Math.max(1, o.spots.length);
        const cy = o.spots.reduce((a, sp) => a + sp.y, 0) / Math.max(1, o.spots.length);
        view = { tx: 0.5 - cx, ty: 0.5 - cy, z: 1, W: 1, H: 1 };
        picker = next;
        pump(kinds);
      }, 3500)
    : 0;

  /** Advance one toy's motion; true while it is still moving. */
  function animate(it: Item, dt: number): boolean {
    const target = it.hovering ? 1 : 0;
    it.hover += (target - it.hover) * settle(8, dt);
    if (!it.dragging) {
      it.yaw += it.vYaw * dt;
      it.pitch = clamp(it.pitch + it.vPitch * dt, -1.2, 1.2);
      it.vYaw *= Math.exp(-2.2 * dt);
      it.vPitch *= Math.exp(-3 * dt);
      if (Math.abs(it.vYaw) < 0.5) it.yaw += (Math.round(it.yaw / TAU) * TAU - it.yaw) * settle(1.6, dt);
      if (Math.abs(it.vPitch) < 0.5) it.pitch += -it.pitch * settle(2, dt);
    }
    const lean = it.hovering && !it.dragging ? 1 : 0;
    it.sx += (it.px * lean - it.sx) * settle(5, dt);
    it.sy += (it.py * lean - it.sy) * settle(5, dt);
    const bob = !reduceMotion && it.size >= IDLE_PX;
    const t = clock;
    const ph = it.spot.phase;
    const yaw = it.spot.yaw + it.yaw + (bob ? Math.sin(t * 0.5 + ph) * 0.22 : 0) + it.sx * 0.45;
    const pitch = it.pitch + it.sy * 0.25;
    qRoll.setFromAxisAngle(AZ, it.spot.roll);
    qPitch.setFromAxisAngle(AX, pitch);
    qYaw.setFromAxisAngle(AY, yaw);
    it.toy.rig.quaternion.copy(qRoll).multiply(qPitch).multiply(qYaw);
    const age = t - it.toy.bornAt;
    it.toy.rig.scale.setScalar(entrance(age) * (0.86 + 0.14 * it.appear) * (1 + it.hover * 0.06));
    it.toy.rig.position.y = bob ? Math.sin(t * 0.85 + ph * 1.7) * 0.04 : 0;
    const rest = Math.round(it.yaw / TAU) * TAU;
    return (
      bob ||
      it.dragging ||
      age < 1 ||
      !near(it.hover, target) ||
      Math.abs(it.vYaw) > 1e-3 ||
      Math.abs(it.vPitch) > 1e-3 ||
      !near(it.yaw, rest) ||
      !near(it.pitch, 0) ||
      !near(it.sx, it.px * lean) ||
      !near(it.sy, it.py * lean) ||
      (!!it.toy.built?.update && it.size >= 140)
    );
  }

  return {
    els: items.map((it) => it.el),
    setAppear(i, k) {
      const it = items[i];
      if (it && it.appear !== k) {
        it.appear = k;
        dirty = true;
      }
    },
    render(v, show, now) {
      const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      if (!show) return;
      const g = getGL();
      if (!g) return;
      view = v;
      shownAt = performance.now();
      clock += dt;
      if (!attached) {
        attached = true;
        o.stage.append(g.canvas);
        dirty = true;
      }
      if (items.some((it) => it.toy.state === 'idle')) {
        picker = next;
        urgent = true;
        if (building) hurry();
        else pump(kinds);
      }
      const r = g.renderer;
      if (v.W !== cw || v.H !== ch) {
        cw = v.W;
        ch = v.H;
        r.setSize(cw, ch, false);
        dirty = true;
      }

      // what is on screen, and is anything still moving
      let moving = false;
      const vis: Item[] = [];
      for (const it of items) {
        const t = it.toy;
        if (t.state !== 'ready' || !t.built) continue;
        if (!it.el.classList.contains('is-ready')) {
          it.el.classList.add('is-ready');
          describe(it);
          if (it.hovering) it.label.classList.add('is-on');
        }
        const size = it.spot.d * v.z;
        const cx = v.tx + it.spot.x * v.z, cy = v.ty + it.spot.y * v.z;
        it.size = size;
        if (it.appear <= 0.01 || size < 5 || cx + size < 0 || cx - size > cw || cy + size < 0 || cy - size > ch) continue;
        if (animate(it, dt)) moving = true;
        vis.push(it);
      }
      const key = `${v.tx.toFixed(1)}|${v.ty.toFixed(1)}|${v.z.toFixed(5)}`;
      if (!moving && !dirty && key === lastKey) return;
      lastKey = key;
      dirty = false;

      r.setScissorTest(false);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.setScissorTest(true);
      // glass and translucent plastic "see" the board floor behind them (the transmission pass clears to this)
      r.setClearColor(floor, 1);
      const cam = g.cam;
      const half = (FOV / 2) * DEG;
      for (const it of vis) {
        const built = it.toy.built!;
        const size = it.size;
        const x = v.tx + it.spot.x * v.z - size / 2;
        const y = v.ty + it.spot.y * v.z - size / 2;
        cam.aspect = 1;
        cam.position.set(0, 0, built.radius / Math.sin(half * FILL));
        cam.updateProjectionMatrix();
        const vy = ch - (y + size);
        r.setViewport(x, vy, size, size);
        const sx = Math.max(0, x), sy = Math.max(0, vy);
        const sw = Math.min(cw, x + size) - sx, sh = Math.min(ch, vy + size) - sy;
        if (sw <= 0 || sh <= 0) continue;
        r.setScissor(sx, sy, sw, sh);
        if (size >= 60) built.update?.(clock, dt);
        r.render(it.toy.scene, cam);
      }
      r.setScissorTest(false);
    },
    destroy() {
      ac.abort();
      clearTimeout(warmT);
      if (picker === next) picker = null;
      if (attached && gl) {
        gl.canvas.remove();
        // a fresh board draws from scratch
        gl.renderer.setScissorTest(false);
        gl.renderer.setClearColor(0x000000, 0);
        gl.renderer.clear();
      }
      dirty = true;
      for (const it of items) {
        it.el.remove();
        it.label.remove();
      }
    },
  };
}
