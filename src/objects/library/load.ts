import type { LibraryDef } from './types';
import { LIBRARY_ORDER } from './order';

/**
 * Lazy, per-file loading of the shelf objects. Each object is its own module, so a page can
 * show cards before any heavy code runs, and an object that fails to compile or build only
 * takes its own card down. `index.ts` (the static list) is for code that wants them all.
 */
const modules = import.meta.glob<{ default?: LibraryDef }>([
  './*.ts',
  '!./_*.ts',
  '!./index.ts',
  '!./types.ts',
  '!./order.ts',
  '!./load.ts',
]);

const kindOf = (path: string) => path.replace(/^\.\//, '').replace(/\.ts$/, '');

/** Every shelf kind: LIBRARY_ORDER first, then any other object file alphabetically. */
export function libraryKinds(): string[] {
  const files = Object.keys(modules).map(kindOf);
  const listed = LIBRARY_ORDER.filter((k) => files.includes(k));
  const extra = files.filter((k) => !LIBRARY_ORDER.includes(k)).sort();
  return [...listed, ...extra];
}

/** Import one object module and return its definition (its default export). */
export async function loadLibraryDef(kind: string): Promise<LibraryDef> {
  const loader = modules[`./${kind}.ts`];
  if (!loader) throw new Error(`no shelf object file for "${kind}"`);
  const mod = await loader();
  const def = mod.default;
  if (!def || typeof def.build !== 'function') throw new Error(`${kind}.ts has no default-exported LibraryDef`);
  return def;
}
