import * as THREE from 'three';
import type { BuiltObject } from './types';

/** Collects anything with a dispose() so a factory can free it all at once. */
export class Trash {
  private readonly items = new Set<{ dispose(): void }>();
  add<T extends { dispose(): void }>(x: T): T {
    this.items.add(x);
    return x;
  }
  dispose(): void {
    this.items.forEach((d) => d.dispose());
    this.items.clear();
  }
}

/** Every geometry, material and material texture referenced under `root`. */
export function collectDisposables(root: THREE.Object3D, into: Trash): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    into.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      into.add(m);
      for (const v of Object.values(m)) {
        if (v && typeof v === 'object' && (v as THREE.Texture).isTexture) into.add(v as THREE.Texture);
      }
    }
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) into.add(mesh as THREE.InstancedMesh);
  });
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();

/** World-space (relative to `inner`'s parent frame) vertex positions of all meshes. */
function forEachVertex(inner: THREE.Object3D, fn: (v: THREE.Vector3) => void): void {
  inner.updateMatrixWorld(true);
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
    const count = inst ? inst.count : 1;
    for (let k = 0; k < count; k++) {
      if (inst) {
        inst.getMatrixAt(k, _mi);
        _m.multiplyMatrices(mesh.matrixWorld, _mi);
      } else {
        _m.copy(mesh.matrixWorld);
      }
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
        fn(_v);
      }
    }
  });
}

/**
 * Wrap `inner` in a root group so the bounding sphere (box centre, farthest vertex)
 * sits at the origin with radius 1. Returns the root and the measured radius.
 */
export function normalise(inner: THREE.Group): { root: THREE.Group; radius: number } {
  const root = new THREE.Group();
  inner.position.set(0, 0, 0);
  inner.scale.setScalar(1);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3();
  forEachVertex(inner, (v) => box.expandByPoint(v));
  const c = box.getCenter(new THREE.Vector3());
  let r2 = 0;
  forEachVertex(inner, (v) => {
    r2 = Math.max(r2, v.distanceToSquared(c));
  });
  const r = Math.sqrt(r2) || 1;
  const s = 1 / r;
  inner.scale.setScalar(s);
  inner.position.copy(c).multiplyScalar(-s);
  root.add(inner);
  root.updateMatrixWorld(true);
  // measure again in the normalised frame
  let rr = 0;
  forEachVertex(root, (v) => {
    rr = Math.max(rr, v.length());
  });
  return { root, radius: rr };
}

/** Standard tail of every factory: normalise, gather disposables. */
export function finish(
  inner: THREE.Group,
  trash: Trash,
  update?: (t: number, dt: number) => void,
  name?: string,
): BuiltObject {
  const { root, radius } = normalise(inner);
  if (name) root.name = name;
  collectDisposables(root, trash);
  return {
    root,
    radius,
    update,
    dispose: () => trash.dispose(),
  };
}
