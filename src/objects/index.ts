import type { ObjectDef } from './types';
import { sodaCan } from './sodaCan';
import { pedal } from './pedal';
import { jar } from './jar';
import { chips } from './chips';
import { terminal } from './terminal';

/** The five collectibles, in display order. */
export const OBJECTS: ObjectDef[] = [sodaCan, pedal, jar, chips, terminal];

export type { ObjectDef, BuiltObject, ObjectBuildContext, ObjectKind } from './types';
