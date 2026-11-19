import { homeGestures, homeView, type GesturePhase } from '../view';
import { createCaseStudies } from './caseStudy';
import { clamp, ease, h, isTyping, lerp, smoothstep, svg } from './dom';
import { aspectOf, layoutBoard, type Box, type Frame, type Rect } from './layout';
import { WORKS, mountWork } from './works';
import './board.css';

/**
 * The Board.
 *
 * A camera over a design board (laid out by layout.ts from the list of works). The live homepage is one frame on it (the camera
 * resting on that frame *is* the homepage).
 *
 *  - Nothing here moves by itself: the camera goes exactly as far as the visitor's wheel, pinch or
 *    finger takes it, and stops where they stop.
 *  - Scrolling on the homepage runs along a rail (the "portal"): the page first scrolls up like any
 *    page, then that scroll becomes the camera pulling back, and the board assembles around it.
 *  - Zooming (⌘/Ctrl + scroll, pinch) is plain canvas zoom at the cursor, from the homepage too.
 *  - The canvas is a plain free canvas: scroll pans, ⌘/Ctrl + scroll or pinch zooms, a click selects.
 *    Zooming in on the selected Home frame steers the camera onto it, so the zoom ends exactly
 *    on the homepage.
 *
 * Everything here is imperative DOM so camera moves never re-render React.
 */

export interface BoardHost {
  app: HTMLElement;
  home: HTMLElement;
  stage: HTMLElement;
  over: HTMLElement;
  hud: HTMLElement;
  /** The camera arrived on / left the homepage. */
  onView(view: 'home' | 'board'): void;
  /** Whether the homepage's WebGL needs to keep rendering. */
  onGlActive(active: boolean): void;
  /** True while something on the homepage is selected (its keys win). */
  hasSelection(): boolean;
}

interface Cam { cx: number; cy: number; z: number }
type Tool = 'hand' | 'move' | 'marker' | 'stamp' | 'note';
type Pt = [number, number];
interface Stroke { c: string; pts: Pt[]; el?: SVGPathElement }
interface Stamp { k: string; x: number; y: number; r: number; f: number; el?: HTMLElement }
interface Note { x: number; y: number; r: number; c: string; text: string; el?: HTMLElement }
type Action = { t: 'stroke'; s: Stroke } | { t: 'stamp'; s: Stamp } | { t: 'note'; n: Note } | { t: 'move'; i: number; dx: number; dy: number };
type Gesture =
  | { kind: 'pinch'; d0: number; z0: number; m0: { x: number; y: number }; c0: { cx: number; cy: number }; home: boolean }
  | { kind: 'draw'; s: Stroke }
  | { kind: 'move'; i: number; start: { x: number; y: number }; dx0: number; dy0: number; moved: boolean }
  | { kind: 'pan'; x: number; y: number; moved: boolean; touch: boolean; fi: number; startCam: Cam }
  | { kind: 'portal'; y: number; s0: number };

const FRAME_R = 14;
const DIMS: Record<string, string> = { '4/5': '1080 × 1350', '1/1': '1080 × 1080', '16/10': '1920 × 1200', '16/9': '1920 × 1080', '4/3': '1600 × 1200', '9/16': '1080 × 1920' };
/** Length of the scroll (px) between the homepage and the canvas. */
const S_MAX = 1100;
const ZMIN = 0.05;
const ZMAX = 3;

const ICON: Record<string, string> = {
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-1V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3.3 15a1.6 1.6 0 0 1 2.5-2L8 15V11"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M5 3l14 8.5-6.2 1.3L10 19z"/></svg>',
  marker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5l5 5L9 20H4v-5z"/><path d="M12.5 6.5l5 5"/></svg>',
  stamp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3.5 3.5 0 0 0-2 6.4V12H6a2 2 0 0 0-2 2v2h16v-2a2 2 0 0 0-2-2h-4V9.4A3.5 3.5 0 0 0 12 3zM5 20h14"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M5 4h14v10l-6 6H5z"/><path d="M13 20v-6h6"/></svg>',
  comments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6L4 11l5 5"/><path d="M4 11h10a5 5 0 0 1 0 10h-2"/></svg>',
  tidy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><ellipse cx="12" cy="12" rx="5.6" ry="7.4"/></svg>',
};
const STAMPS: Record<string, string> = {
  heart: '<svg viewBox="0 0 100 100"><path d="M50 88 C20 66 6 50 6 32 A20 20 0 0 1 50 22 A20 20 0 0 1 94 32 C94 50 80 66 50 88Z" fill="#ff3f7f" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><ellipse cx="32" cy="34" rx="8" ry="5" fill="#fff" opacity=".55" transform="rotate(-30 32 34)"/></svg>',
  fire: '<svg viewBox="0 0 100 100"><path d="M50 94c-20 0-34-14-34-32 0-16 10-24 16-36 2 10 8 14 12 14 0-14 8-28 22-34-4 14 4 22 10 32 6 9 8 16 8 24 0 18-14 32-34 32z" fill="#ff6b1a" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><path d="M50 88c-9 0-15-6-15-15 0-8 6-12 9-18 1 6 4 8 7 8 1-6 4-10 8-12-1 6 6 12 6 22 0 9-6 15-15 15z" fill="#ffd23f"/></svg>',
  star: '<svg viewBox="0 0 100 100"><path d="M50 6l12.6 27.4 30 3.4-22.4 20.3 6.2 29.5L50 71.5 23.6 86.6l6.2-29.5L7.4 36.8l30-3.4z" fill="#d7ff3a" stroke="#fff" stroke-width="7" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="#2b59ff" stroke="#fff" stroke-width="7"/><text x="50" y="62" text-anchor="middle" font-family="Bagel Fat One, Arial Black, sans-serif" font-size="36" fill="#fff">+1</text></svg>',
  eyes: '<svg viewBox="0 0 100 100"><ellipse cx="32" cy="50" rx="22" ry="30" fill="#fff" stroke="#111" stroke-width="5"/><ellipse cx="68" cy="50" rx="22" ry="30" fill="#fff" stroke="#111" stroke-width="5"/><circle cx="38" cy="58" r="10" fill="#111"/><circle cx="74" cy="58" r="10" fill="#111"/></svg>',
  wow: '<svg viewBox="0 0 100 100"><path d="M50 4l9 14 16-6-1 17 17 4-11 13 11 13-17 4 1 17-16-6-9 14-9-14-16 6 1-17-17-4 11-13L9 36l17-4-1-17 16 6z" fill="#ffd23f" stroke="#fff" stroke-width="6" stroke-linejoin="round"/><text x="50" y="58" text-anchor="middle" font-family="Bagel Fat One, Arial Black, sans-serif" font-size="22" fill="#111">WOW</text></svg>',
};
const COLORS = ['#d7ff3a', '#ff4fd8', '#46c8ff', '#ffffff'];
const TOOLS: Tool[] = ['hand', 'move', 'marker', 'stamp', 'note'];
const STORE_BASE = 'once-upon-a-time:board:v1';

/** Mounts the board. Turning a phone (or resizing across portrait / landscape) lays it out again. */
export function createBoard(host: BoardHost): { destroy(): void } {
  const isPortrait = () => host.app.clientHeight > host.app.clientWidth * 1.05;
  let portrait = isPortrait();
  let board = build(host, portrait, false);
  const onResize = () => {
    const next = isPortrait();
    if (next === portrait) return;
    portrait = next;
    const onBoard = !board.atHome();
    board.destroy();
    board = build(host, portrait, onBoard);
  };
  window.addEventListener('resize', onResize);
  return {
    destroy() {
      window.removeEventListener('resize', onResize);
      board.destroy();
    },
  };
}

function build(host: BoardHost, portrait: boolean, startOnBoard: boolean): { destroy(): void; atHome(): boolean } {
  const { app, home, stage, over, hud } = host;
  const ac = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K | string, fn: (e: never) => void, o: AddEventListenerOptions = {}) =>
    el.addEventListener(type, fn as EventListener, { ...o, signal: ac.signal });
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  // ── viewport + layout ────────────────────────────────────────────────────
  let W = Math.max(1, app.clientWidth);
  let H = Math.max(1, app.clientHeight);
  const L = layoutBoard(WORKS, portrait);
  const BW = L.w;
  const BH = L.h;
  const FRAMES: Frame[] = L.frames;
  const SECTIONS = L.sections;
  const OVER = L.over;
  const HERO_C = L.heroC;
  const HERO_MAX = L.heroMax;
  const secOf = (id: string) => SECTIONS.find((x) => x.id === id);
  // marks live in board coordinates, and the two layouts don't share them
  const STORE_KEY = `${STORE_BASE}:${portrait ? 'p' : 'l'}`;
  let HERO: Rect = { x: 0, y: 0, w: 1, h: 1 };
  const layoutHero = () => {
    const a = W / H;
    const w = Math.min(HERO_MAX.w, HERO_MAX.h * a);
    const hh = w / a;
    HERO = { x: HERO_C.x - w / 2, y: HERO_C.y - hh / 2, w, h: hh };
  };
  layoutHero();

  // ── DOM ──────────────────────────────────────────────────────────────────
  const size = `width:${BW}px;height:${BH}px`;
  const under = h('div', { class: 'bd-board', style: size });
  const top = h('div', { class: 'bd-board', style: size });
  stage.replaceChildren(under);
  over.replaceChildren(top);

  SECTIONS.forEach((s) => {
    under.append(
      h('div', { class: 'bd-sec', style: `left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;--tab:${s.tab}` },
        h('span', { class: 'bd-label' }, h('i'), s.name, h('em', {}, String(s.count)))),
    );
  });

  const links = svg('svg', { class: 'bd-links', viewBox: `0 0 ${BW} ${BH}` });
  const linkPaths = [0, 1, 2].map(() => links.appendChild(svg('path')));
  under.append(links);
  const linkLen = [0, 0, 0];
  function layoutLinks() {
    const cy = HERO.y + HERO.h / 2;
    const l = HERO.x - 14, r = HERO.x + HERO.w + 14, b = HERO.y + HERO.h + 14;
    const arrow = (x: number, y: number, dx: number, dy: number) => ` M${x - dx * 14 - dy * 9},${y - dy * 14 - dx * 9} L${x},${y} L${x - dx * 14 + dy * 9},${y - dy * 14 + dx * 9}`;
    const m = secOf('motion'), t = secOf('3d'), u = secOf('ux');
    const down = (to: number) => `M${HERO_C.x},${b} L${HERO_C.x},${to}` + arrow(HERO_C.x, to, 0, 1);
    const ds = L.portrait
      ? [SECTIONS[0] ? down(SECTIONS[0].y - 60) : '', '', '']
      : [
          m ? `M${l},${cy} L${m.x + m.w + 16},${cy}` + arrow(m.x + m.w + 16, cy, -1, 0) : '',
          t ? `M${r},${cy} L${t.x - 16},${cy}` + arrow(t.x - 16, cy, 1, 0) : '',
          u ? down(u.y - 16) : '',
        ];
    linkPaths.forEach((p, i) => {
      p.setAttribute('d', ds[i] || 'M0,0');
      linkLen[i] = ds[i] ? p.getTotalLength() : 0;
      p.style.strokeDasharray = `${linkLen[i]}`;
    });
  }

  const frameEls = FRAMES.map((f, i) => {
    const t = f.work.type;
    const el = h('div', { class: `bd-frame is-${t}`, tabindex: '0', role: 'button', 'data-i': String(i), 'aria-label': t === 'ux' ? 'Case study' : t === '3d' ? '3D piece' : 'Motion piece' });
    const media = h('div', { class: 'bd-media' });
    el.append(media);
    mountWork(f.work, media);
    el.append(h('div', { class: 'bd-sel' }, h('i'), h('i'), h('i'), h('i'), h('b', {}, DIMS[f.work.aspect] ?? `1600 × ${Math.round(1600 / aspectOf(f.work))}`)));
    if (t === 'motion') {
      el.append(h('div', { class: 'bd-timeline' }, h('em', {}, `0:0${3 + (i % 6)}`),
        h('span', {}, h('i', { style: 'left:18%' }), h('i', { style: 'left:55%' }), h('i', { style: 'left:82%' }), h('b'))));
    }
    if (t === 'ux') {
      el.append(h('button', { class: 'bd-play', type: 'button', 'aria-label': 'Open case study', tabindex: '-1' }, '▶'));
      el.append(h('button', { class: 'bd-open', type: 'button', tabindex: '-1' }, 'Open case study'));
    }
    under.append(el);
    return el;
  });
  const placeFrame = (i: number) => {
    const f = FRAMES[i];
    frameEls[i].style.cssText += `;left:${f.x + f.dx}px;top:${f.y + f.dy}px;width:${f.w}px;height:${f.h}px`;
  };
  FRAMES.forEach((_, i) => placeFrame(i));
  const frameAt = (bx: number, by: number) =>
    FRAMES.findIndex((f) => bx >= f.x + f.dx && bx <= f.x + f.dx + f.w && by >= f.y + f.dy && by <= f.y + f.dy + f.h);

  // layers above the homepage: its outline, visitor marks, notes, cursors
  const heroOpen = h('button', { class: 'bd-open', type: 'button', tabindex: '-1' }, 'Open home');
  const heroSel = h('div', { class: 'bd-herosel' }, h('span', { class: 'bd-label' }, h('i'), 'Home'), h('div', { class: 'bd-sel' }, h('i'), h('i'), h('i'), h('i')), heroOpen);
  const ink = svg('svg', { class: 'bd-ink', viewBox: `0 0 ${BW} ${BH}`, width: BW, height: BH });
  const stampLayer = h('div');
  const noteLayer = h('div');
  const cmtLayer = h('div');
  // a note under the homepage that shows while the page is lifting off the board
  const cue = h('div', { class: 'bd-cue' }, 'keep going', h('br'), 'the work is out here ↓');
  top.append(heroSel, cue, ink, stampLayer, noteLayer, cmtLayer);

  // designer's notes come from the works list (`note`)
  const COMMENTS: [number, string][] = FRAMES.flatMap((f, i) => (f.work.note ? [[i, f.work.note] as [number, string]] : []));
  const cmtEls = COMMENTS.map(([fi, text]) => {
    const btn = h('button', { type: 'button', 'aria-label': 'Designer’s note' }, 'Z');
    const el = h('div', { class: 'bd-cmt' }, btn, h('div', {}, h('b', {}, 'Designer’s note'), text));
    on(btn, 'click', (e: MouseEvent) => {
      e.stopPropagation();
      el.classList.toggle('is-open');
    });
    cmtLayer.append(el);
    return [fi, el] as const;
  });
  const placeComments = () =>
    cmtEls.forEach(([fi, el]) => {
      const f = FRAMES[fi];
      el.style.left = `${f.x + f.dx + f.w - 10}px`;
      el.style.top = `${f.y + f.dy - 14}px`;
    });
  placeComments();

  interface Visitor { name: string; c: string; cx: number; cy: number; rx: number; ry: number; sp: number; ph: number; says: string[]; n: number }
  const zone = (id: string, fx: number) => {
    const z = secOf(id) ?? { x: BW * fx - 400, y: BH / 2 - 400, w: 800, h: 800 };
    return { cx: z.x + z.w / 2, cy: z.y + z.h / 2, rx: z.w * 0.32, ry: z.h * 0.3 };
  };
  const CURSORS: Visitor[] = [
    { name: 'recruiter', c: '#f24e1e', ...zone('motion', 0.2), sp: 0.21, ph: 0, says: ['this loop is great', 'is this case study public?', 'booking a call'], n: -1 },
    { name: 'client', c: '#9747ff', ...zone('3d', 0.8), sp: 0.17, ph: 2, says: ['love this render', 'can we get one of these?', 'sharing this with the team'], n: -1 },
  ];
  const cursorEls = CURSORS.map((c, i) => {
    const el = h('div', { class: 'bd-cursor', style: `--cc:${c.c}` });
    el.innerHTML = `<svg width="20" height="22" viewBox="0 0 22 24"><path d="M2 2 L2 20 L7 15.5 L10.5 22.5 L14 21 L10.6 14 L17.5 14 Z" fill="${c.c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><b title="Follow">${c.name}</b><q></q>`;
    on(el.querySelector('b')!, 'click', (e: MouseEvent) => {
      e.stopPropagation();
      startFollow(i);
    });
    top.append(el);
    return el;
  });
  const cursorPos = (c: Visitor, t: number) => ({ x: c.cx + Math.sin(t * c.sp * 2 + c.ph) * c.rx, y: c.cy + Math.sin(t * c.sp * 3.1 + c.ph * 1.7) * c.ry });

  // HUD
  const nav = h('div', { class: 'bd-glass bd-nav', role: 'navigation', 'aria-label': 'Board' });
  const trays = {
    marker: h('div', { class: 'bd-glass bd-tray', role: 'group', 'aria-label': 'Marker colour' }),
    stamp: h('div', { class: 'bd-glass bd-tray', role: 'group', 'aria-label': 'Stamps' }),
  };
  const toolsEl = h('div', { class: 'bd-glass bd-tools', role: 'toolbar', 'aria-label': 'Board tools' });
  const zoomTxt = h('button', { type: 'button', class: 'pct', 'data-z': 'fit', title: 'Zoom to fit · Shift+1', 'aria-label': 'Zoom to fit' }, '100%');
  const zoomEl = h('div', { class: 'bd-glass bd-zoom' },
    h('button', { type: 'button', 'data-z': '-1', 'aria-label': 'Zoom out' }, '−'), zoomTxt, h('button', { type: 'button', 'data-z': '1', 'aria-label': 'Zoom in' }, '+'));
  const right = h('div', { class: 'bd-right' }, zoomEl);
  const miniSvg = svg('svg', { viewBox: `0 0 ${BW} ${BH}`, preserveAspectRatio: 'xMidYMid meet' });
  const mini = h('div', { class: 'bd-glass bd-mini', role: 'button', tabindex: '0', 'aria-label': 'Minimap: jump there' });
  mini.append(miniSvg);
  const tip = h('div', { class: 'bd-tip' });
  const toastEl = h('div', { class: 'bd-glass bd-toast', role: 'status', 'aria-live': 'polite' });
  const youTag = h('div', { class: 'bd-you' }, 'you');
  const ghost = h('div', { class: 'bd-ghost-stamp' });
  const confettiCv = h('canvas', { class: 'bd-confetti' });
  hud.replaceChildren(nav, right, trays.marker, trays.stamp, toolsEl, mini, tip, toastEl, youTag, ghost, confettiCv);

  SECTIONS.forEach((s) => miniSvg.append(svg('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 40, fill: '#fff', opacity: 0.08 })));
  const miniFrames = FRAMES.map((f) => miniSvg.appendChild(svg('rect', { x: f.x, y: f.y, width: f.w, height: f.h, rx: 24, fill: f.work.tone })));
  const miniHero = miniSvg.appendChild(svg('rect', { rx: 24, fill: '#d7ff3a' }));
  const vp = miniSvg.appendChild(svg('rect', { class: 'vp', rx: 30 }));
  const syncMini = () => {
    miniHero.setAttribute('x', String(HERO.x));
    miniHero.setAttribute('y', String(HERO.y));
    miniHero.setAttribute('width', String(HERO.w));
    miniHero.setAttribute('height', String(HERO.h));
    miniFrames.forEach((r, i) => {
      r.setAttribute('x', String(FRAMES[i].x + FRAMES[i].dx));
      r.setAttribute('y', String(FRAMES[i].y + FRAMES[i].dy));
    });
  };
  function placeHero() {
    heroSel.style.cssText = `left:${HERO.x}px;top:${HERO.y}px;width:${HERO.w}px;height:${HERO.h}px`;
    cue.style.left = `${HERO_C.x}px`;
    cue.style.top = `${HERO.y + HERO.h + 46}px`;
    layoutLinks();
    syncMini();
  }
  placeHero();

  // ── camera ───────────────────────────────────────────────────────────────
  // Two places: the homepage (the camera rests exactly on its frame) and the canvas (free pan and
  // zoom). Going from one to the other is always one flight, set off by a slight scroll or zoom.
  const fitZ = (b: { w: number; h: number }) => Math.min(W / b.w, H / b.h);
  const homeCam = (): Cam => ({ cx: HERO.x + HERO.w / 2, cy: HERO.y + HERO.h / 2, z: W / HERO.w });
  const camFor = (b: Box): Cam => ({ cx: b.cx, cy: b.cy, z: clamp(fitZ(b), ZMIN, ZMAX) });
  const mixCam = (a: Cam, b: Cam, t: number): Cam => ({ cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)) });
  /** Eases in gently, spends most of the time settling. */
  const glide = (t: number) => ease(1 - Math.pow(1 - t, 1.7));

  const cam: Cam = homeCam(); // what's on screen
  const free: Cam = camFor(L.first(W / H)); // where the canvas camera is
  const overCam = (): Cam => camFor(L.first(W / H)); // where the portal lands
  let place: 'home' | 'portal' | 'canvas' = 'home';
  let flight: { from: Cam; to: Cam; t0: number; ms: number; kind: 'home' | 'canvas' } | null = null;
  // the portal: scroll position between the homepage (0) and the canvas (S_MAX)
  let S = 0; // on screen (eased)
  let ST = 0; // where the wheel / finger has put it
  let sRate = 16;
  let sAnim: { from: number; to: number; t0: number; ms: number; carry: boolean } | null = null;
  let follow = -1;
  let atHome = true;
  let glActive = true;
  let cover = 1;
  let holding = false; // a finger that started on the homepage is still down
  let fresh = false; // just arrived from the homepage and haven't moved yet: scrolling back up returns
  let wheelLock = false; // swallow the rest of the scroll gesture that just landed somewhere
  let selected: number | 'home' | null = null;

  const toBoard = (sx: number, sy: number) => ({ x: (sx - W / 2) / cam.z + cam.cx, y: (sy - H / 2) / cam.z + cam.cy });
  const inHero = (p: { x: number; y: number }) => p.x >= HERO.x && p.x <= HERO.x + HERO.w && p.y >= HERO.y && p.y <= HERO.y + HERO.h;
  const frameBox = (i: number, pad = 1.3): Box => {
    const f = FRAMES[i];
    return { cx: f.x + f.dx + f.w / 2, cy: f.y + f.dy + f.h / 2, w: f.w * pad, h: f.h * pad };
  };
  /** How much of the viewport the homepage frame covers under camera `c` (1 = all of it). */
  const coverOf = (c: Cam) => {
    const hx = W / 2 + (HERO.x - c.cx) * c.z, hy = H / 2 + (HERO.y - c.cy) * c.z;
    const ix = Math.max(0, Math.min(W, hx + HERO.w * c.z) - Math.max(0, hx)), iy = Math.max(0, Math.min(H, hy + HERO.h * c.z) - Math.max(0, hy));
    return (ix * iy) / (W * H);
  };
  /** A commanded move (Work, Home, Open home) is playing: input waits until it lands. */
  const busy = () => !!sAnim || flight?.kind === 'home';
  const zMax = () => Math.max(ZMAX, homeCam().z * 1.6);

  /**
   * The camera along the portal. The first stretch is a plain page scroll (the homepage moves up
   * 1:1 with the scroll); then the scroll turns into the pull-back, and the frame arcs to its place.
   */
  const zoomT = (sv: number) => smoothstep(170, S_MAX, sv);
  function portalCam(sv: number): Cam {
    const hc = homeCam(), oc = overCam();
    const t = zoomT(sv);
    return { cx: lerp(hc.cx, oc.cx, t), cy: lerp(hc.cy + sv / hc.z, oc.cy, t), z: Math.exp(lerp(Math.log(hc.z), Math.log(oc.z), t)) };
  }
  /** Scroll input (wheel px, or a finger mapped to px) moves along the portal, both ways. */
  function portalInput(next: number, rate = 16) {
    if (place === 'home') S = ST = 0;
    else if (place === 'canvas') {
      S = ST = S_MAX;
      select(null);
      follow = -1;
    }
    place = 'portal';
    sAnim = null;
    next = clamp(next, 0, S_MAX);
    ST = next;
    sRate = rate;
  }
  /** Play the portal to one end (only for explicit commands: the Work button, Home, Open home). */
  function portalTo(target: number, ms?: number, carry = false) {
    if (place === 'home') S = ST = 0;
    else if (place === 'canvas') {
      S = ST = S_MAX;
      select(null);
      follow = -1;
    }
    place = 'portal';
    ST = target;
    sAnim = { from: S, to: target, t0: performance.now(), ms: ms ?? 420 + (780 * Math.abs(target - S)) / S_MAX, carry };
  }
  function arrive() {
    place = 'canvas';
    S = ST = S_MAX;
    sAnim = null;
    Object.assign(free, overCam());
    // you came from Home, so it is the selection: scroll back up (or zoom in) and you return
    select('home');
    fresh = true;
    wheelLock = true;
  }

  function select(next: number | 'home' | null) {
    if (next === selected) return;
    if (typeof selected === 'number') frameEls[selected].classList.remove('is-selected');
    selected = next;
    if (typeof next === 'number') frameEls[next].classList.add('is-selected');
    app.classList.toggle('is-hero-selected', next === 'home');
  }

  /** The visitor did something else part-way along the portal: from here on it is just the canvas. */
  function leaveRail() {
    if (place !== 'portal' || sAnim) return;
    place = 'canvas';
    Object.assign(free, portalCam(S));
    ST = S;
    select('home');
    fresh = false;
  }
  /** The camera has come to rest exactly on the homepage. */
  function enterHome() {
    place = 'home';
    S = ST = 0;
    sAnim = null;
    flight = null;
    fresh = false;
    wheelLock = true;
    homeGestures.wheelQuietUntil = performance.now() + 200;
    select(null);
  }

  /** Homepage → canvas (the Work button, keys). */
  function flyOut() {
    if (place !== 'home') return;
    portalTo(S_MAX, 1300);
  }
  /** Canvas → homepage. */
  function flyHome(ms = 950) {
    if (place === 'home' || busy()) return;
    gesture = null;
    app.classList.remove('is-dragging');
    wheelLock = true;
    // still on the portal's path: go back the way you came. Otherwise fly straight in.
    if (place === 'portal') portalTo(0);
    else if (fresh) portalTo(0, 1200);
    else {
      flight = { from: { ...cam }, to: homeCam(), t0: performance.now(), ms, kind: 'home' };
      follow = -1;
    }
  }
  /** An explicit jump on the canvas (nav chips, minimap, zoom to fit). */
  function flyTo(box: Box, ms = 700) {
    if (place !== 'canvas' || busy()) return;
    fresh = false;
    follow = -1;
    flight = { from: { ...cam }, to: camFor(box), t0: performance.now(), ms, kind: 'canvas' };
  }
  /** The visitor took the camera: any jump in progress stops where it is. */
  function touched() {
    fresh = false;
    follow = -1;
    if (flight?.kind === 'canvas') flight = null;
  }
  function panBy(dx: number, dy: number) {
    touched();
    free.cx += dx / free.z;
    free.cy += dy / free.z;
  }
  /**
   * Canvas zoom by factor `f` about a screen point, exactly as much as the input asks for.
   * One refinement: zooming in on the selected Home frame steers the camera onto that frame in step
   * with the zoom (`onHome`), so when the zoom reaches the homepage's own scale it sits exactly on it.
   */
  function zoomAt(sx: number, sy: number, f: number, onHome = false) {
    touched();
    const hc = homeCam();
    // zoomed in until the homepage covers most of the view: it becomes the target of the zoom
    if (f > 1 && selected !== 'home' && coverOf(free) > 0.85) select('home');
    if (f > 1 && selected === 'home' && free.z < hc.z && (onHome || inHero(toBoard(sx, sy)))) {
      const z = Math.min(free.z * f, hc.z);
      const t = clamp(Math.log(z / free.z) / Math.log(hc.z / free.z), 0, 1);
      free.cx = lerp(free.cx, hc.cx, t);
      free.cy = lerp(free.cy, hc.cy, t);
      free.z = z;
      if (z >= hc.z * 0.9995) enterHome();
      return;
    }
    const bx = (sx - W / 2) / free.z + free.cx, by = (sy - H / 2) / free.z + free.cy;
    free.z = clamp(free.z * f, ZMIN, zMax());
    free.cx = bx - (sx - W / 2) / free.z;
    free.cy = by - (sy - H / 2) / free.z;
  }
  /** Zooming out of the homepage: from here it is the canvas, with Home still the selection. */
  function leaveHome() {
    if (place !== 'home') return;
    place = 'canvas';
    Object.assign(free, homeCam());
    select('home');
    fresh = false;
  }

  // ── tools ────────────────────────────────────────────────────────────────
  let tool: Tool = 'hand';
  let color = COLORS[0];
  let stampKind = 'heart';
  let comments = false;

  function setTool(t: Tool, quiet = false) {
    tool = t;
    app.dataset.tool = t;
    ghost.innerHTML = STAMPS[stampKind];
    renderTools();
    if (quiet || t === 'hand') return;
    toast(
      t === 'marker' ? 'Marker · draw anywhere. It stays in your browser.'
      : t === 'stamp' ? 'Stamps · click the work you like'
      : t === 'note' ? 'Sticky notes · click to leave one'
      : 'Move · drag frames around. Tidy up puts them back.');
  }
  function renderTools() {
    const moved = FRAMES.some((f) => f.dx || f.dy);
    const btn = (id: string, label: string, key: string) => {
      const pressed = (TOOLS as string[]).includes(id) ? tool === id : id === 'comments' ? comments : false;
      return `<button type="button" class="bd-tool" data-act="${id}" aria-label="${label}" title="${label}${key ? ` · ${key}` : ''}" aria-pressed="${pressed}">${ICON[id]}</button>`;
    };
    toolsEl.innerHTML =
      btn('hand', 'Hand', 'H') + btn('move', 'Move frames', 'V') + '<hr>' +
      btn('marker', 'Marker', 'P') + btn('stamp', 'Stamp', 'S') + btn('note', 'Sticky note', 'N') + btn('comments', 'Designer’s notes', 'C') + '<hr>' +
      btn('undo', 'Undo', '⌘Z') + (moved ? btn('tidy', 'Tidy up', '') : '') + (history.length ? btn('clear', 'Clear my marks', '') : '');
    trays.marker.classList.toggle('is-on', tool === 'marker');
    trays.stamp.classList.toggle('is-on', tool === 'stamp');
  }
  trays.marker.innerHTML = COLORS.map((c) => `<button type="button" data-c="${c}" aria-label="Colour ${c}"><span class="sw" style="background:${c}"></span></button>`).join('');
  trays.stamp.innerHTML = Object.keys(STAMPS).map((k) => `<button type="button" data-s="${k}" aria-label="${k} stamp">${STAMPS[k]}</button>`).join('');
  const syncTrays = () => {
    trays.marker.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === color)));
    trays.stamp.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === stampKind)));
  };
  const btnOf = (e: Event) => (e.target as Element).closest<HTMLButtonElement>('button');
  on(trays.marker, 'click', (e: MouseEvent) => {
    const b = btnOf(e);
    if (b?.dataset.c) {
      color = b.dataset.c;
      syncTrays();
    }
  });
  on(trays.stamp, 'click', (e: MouseEvent) => {
    const b = btnOf(e);
    if (b?.dataset.s) {
      stampKind = b.dataset.s;
      ghost.innerHTML = STAMPS[stampKind];
      syncTrays();
    }
  });
  syncTrays();
  const toggleComments = () => {
    comments = !comments;
    app.classList.toggle('show-comments', comments);
    renderTools();
    if (comments) toast('Designer’s notes on · click a pin');
  };
  on(toolsEl, 'click', (e: MouseEvent) => {
    const a = btnOf(e)?.dataset.act;
    if (!a) return;
    if ((TOOLS as string[]).includes(a)) setTool(a as Tool);
    else if (a === 'comments') toggleComments();
    else if (a === 'undo') undo();
    else if (a === 'tidy') tidyUp();
    else if (a === 'clear') clearMarks();
  });

  // nav: Home, and jumps to the whole board or one section (explicit, like "zoom to fit")
  nav.innerHTML =
    `<button type="button" class="is-home" data-go="home" title="Back to the homepage">${ICON.home}<span>Home</span></button><hr>` +
    `<button type="button" data-go="all" title="Zoom to fit · Shift+1">Overview</button>` +
    L.stops.map((st, i) => `<button type="button" data-go="${i}">${st.name}</button>`).join('');
  on(nav, 'click', (e: MouseEvent) => {
    const go = btnOf(e)?.dataset.go;
    if (go == null) return;
    if (go === 'home') flyHome();
    else {
      leaveRail();
      flyTo(go === 'all' ? OVER : L.stops[+go].boxes[0]);
    }
  });

  // ── visitor marks: strokes, stamps, notes, frame moves (persisted, undoable) ──
  const marks: { strokes: Stroke[]; stamps: Stamp[]; notes: Note[] } = { strokes: [], stamps: [], notes: [] };
  const history: Action[] = [];
  const stampedFrames = new Set<number>();
  let confettiDone = false;
  const smooth = (pts: Pt[]) => {
    if (pts.length < 2) return `M${pts[0][0]},${pts[0][1]} l0.1,0`;
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${pts[i][0]},${pts[i][1]} ${mx.toFixed(1)},${my.toFixed(1)}`;
    }
    const l = pts[pts.length - 1];
    return `${d} L${l[0]},${l[1]}`;
  };
  function drawStroke(s: Stroke) {
    s.el = ink.appendChild(svg('path', { d: smooth(s.pts), stroke: s.c }));
  }
  function drawStamp(s: Stamp) {
    s.el = h('div', { class: 'bd-stamp', style: `left:${s.x}px;top:${s.y}px;--r:${s.r}deg` });
    s.el.innerHTML = STAMPS[s.k] ?? STAMPS.heart;
    stampLayer.append(s.el);
  }
  function drawNote(n: Note) {
    const text = h('div', { contenteditable: 'true', spellcheck: 'false' });
    text.textContent = n.text || '';
    const del = h('button', { type: 'button', 'aria-label': 'Delete note' }, '✕');
    const el = h('div', { class: 'bd-sticky', style: `left:${n.x}px;top:${n.y}px;--r:${n.r}deg`, 'data-c': n.c }, text, del);
    n.el = el;
    on(text, 'input', () => {
      n.text = (text.textContent ?? '').slice(0, 160);
      save();
    });
    on(text, 'pointerdown', (e: PointerEvent) => e.stopPropagation());
    on(del, 'pointerdown', (e: PointerEvent) => e.stopPropagation());
    on(del, 'click', () => {
      el.remove();
      marks.notes = marks.notes.filter((x) => x !== n);
      save();
      renderTools();
    });
    // drag a note by anything but its text
    on(el, 'pointerdown', (e: PointerEvent) => {
      e.stopPropagation();
      const start = toBoard(e.clientX, e.clientY), ox = n.x, oy = n.y;
      const dragAc = new AbortController();
      const mv = (ev: PointerEvent) => {
        const p = toBoard(ev.clientX, ev.clientY);
        n.x = ox + p.x - start.x;
        n.y = oy + p.y - start.y;
        el.style.left = `${n.x}px`;
        el.style.top = `${n.y}px`;
      };
      const up = () => {
        dragAc.abort();
        save();
      };
      addEventListener('pointermove', mv, { signal: dragAc.signal });
      addEventListener('pointerup', up, { signal: dragAc.signal });
      addEventListener('pointercancel', up, { signal: dragAc.signal });
      ac.signal.addEventListener('abort', () => dragAc.abort(), { once: true });
    });
    noteLayer.append(el);
    return text;
  }
  let saveT = 0;
  function save() {
    clearTimeout(saveT);
    saveT = window.setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          strokes: marks.strokes.map(({ c, pts }) => ({ c, pts })),
          stamps: marks.stamps.map(({ k, x, y, r, f }) => ({ k, x, y, r, f })),
          notes: marks.notes.map(({ x, y, r, c, text }) => ({ x, y, r, c, text })),
          moves: Object.fromEntries(FRAMES.filter((f) => f.dx || f.dy).map((f) => [f.work.id, [f.dx, f.dy]])),
        }));
      } catch {
        /* storage unavailable: marks last for this visit only */
      }
    }, 250);
  }
  function load() {
    let data: { strokes?: Stroke[]; stamps?: Stamp[]; notes?: Note[]; moves?: Record<string, unknown> } | null = null;
    try {
      data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch {
      /* ignore */
    }
    if (!data) return;
    (data.strokes ?? []).forEach((s) => {
      if (Array.isArray(s.pts) && s.pts.length) {
        marks.strokes.push(s);
        drawStroke(s);
        history.push({ t: 'stroke', s });
      }
    });
    (data.stamps ?? []).forEach((s) => {
      marks.stamps.push(s);
      drawStamp(s);
      history.push({ t: 'stamp', s });
      if (s.f >= 0) stampedFrames.add(s.f);
    });
    (data.notes ?? []).forEach((n) => {
      marks.notes.push(n);
      drawNote(n);
      history.push({ t: 'note', n });
    });
    FRAMES.forEach((f, i) => {
      const m = data?.moves?.[f.work.id];
      if (Array.isArray(m)) {
        f.dx = +m[0] || 0;
        f.dy = +m[1] || 0;
        placeFrame(i);
      }
    });
    placeComments();
    syncMini();
    if (stampedFrames.size >= 5) confettiDone = true;
  }
  function undo() {
    const a = history.pop();
    if (!a) return toast('Nothing to undo');
    if (a.t === 'stroke') {
      a.s.el?.remove();
      marks.strokes = marks.strokes.filter((x) => x !== a.s);
    } else if (a.t === 'stamp') {
      a.s.el?.remove();
      marks.stamps = marks.stamps.filter((x) => x !== a.s);
    } else if (a.t === 'note') {
      a.n.el?.remove();
      marks.notes = marks.notes.filter((x) => x !== a.n);
    } else {
      const f = FRAMES[a.i];
      f.dx = a.dx;
      f.dy = a.dy;
      placeFrame(a.i);
      placeComments();
      syncMini();
    }
    save();
    renderTools();
  }
  function tidyUp() {
    FRAMES.forEach((f, i) => {
      if (f.dx || f.dy) history.push({ t: 'move', i, dx: f.dx, dy: f.dy });
      f.dx = 0;
      f.dy = 0;
      placeFrame(i);
    });
    placeComments();
    syncMini();
    save();
    renderTools();
    toast('Tidied up');
  }
  function clearMarks() {
    marks.strokes.forEach((s) => s.el?.remove());
    marks.stamps.forEach((s) => s.el?.remove());
    marks.notes.forEach((n) => n.el?.remove());
    marks.strokes = [];
    marks.stamps = [];
    marks.notes = [];
    for (let i = history.length - 1; i >= 0; i--) if (history[i].t !== 'move') history.splice(i, 1);
    stampedFrames.clear();
    save();
    renderTools();
    toast('Your marks are cleared');
  }
  function placeStamp(bx: number, by: number) {
    const fi = frameAt(bx, by);
    const s: Stamp = { k: stampKind, x: Math.round(bx), y: Math.round(by), r: Math.round((Math.random() - 0.5) * 30), f: fi };
    marks.stamps.push(s);
    drawStamp(s);
    history.push({ t: 'stamp', s });
    if (fi >= 0) stampedFrames.add(fi);
    save();
    renderTools();
    if (!confettiDone && stampedFrames.size >= 5) {
      confettiDone = true;
      confetti();
      toast('Five pieces stamped. Thank you ✦');
    }
  }
  function placeNote(bx: number, by: number) {
    const n: Note = { x: Math.round(bx - 110), y: Math.round(by - 95), r: Math.round((Math.random() - 0.5) * 8), c: ['yellow', 'pink', 'mint'][marks.notes.length % 3], text: '' };
    marks.notes.push(n);
    const text = drawNote(n);
    history.push({ t: 'note', n });
    save();
    renderTools();
    // focus now, not on a timer (a late timer would steal focus back); preventScroll keeps the layer still
    text.focus({ preventScroll: true });
  }

  // ── small pleasures ──────────────────────────────────────────────────────
  let confettiRaf = 0;
  function confetti() {
    const ctx = confettiCv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    confettiCv.width = W * dpr;
    confettiCv.height = H * dpr;
    const cols = ['#d7ff3a', '#ff4fd8', '#46c8ff', '#ffd23f', '#ff6b1a', '#ffffff'];
    const ps = Array.from({ length: 140 }, () => ({ x: W / 2, y: H * 0.55, vx: (Math.random() - 0.5) * 16, vy: -8 - Math.random() * 14, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, c: cols[(Math.random() * cols.length) | 0] }));
    const t0 = performance.now();
    const step = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ps.forEach((p) => {
        p.vy += 0.42;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (now - t0 < 3200) confettiRaf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, H);
    };
    confettiRaf = requestAnimationFrame(step);
  }

  let toastT = 0;
  function toast(msg: string, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = window.setTimeout(() => toastEl.classList.remove('is-on'), ms);
  }

  function startFollow(i: number) {
    if (place !== 'canvas' || busy()) return;
    touched();
    follow = i;
    free.z = clamp(fitZ({ w: 1400, h: 1000 }), ZMIN, ZMAX);
    toast(`Following ${CURSORS[i].name} · Esc to stop`, 4000);
  }

  // ── case studies ─────────────────────────────────────────────────────────
  const cases = createCaseStudies({
    // a case study opened by address shouldn't strand the visitor on the homepage behind it
    onChange: (open) => {
      if (open && place === 'home' && !flight) place = 'canvas';
    },
    sourceOf: (work) => frameEls[FRAMES.findIndex((f) => f.work === work)]?.querySelector<HTMLElement>('.bd-media') ?? null,
  });
  const openCase = (i: number) => cases.open(FRAMES[i].work, frameEls[i].querySelector<HTMLElement>('.bd-media'));

  // ── pointer input (canvas) ───────────────────────────────────────────────
  const ptrs = new Map<number, { x: number; y: number }>();
  let gesture: Gesture | null = null;
  /** A finger's travel → portal scroll: 1:1 at first (the page sticks to the finger), then geared up. */
  const fingerS = (d: number) => (d <= 0 ? 0 : d < 110 ? d : 110 + (d - 110) * 2.5);
  let lastTap = { t: 0, key: '' };

  on(app, 'pointerdown', (e: PointerEvent) => {
    if (place === 'home' || busy()) return;
    const target = e.target as Element;
    if (target.closest('.bd-glass, .bd-cmt, .bd-sticky, .bd-cursor b, .bd-open, .bd-play, .home, .case')) return;
    // part-way along the portal, a finger keeps scrolling it (up or down), like the page it still is
    if (place === 'portal' && e.pointerType === 'touch' && ptrs.size === 0 && e.button === 0) {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      gesture = { kind: 'portal', y: e.clientY, s0: ST };
      fingerV = 0;
      return;
    }
    leaveRail();
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    ptrs.set(e.pointerId, { x: sx, y: sy });
    if (ptrs.size === 2) {
      if (gesture?.kind === 'draw') return;
      touched();
      app.classList.remove('is-dragging');
      const [a, b] = [...ptrs.values()];
      const m0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture = { kind: 'pinch', d0: Math.hypot(b.x - a.x, b.y - a.y), z0: free.z, m0, c0: { cx: free.cx, cy: free.cy }, home: selected === 'home' && inHero(toBoard(m0.x, m0.y)) };
      return;
    }
    if (ptrs.size > 2) return;
    const p = toBoard(sx, sy);
    const fi = frameAt(p.x, p.y);
    if (tool === 'marker') {
      const s: Stroke = { c: color, pts: [[Math.round(p.x), Math.round(p.y)]] };
      drawStroke(s);
      gesture = { kind: 'draw', s };
    } else if (tool === 'move' && fi >= 0) {
      select(fi);
      gesture = { kind: 'move', i: fi, start: p, dx0: FRAMES[fi].dx, dy0: FRAMES[fi].dy, moved: false };
      frameEls[fi].classList.add('is-dragged');
    } else {
      gesture = { kind: 'pan', x: sx, y: sy, moved: false, touch: e.pointerType === 'touch', fi, startCam: { ...free } };
    }
    try {
      app.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
  on(app, 'pointermove', (e: PointerEvent) => {
    const sx = e.clientX, sy = e.clientY;
    if (gesture?.kind === 'portal') {
      // a finger that pulled the canvas back down keeps hold of the portal until it lifts
      if (ptrs.has(e.pointerId)) {
        const d = sy - gesture.y;
        fingerTo(gesture.s0 - Math.sign(d) * fingerS(Math.abs(d)));
      }
      return;
    }
    if (place !== 'canvas') return;
    const target = e.target as Element;
    if (e.pointerType === 'mouse') {
      const onHud = !!target.closest?.('.bd-glass');
      youTag.style.transform = `translate(${sx + 14}px, ${sy + 16}px)`;
      youTag.classList.toggle('is-on', !onHud);
      ghost.style.transform = `translate(${sx}px, ${sy}px)`;
      ghost.classList.toggle('is-on', !onHud);
      app.classList.toggle('is-hero-hover', !onHud && !gesture && !busy() && (tool === 'hand' || tool === 'move') && inHero(toBoard(sx, sy)));
      const f3 = target.closest?.<HTMLElement>('.bd-frame.is-3d') ?? null;
      frameEls.forEach((el) => {
        if (el !== f3 && el.style.getPropertyValue('--tx')) {
          el.style.removeProperty('--tx');
          el.style.removeProperty('--ty');
        }
      });
      if (f3) {
        const r = f3.getBoundingClientRect();
        f3.style.setProperty('--ty', `${(((sx - r.left) / r.width - 0.5) * 14).toFixed(1)}deg`);
        f3.style.setProperty('--tx', `${(-((sy - r.top) / r.height - 0.5) * 14).toFixed(1)}deg`);
      }
    }
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: sx, y: sy });
    const g = gesture;
    if (!g || busy()) return;
    if (g.kind === 'pinch') {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ratio = d / Math.max(1, g.d0);
      // the canvas follows the fingers: it slides with them and zooms by how far they spread
      panBy(g.m0.x - m.x, g.m0.y - m.y);
      g.m0 = m;
      zoomAt(m.x, m.y, clamp(g.z0 * ratio, ZMIN, zMax()) / free.z, g.home);
      if (place !== 'canvas') gesture = null; // landed on the homepage
    } else if (g.kind === 'draw') {
      const p = toBoard(sx, sy), pts = g.s.pts, l = pts[pts.length - 1];
      if (Math.hypot(p.x - l[0], p.y - l[1]) > 3 / cam.z) {
        pts.push([Math.round(p.x), Math.round(p.y)]);
        g.s.el?.setAttribute('d', smooth(pts));
      }
    } else if (g.kind === 'move') {
      const p = toBoard(sx, sy), f = FRAMES[g.i];
      f.dx = Math.round(g.dx0 + p.x - g.start.x);
      f.dy = Math.round(g.dy0 + p.y - g.start.y);
      g.moved = true;
      placeFrame(g.i);
    } else {
      const dx = sx - g.x, dy = sy - g.y;
      // just arrived from the homepage (touch): pulling back down scrolls the portal back, under the finger
      if (g.touch && !g.moved && fresh && selected === 'home' && dy > 6 && Math.abs(dy) > Math.abs(dx)) {
        gesture = { kind: 'portal', y: g.y, s0: S_MAX };
        fingerTo(S_MAX - fingerS(dy));
        return;
      }
      if (!g.moved && Math.hypot(dx, dy) > 5) {
        g.moved = true;
        app.classList.add('is-dragging');
      }
      if (!g.moved) return;
      touched();
      free.cx = g.startCam.cx - dx / free.z;
      free.cy = g.startCam.cy - dy / free.z;
    }
  });
  const endPtr = (e: PointerEvent) => {
    if (!ptrs.delete(e.pointerId)) return;
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (ptrs.size < 2) gesture = null;
      return;
    }
    gesture = null;
    app.classList.remove('is-dragging');
    if (g.kind === 'portal') return coast();
    if (g.kind === 'draw') {
      marks.strokes.push(g.s);
      history.push({ t: 'stroke', s: g.s });
      save();
      renderTools();
    } else if (g.kind === 'move') {
      frameEls[g.i].classList.remove('is-dragged');
      if (g.moved) {
        history.push({ t: 'move', i: g.i, dx: g.dx0, dy: g.dy0 });
        placeComments();
        syncMini();
        save();
        renderTools();
      }
    } else if (!g.moved && e.type === 'pointerup') tap(e.clientX, e.clientY, g.fi);
  };
  on(app, 'pointerup', endPtr);
  on(app, 'pointercancel', endPtr);
  on(app, 'pointerleave', (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    youTag.classList.remove('is-on');
    ghost.classList.remove('is-on');
    app.classList.remove('is-hero-hover');
  });

  /** A click selects, like on any canvas. It never moves the camera. Double-click opens (Home, case studies). */
  function tap(sx: number, sy: number, fi: number) {
    const p = toBoard(sx, sy);
    if (tool === 'stamp') return placeStamp(p.x, p.y);
    if (tool === 'note') return placeNote(p.x, p.y);
    const now = performance.now();
    const key = inHero(p) ? 'home' : fi >= 0 ? String(fi) : '';
    const twice = key !== '' && lastTap.key === key && now - lastTap.t < 380;
    lastTap = { t: twice ? 0 : now, key };
    if (key === 'home') {
      select('home');
      if (twice) flyHome();
    } else if (fi >= 0) {
      select(fi);
      if (twice && FRAMES[fi].work.type === 'ux') openCase(fi);
    } else select(null);
  }
  frameEls.forEach((el, i) =>
    on(el, 'keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      select(i);
      if (e.key === 'Enter' && FRAMES[i].work.type === 'ux') openCase(i);
    }),
  );
  // the explicit buttons: ▶ and "Open case study" on product frames, "Open home" on the Home frame
  on(stage, 'click', (e: MouseEvent) => {
    const b = (e.target as Element).closest('.bd-play, .bd-open');
    const f = b?.closest<HTMLElement>('.bd-frame');
    if (f?.dataset.i != null) openCase(+f.dataset.i);
  });
  on(heroOpen, 'click', () => flyHome());

  // wheel. Homepage: a slight scroll flies out. Canvas: scroll pans, ⌘/Ctrl + scroll (or a trackpad pinch) zooms.
  let lastWheel = 0;
  on(app, 'wheel', (e: WheelEvent) => {
    if (cases.isOpen()) return;
    if (e.defaultPrevented) return; // a toy on the homepage took it
    const target = e.target as Element;
    const now = performance.now();
    const gap = now - lastWheel;
    lastWheel = now;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const zoomGesture = e.ctrlKey || e.metaKey;
    if (busy()) return e.preventDefault();
    if (place === 'home' || place === 'portal') {
      // the island's open panel scrolls by itself; everywhere else a scroll belongs to the page
      if (place === 'home' && target.closest('.ui-island[data-open], .ui-rail')) return;
      e.preventDefault();
      if (wheelLock && gap < 140) return;
      wheelLock = false;
      if (zoomGesture) {
        // a zoom is a zoom: plain canvas zoom at the cursor, by as much as was asked
        if (place === 'home' && dy <= 0) return;
        leaveHome();
        leaveRail();
        zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0045));
        return;
      }
      // a scroll runs along the portal, as far as it is scrolled
      if (place === 'home' && dy <= 0) return;
      portalInput((place === 'home' ? 0 : ST) + dy);
      return;
    }
    if (target.closest('.bd-glass, .bd-sticky')) return;
    e.preventDefault();
    // the tail of a scroll that just landed (trackpad momentum) must not shove the canvas
    if (wheelLock && gap < 140) return;
    wheelLock = false;
    // right after arriving by the portal: scrolling back up runs it backwards
    if (!zoomGesture && dy < 0 && fresh && selected === 'home') return portalInput(S_MAX + dy);
    if (zoomGesture) zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0045));
    else panBy(dx, dy);
  }, { passive: false });

  const zoomStep = (f: number) => {
    if (place === 'home' || busy()) return;
    leaveRail();
    // with the Home frame selected, zooming in heads for the homepage
    zoomAt(W / 2, H / 2, f, selected === 'home');
  };
  on(zoomEl, 'click', (e: MouseEvent) => {
    const z = btnOf(e)?.dataset.z;
    if (z === 'fit') {
      leaveRail();
      flyTo(OVER);
    } else if (z) zoomStep(z === '1' ? 1.4 : 1 / 1.4);
  });
  on(mini, 'click', (e: MouseEvent) => {
    const r = miniSvg.getBoundingClientRect();
    const s = Math.min(r.width / BW, r.height / BH);
    const bx = (e.clientX - r.left - (r.width - BW * s) / 2) / s, by = (e.clientY - r.top - (r.height - BH * s) / 2) / s;
    leaveRail();
    flyTo({ cx: clamp(bx, 0, BW), cy: clamp(by, 0, BH), w: W / free.z, h: H / free.z }, 500);
  });

  // A finger driving the portal: remember how fast it was going, so letting go coasts like a scroll.
  let fingerV = 0;
  let fingerAt = 0;
  function fingerTo(next: number) {
    const now = performance.now();
    const dtv = Math.max(1, now - fingerAt);
    if (place === 'portal' && dtv < 120) fingerV = lerp(fingerV, ((clamp(next, 0, S_MAX) - ST) / dtv) * 1000, 0.5);
    else fingerV = 0;
    fingerAt = now;
    portalInput(next, 40);
  }
  function coast() {
    if (place !== 'portal' || sAnim) return;
    if (performance.now() - fingerAt < 100 && Math.abs(fingerV) > 80) portalInput(ST + clamp(fingerV * 0.28, -600, 600), 5);
    fingerV = 0;
  }

  // gestures on the empty part of the homepage: a swipe up scrolls the portal under the finger,
  // a pinch zooms the canvas between the fingers
  let swipeY = 0;
  homeGestures.drag = (phase: GesturePhase, _x: number, y: number, pointerType: string) => {
    if (pointerType === 'mouse') return;
    if (phase === 'start') {
      swipeY = y;
      holding = true;
    } else if (phase === 'move') {
      if (!holding || place === 'canvas' || busy()) return;
      const d = swipeY - y;
      if (place === 'portal' || d > 6) fingerTo(fingerS(d));
    } else {
      holding = false;
      coast();
    }
  };
  homeGestures.pinch = (phase: GesturePhase, ratio: number, x: number, y: number) => {
    if (phase === 'start') holding = true;
    else if (phase === 'end') holding = false;
    else if (!busy()) {
      if (place === 'home' && ratio > 0.985) return;
      leaveHome();
      leaveRail();
      zoomAt(x, y, clamp(homeCam().z * Math.min(1, ratio), ZMIN, zMax()) / free.z);
    }
  };
  homeGestures.openBoard = () => flyOut();

  // keyboard
  on(window, 'keydown', (e: KeyboardEvent) => {
    if (cases.isOpen()) return;
    if (isTyping(e.target)) {
      // Esc finishes a sticky note
      if (e.key === 'Escape' && (e.target as HTMLElement).closest('.bd-sticky')) (e.target as HTMLElement).blur();
      return;
    }
    const k = e.key.toLowerCase();
    if (busy()) return;
    if (place === 'home') {
      if (host.hasSelection() || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element | null)?.closest?.('.ui')) return;
      if (k === 'pagedown' || k === 'arrowdown' || k === 'end') {
        e.preventDefault();
        flyOut();
      }
      return;
    }
    leaveRail();
    if (k === 'escape') {
      if (follow >= 0) {
        follow = -1;
        toast('Stopped following');
      } else if (tool !== 'hand') setTool('hand');
      else select(null);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && k === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (k === 'home') return flyHome();
    if (k === 'enter') {
      if (selected === 'home') flyHome();
      else if (typeof selected === 'number' && FRAMES[selected].work.type === 'ux') openCase(selected);
      return;
    }
    if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) return flyTo(OVER, 600);
    if (e.shiftKey && (e.key === '@' || e.code === 'Digit2')) {
      if (selected === 'home') flyHome();
      else if (typeof selected === 'number') flyTo(frameBox(selected), 600);
      return;
    }
    const map: Record<string, Tool> = { h: 'hand', v: 'move', p: 'marker', m: 'marker', s: 'stamp', n: 'note' };
    if (map[k]) return setTool(map[k]);
    if (k === 'c') return toggleComments();
    if (k === '=' || k === '+') zoomStep(1.3);
    else if (k === '-') zoomStep(1 / 1.3);
    else if (k === '0') zoomAt(W / 2, H / 2, 1 / free.z);
    else if (k === 'arrowleft') panBy(-80, 0);
    else if (k === 'arrowright') panBy(80, 0);
    else if (k === 'arrowup') panBy(0, -80);
    else if (k === 'arrowdown') panBy(0, 80);
    else return;
    e.preventDefault();
  });

  const onResize = () => {
    W = Math.max(1, app.clientWidth);
    H = Math.max(1, app.clientHeight);
    layoutHero();
    placeHero();
    if (fresh) Object.assign(free, overCam());
    wasHome = null;
  };
  on(window, 'resize', onResize);

  // ── the board assembles around the homepage as the portal opens ──────────
  // each section and frame pops in a little later the further it is from Home
  const pieces: { el: HTMLElement; d: number; k: number }[] = [];
  {
    const far = Math.hypot(BW, BH) / 2;
    const dist = (x: number, y: number) => Math.min(1, Math.hypot(x - HERO_C.x, y - HERO_C.y) / far);
    under.querySelectorAll<HTMLElement>('.bd-sec').forEach((el, i) => {
      const sec = SECTIONS[i];
      pieces.push({ el, d: 0.12 + 0.3 * dist(sec.x + sec.w / 2, sec.y + sec.h / 2), k: 1 });
    });
    FRAMES.forEach((f, i) => pieces.push({ el: frameEls[i], d: 0.2 + 0.46 * dist(f.x + f.w / 2, f.y + f.h / 2), k: 1 }));
  }
  function assemble(r: number) {
    for (const p of pieces) {
      const k = r >= 1 ? 1 : ease(clamp((r - p.d) / 0.3, 0, 1));
      if (Math.abs(k - p.k) < 0.004 && !(k === 1 && p.k !== 1) && !(k === 0 && p.k !== 0)) continue;
      p.k = k;
      p.el.style.opacity = k === 1 ? '' : k.toFixed(3);
      p.el.style.scale = k === 1 ? '' : (0.86 + 0.14 * k).toFixed(4);
    }
  }

  // ── render loop ──────────────────────────────────────────────────────────
  let raf = 0;
  let last = performance.now();
  let chatT = 6;
  let wasHome: boolean | null = null;
  let hudOn = false;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const tsec = now / 1000;

    if (place === 'portal') {
      // it only ever goes where the wheel or the finger put it (a little smoothing, no pace of its own)
      if (sAnim) {
        const t = clamp((now - sAnim.t0) / sAnim.ms, 0, 1);
        S = lerp(sAnim.from, sAnim.to, sAnim.carry ? 1 - Math.pow(1 - t, 2.6) : glide(t));
        if (t >= 1) S = sAnim.to;
      } else S = Math.abs(ST - S) < 0.5 ? ST : lerp(S, ST, 1 - Math.exp(-dt * sRate));
      if (S >= S_MAX && ST >= S_MAX) arrive();
      else if (S <= 0 && ST <= 0 && !holding && gesture?.kind !== 'portal') enterHome();
    }
    if (place === 'portal') Object.assign(cam, portalCam(S));
    else if (flight) {
      const t = clamp((now - flight.t0) / flight.ms, 0, 1);
      const c = mixCam(flight.from, flight.kind === 'home' ? homeCam() : flight.to, glide(t));
      Object.assign(cam, c);
      if (flight.kind === 'canvas') Object.assign(free, c);
      if (t >= 1) {
        if (flight.kind === 'home') enterHome();
        flight = null;
      }
    } else if (place === 'canvas') {
      if (follow >= 0) {
        const c = cursorPos(CURSORS[follow], tsec);
        free.cx = lerp(free.cx, c.x, 1 - Math.exp(-dt * 3));
        free.cy = lerp(free.cy, c.y, 1 - Math.exp(-dt * 3));
      }
      Object.assign(cam, free);
    } else Object.assign(cam, homeCam());

    // (not while a finger that started on the homepage is still down: it holds the pointer capture)
    const inertNow = !atHome && !holding;
    if (home.inert !== inertNow) home.inert = inertNow;

    const nowHome = place === 'home' && !flight;
    if (nowHome && wasHome === true) return; // resting on the homepage: nothing to draw

    const z = cam.z;
    const tx = W / 2 - cam.cx * z, ty = H / 2 - cam.cy * z;
    // the homepage layer follows its frame
    const hx = tx + HERO.x * z, hy = ty + HERO.y * z, k = (z * HERO.w) / W;
    const ix = Math.max(0, Math.min(W, hx + W * k) - Math.max(0, hx)), iy = Math.max(0, Math.min(H, hy + H * k) - Math.max(0, hy));
    cover = nowHome ? 1 : Math.min(1, (ix * iy) / (W * H));
    if (nowHome) {
      home.style.transform = '';
      home.style.borderRadius = '';
      homeView.x = homeView.y = 0;
      homeView.k = 1;
    } else {
      // through the portal the page tips back a little, like a card lifted off the board and set down
      const tilt = place === 'portal' ? 5 * Math.sin(Math.PI * zoomT(S)) : 0;
      home.style.transform =
        tilt > 0.02
          ? `translate3d(${(hx + (W * k) / 2).toFixed(2)}px, ${(hy + (H * k) / 2).toFixed(2)}px, 0) scale(${k.toFixed(5)}) perspective(2600px) rotateX(${tilt.toFixed(2)}deg) translate(${-W / 2}px, ${-H / 2}px)`
          : `translate3d(${hx.toFixed(2)}px, ${hy.toFixed(2)}px, 0) scale(${k.toFixed(5)})`;
      home.style.borderRadius = `${(((FRAME_R * W) / HERO.w) * clamp((1 - cover) / 0.1, 0, 1)).toFixed(2)}px`;
      homeView.x = hx;
      homeView.y = hy;
      homeView.k = k;
    }
    if (nowHome !== wasHome) {
      wasHome = nowHome;
      atHome = nowHome;
      homeView.home = nowHome;
      app.dataset.view = nowHome ? 'home' : 'board';
      app.classList.remove('is-hero-hover');
      stage.inert = nowHome;
      over.inert = nowHome;
      host.onView(nowHome ? 'home' : 'board');
    }
    const gl = ix > 0 && iy > 0 && !cases.isOpen();
    if (gl !== glActive) {
      glActive = gl;
      host.onGlActive(gl);
    }
    // the board's own chrome fades in as the homepage shrinks away, and out as it comes back
    const hudNow = !nowHome && cover < 0.78;
    if (hudNow !== hudOn) {
      hudOn = hudNow;
      app.classList.toggle('hud-on', hudNow);
      hud.inert = !hudNow;
    }

    const tf = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${z.toFixed(5)})`;
    under.style.transform = tf;
    top.style.transform = tf;
    under.style.setProperty('--s', z.toFixed(5));
    top.style.setProperty('--s', z.toFixed(5));
    over.style.opacity = (1 - smoothstep(0.6, 0.95, cover)).toFixed(3);
    const dot = 24 * z * (z < 0.4 ? 4 : z < 0.8 ? 2 : 1);
    stage.style.setProperty('--dot', `${dot.toFixed(2)}px`);
    stage.style.backgroundPosition = `${tx.toFixed(1)}px ${ty.toFixed(1)}px, 0 0`;
    zoomTxt.textContent = `${Math.round(z * 100)}%`;
    vp.setAttribute('x', (-tx / z).toFixed(0));
    vp.setAttribute('y', (-ty / z).toFixed(0));
    vp.setAttribute('width', (W / z).toFixed(0));
    vp.setAttribute('height', (H / z).toFixed(0));

    const r = place === 'portal' ? S / S_MAX : 1;
    assemble(r);
    cue.style.opacity = (smoothstep(0.05, 0.14, r) * (1 - smoothstep(0.34, 0.52, r))).toFixed(3);
    const draw = 1 - smoothstep(0.2, 0.75, cover);
    linkPaths.forEach((p, i) => (p.style.strokeDashoffset = (linkLen[i] * (1 - draw)).toFixed(1)));

    // visitors wander and now and then say something
    chatT -= dt;
    if (chatT <= 0 && hudOn) {
      chatT = 9 + Math.random() * 7;
      const i = (Math.random() * CURSORS.length) | 0, c = CURSORS[i];
      const q = cursorEls[i].querySelector('q')!;
      c.n = (c.n + 1) % c.says.length;
      q.textContent = c.says[c.n];
      q.classList.add('is-on');
      later(() => q.classList.remove('is-on'), 3200);
    }
    cursorEls.forEach((el, i) => {
      const c = cursorPos(CURSORS[i], tsec);
      el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) scale(${(1 / z).toFixed(4)})`;
    });

    const msg =
      tool === 'marker' ? 'Draw anywhere. <b>⌘Z</b> undoes. Saved in your browser.'
      : tool === 'stamp' ? 'Click a piece to stamp it.'
      : tool === 'note' ? 'Click anywhere to leave a note.'
      : tool === 'move' ? 'Drag frames around. <b>Tidy up</b> puts them back.'
      : selected === 'home' ? '<b>Home</b> is selected: zoom in on it to go back into the homepage.'
      : 'Scroll pans · <b>⌘/Ctrl + scroll</b> zooms · select <b>Home</b> and zoom in to go back.';
    if (tip.dataset.msg !== msg) {
      tip.dataset.msg = msg;
      tip.innerHTML = msg;
    }
  }

  ghost.innerHTML = STAMPS[stampKind];
  app.dataset.tool = tool;
  app.dataset.view = 'home';
  hud.inert = true;
  load();
  renderTools();
  // deep link: #work lands on the canvas
  if (startOnBoard || location.hash === '#work' || cases.isOpen()) place = 'canvas';
  raf = requestAnimationFrame(frame);

  return {
    atHome: () => place !== 'canvas',
    destroy() {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(confettiRaf);
      ac.abort();
      timers.forEach((id) => clearTimeout(id));
      clearTimeout(saveT);
      clearTimeout(toastT);
      cases.destroy();
      homeGestures.drag = homeGestures.pinch = homeGestures.openBoard = null;
      stage.replaceChildren();
      over.replaceChildren();
      hud.replaceChildren();
      home.style.transform = '';
      home.style.borderRadius = '';
      home.inert = false;
      stage.inert = over.inert = hud.inert = false;
      homeView.x = homeView.y = 0;
      homeView.k = 1;
      homeView.home = true;
      app.classList.remove('hud-on', 'show-comments', 'is-dragging', 'is-hero-hover', 'is-hero-selected');
      delete app.dataset.view;
      delete app.dataset.tool;
      host.onView('home');
      host.onGlActive(true);
    },
  };
}
