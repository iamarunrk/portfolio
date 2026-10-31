/**
 * Dev harness for the shelf collectibles in src/objects/library (plain three.js).
 *
 *   /dev/library.html                  every shelf object in a grid (1600x900)
 *   ?only=<kind>                       one object, large
 *   ?only=<kind>&views=1               eight views of one object: hero pose, front, back, right (+X),
 *                                      left (-X), top, bottom and hero pose seen from behind
 *   ?only=<kind>&with=<hero kind>      the object beside a hero toy (can, pedal, jar, chips, terminal)
 *   ?bg=light | ?bg=pastel             #efe9df / the hero's pastel gradient (default #0b0b0d)
 *   ?rot=y                             slow turntable spin
 *   ?yaw=<deg>&pitch=<deg>             extra fixed rotation on top of the default pose
 *   ?t=<seconds>                       freeze animation time (deterministic screenshots)
 *   ?ts=<scale>                        ObjectBuildContext.textureScale (default 1)
 *   ?hud=1                             triangle / draw-call / texture stats overlay
 *
 * Each object file is imported on its own, so a broken one shows "ERR" instead of blanking
 * the page. Drag to rotate. Sets window.__objectsReady / __objectsStats / __objectsErrors.
 */
import * as THREE from 'three';
import { OBJECTS } from '../src/objects';
import { createStudioEnvironment } from '../src/scene/studioEnv';
import { ensureFonts } from '../src/fonts';
import type { BuiltObject } from '../src/objects/types';
import { libraryKinds, loadLibraryDef } from '../src/objects/library/load';

const W = 1600;
const H = 900;
const DEG = Math.PI / 180;
const qs = new URLSearchParams(location.search);
const only = qs.get('only');
const views = qs.get('views') === '1';
const withKind = qs.get('with');
const bgMode = qs.get('bg') ?? 'dark';
const spin = qs.get('rot') === 'y';
const yawExtra = Number(qs.get('yaw') ?? 0) * DEG;
const pitchExtra = Number(qs.get('pitch') ?? 0) * DEG;
const frozen = qs.has('t') ? Number(qs.get('t')) : null;
const showHud = qs.get('hud') === '1';
const textureScale = Number(qs.get('ts') ?? 1);

const win = window as unknown as {
  __objectsReady?: boolean;
  __objectsStats?: Stat[];
  __objectsErrors?: string[];
};
const errors: string[] = (win.__objectsErrors = []);
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String((e as PromiseRejectionEvent).reason)));

interface Stat {
  kind: string;
  name: string;
  radius: number;
  meshes: number;
  triangles: number;
  drawCalls: number;
  textures: number;
  textureMB: number;
  buildMs: number;
}

interface Item {
  kind: string;
  name: string;
  pose: [number, number, number];
  built: BuiltObject | null;
  pivot: THREE.Group;
  error?: string;
}

interface Cell {
  item: Item;
  label: string;
  /** Fixed rotation for this view, or null for the item's pose + extras + drag. */
  rot: [number, number, number] | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

const BG = { dark: '#0b0b0d', light: '#efe9df', pastel: '#ecd6ee' } as Record<string, string>;
const bgColor = BG[bgMode] ?? BG.dark;
const ink = bgMode === 'dark' ? '#d8d8d8' : '#222';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(bgColor, 1);
document.body.style.background = bgColor;
document.body.style.color = ink;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = createStudioEnvironment(renderer);
if (bgMode === 'pastel') scene.background = pastelTexture();

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);

function pastelTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 288;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9d3f3';
  g.fillRect(0, 0, 512, 288);
  const blob = (x: number, y: number, r: number, col: string) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, 'rgba(233,211,243,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 512, 288);
  };
  blob(40, 120, 260, 'rgba(244,170,200,0.95)');
  blob(270, 40, 220, 'rgba(255,229,170,0.95)');
  blob(470, 90, 240, 'rgba(206,186,250,0.9)');
  blob(260, 280, 260, 'rgba(225,205,250,0.8)');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ nav + labels

const nav = document.getElementById('nav')!;
const kinds = libraryKinds();
nav.innerHTML = ['all', ...kinds]
  .map((k) => {
    const p = new URLSearchParams(qs);
    if (k === 'all') p.delete('only');
    else p.set('only', k);
    return `<a href="?${p.toString()}"${k === (only ?? 'all') ? ' class="on"' : ''}>${k}</a>`;
  })
  .join('');

function addLabel(cell: Cell, text: string, isError: boolean): void {
  const el = document.createElement('div');
  el.className = 'lbl' + (isError ? ' err' : '');
  el.textContent = text;
  el.style.left = `${cell.x}px`;
  el.style.top = `${cell.y + cell.h - 22}px`;
  el.style.width = `${cell.w}px`;
  document.body.appendChild(el);
}

// ------------------------------------------------------------------ build

function geometryStats(root: THREE.Object3D): { meshes: number; tris: number; textures: number; texMB: number } {
  let tris = 0;
  let meshes = 0;
  const texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    const n = g.index ? g.index.count : g.getAttribute('position').count;
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    tris += (n / 3) * inst;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      for (const v of Object.values(mat)) {
        if (v && typeof v === 'object' && (v as THREE.Texture).isTexture) texs.add(v as THREE.Texture);
      }
    }
  });
  let bytes = 0;
  texs.forEach((t) => {
    const img = t.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) bytes += img.width * img.height * 4 * (t.generateMipmaps ? 1.33 : 1);
  });
  return { meshes, tris, textures: texs.size, texMB: bytes / (1024 * 1024) };
}

const ctx = {
  renderer,
  textureScale,
  maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
};
const stats: Stat[] = [];
const probe = new THREE.Scene();
probe.environment = scene.environment;

function measureCalls(pivot: THREE.Group): number {
  probe.add(pivot);
  camera.aspect = W / H;
  camera.position.set(0, 0, 4.6);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  renderer.setViewport(0, 0, W, H);
  renderer.render(probe, camera);
  const calls = renderer.info.render.calls;
  probe.remove(pivot);
  return calls;
}

async function makeItem(kind: string, hero = false): Promise<Item> {
  const pivot = new THREE.Group();
  const item: Item = { kind, name: kind, pose: [0, 0, 0], built: null, pivot };
  try {
    const def = hero ? OBJECTS.find((o) => o.kind === kind) : await loadLibraryDef(kind);
    if (!def) throw new Error(`unknown hero kind "${kind}"`);
    item.name = def.name;
    item.pose = def.defaultRotation;
    const t0 = performance.now();
    const built = def.build(ctx);
    const buildMs = performance.now() - t0;
    item.built = built;
    pivot.add(built.root);
    built.root.rotation.set(...item.pose);
    const calls = measureCalls(pivot);
    const s = geometryStats(built.root);
    stats.push({
      kind: hero ? `hero:${kind}` : kind,
      name: def.name,
      radius: +built.radius.toFixed(3),
      meshes: s.meshes,
      triangles: Math.round(s.tris),
      drawCalls: calls,
      textures: s.textures,
      textureMB: +s.texMB.toFixed(1),
      buildMs: Math.round(buildMs),
    });
  } catch (e) {
    const err = e as Error;
    item.error = String(err?.stack ?? err);
    errors.push(`${kind}: ${item.error}`);
    console.error(`[library] ${kind} failed`, e);
  }
  scene.add(pivot);
  return item;
}

function grid(n: number, x0: number, y0: number, w: number, h: number, cols: number): { x: number; y: number; w: number; h: number }[] {
  const rows = Math.ceil(n / cols);
  const cw = Math.floor(w / cols);
  const ch = Math.floor(h / rows);
  return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * cw, y: y0 + Math.floor(i / cols) * ch, w: cw, h: ch }));
}

const VIEWS: [string, [number, number, number] | 'pose' | 'pose-back'][] = [
  ['hero pose', 'pose'],
  ['front (+Z)', [0, 0, 0]],
  ['back (-Z)', [0, Math.PI, 0]],
  ['right (+X)', [0, -Math.PI / 2, 0]],
  ['left (-X)', [0, Math.PI / 2, 0]],
  ['top (+Y)', [Math.PI / 2, 0, 0]],
  ['bottom (-Y)', [-Math.PI / 2, 0, 0]],
  ['hero pose, from behind', 'pose-back'],
];

async function main() {
  await ensureFonts();
  const cells: Cell[] = [];
  const items: Item[] = [];
  if (only && views) {
    const it = await makeItem(only);
    items.push(it);
    grid(VIEWS.length, 0, 0, W, H, 4).forEach((r, i) => {
      const [label, v] = VIEWS[i];
      let rot: [number, number, number];
      if (v === 'pose') rot = [it.pose[0] + pitchExtra, it.pose[1] + yawExtra, it.pose[2]];
      else if (v === 'pose-back') rot = [it.pose[0], it.pose[1] + Math.PI, it.pose[2]];
      else rot = v;
      cells.push({ item: it, label: `${only} · ${label}`, rot, ...r });
    });
  } else if (only) {
    const list = [only, ...(withKind ? [withKind] : [])];
    for (let i = 0; i < list.length; i++) items.push(await makeItem(list[i], i > 0));
    grid(items.length, 0, 0, W, H, items.length).forEach((r, i) => cells.push({ item: items[i], label: `${items[i].kind} · ${items[i].name}`, rot: null, ...r }));
  } else {
    for (const k of kinds) items.push(await makeItem(k));
    const cols = items.length <= 6 ? Math.max(1, items.length) : Math.ceil(items.length / 3);
    grid(items.length, 0, 0, W, H, cols).forEach((r, i) => cells.push({ item: items[i], label: items[i].kind, rot: null, ...r }));
  }
  for (const c of cells) addLabel(c, c.item.error ? `${c.label} · ERR (see console)` : c.label, !!c.item.error);

  win.__objectsStats = stats;
  console.table(stats);
  if (showHud) {
    document.getElementById('hud')!.textContent = stats
      .map(
        (s) =>
          `${s.kind.padEnd(14)} r=${s.radius.toFixed(3)} tris=${String(s.triangles).padStart(7)} calls=${String(s.drawCalls).padStart(2)} meshes=${String(s.meshes).padStart(2)} tex=${s.textures} (${s.textureMB}MB) build=${s.buildMs}ms`,
      )
      .join('\n');
  }

  // drag to rotate
  let drag: { x: number; y: number } | null = null;
  let dragYaw = 0;
  let dragPitch = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
  window.addEventListener('pointerup', () => (drag = null));
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dragYaw += (e.clientX - drag.x) * 0.01;
    dragPitch += (e.clientY - drag.y) * 0.01;
    drag = { x: e.clientX, y: e.clientY };
  });

  const fill = cells.length === 1 || (only && !views) ? 0.84 : 0.8;
  const t0 = performance.now();
  let frames = 0;
  let last = 0;
  renderer.setScissorTest(true);
  renderer.setAnimationLoop(() => {
    const t = frozen ?? (performance.now() - t0) / 1000;
    const dt = frozen !== null ? 1 / 60 : Math.min(0.1, t - last);
    last = t;
    for (const it of items) it.built?.update?.(t, dt);
    for (const c of cells) {
      const it = c.item;
      for (const o of items) o.pivot.visible = o === it;
      if (it.built) {
        if (c.rot) it.built.root.rotation.set(c.rot[0], c.rot[1], c.rot[2]);
        else it.built.root.rotation.set(it.pose[0] + pitchExtra + dragPitch, it.pose[1] + yawExtra + dragYaw + (spin ? t * 0.6 : 0), it.pose[2]);
      }
      const yGL = H - c.y - c.h;
      renderer.setViewport(c.x, yGL, c.w, c.h);
      renderer.setScissor(c.x, yGL, c.w, c.h);
      const aspect = c.w / c.h;
      const half = Math.min(15 * DEG, Math.atan(Math.tan(15 * DEG) * aspect));
      const r = it.built?.radius ?? 1;
      camera.aspect = aspect;
      camera.position.set(0, 0, r / Math.sin(half * fill));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
    if (++frames === 3) win.__objectsReady = true;
  });

  Object.assign(window, { THREE, scene, renderer, items });
}

main().catch((e) => {
  console.error(e);
  errors.push(String(e?.stack ?? e));
  win.__objectsReady = true;
});
