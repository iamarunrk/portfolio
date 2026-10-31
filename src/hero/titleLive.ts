import { defaultTitle, toPx, type CanvasFrame } from '../layout';
import type { TitleFrame } from '../store';

/**
 * Live handle on the hero title DOM frame so the interaction controller can
 * move/scale it every pointer event without React re-renders.
 */
export const titleLive = {
  /** Positioned wrapper (translate + scale applied here). */
  el: null as HTMLElement | null,
  /** The text block that defines the frame's box (unscaled size = offsetWidth/Height). */
  box: null as HTMLElement | null,
  cur: { nx: 0, ny: 0, s: 1 } as TitleFrame,
  dragging: false,

  /** Sync from persisted placement (or the responsive default). */
  sync(t: TitleFrame | null, frame: CanvasFrame) {
    if (this.dragging) return;
    this.cur = { ...(t ?? defaultTitle(frame)) };
    this.apply(frame);
  },

  apply(frame: CanvasFrame) {
    const el = this.el;
    if (!el) return;
    const [x, y] = toPx(this.cur.nx, this.cur.ny, frame);
    el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${this.cur.s})`;
  },

  /** Screen-space box of the frame in CSS px: centre + size (already scaled). */
  rect(frame: CanvasFrame): { x: number; y: number; w: number; h: number } | null {
    const box = this.box;
    if (!box) return null;
    const [x, y] = toPx(this.cur.nx, this.cur.ny, frame);
    const w = box.offsetWidth * this.cur.s;
    const h = box.offsetHeight * this.cur.s;
    return { x, y, w, h };
  },
};
