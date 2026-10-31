import * as THREE from 'three';
import type { ObjectBuildContext, ObjectDef } from './types';
import { Trash, finish } from './build';

function build(_b: ObjectBuildContext) {
  const trash = new Trash();
  const inner = new THREE.Group();
  inner.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#888' })));
  return finish(inner, trash);
}

export const chips: ObjectDef = {
  kind: 'chips',
  name: 'chips',
  tagline: 'todo',
  defaultRotation: [0, 0, 0],
  build,
};
