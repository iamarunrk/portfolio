/**
 * Dev harness for the signature motions (what each collectible does when clicked): all 23 toys,
 * hero and shelf alike (plain three.js).
 *
 *   /dev/act.html                      every toy in a grid; click one to play its motion
 *   ?f=<0..1>                          the grid as a still, each toy at that fraction of its motion
 *   ?loop=1                            keep replaying (grid or single)
 *   ?only=<kind>                       one toy, large, in its hero pose; click to play
 *   ?only=<kind>&strip=1               a filmstrip: 8 stills evenly spread over the motion
 *                                      (first = rest, last = back at rest), deterministic
 *   ?only=<kind>&at=<seconds>          one still at that time into the motion
 *   ?yaw=<deg>&pitch=<deg>             extra rotation on top of the hero pose
 *   ?bg=light                          light backdrop
 *   ?ts=<scale>                        texture scale (default 0.6)
 *
 * The dashed square in each cell is what the board shows of a toy (its square there is clipped):
 * keep the motion inside it. Sets window.__objectsReady / __objectsErrors / __actInfo.
 */
import * as THREE from 'three';
import { OBJECTS } from '../src/objects';
import { createStudioEnvironment } from '../src/scene/studioEnv';
import { ensureFonts } from '../src/fonts';
import type { BuiltObject } from '../src/objects/types';
import { libraryKinds, loadLibraryDef } from '../src/objects/library/load';

const DEG = Math.PI / 180;
const FOV = 30;
/** How much of a cell the bounding sphere fills here, and on the board (src/board/toys.ts). */
const FILL = 0.66;
const BOARD_FILL = 0.84;
const qs = new URLSearchParams(location.search);
const only = qs.get('only');
const strip = qs.get('strip') === '1';
const at = qs.has('at') ? Number(qs.get('at')) : null;
const frac = qs.has('f') ? Number(qs.get('f')) : null;
const loop = qs.get('loop') === '1';
const light = qs.get('bg') === 'light';
const yawExtra = Number(qs.get('yaw') ?? 0) * DEG;
const pitchExtra = Number(qs.get('pitch') ?? 0) * DEG;
const textureScale = Number(qs.get('ts') ?? 0.6);
const still = strip || at !== null || frac !== null;

const win = window as unknown as { __objectsReady?: boolean; __objectsErrors?: string[]; __actInfo?: unknown };
const errors: string[] = (win.__objectsErrors = []);
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String((e as PromiseRejectionEvent).reason)));

interface Item {
  kind: string;
  name: string;
  pose: [number, number, number];
  built: BuiltObject | null;
  scene: THREE.Scene;
  duration: number;
  error?: string;
  restAt: number;
}
interface Cell {
  item: Item;
  /** Seconds into the motion for a still, or null for live. */
  time: number | null;
  label: string;
  el: HTMLElement;
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const BG = light ? '#efe9df' : '#101012';
renderer.setClearColor(BG, 1);
renderer.autoClear = false;
document.body.style.background = BG;
document.body.style.color = light ? '#222' : '#ddd';
document.body.style.overflow = 'hidden';
renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh';
document.body.appendChild(renderer.domElement);
const env = createStudioEnvironment(renderer);
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
const grid = document.createElement('div');
grid.style.cssText = 'position:fixed;inset:0;display:grid;pointer-events:auto';
document.body.appendChild(grid);

const nav = document.getElementById('nav')!;
nav.style.zIndex = '2';

/** Jump a toy's motion to `time` seconds (always stepped from the start, so stills are repeatable). */
function seek(built: BuiltObject, time: number) {
  built.update?.(0, 1e4); // finish whatever was playing: back at rest
  if (time <= 0 || !built.act) return;
  built.act();
  const n = Math.round(time * 60);
  for (let i = 0; i < n; i++) built.update?.(0, 1 / 60);
}

async function main() {
  await ensureFonts();
  const ctx = { renderer, textureScale, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() };
  const heroKinds = OBJECTS.map((o) => o.kind as string);
  const all = [...heroKinds, ...libraryKinds()];
  if (strip) nav.style.display = 'none';
  nav.innerHTML = ['all', ...all].map((k) => `<a href="?${k === 'all' ? '' : `only=${k}`}">${k}</a>`).join('');
  const kinds = only ? [only] : all;

  const items: Item[] = [];
  for (const kind of kinds) {
    const item: Item = { kind, name: kind, pose: [0, 0, 0], built: null, scene: new THREE.Scene(), duration: 0, restAt: 0 };
    item.scene.environment = env;
    try {
      const hero = OBJECTS.find((o) => o.kind === kind);
      const def = hero ?? (await loadLibraryDef(kind));
      item.name = def.name;
      item.pose = def.defaultRotation;
      const built = def.build(ctx);
      built.root.rotation.set(def.defaultRotation[0] + pitchExtra, def.defaultRotation[1] + yawExtra, def.defaultRotation[2]);
      item.scene.add(built.root);
      item.built = built;
      // the motion's length is whatever act() reports; put the toy straight back to rest
      item.duration = built.act?.() ?? 0;
      built.update?.(0, 1e4);
    } catch (err) {
      item.error = String((err as Error)?.stack ?? err);
      errors.push(`${kind}: ${item.error}`);
      console.error(kind, err);
    }
    items.push(item);
  }
  win.__actInfo = items.map((i) => ({ kind: i.kind, name: i.name, duration: +i.duration.toFixed(2), hasAct: !!i.built?.act, error: i.error }));
  console.table(win.__actInfo);

  // cells
  const cells: Cell[] = [];
  const mk = (item: Item, time: number | null, label: string) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:relative;min-width:0;min-height:0;cursor:pointer';
    el.innerHTML = `<i style="position:absolute;left:50%;top:50%;translate:-50% -50%;border:1px dashed ${light ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.2)'};pointer-events:none"></i><span style="position:absolute;left:8px;top:6px;opacity:.75"></span>`;
    el.querySelector('span')!.textContent = label;
    grid.appendChild(el);
    const cell: Cell = { item, time, label, el };
    el.addEventListener('click', () => item.built?.act?.());
    cells.push(cell);
  };
  if (only && strip) {
    const it = items[0];
    const n = 8;
    grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * it.duration;
      mk(it, t, `${it.kind} · ${t.toFixed(2)}s / ${it.duration.toFixed(2)}s`);
    }
  } else if (only) {
    const it = items[0];
    grid.style.gridTemplateColumns = '1fr';
    mk(it, at, `${it.kind} · ${it.name} · ${it.built?.act ? `${it.duration.toFixed(2)}s${at !== null ? ` @ ${at}s` : ' (click to play)'}` : 'NO SIGNATURE YET'}`);
  } else {
    grid.style.gridTemplateColumns = 'repeat(6, 1fr)';
    for (const it of items) mk(it, frac !== null ? frac * it.duration : null, `${it.kind}${it.built?.act ? ` ${it.duration.toFixed(1)}s` : ' —'}${it.error ? ' ERR' : ''}`);
  }

  const half = (FOV / 2) * DEG;
  let frames = 0;
  let last = performance.now();
  const t0 = last;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (renderer.domElement.width !== Math.round(W * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(H * renderer.getPixelRatio())) renderer.setSize(W, H, false);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    if (!still) {
      for (const it of items) {
        if (!it.built) continue;
        if (loop && !it.built.acting?.()) {
          if (it.restAt === 0) it.restAt = now;
          else if (now - it.restAt > 700) {
            it.built.act?.();
            it.restAt = 0;
          }
        }
        it.built.update?.(t, dt);
      }
    }
    for (const c of cells) {
      const b = c.item.built;
      if (!b) continue;
      const r = c.el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (c.time !== null) seek(b, c.time);
      const side = Math.min(r.width, r.height);
      const box = c.el.querySelector('i') as HTMLElement;
      const bs = `${((side * FILL) / BOARD_FILL).toFixed(1)}px`;
      if (box.style.width !== bs) box.style.width = box.style.height = bs;
      camera.aspect = r.width / r.height;
      const h = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
      camera.position.set(0, 0, b.radius / Math.sin(h * FILL));
      camera.updateProjectionMatrix();
      const y = H - r.bottom;
      renderer.setViewport(r.left, y, r.width, r.height);
      renderer.setScissor(r.left, y, r.width, r.height);
      renderer.render(c.item.scene, camera);
    }
    if (++frames === 3) win.__objectsReady = true;
  });
  Object.assign(window, { THREE, renderer, items });
}

main().catch((e) => {
  console.error(e);
  errors.push(String(e?.stack ?? e));
  win.__objectsReady = true;
});
