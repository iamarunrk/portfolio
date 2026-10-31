import type { LibraryDef } from './types';
import { cassette } from './cassette';
import { figma } from './figma';
import { burger } from './burger';
import { camera } from './camera';
import { handheld } from './handheld';
import { pizza } from './pizza';
import { paintbox } from './paintbox';
import { imac } from './imac';
import { biryani } from './biryani';
import { parcel } from './parcel';
import { harddrive } from './harddrive';
import { chai } from './chai';
import { swatches } from './swatches';
import { cardreader } from './cardreader';
import { fries } from './fries';
import { desktop } from './desktop';
import { noodles } from './noodles';
import { rocket } from './rocket';

/**
 * Every shelf collectible (built, but not on the hero canvas), in showcase order.
 * /showcase.html and /dev/library.html lazy-load the files one by one instead of importing
 * this list, so a half-finished object can never blank the whole page.
 */
export const LIBRARY: LibraryDef[] = [cassette, figma, burger, camera, handheld, pizza, paintbox, imac, biryani, parcel, harddrive, chai, swatches, cardreader, fries, desktop, noodles, rocket];

export { LIBRARY_ORDER } from './order';
export { CATEGORY_LABEL, asObjectDef } from './types';
export type { LibraryDef, LibraryCategory } from './types';
