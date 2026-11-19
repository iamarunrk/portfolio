/**
 * The shelf (showcase.html): every collectible in src/objects/library on one page.
 *
 * One fixed, transparent WebGL canvas sits above the card tiles and below their labels;
 * each frame it draws every on-screen card's object into that card's rectangle (viewport +
 * scissor), so 18 toys share a single GL context, one studio environment and one
 * transmission buffer. Objects are imported one file at a time and built lazily as their
 * cards approach the viewport (at a reduced texture scale); the close-up view builds a
 * full-resolution copy and frees it again on close.
 *
 * Query params (handy for screenshots): ?theme=studio|pastel  ?all=1 (build every card now)
 * ?t=<seconds> (freeze time). A #<kind> hash opens that toy's close-up.
 */
import * as THREE from 'three';
import { createStudioEnvironment } from '../scene/studioEnv';
import { ensureFonts } from '../fonts';
import type { BuiltObject, ObjectBuildContext } from '../objects/types';
import { libraryKinds, loadLibraryDef } from '../objects/library/load';
import { CATEGORY_LABEL, type LibraryCategory, type LibraryDef } from '../objects/library/types';
import './showcase.css';

type Theme = 'pastel' | 'studio';
type Filter = 'all' | LibraryCategory;

const qs = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 640px)').matches;
const eager = qs.get('all') === '1';
const frozenT = qs.has('t') ? Number(qs.get('t')) : null;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const FOV = 30;
const CATEGORIES: LibraryCategory[] = ['tech', 'studio', 'food', 'founder'];

/** What glass and translucent plastic "see" behind them (the transmission pass clears to this). */
const BEHIND: Record<Theme, { tile: string; inspect: string }> = {
  pastel: { tile: '#f1e4f3', inspect: '#ecdbf1' },
  studio: { tile: '#141417', inspect: '#0d0d10' },
};

const win = window as unknown as { __objectsReady?: boolean; __objectsErrors?: string[]; __objectsStats?: unknown };
const errors: string[] = (win.__objectsErrors = []);
window.addEventListener('error', (e) => errors.push(String(e.message)));

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ theme

function readTheme(): Theme {
  const q = qs.get('theme');
  if (q === 'studio' || q === 'pastel') return q;
  try {
    const s = localStorage.getItem('shelf-theme');
    if (s === 'studio' || s === 'pastel') return s;
  } catch {
    /* storage blocked: use the default */
  }
  return 'pastel';
}

let theme: Theme = readTheme();
const behindTile = new THREE.Color();
const behindInspect = new THREE.Color();

function applyTheme(t: Theme, remember: boolean): void {
  theme = t;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'studio' ? '#0b0b0d' : '#ead7f0');
  document.querySelectorAll<HTMLButtonElement>('[data-theme-option]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeOption === t)));
  behindTile.set(BEHIND[t].tile);
  behindInspect.set(BEHIND[t].inspect);
  if (!remember) return;
  try {
    localStorage.setItem('shelf-theme', t);
  } catch {
    /* not persisted */
  }
}

applyTheme(theme, false);
document.querySelectorAll<HTMLButtonElement>('[data-theme-option]').forEach((b) =>
  b.addEventListener('click', () => applyTheme(b.dataset.themeOption === 'studio' ? 'studio' : 'pastel', true)),
);

// ------------------------------------------------------------------ renderer

const canvas = $<HTMLCanvasElement>('gl');
let renderer: THREE.WebGLRenderer | null = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  errors.push(`WebGL unavailable: ${String(e)}`);
}

// ------------------------------------------------------------------ entries

interface Entry {
  kind: string;
  index: number;
  el: HTMLElement;
  stage: HTMLElement;
  def: LibraryDef | null;
  defPromise: Promise<LibraryDef>;
  state: 'waiting' | 'queued' | 'building' | 'ready' | 'error';
  near: boolean;
  built: BuiltObject | null;
  scene: THREE.Scene;
  /** Idle sway, drag rotation, bob and entrance scale; the build's posed root sits inside. */
  rig: THREE.Group;
  phase: number;
  bornAt: number;
  yaw: number;
  pitch: number;
  vYaw: number;
  vPitch: number;
  dragging: boolean;
  hovering: boolean;
  hover: number;
  px: number;
  py: number;
  tx: number;
  ty: number;
}

const grid = $('grid');
const kinds = libraryKinds();
$('count').textContent = String(kinds.length);

const entries: Entry[] = kinds.map((kind, index) => {
  const el = document.createElement('article');
  el.className = 'card';
  el.tabIndex = 0;
  el.dataset.kind = kind;
  el.setAttribute('role', 'button');
  el.innerHTML = `
    <div class="card-stage"></div>
    <div class="card-status"><span>loading</span></div>
    <div class="card-top"><span class="card-no"></span><span class="chip"></span></div>
    <div class="card-meta"><h2 class="card-name"></h2><p class="card-tagline">&nbsp;</p></div>`;
  el.querySelector('.card-no')!.textContent = `No. ${String(index + 1).padStart(2, '0')}`;
  el.querySelector('.card-name')!.textContent = kind;
  grid.appendChild(el);
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  scene.add(rig);
  const e: Entry = {
    kind,
    index,
    el,
    stage: el.querySelector('.card-stage') as HTMLElement,
    def: null,
    defPromise: loadLibraryDef(kind),
    state: 'waiting',
    near: false,
    built: null,
    scene,
    rig,
    phase: index * 1.37,
    bornAt: 0,
    yaw: 0,
    pitch: 0,
    vYaw: 0,
    vPitch: 0,
    dragging: false,
    hovering: false,
    hover: 0,
    px: 0,
    py: 0,
    tx: 0,
    ty: 0,
  };
  e.defPromise.then(
    (def) => {
      e.def = def;
      el.dataset.category = def.category;
      el.querySelector('.card-name')!.textContent = def.name;
      el.querySelector('.card-tagline')!.textContent = def.tagline;
      el.querySelector('.chip')!.textContent = CATEGORY_LABEL[def.category] ?? def.category;
      el.setAttribute('aria-label', `${def.name}: ${def.tagline}. Open close-up`);
    },
    (err) => fail(e, err),
  );
  return e;
});

function fail(e: Entry, err: unknown): void {
  e.state = 'error';
  e.el.classList.add('is-error');
  e.el.querySelector('.card-status span')!.textContent = 'failed to load';
  errors.push(`${e.kind}: ${String((err as Error)?.stack ?? err)}`);
  console.error(`[shelf] ${e.kind}`, err);
}

// ------------------------------------------------------------------ filters

let filter: Filter = 'all';
const filterNav = $('filters');

function setFilter(f: Filter): void {
  filter = f;
  for (const e of entries) e.el.hidden = f !== 'all' && e.def?.category !== f;
  filterNav.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
}

function buildFilters(): void {
  const counts = new Map<LibraryCategory, number>();
  for (const e of entries) if (e.def) counts.set(e.def.category, (counts.get(e.def.category) ?? 0) + 1);
  const add = (id: Filter, label: string, n: number) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.filter = id;
    b.setAttribute('aria-pressed', String(id === filter));
    const count = document.createElement('span');
    count.textContent = String(n);
    b.append(label, count);
    b.addEventListener('click', () => setFilter(id));
    filterNav.appendChild(b);
  };
  filterNav.textContent = '';
  add('all', 'All', entries.length);
  for (const c of CATEGORIES) if (counts.get(c)) add(c, CATEGORY_LABEL[c], counts.get(c)!);
}

Promise.allSettled(entries.map((e) => e.defPromise)).then(() => {
  defsSettled = true;
  buildFilters();
  const k = location.hash.slice(1);
  const target = entries.find((e) => e.kind === k && e.def);
  if (target) openInspector(target);
});

// ------------------------------------------------------------------ everything below needs WebGL

/** The close-up view; assigned by start() once WebGL is up. */
let openInspector: (e: Entry) => void = () => {};
let defsSettled = false;

if (!renderer) {
  document.body.classList.add('no-gl');
  for (const e of entries) {
    e.el.classList.add('is-error');
    e.el.querySelector('.card-status span')!.textContent = 'needs WebGL';
  }
  win.__objectsReady = true;
} else {
  start(renderer);
}

function start(gl: THREE.WebGLRenderer): void {
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  gl.toneMapping = THREE.NeutralToneMapping;
  gl.toneMappingExposure = 1;
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.autoClear = false;
  const env = createStudioEnvironment(gl);
  const gridCam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  const inspCam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
  const gridCtx: ObjectBuildContext = { renderer: gl, textureScale: small ? 0.45 : 0.6, maxAnisotropy };
  const fullCtx: ObjectBuildContext = { renderer: gl, textureScale: small ? 0.75 : 1, maxAnisotropy };
  for (const e of entries) e.scene.environment = env;

  const clock = { t: frozenT ?? 0, last: performance.now() };
  let cw = 0;
  let ch = 0;
  let frames = 0;

  // ---------------------------------------------------------------- lazy builds

  const queue: Entry[] = [];
  let pumping = false;
  const fonts = ensureFonts();

  function want(e: Entry): void {
    if (e.state !== 'waiting') return;
    e.state = 'queued';
    queue.push(e);
    void pump();
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    await fonts;
    while (queue.length) {
      queue.sort((a, b) => Number(b.near) - Number(a.near) || a.index - b.index);
      await build(queue.shift()!);
      await nextFrame();
    }
    pumping = false;
  }

  async function build(e: Entry): Promise<void> {
    e.state = 'building';
    try {
      const def = await e.defPromise;
      const built = def.build(gridCtx);
      const [rx, ry, rz] = def.defaultRotation;
      built.root.rotation.set(rx, ry, rz);
      e.rig.add(built.root);
      e.built = built;
      try {
        await gl.compileAsync(e.scene, gridCam);
      } catch {
        /* compiled on first draw instead */
      }
      e.bornAt = clock.t;
      e.state = 'ready';
      e.el.classList.add('is-ready');
    } catch (err) {
      fail(e, err);
    }
  }

  let ioSeen = false;
  const io = new IntersectionObserver(
    (list) => {
      ioSeen = true;
      for (const it of list) {
        const e = entries.find((x) => x.el === it.target);
        if (!e) continue;
        e.near = it.isIntersecting;
        if (it.isIntersecting) want(e);
      }
    },
    { rootMargin: '360px 0px' },
  );
  for (const e of entries) {
    io.observe(e.el);
    if (eager) want(e);
  }

  // ---------------------------------------------------------------- card interaction

  for (const e of entries) {
    const el = e.el;
    let press: { id: number; x: number; y: number; lx: number; ly: number; lt: number; moved: boolean } | null = null;
    el.addEventListener('pointerenter', (ev) => {
      if (ev.pointerType === 'mouse') e.hovering = true;
    });
    el.addEventListener('pointerleave', () => {
      e.hovering = false;
    });
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || press) return;
      press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, lt: ev.timeStamp, moved: false };
      el.setPointerCapture(ev.pointerId);
    });
    el.addEventListener('pointermove', (ev) => {
      const r = e.stage.getBoundingClientRect();
      e.px = clamp(((ev.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      e.py = clamp(((ev.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      if (!press || ev.pointerId !== press.id) return;
      if (!press.moved && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 5) {
        press.moved = true;
        e.dragging = true;
        el.classList.add('is-dragging');
      }
      if (press.moved) {
        const dx = (ev.clientX - press.lx) * 0.012;
        const dy = (ev.clientY - press.ly) * 0.012;
        const s = Math.max(0.008, (ev.timeStamp - press.lt) / 1000);
        e.yaw += dx;
        e.pitch = clamp(e.pitch + dy, -1.3, 1.3);
        e.vYaw = e.vYaw * 0.4 + (dx / s) * 0.6;
        e.vPitch = e.vPitch * 0.4 + (dy / s) * 0.6;
      }
      press.lx = ev.clientX;
      press.ly = ev.clientY;
      press.lt = ev.timeStamp;
    });
    const end = (ev: PointerEvent, cancelled: boolean) => {
      if (!press || ev.pointerId !== press.id) return;
      const click = !press.moved && !cancelled;
      if (ev.timeStamp - press.lt > 90) {
        e.vYaw = 0;
        e.vPitch = 0;
      }
      press = null;
      e.dragging = false;
      el.classList.remove('is-dragging');
      if (click) openInspector(e);
    };
    el.addEventListener('pointerup', (ev) => end(ev, false));
    el.addEventListener('pointercancel', (ev) => end(ev, true));
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openInspector(e);
      }
    });
  }

  // ---------------------------------------------------------------- inspector

  const inspectEl = $('inspect');
  const stageEl = $('insp-stage');
  const closeBtn = $<HTMLButtonElement>('insp-close');
  const insp = {
    open: false,
    entry: null as Entry | null,
    scene: new THREE.Scene(),
    rig: new THREE.Group(),
    built: null as BuiltObject | null,
    token: 0,
    yaw: 0,
    pitch: 0,
    vYaw: 0,
    vPitch: 0,
    zoom: 1,
    targetZoom: 1,
    dragging: false,
    idle: 0,
  };
  insp.scene.environment = env;
  insp.scene.add(insp.rig);

  const pageParts = [document.querySelector('main'), document.querySelector('.top'), document.querySelector('.foot')].filter(Boolean) as HTMLElement[];
  function setPageInert(on: boolean): void {
    for (const p of pageParts) p.inert = on;
  }

  function dropInspectorBuild(): void {
    if (!insp.built) return;
    insp.rig.remove(insp.built.root);
    insp.built.dispose();
    insp.built = null;
  }

  function fact(dl: HTMLElement, k: string, v: string): void {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }

  function describe(e: Entry, built: BuiltObject | null): void {
    const dl = $('insp-facts');
    dl.textContent = '';
    if (built) {
      let tris = 0;
      let meshes = 0;
      const textures = new Set<THREE.Texture>();
      built.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        const n = m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count;
        tris += (n / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if (v && typeof v === 'object' && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
        }
      });
      fact(dl, 'triangles', Math.round(tris).toLocaleString('en-US'));
      fact(dl, 'meshes', String(meshes));
      fact(dl, 'painted textures', String(textures.size));
    }
    fact(dl, 'kind', e.kind);
    fact(dl, 'file', `src/objects/library/${e.kind}.ts`);
  }

  openInspector = (e: Entry) => {
    const def = e.def;
    if (!def) return;
    const wasOpen = insp.open;
    insp.open = true;
    insp.entry = e;
    insp.yaw = 0;
    insp.pitch = 0;
    insp.vYaw = 0;
    insp.vPitch = 0;
    insp.targetZoom = 1;
    insp.zoom = wasOpen ? insp.zoom : 0.86;
    insp.idle = 0;
    inspectEl.hidden = false;
    document.body.classList.add('inspecting');
    setPageInert(true);
    $('insp-no').textContent = `No. ${String(e.index + 1).padStart(2, '0')} / ${String(entries.length).padStart(2, '0')}`;
    $('insp-name').textContent = def.name;
    $('insp-tagline').textContent = def.tagline;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = CATEGORY_LABEL[def.category] ?? def.category;
    $('insp-chip').replaceChildren(chip);
    describe(e, null);
    if (location.hash !== `#${e.kind}`) history.replaceState(null, '', `#${e.kind}`);
    if (!wasOpen) closeBtn.focus({ preventScroll: true });
    dropInspectorBuild();
    want(e);
    const token = ++insp.token;
    // Let the overlay paint first; the full-resolution build blocks for a moment.
    void Promise.all([fonts, nextFrame(), nextFrame()]).then(() => {
      if (token !== insp.token) return;
      try {
        const built = def.build(fullCtx);
        const [rx, ry, rz] = def.defaultRotation;
        built.root.rotation.set(rx, ry, rz);
        insp.rig.add(built.root);
        insp.built = built;
        describe(e, built);
      } catch (err) {
        errors.push(`${e.kind} (close-up): ${String((err as Error)?.stack ?? err)}`);
        console.error(err);
      }
    });
  };

  function closeInspector(): void {
    if (!insp.open) return;
    insp.open = false;
    insp.token++;
    dropInspectorBuild();
    inspectEl.hidden = true;
    document.body.classList.remove('inspecting');
    setPageInert(false);
    history.replaceState(null, '', location.pathname + location.search);
    insp.entry?.el.focus({ preventScroll: true });
  }

  function step(dir: 1 | -1): void {
    const list = entries.filter((e) => !e.el.hidden && e.def);
    if (!insp.entry || !list.length) return;
    const i = list.indexOf(insp.entry);
    openInspector(list[(i + dir + list.length) % list.length]);
  }

  closeBtn.addEventListener('click', closeInspector);
  $('insp-prev').addEventListener('click', () => step(-1));
  $('insp-next').addEventListener('click', () => step(1));
  inspectEl.querySelector('.inspect-backdrop')!.addEventListener('click', closeInspector);
  window.addEventListener('keydown', (ev) => {
    if (!insp.open) return;
    if (ev.key === 'Escape') closeInspector();
    else if (ev.key === 'ArrowRight') step(1);
    else if (ev.key === 'ArrowLeft') step(-1);
  });
  window.addEventListener('hashchange', () => {
    const e = entries.find((x) => x.kind === location.hash.slice(1) && x.def);
    if (e && insp.entry !== e) openInspector(e);
    else if (!e) closeInspector();
  });

  // drag to spin, wheel / pinch to zoom, double-click to reset
  const pointers = new Map<number, { x: number; y: number; t: number }>();
  let pinch = 0;
  stageEl.addEventListener('pointerdown', (ev) => {
    stageEl.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, t: ev.timeStamp });
    insp.dragging = true;
    insp.idle = 0;
    insp.vYaw = 0;
    insp.vPitch = 0;
    stageEl.classList.add('is-dragging');
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  stageEl.addEventListener('pointermove', (ev) => {
    const p = pointers.get(ev.pointerId);
    if (!p) return;
    if (pointers.size >= 2) {
      p.x = ev.clientX;
      p.y = ev.clientY;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) insp.targetZoom = clamp((insp.targetZoom * d) / pinch, 0.6, 2);
      pinch = d;
      return;
    }
    const dx = (ev.clientX - p.x) * 0.01;
    const dy = (ev.clientY - p.y) * 0.01;
    const s = Math.max(0.008, (ev.timeStamp - p.t) / 1000);
    insp.yaw += dx;
    insp.pitch = clamp(insp.pitch + dy, -1.4, 1.4);
    insp.vYaw = insp.vYaw * 0.4 + (dx / s) * 0.6;
    insp.vPitch = insp.vPitch * 0.4 + (dy / s) * 0.6;
    p.x = ev.clientX;
    p.y = ev.clientY;
    p.t = ev.timeStamp;
  });
  const release = (ev: PointerEvent) => {
    const p = pointers.get(ev.pointerId);
    if (p && ev.timeStamp - p.t > 90) {
      insp.vYaw = 0;
      insp.vPitch = 0;
    }
    pointers.delete(ev.pointerId);
    pinch = 0;
    if (pointers.size === 0) {
      insp.dragging = false;
      stageEl.classList.remove('is-dragging');
    }
  };
  stageEl.addEventListener('pointerup', release);
  stageEl.addEventListener('pointercancel', release);
  stageEl.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      insp.targetZoom = clamp(insp.targetZoom * Math.exp(-ev.deltaY * 0.0015), 0.6, 2);
      insp.idle = 0;
    },
    { passive: false },
  );
  stageEl.addEventListener('dblclick', () => {
    insp.yaw = Math.round(insp.yaw / TAU) * TAU;
    insp.pitch = 0;
    insp.vYaw = 0;
    insp.vPitch = 0;
    insp.targetZoom = 1;
  });

  // ---------------------------------------------------------------- frame

  const qYaw = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0);
  const AY = new THREE.Vector3(0, 1, 0);

  function entrance(age: number): number {
    if (frozenT !== null || reduceMotion) return 1;
    const x = clamp(age / 0.9, 0, 1) - 1;
    return 0.55 + 0.45 * (1 + 2.70158 * x * x * x + 1.70158 * x * x);
  }

  function draw(scene: THREE.Scene, cam: THREE.PerspectiveCamera, r: DOMRect, radius: number, fill: number, zoom: number, behind: THREE.Color): void {
    const aspect = r.width / r.height;
    const half = Math.min((FOV / 2) * DEG, Math.atan(Math.tan((FOV / 2) * DEG) * aspect));
    cam.aspect = aspect;
    cam.position.set(0, 0, radius / Math.sin(half * fill) / zoom);
    cam.updateProjectionMatrix();
    const x = r.left;
    const y = ch - r.bottom;
    gl.setViewport(x, y, r.width, r.height);
    const sx = Math.max(0, x);
    const sy = Math.max(0, y);
    const sw = Math.min(cw, x + r.width) - sx;
    const sh = Math.min(ch, y + r.height) - sy;
    if (sw <= 0 || sh <= 0) return;
    gl.setScissor(sx, sy, sw, sh);
    gl.setClearColor(behind, 1);
    gl.render(scene, cam);
  }

  function animateCard(e: Entry, dt: number): void {
    e.hover += ((e.hovering ? 1 : 0) - e.hover) * ease(8, dt);
    e.tx += ((e.hovering && !e.dragging ? e.px : 0) - e.tx) * ease(5, dt);
    e.ty += ((e.hovering && !e.dragging ? e.py : 0) - e.ty) * ease(5, dt);
    if (!e.dragging) {
      e.yaw += e.vYaw * dt;
      e.pitch = clamp(e.pitch + e.vPitch * dt, -1.3, 1.3);
      e.vYaw *= Math.exp(-2.2 * dt);
      e.vPitch *= Math.exp(-3 * dt);
      if (Math.abs(e.vYaw) < 0.5) e.yaw += (Math.round(e.yaw / TAU) * TAU - e.yaw) * ease(1.5, dt);
      if (Math.abs(e.vPitch) < 0.5) e.pitch += -e.pitch * ease(2, dt);
    }
    const t = clock.t;
    const calm = reduceMotion ? 0 : 1;
    const yaw = e.yaw + Math.sin(t * 0.55 + e.phase) * 0.3 * calm + e.tx * 0.45;
    const pitch = e.pitch + e.ty * 0.25;
    qPitch.setFromAxisAngle(AX, pitch);
    qYaw.setFromAxisAngle(AY, yaw);
    e.rig.quaternion.multiplyQuaternions(qPitch, qYaw);
    const grow = entrance(t - e.bornAt);
    e.rig.scale.setScalar(grow * (1 + e.hover * 0.05));
    e.rig.position.y = Math.sin(t * 0.9 + e.phase * 1.7) * 0.035 * calm - (1 - grow) * 0.4;
  }

  function renderGrid(dt: number): void {
    for (const e of entries) {
      if (e.state !== 'ready' || !e.built || e.el.hidden) continue;
      const r = e.stage.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= ch || r.right <= 0 || r.left >= cw || r.width < 4) continue;
      animateCard(e, dt);
      e.built.update?.(clock.t, dt);
      draw(e.scene, gridCam, r, e.built.radius, 0.86, 1, behindTile);
    }
  }

  function renderInspector(dt: number): void {
    const e = insp.entry;
    if (!e) return;
    const target = insp.built ? { scene: insp.scene, rig: insp.rig, built: insp.built } : e.built ? { scene: e.scene, rig: e.rig, built: e.built } : null;
    if (!target) return;
    insp.idle += dt;
    if (!insp.dragging) {
      insp.yaw += insp.vYaw * dt;
      insp.pitch = clamp(insp.pitch + insp.vPitch * dt, -1.4, 1.4);
      insp.vPitch *= Math.exp(-3 * dt);
      // drift into a slow turntable once left alone
      const cruise = insp.idle > 2.5 && !reduceMotion ? 0.32 : 0;
      insp.vYaw += (cruise - insp.vYaw) * ease(Math.abs(insp.vYaw) > 0.6 ? 1.6 : 0.8, dt);
    }
    insp.zoom += (insp.targetZoom - insp.zoom) * ease(9, dt);
    qPitch.setFromAxisAngle(AX, insp.pitch);
    qYaw.setFromAxisAngle(AY, insp.yaw);
    target.rig.quaternion.multiplyQuaternions(qPitch, qYaw);
    target.rig.position.set(0, 0, 0);
    target.rig.scale.setScalar(1);
    target.built.update?.(clock.t, dt);
    draw(target.scene, inspCam, stageEl.getBoundingClientRect(), target.built.radius, 0.84, insp.zoom, behindInspect);
  }

  /** Still building something the viewer is (or, with ?all=1, will be) looking at. */
  function busy(): boolean {
    return (
      !defsSettled ||
      !ioSeen ||
      (insp.open && !insp.built) ||
      entries.some((e) => (eager || e.near) && !e.el.hidden && (e.state === 'waiting' || e.state === 'queued' || e.state === 'building'))
    );
  }

  let readyIn = -1;
  function checkReady(): void {
    if (win.__objectsReady) return;
    if (busy() || frames < 2) {
      readyIn = -1;
      return;
    }
    if (readyIn < 0) readyIn = 3;
    else if (--readyIn === 0) {
      win.__objectsReady = true;
      win.__objectsStats = entries.map((e) => ({ kind: e.kind, state: e.state }));
    }
  }

  function frame(now: number): void {
    requestAnimationFrame(frame);
    // ?t= (frozen time) is for stills: draw nothing until every wanted toy is built, then
    // draw a few frames and keep the last one (software GL in CI is slow).
    if (frozenT !== null && (win.__objectsReady || busy())) return;
    const dt = Math.min(0.05, Math.max(0, (now - clock.last) / 1000));
    clock.last = now;
    if (frozenT === null) clock.t += dt;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w !== cw || h !== ch) {
      cw = w;
      ch = h;
      gl.setSize(w, h, false);
    }
    gl.setScissorTest(false);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.setScissorTest(true);
    if (insp.open) renderInspector(dt);
    else renderGrid(dt);
    frames++;
    checkReady();
  }
  requestAnimationFrame(frame);

  Object.assign(window, { THREE, renderer: gl, entries });
}
