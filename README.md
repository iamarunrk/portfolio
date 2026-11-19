# Once upon a time

> Once upon a time i was a product designer. Now: founder of **Zeros**.

A portfolio that behaves like a design tool. The homepage is a canvas: sticker-covered 3D
collectibles float on it, and every visitor can grab, spin and scale them, drag the headline
around, and restyle the background with live shaders and glass materials. Whatever they make is
remembered in their browser.

Scroll, and the camera pulls back: the homepage turns out to be one frame on a design board that
holds the work (motion, 3D, product). Click the home frame and the camera flies back in.

## What you can do

| Gesture | Desktop | Touch |
| --- | --- | --- |
| Select a toy | click it | tap it |
| Move it | drag the toy | drag with one finger |
| Rotate on X / Y / Z | drag a coloured ring (hold <kbd>Shift</kbd> to snap 15°) | drag a ring |
| Twist in screen plane | <kbd>Shift</kbd> + wheel | two-finger twist |
| Scale | drag the round knob, scroll the wheel over the selected toy, or trackpad-pinch any toy | pinch |
| Spin for fun | double-click, or <kbd>Space</kbd> | double-tap |
| Nudge / resize | arrow keys, <kbd>[</kbd> <kbd>]</kbd> | |
| Reset | <kbd>R</kbd> or the pill's **Reset** | pill's **Reset** |
| Move / scale the headline | drag it, drag its corner handles | tap it first, then drag |
| Go to the work | scroll (or **Work**, <kbd>PgDn</kbd>) | swipe up on empty canvas, or pinch in |

The bottom island remixes the canvas: **Shaders** (animated generators), **Gradients**, **Colors**,
**Glass** (fluted, ribbed, frosted, blur, liquid glass, glass tiles, water, crystal, prism,
halftone, pixelate, CRT, dither) and **Effects** (grain, vignette, speed).

## The board

The page is a design board with a camera over it (`src/board/board.ts`). The live homepage is a
real frame on that board: the camera resting on it *is* the homepage, so the zoom between the two is
one continuous move, not a page change. There is no footer and no second page to scroll.

| On the board | Desktop | Touch |
| --- | --- | --- |
| Tour: overview → Motion → 3D → Product | scroll, <kbd>↓</kbd> <kbd>↑</kbd>, the chips top-left, or **Tour** | swipe up / down |
| Zoom back into the homepage | scroll back up from the overview | swipe down |
| Back to the homepage | click the **Home** frame or chip, or <kbd>Esc</kbd> | tap the Home frame or chip |
| Zoom to a piece | click it | tap it |
| Open a case study (product work) | click the frame or its ▶ | tap it |
| Explore freely | **Explore** or <kbd>E</kbd>: scroll pans, <kbd>⌘/Ctrl</kbd> + scroll zooms, drag pans | two-finger pinch, drag |
| Leave a mark | marker <kbd>P</kbd>, stamps <kbd>S</kbd>, sticky notes <kbd>N</kbd>, move frames <kbd>V</kbd>, undo <kbd>⌘Z</kbd> | same tools in the toolbar |
| Designer's notes | <kbd>C</kbd> | the speech-bubble tool |

Marks (ink, stamps, notes, moved frames) are saved in the visitor's own browser. The two other
cursors on the board are scripted, not live visitors.

Case studies open as their own address (`#/work/<id>`): the frame zooms up into the page and the
browser's back button zooms it back. `#work` links straight to the board.

### Adding your real work

Everything on the board is listed in `src/board/works.ts`. Each entry is one frame; until it has a
file it is drawn by a CSS stand-in.

1. Put the file in `public/works/` (a loop as `.mp4` / `.webm`, a render or screen as an image).
2. On its entry set `src: 'works/your-file.mp4'` and the right `aspect` (`'16/10'`, `'4/5'`, `'1/1'`…).
   Videos play muted and looped, and pause when they are off screen.
3. For product work, fill in `case` (`kicker`, `title`, `meta`, and `body` paragraphs).
4. Add `note: '…'` for a designer's note pinned to the frame.

The board lays itself out from that list (`src/board/layout.ts`): Motion and 3D are three-column
masonry (pieces wider than about 7:5 span two columns), Product is rows of equal height. Sections
grow with their content, the order in the list is the order on the board, and the tour gets a stop
per screenful. On phones everything stacks in one column under the homepage, so the story scrolls
straight down.

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
npm run dev            # http://localhost:5173
npm run build          # static site in dist/ (relative paths: deploy anywhere)
npm run build:preview  # one self-contained HTML file in dist-preview/
```

## Project map

```
src/
  App.tsx                 page composition: board stage, homepage layer, board HUD
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
  view.ts                 bridge between the homepage and the board camera
  board/
    board.ts              the board: camera, story rail, explore mode, tools, marks, cursors
    works.ts              the list of works (+ CSS stand-ins until real files arrive)
    layout.ts             lays the works out (wide board, or one column on phones)
    caseStudy.ts          case-study pages (#/work/<id>) with the zoom transition
  objects/                the 3D collectibles (one file each) + sticker painting helpers
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

## Adding a new toy

1. Create `src/objects/<name>.ts` exporting an `ObjectDef` (see `src/objects/types.ts`): build a
   `THREE.Group` normalised to a bounding sphere of radius ≈ 1, hero side facing +Z.
2. Add it to `OBJECTS` in `src/objects/index.ts`, its kind to `ObjectKind`, and a slot in
   `src/layout.ts` (landscape + portrait) and `OBJECT_ORDER` in `src/store.ts`.
