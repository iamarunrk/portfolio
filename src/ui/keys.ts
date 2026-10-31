import type { KeyboardEvent } from 'react';

const PASS = new Set(['Escape', 'Tab']);

/**
 * Keys pressed while focus is inside the chrome (arrows on a slider, Space on a
 * button...) belong to the chrome. Stop them before they reach the canvas
 * controller's window listener, which would otherwise also nudge/spin the
 * selected toy. Escape, Tab and modifier shortcuts still pass through.
 */
export function keepKeys(e: KeyboardEvent) {
  if (PASS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
  e.stopPropagation();
}
