/**
 * Bridge between the live homepage (React + WebGL) and the board camera (imperative).
 *
 * The homepage is one frame on the board. While the camera rests on it the page is fully
 * interactive; as soon as the camera pulls back the page becomes a scaled layer.
 */

export interface HomeView {
  /** Screen position of the homepage layer's top-left corner, in CSS px. */
  x: number;
  y: number;
  /** Scale of the homepage layer (1 = filling the viewport). */
  k: number;
  /** True while the camera rests exactly on the homepage. */
  home: boolean;
}

export const homeView: HomeView = { x: 0, y: 0, k: 1, home: true };

export type GesturePhase = 'start' | 'move' | 'end';

/**
 * Gestures on the empty part of the home canvas (nothing grabbed) are handed to the board:
 * a one-finger swipe or a two-finger pinch pulls the camera back.
 */
export const homeGestures: {
  drag: ((phase: GesturePhase, x: number, y: number, pointerType: string) => void) | null;
  pinch: ((phase: GesturePhase, ratio: number) => void) | null;
  /** Fly from the homepage out to the board (the "Work" button). */
  openBoard: (() => void) | null;
} = { drag: null, pinch: null, openBoard: null };
