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

## Liquid Glass chrome

The island, top bar, hint, show-UI button and selection pill are iOS-style Liquid Glass:

- **Lensing in WebGL, so it works in every browser (Safari included).** Each glass element registers
  itself (`useLiquidGlass` in `src/ui/liquidGlass.ts`); every frame its box is handed to the
  background engine, whose material pass refracts the finished background inside that rounded shape.
  The rim is a convex squircle bezel, h(t) = (1 − (1 − t)⁴)^¼, and the shift comes from Snell's law
  (IOR 1.5): strong bending at the edges, a clear middle, slight chromatic dispersion and bevel light.
- **Adaptive tone.** The engine measures the background behind each panel (mean, 10th and 90th
  percentile lightness). Panels switch between smoky glass with light glyphs and milky glass with dark
  glyphs, and dim or whiten further when high-contrast content sits behind the text.
- **CSS on top** adds the tint, the specular rim (top-left / bottom-right highlights), depth shadows,
  a light frost (heavier when the island opens, like an iOS sheet), and light that follows the pointer.
- **Liquid selection.** A single lime glass capsule slides and squashes between the island tabs.

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
npm run dev             # http://localhost:5173 (the shelf: /showcase.html)
npm run build           # static site in dist/ (relative paths: deploy anywhere)
npm run build:preview   # one self-contained HTML file in dist-preview/
npm run build:showcase  # the shelf page as one self-contained HTML file in dist-showcase/
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
    library/              the shelf: more collectibles, built but not on the canvas yet
  showcase/               the shelf page (showcase.html at the repo root)
  bg/                     background engine, GLSL, presets and metadata
  ui/                     bottom island, top bar, hint, Liquid Glass registry
```

## Dev pages

Run `npm run dev`, then open:

| Page | What it's for | Handy params |
| --- | --- | --- |
| `/dev/objects.html` | the five toys side by side under studio light | `?only=can`, `?bg=light`, `?rot=y`, `?yaw=30&pitch=10` |
| `/dev/bg.html` | the background engine on its own | `?base=mesh&mat=fluted`, `?preset=<id>`, `?grid=bases`, `?grid=materials` |
| `/dev/ui.html` | island, top bar and hint over a live background | `?fresh` (first visit), `?nogl` |
| `/dev/library.html` | the shelf toys under studio light (QA harness) | `?only=cassette`, `?only=cassette&views=1` (8 angles), `&with=can`, `?bg=pastel`, `?hud=1` |
| `/showcase.html` | the shelf page itself | `?theme=studio`, `?all=1` (build every card now), `#cassette` (close-up) |

## The shelf

Eighteen more collectibles are modelled and ready but **not on the homepage canvas**. They live in
`src/objects/library/` (one file each, file name = kind) and have their own page,
[`showcase.html`](showcase.html): drag a toy to spin it, click it for a close-up (drag, scroll or pinch,
← →), filter by category and switch between the Pastel and Studio backgrounds.

- `npm run dev`, then open `/showcase.html` (`/showcase.html#cassette` opens a close-up directly).
- `npm run build:showcase` writes `dist-showcase/showcase.html`, one self-contained file you can open
  or host anywhere. `npm run build` (the site) does not include the shelf.

| Kind | Toy | Tagline | Category |
| --- | --- | --- | --- |
| `cassette` | Mixtape Vol. 0 | side A: design, side B: ship | Tech |
| `figma` | Figma Tin | fresh frames, packed in auto layout | Studio |
| `burger` | Full-Stack Burger | every layer, shipped | Food |
| `camera` | Instant Zero | develops ideas in 90 seconds | Tech |
| `handheld` | Pocket Zero | cloudy plastic, crunchy pixels | Tech |
| `pizza` | Pizza Slice | one more slice, one more feature | Food |
| `paintbox` | Paintbox | every colour, no undo | Studio |
| `imac` | iMac G3 | hello (again) | Tech |
| `biryani` | Dum Biryani | slow-cooked, worth the wait | Food |
| `parcel` | Ship-It Box | fragile: contains MVP | Founder kit |
| `harddrive` | Cold Storage | every final_final_v7, backed up | Tech |
| `chai` | Cutting Chai | standup fuel | Food |
| `swatches` | Swatch Fan | #D7FF3A and friends | Studio |
| `cardreader` | First Dollar | $1.00 · approved | Founder kit |
| `fries` | Hot Fixes | served hot, deployed fast | Food |
| `desktop` | Relax Station | boot, relax, design | Tech |
| `noodles` | 2-Minute MVP | just add hot water | Food |
| `rocket` | Launch Day | t-minus zero | Founder kit |

Like the hero toys they are fully procedural (geometry + canvas-painted stickers, no model files). Each
group of objects keeps its own helpers in an underscore module (`_food.ts`, `_computers.ts`, ...).

### Promoting a shelf toy to the canvas

Shelf toys use the hero toys' build contract (`LibraryDef` is `ObjectDef` with a free-form `kind` and a
`category`), so promoting one is registration only:

1. Add its kind to `ObjectKind` in `src/objects/types.ts`.
2. In `src/objects/index.ts`, import the toy and the adapter straight from their files (importing
   `./library` would pull every shelf toy into the site bundle):
   `import { cassette } from './library/cassette'`, `import { asObjectDef } from './library/types'`,
   then add `asObjectDef(cassette, 'cassette')` to `OBJECTS`.
3. Give it a slot in `src/layout.ts` (landscape + portrait) and `OBJECT_ORDER` in `src/store.ts`.

## Adding a new toy

1. Create `src/objects/<name>.ts` exporting an `ObjectDef` (see `src/objects/types.ts`): build a
   `THREE.Group` normalised to a bounding sphere of radius ≈ 1, hero side facing +Z.
2. Add it to `OBJECTS` in `src/objects/index.ts`, its kind to `ObjectKind`, and a slot in
   `src/layout.ts` (landscape + portrait) and `OBJECT_ORDER` in `src/store.ts`.
