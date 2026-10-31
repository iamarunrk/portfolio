/**
 * Dev harness for the collectible objects (plain three.js).
 *
 *   /dev/objects.html                 all five in a row (1600x900)
 *   ?only=<kind>                      one object, large
 *   ?bg=light                         #efe9df clear colour instead of #0b0b0d
 *   ?rot=y                            slow turntable spin to check every side
 *   ?yaw=<deg>&pitch=<deg>            extra fixed rotation (QA of back / top)
 *   ?t=<seconds>                      freeze animation time (deterministic screenshots)
 *   ?hud=1                            show triangle / draw-call stats
 *
 * Drag to rotate everything. Stats are logged and exposed on window.__objectsStats.
 */
import * as THREE from 'three';
import { OBJECTS } from '../src/objects';
import { createStudioEnvironment } from '../src/scene/studioEnv';
import { ensureFonts } from '../src/fonts';
import type { BuiltObject, ObjectDef } from '../src/objects/types';

const W = 1600;
const H = 900;
const DEG = Math.PI / 180;
const qs = new URLSearchParams(location.search);
const only = qs.get('only');
const light = qs.get('bg') === 'light';
const spin = qs.get('rot') === 'y';
const yawExtra = Number(qs.get('yaw') ?? 0) * DEG;
const pitchExtra = Number(qs.get('pitch') ?? 0) * DEG;
const frozen = qs.has('t') ? Number(qs.get('t')) : null;
const showHud = qs.get('hud') === '1';

declare global {
  interface Window {
    __objectsReady?: boolean;
    __objectsStats?: Stat[];
    __objectsErrors?: string[];
  }
}
interface Stat {
  kind: string;
  name: string;
  radius: number;
  meshes: number;
  triangles: number;
  drawCalls: number;
  buildMs: number;
}

window.__objectsErrors = [];
window.addEventListener('error', (e) => window.__objectsErrors!.push(String(e.message)));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(light ? '#efe9df' : '#0b0b0d', 1);
document.body.style.background = light ? '#efe9df' : '#0b0b0d';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = createStudioEnvironment(renderer);

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

const nav = document.getElementById('nav')!;
nav.innerHTML = ['all', ...OBJECTS.map((o) => o.kind)]
  .map((k) => {
    const p = new URLSearchParams(qs);
    if (k === 'all') p.delete('only');
    else p.set('only', k);
    return `<a href="?${p.toString()}">${k}</a>`;
  })
  .join('');

interface Slot {
  def: ObjectDef;
  built: BuiltObject;
  pivot: THREE.Group;
}

function geometryTriangles(root: THREE.Object3D): { meshes: number; tris: number } {
  let tris = 0;
  let meshes = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    const n = g.index ? g.index.count : g.getAttribute('position').count;
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    tris += (n / 3) * inst;
  });
  return { meshes, tris };
}

async function main() {
  await ensureFonts();
  const ctx = {
    renderer,
    textureScale: Number(qs.get('ts') ?? 1),
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  };
  const defs = only ? OBJECTS.filter((o) => o.kind === only) : OBJECTS;
  const slots: Slot[] = [];
  const stats: Stat[] = [];
  const probe = new THREE.Scene();
  probe.environment = scene.environment;
  defs.forEach((def, i) => {
    const t0 = performance.now();
    const built = def.build(ctx);
    const buildMs = performance.now() - t0;
    const pivot = new THREE.Group();
    pivot.add(built.root);
    built.root.rotation.set(def.defaultRotation[0] + pitchExtra, def.defaultRotation[1] + yawExtra, def.defaultRotation[2]);
    // probe draw calls with the object alone in front of the camera
    probe.add(pivot);
    renderer.render(probe, camera);
    const calls = renderer.info.render.calls;
    probe.remove(pivot);
    const { meshes, tris } = geometryTriangles(built.root);
    stats.push({ kind: def.kind, name: def.name, radius: +built.radius.toFixed(3), meshes, triangles: Math.round(tris), drawCalls: calls, buildMs: Math.round(buildMs) });
    if (only) {
      pivot.scale.setScalar(2.2);
    } else {
      const n = defs.length;
      pivot.position.x = (i - (n - 1) / 2) * 1.9;
      pivot.scale.setScalar(0.88);
    }
    scene.add(pivot);
    slots.push({ def, built, pivot });
  });
  window.__objectsStats = stats;
  console.table(stats);
  const hud = document.getElementById('hud')!;
  if (showHud) {
    hud.textContent = stats
      .map((s) => `${s.kind.padEnd(9)} r=${s.radius.toFixed(3)} tris=${String(s.triangles).padStart(6)} calls=${s.drawCalls} meshes=${s.meshes} build=${s.buildMs}ms`)
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

  const t0 = performance.now();
  let frames = 0;
  let last = 0;
  renderer.setAnimationLoop(() => {
    const t = frozen ?? (performance.now() - t0) / 1000;
    const dt = frozen !== null ? 1 / 60 : Math.min(0.1, t - last);
    last = t;
    for (const s of slots) {
      const [rx, ry, rz] = s.def.defaultRotation;
      s.built.root.rotation.set(rx + pitchExtra + dragPitch, ry + yawExtra + dragYaw + (spin ? t * 0.6 : 0), rz);
      s.built.update?.(t, dt);
    }
    renderer.render(scene, camera);
    if (++frames === 3) window.__objectsReady = true;
  });

  // expose for console debugging
  Object.assign(window, { THREE, scene, renderer, slots });
}

main().catch((e) => {
  console.error(e);
  window.__objectsErrors!.push(String(e?.stack ?? e));
});
