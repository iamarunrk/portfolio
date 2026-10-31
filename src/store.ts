import { create } from 'zustand';
import type { BaseLayer, BgConfig, Effects, MaterialLayer } from './bg/types';
import { DEFAULT_BG } from './bg/presets';
import type { ObjectKind } from './objects/types';

/** Quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

/**
 * Where an object sits on the canvas, independent of screen size:
 * nx/ny are -1..1 across the visible frame (x right, y up), s multiplies the
 * object's responsive base size (1 = default).
 */
export interface Transform {
  nx: number;
  ny: number;
  q: Quat;
  s: number;
}

export interface PlacedObject {
  id: string;
  kind: ObjectKind;
  /** null = follow the responsive default layout (until the visitor moves it). */
  t: Transform | null;
}

/** Hero title frame placement, same normalised space. null = default responsive spot. */
export interface TitleFrame {
  nx: number;
  ny: number;
  s: number;
}

/** Object id, 'title', or null. */
export type SelectionId = string | null;

export type Ink = 'light' | 'dark';

export const OBJECT_ORDER: ObjectKind[] = ['can', 'pedal', 'jar', 'chips', 'terminal'];

const STORAGE_KEY = 'once-upon-a-time:v1';

interface Persisted {
  v: 1;
  bg: BgConfig;
  objects: PlacedObject[];
  title: TitleFrame | null;
  order?: string[];
}

export interface AppState {
  bg: BgConfig;
  objects: PlacedObject[];
  title: TitleFrame | null;
  /** Stacking order of objects, back to front (like layers in a design tool). */
  order: string[];
  selected: SelectionId;
  hovered: SelectionId;
  /** Headline / chrome ink that reads best on the current background. */
  ink: Ink;
  /** True once the visitor changed anything (drives the "Edited" badge). */
  edited: boolean;
  /** Hide all chrome for a clean look/screenshot. */
  uiHidden: boolean;
  /** Which island tab is open (null = collapsed). */
  islandTab: IslandTab | null;

  setBg(cfg: BgConfig): void;
  setBase(base: BaseLayer): void;
  patchBase(p: Partial<BaseLayer>): void;
  setMaterial(m: MaterialLayer): void;
  patchMaterial(p: Partial<MaterialLayer>): void;
  patchFx(p: Partial<Effects>): void;
  select(id: SelectionId): void;
  hover(id: SelectionId): void;
  commitTransform(id: string, t: Transform): void;
  resetObject(id: string): void;
  bringToFront(id: string): void;
  setTitle(t: TitleFrame | null): void;
  setInk(ink: Ink): void;
  setUiHidden(v: boolean): void;
  setIslandTab(tab: IslandTab | null): void;
  resetAll(): void;
}

export type IslandTab = 'shaders' | 'gradients' | 'colors' | 'glass' | 'effects';

const cloneBg = (bg: BgConfig): BgConfig => ({
  base: { ...bg.base, colors: [...bg.base.colors] as BaseLayer['colors'] },
  material: { ...bg.material },
  fx: { ...bg.fx },
});

const defaultObjects = (): PlacedObject[] => OBJECT_ORDER.map((kind) => ({ id: kind, kind, t: null }));

function loadPersisted(): Partial<Persisted> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Persisted>;
    if (data.v !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

function sanitizeBg(bg: BgConfig | undefined): BgConfig {
  const d = cloneBg(DEFAULT_BG);
  if (!bg || typeof bg !== 'object') return d;
  return {
    base: { ...d.base, ...(bg.base ?? {}), colors: (bg.base?.colors?.length === 4 ? [...bg.base.colors] : d.base.colors) as BaseLayer['colors'] },
    material: { ...d.material, ...(bg.material ?? {}) },
    fx: { ...d.fx, ...(bg.fx ?? {}) },
  };
}

function sanitizeObjects(list: PlacedObject[] | undefined): PlacedObject[] {
  const defaults = defaultObjects();
  if (!Array.isArray(list)) return defaults;
  return defaults.map((d) => {
    const saved = list.find((o) => o && o.id === d.id);
    const t = saved?.t;
    const valid =
      t &&
      Number.isFinite(t.nx) &&
      Number.isFinite(t.ny) &&
      Number.isFinite(t.s) &&
      Array.isArray(t.q) &&
      t.q.length === 4 &&
      t.q.every(Number.isFinite);
    return { ...d, t: valid ? t : null };
  });
}

function sanitizeOrder(order: string[] | undefined): string[] {
  const ids = OBJECT_ORDER as string[];
  if (!Array.isArray(order)) return [...ids];
  const kept = order.filter((id) => ids.includes(id));
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
}

const persisted = typeof window !== 'undefined' ? loadPersisted() : null;

export const useStore = create<AppState>()((set) => ({
  bg: sanitizeBg(persisted?.bg),
  objects: sanitizeObjects(persisted?.objects),
  title: persisted?.title && Number.isFinite(persisted.title.nx) ? persisted.title : null,
  order: sanitizeOrder(persisted?.order),
  selected: null,
  hovered: null,
  ink: 'light',
  edited: !!persisted,
  uiHidden: false,
  islandTab: null,

  setBg: (cfg) => set({ bg: cloneBg(cfg), edited: true }),
  setBase: (base) => set((s) => ({ bg: { ...s.bg, base: { ...base, colors: [...base.colors] as BaseLayer['colors'] } }, edited: true })),
  patchBase: (p) => set((s) => ({ bg: { ...s.bg, base: { ...s.bg.base, ...p } }, edited: true })),
  setMaterial: (m) => set((s) => ({ bg: { ...s.bg, material: { ...m } }, edited: true })),
  patchMaterial: (p) => set((s) => ({ bg: { ...s.bg, material: { ...s.bg.material, ...p } }, edited: true })),
  patchFx: (p) => set((s) => ({ bg: { ...s.bg, fx: { ...s.bg.fx, ...p } }, edited: true })),
  select: (id) => set({ selected: id }),
  hover: (id) => set({ hovered: id }),
  commitTransform: (id, t) =>
    set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, t: { ...t, q: [...t.q] as Quat } } : o)), edited: true })),
  resetObject: (id) => set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, t: null } : o)), edited: true })),
  bringToFront: (id) =>
    set((s) => (s.order[s.order.length - 1] === id ? {} : { order: [...s.order.filter((o) => o !== id), id] })),
  setTitle: (t) => set({ title: t, edited: true }),
  setInk: (ink) => set({ ink }),
  setUiHidden: (v) => set({ uiHidden: v }),
  setIslandTab: (tab) => set({ islandTab: tab }),
  resetAll: () =>
    set({
      bg: cloneBg(DEFAULT_BG),
      objects: defaultObjects(),
      title: null,
      order: [...OBJECT_ORDER],
      selected: null,
      edited: false,
      islandTab: null,
    }),
}));

// Persist the visitor's remix locally (debounced). Storage can be unavailable
// (private mode, sandboxed iframes), so every access is guarded.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.bg === prev.bg && s.objects === prev.objects && s.title === prev.title && s.order === prev.order) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!s.edited) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const data: Persisted = { v: 1, bg: s.bg, objects: s.objects, title: s.title, order: s.order };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable: the remix just won't survive a reload */
    }
  }, 400);
});
