# Once upon a time

> Once upon a time i was a product designer. Now: founder of **Zeros**.

A portfolio that behaves like a design tool. The whole viewport is a canvas: sticker-covered 3D
collectibles float on it, and every visitor can grab, spin and scale them, drag the headline
around, and restyle the background with live shaders and glass materials. Whatever they make is
remembered in their browser.

## What you can do

| Gesture | Desktop | Touch |
| --- | --- | --- |
| Select a toy | click it | tap it |
| Move it | drag the toy | drag with one finger |
| Rotate on X / Y / Z | drag a coloured ring (hold <kbd>Shift</kbd> to snap 15°) | drag a ring |
| Twist in screen plane | <kbd>Shift</kbd> + wheel | two-finger twist |
| Scale | drag the round knob, or scroll the wheel / trackpad pinch | pinch |
| Spin for fun | double-click, or <kbd>Space</kbd> | double-tap |
| Nudge / resize | arrow keys, <kbd>[</kbd> <kbd>]</kbd> | |
| Reset | <kbd>R</kbd> or the pill's **Reset** | pill's **Reset** |
| Move / scale the headline | drag it, drag its corner handles | same |

The bottom island remixes the canvas: **Shaders** (animated generators), **Gradients**, **Colors**,
**Glass** (fluted, ribbed, frosted, blur, liquid glass, glass tiles, water, crystal, prism,
halftone, pixelate, CRT, dither) and **Effects** (grain, vignette, speed).

## Stack

- [Vite](https://vite.dev) + React 19 + TypeScript
- [three.js](https://threejs.org) via [@react-three/fiber](https://r3f.docs.pmnd.rs)
- [zustand](https://zustand.docs.pmnd.rs) for state (persisted to `localStorage`)
- All 3D objects are procedural (geometry + canvas-painted sticker textures). No model files.
- The background is a two-pass WebGL2 shader stack (base generator → glass material → grain),
  modelled on the component catalogue of [shaders.com](https://shaders.com) and rendered in the same
  GPU context as the 3D objects, so glass objects refract it. 20 generators (solid, linear, radial,
  conic, mesh, flow, aurora, liquid metal, satin, plasma, swirl, waves, goo, sunburst, holo, checker,
  dot grid, halftone, dither, studio) × 14 glass materials, all with palette and knobs.

## Scripts

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # static site in dist/ (relative paths: deploy anywhere)
npm run build:preview  # one self-contained HTML file in dist-preview/
```

## Project map

```
src/
  App.tsx                 page composition
  store.ts                app state + persistence (bg config, object transforms, layer order)
  layout.ts               viewport ⇄ world mapping, responsive default layouts
  fonts.ts                font families + loader (textures wait for fonts)
  scene/
    Stage.tsx             R3F canvas: lighting, background, objects, controller
    ObjectNode.tsx        one toy: build, float, entrance, eased transforms
    controller.ts         all pointer/touch/wheel/keyboard interaction + gizmo geometry
    gizmo.ts              gizmo constants and the overlay frame contract
    studioEnv.ts          procedural studio lighting (image-based)
  overlay/GizmoOverlay.tsx  SVG rings, wedge, knob, selection pill, frame box
  hero/TitleFrame.tsx     the headline frame
  objects/                the 3D collectibles (one file each) + sticker painting helpers
  bg/                     background engine, GLSL, presets and metadata
  ui/                     bottom island, top bar, hint
```

## Dev pages

Run `npm run dev`, then open:

| Page | What it's for | Handy params |
| --- | --- | --- |
| `/dev/objects.html` | the five toys side by side under studio light | `?only=can`, `?bg=light`, `?rot=y`, `?yaw=30&pitch=10` |
| `/dev/bg.html` | the background engine on its own | `?base=mesh&mat=fluted`, `?preset=<id>`, `?grid=bases`, `?grid=materials` |
| `/dev/ui.html` | island, top bar and hint over a live background | `?fresh` (first visit), `?nogl` |

## Adding a new toy

1. Create `src/objects/<name>.ts` exporting an `ObjectDef` (see `src/objects/types.ts`): build a
   `THREE.Group` normalised to a bounding sphere of radius ≈ 1, hero side facing +Z.
2. Add it to `OBJECTS` in `src/objects/index.ts`, its kind to `ObjectKind`, and a slot in
   `src/layout.ts` (landscape + portrait) and `OBJECT_ORDER` in `src/store.ts`.
