import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ensureFonts, fontsLoaded, whenFontsLoaded } from '../fonts';
import { defaultSlot, layerZ, type CanvasFrame } from '../layout';
import type { BuiltObject, ObjectDef } from '../objects/types';
import { useStore, type PlacedObject } from '../store';
import { applyPose, registry, useFrameStore, type LiveObject, type PoseState } from './registry';

const TAU = Math.PI * 2;

// Builds are CPU-heavy (canvas painting + geometry), so run one per animation frame.
const buildQueue: (() => void)[] = [];
let draining = false;
function enqueueBuild(job: () => void) {
  buildQueue.push(job);
  if (draining) return;
  draining = true;
  const step = () => {
    const next = buildQueue.shift();
    if (!next) {
      draining = false;
      return;
    }
    try {
      next();
    } catch (err) {
      console.error('[objects] build failed', err);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const easeOutBack = (x: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

function poseFor(def: ObjectDef, placed: PlacedObject, frame: CanvasFrame): Omit<PoseState, 'z'> {
  if (placed.t) {
    const t = placed.t;
    return { nx: t.nx, ny: t.ny, s: t.s, q: new THREE.Quaternion(t.q[0], t.q[1], t.q[2], t.q[3]).normalize() };
  }
  const slot = defaultSlot(def.kind, frame);
  const r = def.defaultRotation;
  const tilt = slot.tilt ?? [0, 0, 0];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] + tilt[0], r[1] + tilt[1], r[2] + tilt[2], 'XYZ'));
  return { nx: slot.nx, ny: slot.ny, s: slot.s, q };
}

interface Props {
  def: ObjectDef;
  placed: PlacedObject;
  rank: number;
  count: number;
  index: number;
}

export function ObjectNode({ def, placed, rank, count, index }: Props) {
  const gl = useThree((s) => s.gl);
  const frame = useFrameStore((s) => s.frame);
  const initialized = useRef(false);
  const spinAngle = useRef(0);

  const live = useMemo<LiveObject>(() => {
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    outer.name = `object:${placed.id}`;
    outer.add(inner);
    const mk = (): PoseState => ({ nx: 0, ny: 0, s: 1, q: new THREE.Quaternion(), z: 0 });
    return {
      id: placed.id,
      kind: def.kind,
      name: def.name,
      tagline: def.tagline,
      outer,
      inner,
      built: null,
      cur: mk(),
      tgt: mk(),
      dragging: false,
      floatAmp: 1,
      hover: 0,
      hoverTarget: 0,
      appear: 0,
      age: -1,
      phase: index * 1.37 + 0.4,
      spin: 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed.id]);

  // Register for the interaction controller.
  useEffect(() => {
    registry.set(live.id, live);
    return () => {
      registry.delete(live.id);
    };
  }, [live]);

  // Build the 3D object once fonts are ready (stickers bake text into textures).
  // If the font CDN was slow and we built with fallback faces, rebuild once they land.
  useEffect(() => {
    let cancelled = false;
    let built: BuiltObject | null = null;
    const small = Math.min(window.innerWidth, window.innerHeight) < 640;
    const build = () => {
      if (cancelled) return;
      const next = def.build({
        renderer: gl,
        textureScale: small ? 0.7 : 1,
        maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
      });
      if (built) {
        live.inner.remove(built.root);
        built.dispose();
      } else {
        live.age = 0;
      }
      built = next;
      live.inner.add(next.root);
      live.built = next;
    };
    ensureFonts().then(() => {
      if (cancelled) return;
      const hadFonts = fontsLoaded();
      enqueueBuild(build);
      if (!hadFonts) whenFontsLoaded().then(() => !cancelled && enqueueBuild(build));
    });
    return () => {
      cancelled = true;
      if (built) {
        live.inner.remove(built.root);
        built.dispose();
      }
      live.built = null;
      live.age = -1;
      live.appear = 0;
    };
  }, [def, gl, live]);

  // Follow the persisted transform, or the responsive default layout.
  useEffect(() => {
    if (live.dragging) return;
    const p = poseFor(def, placed, frame);
    live.tgt.nx = p.nx;
    live.tgt.ny = p.ny;
    live.tgt.s = p.s;
    live.tgt.q.copy(p.q);
    if (!initialized.current) {
      live.cur.nx = p.nx;
      live.cur.ny = p.ny;
      live.cur.s = p.s;
      live.cur.q.copy(p.q);
    }
  }, [def, placed, frame, live]);

  useEffect(() => {
    live.tgt.z = layerZ(rank, count);
    if (!initialized.current) {
      live.cur.z = live.tgt.z;
      initialized.current = true;
    }
  }, [rank, count, live]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const t = state.clock.elapsedTime;
    const f = useFrameStore.getState().frame;
    const { cur, tgt } = live;

    if (!live.dragging) {
      const k = 1 - Math.exp(-dt * 9);
      cur.nx += (tgt.nx - cur.nx) * k;
      cur.ny += (tgt.ny - cur.ny) * k;
      cur.s += (tgt.s - cur.s) * k;
      cur.q.slerp(tgt.q, k);
    }
    cur.z += (tgt.z - cur.z) * (1 - Math.exp(-dt * 7));
    applyPose(live, f);

    // Entrance: staggered pop + spin-in.
    let appearScale = 0;
    let appearSpin = 0;
    if (live.built && live.age >= 0) {
      live.age += dt;
      const p = THREE.MathUtils.clamp((live.age - index * 0.11) / 0.95, 0, 1);
      live.appear = p;
      appearScale = easeOutBack(p);
      appearSpin = (1 - easeOutCubic(p)) * -1.6;
    }

    const selected = useStore.getState().selected === live.id;
    const floatTarget = selected || live.dragging ? 0 : 1;
    live.floatAmp += (floatTarget - live.floatAmp) * (1 - Math.exp(-dt * 4));
    live.hover += (live.hoverTarget - live.hover) * (1 - Math.exp(-dt * 14));

    if (live.spin > 1e-3) {
      const step = live.spin * (1 - Math.exp(-dt * 4.5));
      live.spin -= step;
      spinAngle.current = (spinAngle.current + step) % TAU;
    } else if (live.spin !== 0) {
      spinAngle.current = 0;
      live.spin = 0;
    }

    const a = live.floatAmp;
    const ph = live.phase;
    live.inner.position.set(0, Math.sin(t * 0.9 + ph) * 0.07 * a, 0);
    live.inner.rotation.set(
      Math.sin(t * 0.62 + ph) * 0.06 * a,
      Math.sin(t * 0.41 + ph * 1.3) * 0.12 * a + spinAngle.current + appearSpin,
      Math.sin(t * 0.53 + ph * 0.7) * 0.05 * a,
    );
    live.inner.scale.setScalar(Math.max(1e-4, appearScale * (1 + 0.04 * live.hover)));
    live.outer.visible = appearScale > 0.001;

    live.built?.update?.(t, dt);
  });

  return <primitive object={live.outer} />;
}
