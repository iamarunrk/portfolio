import * as THREE from 'three';

export type Axis = 'x' | 'y' | 'z';
export const AXES: Axis[] = ['x', 'y', 'z'];

export const AXIS_COLOR: Record<Axis, string> = {
  x: '#ff4f64',
  y: '#2fdc8c',
  z: '#3b8bff',
};

/** Accent used for frame (DOM element) selections, Figma-style. */
export const FRAME_BLUE = '#2d8cff';

/**
 * The rotation rings live in a fixed, view-tilted basis (like looking at a
 * turntable from slightly above-right). With a straight-on camera, world-aligned
 * rings would collapse into lines; this keeps all three readable as ellipses.
 * Dragging a ring rotates the object about that ring's normal, so what you
 * grab always matches how it turns.
 */
const BASIS_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, -0.55, 0, 'YXZ'));

export const GIZMO_AXIS: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0).applyQuaternion(BASIS_Q).normalize(),
  y: new THREE.Vector3(0, 1, 0).applyQuaternion(BASIS_Q).normalize(),
  z: new THREE.Vector3(0, 0, 1).applyQuaternion(BASIS_Q).normalize(),
};

/** In-plane basis (u, w) for each ring so that u × w = normal. */
export const RING_BASIS: Record<Axis, [THREE.Vector3, THREE.Vector3]> = {
  x: [GIZMO_AXIS.y, GIZMO_AXIS.z],
  y: [GIZMO_AXIS.z, GIZMO_AXIS.x],
  z: [GIZMO_AXIS.x, GIZMO_AXIS.y],
};

/** Ring radius relative to the object's bounding sphere. */
export const RING_SCALE = 1.08;
export const RING_SEGMENTS = 120;

export type Handle =
  | { type: 'ring'; axis: Axis }
  | { type: 'scale' }
  | { type: 'object'; id: string }
  | { type: 'title' }
  | { type: 'title-corner'; corner: 0 | 1 | 2 | 3 };

export type DragMode = 'idle' | 'move' | 'rotate' | 'scale' | 'pinch' | 'title-move' | 'title-scale';

/** Everything the SVG overlay needs to draw one frame. Written by the controller, read by the overlay. */
export interface GizmoFrame {
  object: null | {
    id: string;
    cx: number;
    cy: number;
    r: number;
    rings: Record<Axis, { front: string; back: string }>;
    activeAxis: Axis | null;
    hoverAxis: Axis | null;
    knob: [number, number];
    knobActive: boolean;
    knobHover: boolean;
    wedge: { d: string; axis: Axis } | null;
    moving: boolean;
  };
  title: null | {
    x: number;
    y: number;
    w: number;
    h: number;
    hover: boolean;
    selected: boolean;
    activeCorner: number;
  };
  pill: null | { text: string; x: number; y: number; color: string };
}

export const gizmoFrame: GizmoFrame = { object: null, title: null, pill: null };

type OverlayRenderer = (f: GizmoFrame) => void;
let overlayRenderer: OverlayRenderer | null = null;

export function registerOverlay(fn: OverlayRenderer | null) {
  overlayRenderer = fn;
}

export function pushGizmoFrame() {
  overlayRenderer?.(gizmoFrame);
}
