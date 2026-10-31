import type * as THREE from 'three';

/** Identifiers of the collectible 3D objects. Add new kinds here when adding objects. */
export type ObjectKind = 'can' | 'pedal' | 'jar' | 'chips' | 'terminal';

export interface ObjectBuildContext {
  renderer: THREE.WebGLRenderer;
  /** Multiply every canvas-texture dimension by this (1 on desktop, ~0.7 on phones). */
  textureScale: number;
  /** renderer.capabilities.getMaxAnisotropy(), pre-read for convenience. */
  maxAnisotropy: number;
}

export interface BuiltObject {
  /**
   * The object, centred so its bounding sphere is at the origin with radius ~1.0
   * (normalise inside the factory). +Y is up and the "hero" side faces +Z
   * (towards the camera) when rotation is zero.
   */
  root: THREE.Group;
  /** Bounding-sphere radius of `root` in its own units (≈ 1.0 after normalising). */
  radius: number;
  /** Optional per-frame animation (blinking LEDs, a typing screen...). `t` in seconds. */
  update?: (t: number, dt: number) => void;
  /** Free geometries, materials and textures created by the factory. */
  dispose: () => void;
}

export interface ObjectDef {
  kind: ObjectKind;
  /** Display name, e.g. "Zeros Soda". */
  name: string;
  /** One-liner shown in the selection pill, e.g. "founder fuel, 0 sugar". */
  tagline: string;
  /** Euler XYZ (radians) giving a pleasing 3/4 hero pose against a straight-on camera. */
  defaultRotation: [number, number, number];
  build: (ctx: ObjectBuildContext) => BuiltObject;
}
