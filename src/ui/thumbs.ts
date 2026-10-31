import { useEffect, useRef, useState, type RefObject } from 'react';
import type { BaseLayer, BgConfig } from '../bg/types';
import { BASE_META } from '../bg/meta';
import { engineRef, onEngine } from '../scene/engineRef';

/**
 * Thumbnail queue + cache for background swatches.
 *
 * - Thumbnails come only from the live engine (`engineRef.current.renderThumbnail`).
 * - At most ONE thumbnail renders per animation frame, so opening a panel with
 *   twenty swatches never blocks the main render for more than one small draw.
 * - Results are cached by the JSON of the exact config + size (LRU), so swatches
 *   re-open instantly and duplicate requests share one render.
 * - Requests wait while the engine is not ready and flush once it appears.
 */

type Listener = (url: string) => void;

interface Job {
  key: string;
  cfg: BgConfig;
  w: number;
  h: number;
  time: number | undefined;
  priority: number;
  seq: number;
  listeners: Set<Listener>;
}

const MAX_CACHE = 200;
const cache = new Map<string, string>();
const failed = new Set<string>();
const jobs = new Map<string, Job>();
let seq = 0;
let raf = 0;

export function thumbKey(cfg: BgConfig, w: number, h: number, time?: number): string {
  return JSON.stringify([w, h, time ?? null, cfg]);
}

export function peekThumb(key: string): string | undefined {
  return cache.get(key);
}

function remember(key: string, url: string) {
  cache.delete(key);
  cache.set(key, url);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface ThumbRequestOptions {
  /** Higher renders first. Ties render in request order. */
  priority?: number;
  /** Shader time in seconds (engine default when omitted). */
  time?: number;
}

/** Queue a thumbnail; `listener` fires once with the data URL. Returns a cancel function. */
export function requestThumb(cfg: BgConfig, w: number, h: number, listener: Listener, opts: ThumbRequestOptions = {}): () => void {
  const key = thumbKey(cfg, w, h, opts.time);
  const hit = cache.get(key);
  if (hit !== undefined) {
    remember(key, hit);
    listener(hit);
    return () => {};
  }
  if (failed.has(key)) return () => {};
  const priority = opts.priority ?? 0;
  let job = jobs.get(key);
  if (!job) {
    job = { key, cfg, w, h, time: opts.time, priority, seq: seq++, listeners: new Set() };
    jobs.set(key, job);
  } else if (priority > job.priority) {
    job.priority = priority;
  }
  job.listeners.add(listener);
  schedule();
  const owned = job;
  return () => {
    owned.listeners.delete(listener);
    if (owned.listeners.size === 0 && jobs.get(key) === owned) jobs.delete(key);
  };
}

function schedule() {
  if (raf || jobs.size === 0 || !engineRef.current || typeof requestAnimationFrame === 'undefined') return;
  raf = requestAnimationFrame(tick);
}

function tick() {
  raf = 0;
  const engine = engineRef.current;
  if (!engine) return; // onEngine() reschedules when it comes back
  let best: Job | undefined;
  for (const j of jobs.values()) {
    if (!best || j.priority > best.priority || (j.priority === best.priority && j.seq < best.seq)) best = j;
  }
  if (best) {
    jobs.delete(best.key);
    let url = '';
    try {
      url = engine.renderThumbnail(best.cfg, best.w, best.h, best.time);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[ui] thumbnail render failed', err);
    }
    if (url) {
      remember(best.key, url);
      best.listeners.forEach((l) => l(url));
    } else {
      failed.add(best.key);
    }
  }
  schedule();
}

if (typeof window !== 'undefined') {
  const off = onEngine((engine) => {
    if (!engine) return;
    failed.clear(); // a fresh engine (e.g. after context loss) may succeed where the old one failed
    schedule();
  });
  import.meta.hot?.dispose(() => {
    off();
    if (raf) cancelAnimationFrame(raf);
  });
}

export interface UseThumbOptions extends ThumbRequestOptions {
  /** Wait this long after the config changes before re-rendering (only for updates, not the first render). */
  debounce?: number;
  /** Lazy: nothing is requested while false (cached thumbs still show). */
  enabled?: boolean;
}

/**
 * React hook returning a data URL for `cfg`, or null until the first one arrives.
 * Stale-while-revalidate: when `cfg` changes, the previous image stays up until
 * the new one is ready, so swatches never flash back to their placeholder.
 */
export function useThumb(cfg: BgConfig | null, w: number, h: number, opts: UseThumbOptions = {}): string | null {
  const { debounce = 0, enabled = true, priority, time } = opts;
  const key = cfg ? thumbKey(cfg, w, h, time) : null;
  const [url, setUrl] = useState<string | null>(() => (key ? peekThumb(key) ?? null : null));
  const requestedOnce = useRef(false);
  const cfgRef = useRef(cfg);

  useEffect(() => {
    cfgRef.current = cfg;
  });

  useEffect(() => {
    if (!key) return;
    const hit = peekThumb(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    if (!enabled) return;
    let cancel = () => {};
    const run = () => {
      const c = cfgRef.current;
      if (!c) return;
      requestedOnce.current = true;
      cancel = requestThumb(c, w, h, setUrl, { priority, time });
    };
    if (debounce > 0 && requestedOnce.current) {
      const t = setTimeout(run, debounce);
      return () => {
        clearTimeout(t);
        cancel();
      };
    }
    run();
    return () => cancel();
  }, [key, enabled, debounce, priority, time, w, h]);

  return url;
}

/** Tracks whether `ref` is within `rootRef` (or the viewport), expanded by `margin`. */
export function useInView(ref: RefObject<Element | null>, rootRef?: RefObject<Element | null>, margin = '0px 160px'): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setInView(last.isIntersecting);
      },
      { root: rootRef?.current ?? null, rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootRef, margin]);
  return inView;
}

/* ------------------------------------------------------------------------ */
/* Placeholders: a CSS gradient built from the palette, shown until the real */
/* thumbnail arrives (and as the fallback when WebGL is unavailable).        */
/* ------------------------------------------------------------------------ */

const RADIAL_KINDS = new Set<string>(['radial', 'goo', 'holo']);
const CONIC_KINDS = new Set<string>(['conic', 'sunburst', 'swirl']);

export function paletteCss(base: BaseLayer): string {
  const count = BASE_META[base.kind]?.colorCount ?? 4;
  const cols = base.colors.slice(0, Math.max(1, count));
  if (base.kind === 'solid' || cols.length === 1) return cols[0];
  if (RADIAL_KINDS.has(base.kind)) return `radial-gradient(120% 120% at 30% 25%, ${cols.join(', ')})`;
  if (CONIC_KINDS.has(base.kind)) return `conic-gradient(from ${Math.round(base.angle)}deg at 50% 50%, ${[...cols, cols[0]].join(', ')})`;
  if (base.kind === 'mesh' || base.kind === 'aurora' || base.kind === 'flow') {
    const [a, b, c = a, d = b] = cols;
    return `radial-gradient(70% 70% at 20% 20%, ${a}, transparent 70%), radial-gradient(70% 70% at 85% 30%, ${b}, transparent 70%), radial-gradient(80% 80% at 30% 90%, ${c}, transparent 70%), ${d}`;
  }
  return `linear-gradient(${Math.round(135 + (base.angle || 0))}deg, ${cols.join(', ')})`;
}
