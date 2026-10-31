/**
 * Background engine dev harness (plain three.js, no React).
 *   /dev/bg.html                         full-screen DEFAULT_BG
 *   ?base=<kind>&mat=<kind>              override kinds (tuned defaults)
 *   &preset=<id>[,<id>]                  apply base and/or material presets by id
 *   &t=<seconds>&freeze=1                fixed time for screenshots
 *   &hud=0  &obj=1 (transmissive test objects)  &grain=0.3&vignette=0.3
 *   ?grid=bases | ?grid=materials        labelled thumbnail grids for visual QA
 */
import * as THREE from 'three';
import { BackgroundEngine } from '../src/bg/BackgroundEngine';
import { BASE_KINDS, BASE_META, MATERIAL_KINDS, MATERIAL_META } from '../src/bg/meta';
import {
  COLOR_PRESETS,
  DEFAULT_BG,
  GRADIENT_PRESETS,
  MATERIAL_PRESETS,
  SHADER_PRESETS,
  defaultBase,
  defaultMaterial,
  randomBg,
} from '../src/bg/presets';
import type { BaseKind, BgConfig, MaterialKind } from '../src/bg/types';

const qs = new URLSearchParams(location.search);
const num = (k: string, d: number) => (qs.has(k) && Number.isFinite(Number(qs.get(k))) ? Number(qs.get(k)) : d);
const clone = (c: BgConfig): BgConfig => JSON.parse(JSON.stringify(c));
const ALL_BASE_PRESETS = [...SHADER_PRESETS, ...GRADIENT_PRESETS];

declare global {
  interface Window {
    __bg?: { engine: BackgroundEngine; renderer: THREE.WebGLRenderer; cfg: () => BgConfig; set: (c: BgConfig) => void; frames: number; errors: string[] };
    __gridDone?: boolean;
  }
}

const errors: string[] = [];
const origError = console.error.bind(console);
console.error = (...a: unknown[]) => {
  errors.push(a.map(String).join(' '));
  origError(...a);
};

function configFromQuery(): BgConfig {
  const cfg = clone(DEFAULT_BG);
  const bk = qs.get('base') as BaseKind | null;
  const mk = qs.get('mat') as MaterialKind | null;
  if (bk && (BASE_KINDS as string[]).includes(bk)) cfg.base = defaultBase(bk);
  if (mk && (MATERIAL_KINDS as string[]).includes(mk)) cfg.material = defaultMaterial(mk);
  for (const id of (qs.get('preset') ?? '').split(',').filter(Boolean)) {
    const bp = ALL_BASE_PRESETS.find((p) => p.id === id);
    if (bp) cfg.base = clone({ ...cfg, base: bp.base }).base;
    const mp = MATERIAL_PRESETS.find((p) => p.id === id);
    if (mp) cfg.material = { ...mp.material };
  }
  if (qs.has('grain')) cfg.fx.grain = num('grain', cfg.fx.grain);
  if (qs.has('vignette')) cfg.fx.vignette = num('vignette', cfg.fx.vignette);
  return cfg;
}

function makeRenderer(canvas?: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#0b0b0d', 1);
  return renderer;
}

// ------------------------------------------------------------------------------------------------
// Full-screen mode
// ------------------------------------------------------------------------------------------------
function fullScreen() {
  document.body.classList.add('full');
  const renderer = makeRenderer();
  renderer.domElement.className = 'stage';
  document.body.appendChild(renderer.domElement);
  const dpr = num('dpr', Math.min(window.devicePixelRatio || 1, 2));
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 60);
  camera.position.set(0, 0, 9);
  const engine = new BackgroundEngine(renderer);
  scene.add(engine.mesh);
  let cfg = configFromQuery();
  engine.setConfig(cfg);
  engine.setSize(window.innerWidth, window.innerHeight, dpr);

  if (qs.get('obj') === '1') addTestObjects(scene, renderer);

  const fixedT = qs.has('t') ? num('t', 0) : null;
  const freeze = qs.get('freeze') === '1';
  if (fixedT !== null) engine.update(0); // ensure first frame exists
  if (fixedT !== null) {
    // advance deterministic time in one go (update clamps dt, so step)
    let left = fixedT;
    while (left > 0) {
      const step = Math.min(0.1, left);
      engine.update(step);
      left -= step;
    }
  }

  const state = { frames: 0 };
  window.__bg = {
    engine,
    renderer,
    cfg: () => cfg,
    set: (c: BgConfig) => {
      cfg = clone(c);
      engine.setConfig(cfg);
      updateHud();
    },
    get frames() {
      return state.frames;
    },
    errors,
  } as Window['__bg'] & object;

  addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    engine.setSize(window.innerWidth, window.innerHeight, dpr);
  });
  renderer.domElement.addEventListener('pointermove', (e) => engine.setPointer(e.clientX / innerWidth, 1 - e.clientY / innerHeight));
  renderer.domElement.addEventListener('pointerdown', (e) => engine.pulse(e.clientX / innerWidth, 1 - e.clientY / innerHeight));

  // HUD
  const hud = document.createElement('div');
  hud.id = 'hud';
  if (qs.get('hud') === '0') hud.style.display = 'none';
  document.body.appendChild(hud);
  const sel = (opts: string[], val: string, on: (v: string) => void) => {
    const s = document.createElement('select');
    for (const o of opts) s.add(new Option(o, o, false, o === val));
    s.onchange = () => on(s.value);
    return s;
  };
  const fpsEl = document.createElement('span');
  function updateHud() {
    hud.textContent = '';
    const row = document.createElement('div');
    row.className = 'row';
    row.append(
      sel([...BASE_KINDS], cfg.base.kind, (v) => window.__bg!.set({ ...cfg, base: defaultBase(v as BaseKind, cfg.base.colors) })),
      sel([...MATERIAL_KINDS], cfg.material.kind, (v) => window.__bg!.set({ ...cfg, material: defaultMaterial(v as MaterialKind) })),
      sel(['(base preset)', ...ALL_BASE_PRESETS.map((p) => p.id)], '(base preset)', (v) => {
        const p = ALL_BASE_PRESETS.find((x) => x.id === v);
        if (p) window.__bg!.set({ ...cfg, base: clone({ ...cfg, base: p.base }).base });
      }),
      sel(['(material preset)', ...MATERIAL_PRESETS.map((p) => p.id)], '(material preset)', (v) => {
        const p = MATERIAL_PRESETS.find((x) => x.id === v);
        if (p) window.__bg!.set({ ...cfg, material: { ...p.material } });
      }),
    );
    const rnd = document.createElement('button');
    rnd.textContent = 'surprise';
    rnd.onclick = () => window.__bg!.set(randomBg());
    const lum = document.createElement('button');
    lum.textContent = 'lum';
    lum.onclick = () => (lum.textContent = `lum ${engine.sampleLuminance().toFixed(3)}`);
    row.append(rnd, lum, fpsEl);
    hud.append(row);
  }
  updateHud();

  let last = performance.now();
  let acc = 0;
  let n = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    n++;
    if (acc > 0.5) {
      fpsEl.textContent = `${Math.round(n / acc)} fps`;
      acc = 0;
      n = 0;
    }
    engine.update(freeze || fixedT !== null ? 0 : dt);
    renderer.render(scene, camera);
    state.frames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** A transmissive sphere + a glossy sticker box: checks the background reaches the transmission pre-pass. */
function addTestObjects(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#888');
  scene.environment = pmrem.fromScene(envScene).texture;
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0.05, thickness: 1.2, ior: 1.45, color: '#ffffff' }),
  );
  glass.position.set(-1.4, 0, 0);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: '#ff5a1f', roughness: 0.35 }));
  box.position.set(1.4, 0, 0);
  box.rotation.set(0.5, 0.7, 0);
  scene.add(glass, box, new THREE.AmbientLight('#fff', 0.6));
  const dl = new THREE.DirectionalLight('#fff', 2);
  dl.position.set(-3, 4, 5);
  scene.add(dl);
}

// ------------------------------------------------------------------------------------------------
// Grid mode
// ------------------------------------------------------------------------------------------------
async function grid(kind: 'bases' | 'materials') {
  document.body.classList.add('grid-page');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const renderer = makeRenderer(canvas);
  const engine = new BackgroundEngine(renderer);
  engine.setSize(1440, 900, 1);
  const W = num('w', 320);
  const H = num('h', 200);
  const T = num('t', 7.5);
  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

  const section = (title: string, cls = 'grid') => {
    const h = document.createElement('h2');
    h.textContent = title;
    const g = document.createElement('div');
    g.className = cls;
    document.body.append(h, g);
    return g;
  };
  const tile = async (parent: HTMLElement, cfg: BgConfig, label: string) => {
    const fig = document.createElement('figure');
    const img = new Image(W, H);
    const cap = document.createElement('figcaption');
    fig.append(img, cap);
    parent.append(fig);
    await yieldFrame();
    const t0 = performance.now();
    img.src = engine.renderThumbnail(cfg, W, H, T);
    const lum = engine.sampleLuminance(cfg);
    cap.textContent = `${label} · L ${lum.toFixed(2)} · ${Math.round(performance.now() - t0)}ms`;
  };
  const fx = { grain: 0.2, vignette: 0.25 };

  if (kind === 'bases') {
    const g1 = section('Base kinds (tuned defaults, no material)');
    for (const k of BASE_KINDS) {
      await tile(g1, { base: defaultBase(k), material: defaultMaterial('none'), fx }, `${k} — ${BASE_META[k].label}`);
    }
    const g2 = section('SHADER_PRESETS');
    for (const p of SHADER_PRESETS) await tile(g2, { base: p.base, material: defaultMaterial('none'), fx }, `${p.id} (${p.base.kind})`);
    const g3 = section('GRADIENT_PRESETS');
    for (const p of GRADIENT_PRESETS) await tile(g3, { base: p.base, material: defaultMaterial('none'), fx }, `${p.id} (${p.base.kind})`);
    const g4 = section('COLOR_PRESETS (solid) + DEFAULT_BG + randomBg');
    for (const c of COLOR_PRESETS.slice(0, 6)) {
      await tile(g4, { base: defaultBase('solid', [c, c, c, c]), material: defaultMaterial('none'), fx }, `solid ${c}`);
    }
    await tile(g4, DEFAULT_BG, 'DEFAULT_BG');
    for (let i = 0; i < 5; i++) {
      const r = randomBg();
      await tile(g4, r, `random: ${r.base.kind} + ${r.material.kind}`);
    }
  } else {
    const bases = [
      { name: 'default mesh', base: DEFAULT_BG.base },
      { name: 'peach (linear)', base: GRADIENT_PRESETS.find((p) => p.id === 'peach')!.base },
      { name: 'groovy (swirl)', base: SHADER_PRESETS.find((p) => p.id === 'groovy')!.base },
    ];
    const g = section(`Materials over ${bases.map((b) => b.name).join(' / ')}`, 'grid cols3');
    const rows: { label: string; mat: BgConfig['material'] }[] = [
      ...MATERIAL_KINDS.map((k) => ({ label: `${k} — ${MATERIAL_META[k].label}`, mat: defaultMaterial(k) })),
      ...MATERIAL_PRESETS.filter((p) => p.id !== 'none').map((p) => ({ label: `preset ${p.id}`, mat: p.material })),
    ];
    for (const row of rows) {
      const lab = document.createElement('div');
      lab.className = 'rowlabel';
      lab.textContent = row.label;
      g.append(lab);
      for (const b of bases) await tile(g, { base: b.base, material: row.mat, fx }, b.name);
    }
  }
  window.__bg = { engine, renderer, cfg: () => DEFAULT_BG, set: () => {}, frames: 0, errors };
  window.__gridDone = true;
}

/** Headless API mode for scripted QA: window.__bg.engine.renderThumbnail(cfg, w, h, t). */
function api() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const renderer = makeRenderer(canvas);
  const engine = new BackgroundEngine(renderer);
  engine.setSize(num('cw', 1440), num('ch', 900), num('dpr', 1));
  window.__bg = { engine, renderer, cfg: () => DEFAULT_BG, set: (c) => engine.setConfig(c), frames: 0, errors };
  window.__gridDone = true;
}

const gridMode = qs.get('grid');
if (gridMode === 'bases' || gridMode === 'materials') void grid(gridMode);
else if (gridMode === 'api') api();
else fullScreen();
