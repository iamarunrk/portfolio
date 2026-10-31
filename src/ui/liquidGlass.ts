import { useCallback, useEffect, type RefObject } from 'react';
import type { GlassPanel } from '../bg/BackgroundEngine';
import { engineRef } from '../scene/engineRef';

/**
 * Liquid Glass for the canvas chrome.
 *
 * The refraction itself is drawn by the WebGL background (so it works in every browser, Safari
 * included): each registered element reports its on-screen box every frame and the background's
 * material pass lenses itself inside that rounded shape. CSS on top adds the tint, the specular
 * rim, depth shadows and a light frost.
 *
 * The registry also keeps each panel's tone honest: it measures how bright the background behind
 * the panel really is and sets `data-tone="light" | "dark"`, so the glass turns milky with dark
 * glyphs over light content and smoky with light glyphs over dark content, like iOS.
 */

export interface GlassOptions {
  /** Refraction strength 0..1 (default 1). */
  strength?: number;
  /** Width of the curved rim in CSS px (default from size and radius). */
  bezel?: number;
  /** Pick light/dark glass from the background behind it (default true). */
  adaptive?: boolean;
}

type Tone = 'light' | 'dark';

interface Entry {
  el: HTMLElement;
  opts: GlassOptions;
  radius: number;
  radiusDirty: boolean;
  tone: Tone | null;
}

const entries = new Set<Entry>();

// Hysteresis so a panel never flickers between tones on mid-grey content.
const TO_LIGHT = 0.63;
const TO_DARK = 0.53;

export function registerGlass(el: HTMLElement, opts: GlassOptions = {}): () => void {
  const entry: Entry = { el, opts, radius: 0, radiusDirty: true, tone: null };
  entries.add(entry);
  el.dataset.glass = '';

  // Light follows the pointer across the glass, like touching iOS Liquid Glass.
  const onMove = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    el.style.setProperty('--lg-x', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty('--lg-y', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  };
  const onEnter = () => el.style.setProperty('--lg-glow', '1');
  const onLeave = () => el.style.setProperty('--lg-glow', '0');
  el.addEventListener('pointermove', onMove, { passive: true });
  el.addEventListener('pointerenter', onEnter, { passive: true });
  el.addEventListener('pointerleave', onLeave, { passive: true });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => (entry.radiusDirty = true)) : null;
  ro?.observe(el);
  queueToneUpdate();

  return () => {
    entries.delete(entry);
    ro?.disconnect();
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointerleave', onLeave);
    delete el.dataset.glass;
  };
}

/** Registers the element behind `ref` as a Liquid Glass panel while mounted. */
export function useLiquidGlass(ref: RefObject<HTMLElement | null>, opts?: GlassOptions) {
  const strength = opts?.strength;
  const bezel = opts?.bezel;
  const adaptive = opts?.adaptive;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerGlass(el, { strength, bezel, adaptive });
  }, [ref, strength, bezel, adaptive]);
}

/** Callback-ref variant for elements that mount and unmount (React 19 ref cleanup). */
export function useGlassRef<T extends HTMLElement>(opts?: GlassOptions) {
  const strength = opts?.strength;
  const bezel = opts?.bezel;
  const adaptive = opts?.adaptive;
  return useCallback(
    (el: T | null) => {
      if (!el) return;
      return registerGlass(el, { strength, bezel, adaptive });
    },
    [strength, bezel, adaptive],
  );
}

/**
 * Current on-screen boxes of every visible glass panel (reused `out` array, no allocation churn
 * beyond the panel objects). Called once per frame by the stage, right before rendering.
 */
export function collectGlassPanels(out: GlassPanel[]): GlassPanel[] {
  out.length = 0;
  for (const e of entries) {
    const el = e.el;
    if (!el.isConnected) continue;
    const cs = getComputedStyle(el);
    const opacity = parseFloat(cs.opacity);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !(opacity > 0.01)) continue;
    if (e.radiusDirty) {
      e.radius = parseFloat(cs.borderTopLeftRadius) || 0;
      e.radiusDirty = false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // A CSS scale (press, show/hide) shrinks the corners too.
    const k = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
    out.push({
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
      radius: e.radius * k,
      strength: (e.opts.strength ?? 1) * Math.min(1, opacity),
      bezel: e.opts.bezel,
    });
  }
  return out;
}

let toneTimer: ReturnType<typeof setTimeout> | undefined;

/** Re-measure the background behind every adaptive panel soon (debounced). */
export function queueToneUpdate(delay = 140) {
  clearTimeout(toneTimer);
  toneTimer = setTimeout(updateGlassTones, delay);
}

/** Measure the background under each adaptive panel and flip its tone with hysteresis. */
export function updateGlassTones() {
  const engine = engineRef.current;
  if (!engine) return;
  const list: Entry[] = [];
  const regions: { x: number; y: number; w: number; h: number }[] = [];
  for (const e of entries) {
    if (e.opts.adaptive === false || !e.el.isConnected) continue;
    const r = e.el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    list.push(e);
    regions.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  if (!list.length) return;
  let stats: { mean: number; low: number; high: number }[];
  try {
    stats = engine.sampleRegionLuminance(regions);
  } catch {
    return;
  }
  list.forEach((e, i) => {
    const { mean: L, low, high } = stats[i];
    // How much contrast sits behind the glyphs drives how much the glass dims or milks (CSS).
    e.el.style.setProperty('--lg-low', low.toFixed(3));
    e.el.style.setProperty('--lg-high', high.toFixed(3));
    let tone: Tone = e.tone ?? (L > (TO_LIGHT + TO_DARK) / 2 ? 'light' : 'dark');
    if (e.tone === 'dark' && L > TO_LIGHT) tone = 'light';
    if (e.tone === 'light' && L < TO_DARK) tone = 'dark';
    if (tone !== e.tone) {
      e.tone = tone;
      e.el.dataset.tone = tone;
    }
  });
}
