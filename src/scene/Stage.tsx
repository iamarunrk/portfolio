import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BackgroundEngine, type GlassPanel } from '../bg/BackgroundEngine';
import { collectGlassPanels, queueToneUpdate, updateGlassTones } from '../ui/liquidGlass';
import { CAMERA_FOV, CAMERA_Z, computeFrame } from '../layout';
import { OBJECTS } from '../objects';
import { useStore } from '../store';
import { InteractionController } from './controller';
import { setEngine } from './engineRef';
import { gizmoFrame } from './gizmo';
import { ObjectNode } from './ObjectNode';
import { useFrameStore } from './registry';
import { createStudioEnvironment } from './studioEnv';

/** Keeps the world-space canvas frame in sync with the viewport size. */
function FrameSync() {
  const size = useThree((s) => s.size);
  useEffect(() => {
    useFrameStore.getState().setFrame(computeFrame(size.width, size.height));
  }, [size.width, size.height]);
  return null;
}

function StudioLighting() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const env = createStudioEnvironment(gl);
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Background() {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const bg = useStore((s) => s.bg);
  const [engine, setEngineState] = useState<BackgroundEngine | null>(null);

  // Created inside the effect so StrictMode's mount/unmount/mount never reuses a disposed engine.
  useEffect(() => {
    const e = new BackgroundEngine(gl);
    setEngineState(e);
    setEngine(e);
    return () => {
      setEngine(null);
      setEngineState(null);
      e.dispose();
    };
  }, [gl]);

  useEffect(() => {
    engine?.setSize(size.width, size.height, dpr);
  }, [engine, size.width, size.height, dpr]);

  // Once the page has settled, compile every shader variant in the background so the
  // first visit to a swatch never hitches.
  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    const idle =
      (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1));
    const id = window.setTimeout(() => {
      idle(() => {
        if (!cancelled) engine.precompile().catch(() => {});
      }, { timeout: 3000 });
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    engine.setConfig(bg);
    // Pick headline ink from how bright the background actually renders.
    const id = setTimeout(() => {
      try {
        const lum = engine.sampleLuminance(bg);
        useStore.getState().setInk(lum > 0.56 ? 'dark' : 'light');
      } catch {
        /* keep current ink */
      }
    }, 120);
    return () => clearTimeout(id);
  }, [engine, bg]);

  // Chrome glass tones follow what is actually behind each panel; animated shaders drift, so re-check.
  useEffect(() => {
    if (!engine) return;
    queueToneUpdate(160);
    const id = window.setInterval(updateGlassTones, 1500);
    return () => window.clearInterval(id);
  }, [engine, bg]);

  // Every frame: tell the background where the Liquid Glass chrome sits so it lenses itself there.
  const panels = useRef<GlassPanel[]>([]);
  useFrame((_, dt) => {
    if (!engine) return;
    engine.setGlass(collectGlassPanels(panels.current));
    engine.update(Math.min(dt, 0.1));
  });
  return engine ? <primitive object={engine.mesh} /> : null;
}

function Objects() {
  const objects = useStore((s) => s.objects);
  const order = useStore((s) => s.order);
  return (
    <>
      {objects.map((placed, i) => {
        const def = OBJECTS.find((d) => d.kind === placed.kind);
        if (!def) return null;
        const rank = Math.max(0, order.indexOf(placed.id));
        return <ObjectNode key={placed.id} def={def} placed={placed} rank={rank} count={objects.length} index={i} />;
      })}
    </>
  );
}

function Controller() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const ctrl = useMemo(
    () => new InteractionController(gl.domElement, camera as THREE.PerspectiveCamera),
    [gl, camera],
  );
  useEffect(() => {
    ctrl.attach();
    // Test hook (dev builds only): lets automated checks find gizmo geometry.
    if (import.meta.env.DEV) (window as unknown as { __gizmo?: unknown }).__gizmo = gizmoFrame;
    return () => ctrl.detach();
  }, [ctrl]);
  useFrame(() => ctrl.update());
  return null;
}

export function Stage() {
  return (
    <Canvas
      className="stage"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: CAMERA_FOV, position: [0, 0, CAMERA_Z], near: 0.1, far: 60 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1;
        gl.setClearColor('#0b0b0d', 1);
      }}
    >
      <FrameSync />
      <StudioLighting />
      <Background />
      <Objects />
      <Controller />
    </Canvas>
  );
}
