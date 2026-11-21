import { useLayoutEffect, type RefObject } from 'react';
import { useStore } from '../store';
import { themeTokens, type ThemeTokens } from './tokens';

/**
 * Keeps the theme echo live: whenever the homepage background (or the ink it reads with) changes,
 * the derived tokens are written as CSS custom properties on the app root, and imperative parts
 * (the board's WebGL toys) are told the new floor colour.
 */

type Listener = (t: ThemeTokens) => void;
const listeners = new Set<Listener>();
let current: ThemeTokens | null = null;

/** The latest tokens (null until the app has mounted). */
export const currentTheme = () => current;

/** Subscribe to theme changes; fires right away when tokens already exist. */
export function onTheme(fn: Listener): () => void {
  listeners.add(fn);
  if (current) fn(current);
  return () => listeners.delete(fn);
}

function apply(el: HTMLElement, t: ThemeTokens) {
  for (const [k, v] of Object.entries(t.vars)) el.style.setProperty(k, v);
  el.dataset.theme = t.light ? 'light' : 'dark';
  current = t;
  listeners.forEach((fn) => fn(t));
}

/** Mount once, on the app root. */
export function useThemeEcho(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let last = '';
    const run = () => {
      raf = 0;
      const s = useStore.getState();
      const key = JSON.stringify([s.bg, s.ink]);
      if (key === last) return;
      last = key;
      apply(el, themeTokens(s.bg, s.ink));
    };
    run();
    // slider drags change the background every frame: recompute at most once per frame
    const off = useStore.subscribe((s, prev) => {
      if (s.bg === prev.bg && s.ink === prev.ink) return;
      if (!raf) raf = requestAnimationFrame(run);
    });
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}
