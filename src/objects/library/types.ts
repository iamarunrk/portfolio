import type { BuiltObject, ObjectBuildContext, ObjectDef, ObjectKind } from '../types';

/**
 * The shelf: extra collectibles that are modelled and ready but NOT placed on the hero
 * canvas. They live in this folder (one file each, file name = kind) and are shown on
 * /showcase.html. They follow exactly the same build contract as the hero toys
 * (`ObjectDef` in ../types.ts), so promoting one to the site is only registration work
 * (see "Promoting a shelf object" in the README).
 */
export type LibraryCategory = 'tech' | 'food' | 'studio' | 'founder';

export interface LibraryDef {
  /** Unique id, identical to the file name (`cassette` for cassette.ts). Becomes the ObjectKind if promoted. */
  kind: string;
  /** Display name, e.g. "Mixtape Vol. 0". */
  name: string;
  /** One-liner, e.g. "side A: design, side B: ship". */
  tagline: string;
  category: LibraryCategory;
  /** Euler XYZ (radians) giving a pleasing 3/4 hero pose against a straight-on camera. */
  defaultRotation: [number, number, number];
  /** Same contract as ObjectDef.build: a group normalised to a bounding sphere of radius ~1, hero side facing +Z. */
  build: (ctx: ObjectBuildContext) => BuiltObject;
}

export const CATEGORY_LABEL: Record<LibraryCategory, string> = {
  tech: 'Tech',
  food: 'Food',
  studio: 'Studio',
  founder: 'Founder kit',
};

/**
 * Promote a shelf object to the hero canvas: once its kind is part of `ObjectKind`,
 * `OBJECTS.push(asObjectDef(cassette, 'cassette'))` (see README, "Promoting a shelf toy").
 */
export function asObjectDef(def: LibraryDef, kind: ObjectKind): ObjectDef {
  return { kind, name: def.name, tagline: def.tagline, defaultRotation: def.defaultRotation, build: def.build };
}
