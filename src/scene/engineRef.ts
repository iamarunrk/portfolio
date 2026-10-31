import type { BackgroundEngine } from '../bg/BackgroundEngine';

/**
 * The live background engine, created inside the WebGL canvas. UI code uses it
 * for swatch thumbnails and luminance sampling. Null until the canvas mounts.
 */
export const engineRef: { current: BackgroundEngine | null } = { current: null };

type Listener = (engine: BackgroundEngine | null) => void;
const listeners = new Set<Listener>();

export function setEngine(engine: BackgroundEngine | null) {
  engineRef.current = engine;
  listeners.forEach((l) => l(engine));
}

/** Subscribe to engine availability; fires immediately with the current value. */
export function onEngine(listener: Listener): () => void {
  listeners.add(listener);
  listener(engineRef.current);
  return () => listeners.delete(listener);
}
