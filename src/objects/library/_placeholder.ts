import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Trash, finish } from '../build';
import { Surface } from '../textures';
import { FONTS, text, smallPrint } from '../paint';
import { glossyPlastic } from '../materials';
import type { LibraryCategory, LibraryDef } from './types';

/** Stand-in used while an object is still being modelled: a lime block with its name printed on it. */
export function placeholder(kind: string, name: string, tagline: string, category: LibraryCategory): LibraryDef {
  return {
    kind,
    name,
    tagline,
    category,
    defaultRotation: [0.28, -0.55, 0],
    build: (bctx) => {
      const trash = new Trash();
      const inner = new THREE.Group();
      const s = new Surface(512, 512, bctx);
      s.c.fillStyle = '#d7ff3a';
      s.c.fillRect(0, 0, 512, 512);
      text(s.c, name, 256, 270, { size: 72, family: FONTS.archivoBlack, align: 'center', color: '#111', maxWidth: 440 });
      smallPrint(s.c, ['coming soon'], 256, 310, 30, '#111', { align: 'center', weight: 700 });
      const mat = glossyPlastic('#ffffff', { map: s.colorTexture() });
      inner.add(new THREE.Mesh(new RoundedBoxGeometry(1.4, 1.4, 1.4, 4, 0.2), mat));
      return finish(inner, trash, undefined, kind);
    },
  };
}
