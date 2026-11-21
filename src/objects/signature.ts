/**
 * Signature motions: what a collectible does when it is clicked (a camera clicks, a can
 * fizzes, a computer types...). Each object builds one with `signature(duration, frame)` and
 * hands it to `finish()`; whoever shows the object calls `built.act()` on a click and keeps
 * calling `built.update(t, dt)` every frame.
 *
 * The contract for `frame(p, s, dt)`:
 *  - `p` runs 0 → 1 over `duration` seconds, `s` is seconds since the start, `dt` the step.
 *  - It is called once with p = 0 when the motion starts (reset any state there), every frame
 *    while it plays, and exactly once with p = 1 at the end.
 *  - p = 1 MUST leave the object exactly in its rest pose (the pose it was built in), so the
 *    motion can replay and the object never drifts. Write poses as functions of p (or s)
 *    rather than accumulating, and hide anything extra (droplets, sparks, a flash) again.
 */
export interface Signature {
  /** Start the motion (a click while it plays lets it finish). Returns seconds until it is done. */
  play(): number;
  /** Advance by `dt` seconds. Cheap when idle. */
  update(dt: number): void;
  readonly active: boolean;
  readonly duration: number;
}

export function signature(duration: number, frame: (p: number, s: number, dt: number) => void): Signature {
  let s = 0;
  let active = false;
  return {
    duration,
    get active() {
      return active;
    },
    play() {
      if (active) return Math.max(0, duration - s);
      active = true;
      s = 0;
      frame(0, 0, 0);
      return duration;
    },
    update(dt) {
      if (!active) return;
      s += Math.max(0, dt);
      if (s >= duration) {
        active = false;
        frame(1, duration, dt);
        return;
      }
      frame(s / duration, s, dt);
    },
  };
}

// ── a small kit for writing poses as functions of p ─────────────────────────────

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 before `a`, 1 after `b`, linear in between. */
export const span = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));
/** Like `span`, with soft ends. */
export const smooth = (x: number, a: number, b: number) => {
  const t = span(x, a, b);
  return t * t * (3 - 2 * t);
};
/** 0 → 1 → 0: rises over a..b, holds, falls over c..d (soft ends). Rest (0) outside a..d. */
export const bump = (x: number, a: number, b: number, c: number, d: number) => smooth(x, a, b) * (1 - smooth(x, c, d));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
/** Overshoots a little past 1, then settles. */
export const easeOutBack = (t: number, k = 1.7) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
/** Springy settle onto 1. */
export const easeOutElastic = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
/** A decaying wobble around 0: starts at full swing at s = 0 and dies out. `s` in seconds. */
export const wobble = (s: number, hz: number, decay: number) => Math.sin(s * hz * Math.PI * 2) * Math.exp(-s * decay);
/** Height of a ballistic hop over 0..1 (0 at both ends, 1 at the top). */
export const arc = (t: number) => 4 * clamp01(t) * (1 - clamp01(t));
