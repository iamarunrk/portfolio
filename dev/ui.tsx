/**
 * Dev harness for the canvas chrome: a full-screen three.js canvas running the
 * BackgroundEngine, with <TopBar/>, <Island/> and <Hint/> mounted on top.
 *
 *   /dev/ui.html            normal
 *   /dev/ui.html?fresh      forget the remix + hint flag first (first-visit view)
 *   /dev/ui.html?nogl       skip WebGL, paint a CSS gradient of the palette
 *   /dev/ui.html?headline=0 hide the stand-in headline
 *
 * Until src/bg/BackgroundEngine.ts exists this falls back to the CSS gradient.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import '../src/styles.css';
import { useStore } from '../src/store';
import { engineRef, setEngine } from '../src/scene/engineRef';
import { Hint } from '../src/ui/Hint';
import { Island } from '../src/ui/Island';
import { TopBar } from '../src/ui/TopBar';
import { paletteCss } from '../src/ui/thumbs';
import type { BackgroundEngine } from '../src/bg/BackgroundEngine';

type EngineModule = { BackgroundEngine: new (renderer: THREE.WebGLRenderer) => BackgroundEngine };
// A glob (not a static import) so the harness still loads before the engine file exists.
const engineModules = import.meta.glob<EngineModule>('../src/bg/BackgroundEngine.ts');

const params = new URLSearchParams(location.search);
const host = document.getElementById('bg') as HTMLDivElement;
const headline = document.getElementById('headline');
if (headline && params.get('headline') === '0') headline.hidden = true;

function cssFallback(reason: string) {
  console.info(`[dev/ui] CSS background fallback (${reason})`);
  const paint = () => {
    host.style.background = paletteCss(useStore.getState().bg.base);
  };
  paint();
  useStore.subscribe((s, prev) => {
    if (s.bg !== prev.bg) paint();
  });
}

async function startBackground() {
  const load = engineModules['../src/bg/BackgroundEngine.ts'];
  if (params.has('nogl')) return cssFallback('?nogl');
  if (!load) return cssFallback('engine not written yet');

  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const { BackgroundEngine } = await load();
    // Same renderer settings as the real Stage.
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setClearColor('#0b0b0d', 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    host.appendChild(renderer.domElement);

    const engine = new BackgroundEngine(renderer);
    const scene = new THREE.Scene();
    scene.add(engine.mesh);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    camera.position.z = 1;

    engine.setSize(window.innerWidth, window.innerHeight, dpr);
    engine.setConfig(useStore.getState().bg);
    useStore.subscribe((s, prev) => {
      if (s.bg !== prev.bg) engine.setConfig(s.bg);
    });
    setEngine(engine);

    window.addEventListener('resize', () => {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      renderer!.setPixelRatio(d);
      renderer!.setSize(window.innerWidth, window.innerHeight, false);
      engine.setSize(window.innerWidth, window.innerHeight, d);
    });
    host.addEventListener('pointermove', (e) => {
      engine.setPointer(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
    });
    host.addEventListener('pointerdown', (e) => {
      engine.pulse(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
    });

    let last = performance.now();
    renderer.setAnimationLoop((now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      engine.update(dt);
      renderer!.render(scene, camera);
    });
  } catch (err) {
    console.error('[dev/ui] engine failed to start', err);
    renderer?.domElement.remove();
    setEngine(null);
    cssFallback('engine error');
  }
}

void startBackground();

// Handy for poking at state from the console / Playwright.
(window as unknown as { __ui: unknown }).__ui = { store: useStore, engineRef };

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <TopBar />
    <Island />
    <Hint />
  </StrictMode>,
);
