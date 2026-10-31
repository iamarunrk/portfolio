import * as THREE from 'three';
import { create } from 'zustand';
import { computeFrame, depthFactor, type CanvasFrame } from '../layout';
import type { BuiltObject, ObjectKind } from '../objects/types';

/** Current canvas frame (viewport mapped to world units). Updated by the Stage on resize. */
export const useFrameStore = create<{ frame: CanvasFrame; setFrame: (f: CanvasFrame) => void }>()((set) => ({
  frame: computeFrame(typeof window !== 'undefined' ? window.innerWidth : 1440, typeof window !== 'undefined' ? window.innerHeight : 900),
  setFrame: (frame) => set({ frame }),
}));

export const frameRef = { get current() { return useFrameStore.getState().frame; } };

export interface PoseState {
  nx: number;
  ny: number;
  s: number;
  q: THREE.Quaternion;
  z: number;
}

/**
 * Mutable per-object state shared between the scene (rendering/animation) and
 * the interaction controller. Kept outside React so drags never re-render.
 */
export interface LiveObject {
  id: string;
  kind: ObjectKind;
  name: string;
  tagline: string;
  outer: THREE.Group;
  inner: THREE.Group;
  built: BuiltObject | null;
  /** What is rendered right now. */
  cur: PoseState;
  /** Where it is heading (eased towards unless `dragging`). */
  tgt: PoseState;
  dragging: boolean;
  /** 0..1 eased amounts. */
  floatAmp: number;
  hover: number;
  /** 1 while the pointer hovers it (set by the controller), eased into `hover`. */
  hoverTarget: number;
  appear: number;
  /** Seconds since the object finished building (-1 = not yet). */
  age: number;
  phase: number;
  /** Remaining playful spin (radians) from a double-tap, eased out. */
  spin: number;
}

export const registry = new Map<string, LiveObject>();

/** World-space centre and radius of an object's bounding sphere. */
export function worldSphere(o: LiveObject, out: THREE.Sphere): THREE.Sphere {
  out.center.copy(o.outer.position);
  out.radius = (o.built?.radius ?? 1) * o.outer.scale.x;
  return out;
}

/** Position/scale an object's outer group from its current pose. */
export function applyPose(o: LiveObject, frame: CanvasFrame) {
  const df = depthFactor(o.cur.z);
  o.outer.position.set(o.cur.nx * frame.halfW * df, o.cur.ny * frame.halfH * df, o.cur.z);
  o.outer.quaternion.copy(o.cur.q);
  o.outer.scale.setScalar(Math.max(1e-4, frame.unit * o.cur.s * df));
}
