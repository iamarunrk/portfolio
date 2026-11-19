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
 * resting on that frame *is* the homepage). Two ways to move:
 *
 *  - Story: scrolling runs the camera along a rail: home → whole board → each section.
 *  - Explore: the board is a free canvas (pan, zoom, marker, stamps, notes, move frames).
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
  | { kind: 'pinch'; d0: number; z0: number; m0: { x: number; y: number }; c0: { cx: number; cy: number } }
  | { kind: 'draw'; s: Stroke }
  | { kind: 'move'; i: number; start: { x: number; y: number }; dx0: number; dy0: number; moved: boolean }
  | { kind: 'pan'; x: number; y: number; moved: boolean; touch: boolean; fi: number; startCam: Cam | null; sp: { px: number; py: number }; rail: boolean };

const FRAME_R = 14;
const DIMS: Record<string, string> = { '4/5': '1080 × 1350', '1/1': '1080 × 1080', '16/10': '1920 × 1200', '16/9': '1920 × 1080', '4/3': '1600 × 1200', '9/16': '1080 × 1920' };
const HOME_END = 600;
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
  explore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  tour: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
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
    const el = h('div', { class: `bd-frame is-${t}`, tabindex: '0', role: 'button', 'data-i': String(i), 'aria-label': t === 'ux' ? 'Open case study' : 'Zoom to this piece' });
    const media = h('div', { class: 'bd-media' });
    el.append(media);
    mountWork(f.work, media);
    el.append(h('div', { class: 'bd-sel' }, h('i'), h('i'), h('i'), h('i'), h('b', {}, DIMS[f.work.aspect] ?? `1600 × ${Math.round(1600 / aspectOf(f.work))}`)));
    if (t === 'motion') {
      el.append(h('div', { class: 'bd-timeline' }, h('em', {}, `0:0${3 + (i % 6)}`),
        h('span', {}, h('i', { style: 'left:18%' }), h('i', { style: 'left:55%' }), h('i', { style: 'left:82%' }), h('b'))));
    }
    if (t === 'ux') el.append(h('button', { class: 'bd-play', type: 'button', 'aria-label': 'Open case study', tabindex: '-1' }, '▶'));
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
  const heroSel = h('div', { class: 'bd-herosel' }, h('span', { class: 'bd-label' }, h('i'), 'Home'), h('b', {}, 'Open home'));
  const ink = svg('svg', { class: 'bd-ink', viewBox: `0 0 ${BW} ${BH}`, width: BW, height: BH });
  const stampLayer = h('div');
  const noteLayer = h('div');
  const cmtLayer = h('div');
  top.append(heroSel, ink, stampLayer, noteLayer, cmtLayer);

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
  const zoomTxt = h('span', {}, '100%');
  const zoomEl = h('div', { class: 'bd-glass bd-zoom' },
    h('button', { type: 'button', 'data-z': '-1', 'aria-label': 'Zoom out' }, '−'), zoomTxt, h('button', { type: 'button', 'data-z': '1', 'aria-label': 'Zoom in' }, '+'));
  const doneBtn = h('button', { class: 'bd-glass bd-done', type: 'button' }, 'Done', h('kbd', {}, 'Esc'));
  const right = h('div', { class: 'bd-right' }, doneBtn, zoomEl);
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
    layoutLinks();
    syncMini();
  }
  placeHero();

  // ── camera ───────────────────────────────────────────────────────────────
  type Key = [number, Box];
  interface Stop { id: string; name: string; s: number }
  let KEYS: Key[] = [];
  let STOPS: Stop[] = [];
  let RAIL_MAX = 0;
  const heroBox = (): Box => ({ cx: HERO.x + HERO.w / 2, cy: HERO.y + HERO.h / 2, w: HERO.w, h: HERO.h });
  function buildKeys() {
    const first = L.first(W / H);
    KEYS = [[0, heroBox()], [HOME_END, first]];
    STOPS = [{ id: 'all', name: 'Overview', s: HOME_END }];
    let at = HOME_END + 160;
    KEYS.push([at, first]);
    for (const stop of L.stops) {
      stop.boxes.forEach((box, i) => {
        at += i === 0 ? 760 : 560;
        if (i === 0) STOPS.push({ id: stop.id, name: stop.name, s: at });
        KEYS.push([at, box]);
        at += 380;
        KEYS.push([at, box]);
      });
    }
    at += 800;
    KEYS.push([at, OVER]);
    RAIL_MAX = at;
  }
  buildKeys();
  function boxAt(s: number): Box {
    let i = 0;
    while (i < KEYS.length - 2 && s > KEYS[i + 1][0]) i++;
    const [s0, a] = KEYS[i];
    const [s1, b] = KEYS[i + 1];
    const t = ease(clamp((s - s0) / Math.max(1e-6, s1 - s0), 0, 1));
    return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), w: Math.exp(lerp(Math.log(a.w), Math.log(b.w), t)), h: Math.exp(lerp(Math.log(a.h), Math.log(b.h), t)) };
  }
  const fitZ = (b: { w: number; h: number }) => Math.min(W / b.w, H / b.h);
  const homeCam = (): Cam => ({ cx: HERO.x + HERO.w / 2, cy: HERO.y + HERO.h / 2, z: W / HERO.w });
  const mixCam = (a: Cam, b: Cam, t: number): Cam => ({ cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)) });

  const cam: Cam = homeCam(); // what's on screen
  let mode: 'story' | 'explore' = 'story';
  let rail = 0; // story position (eased)
  let railT = 0; // story position (target)
  let railRate = 12;
  let lastDir = 1;
  let lastInput = -1e9;
  let holding = false; // a finger is driving the rail
  let free: Cam | null = null; // explore camera
  const story = { px: 0, py: 0 }; // temporary story pan (px)
  let focus: { i: number; t: number } | null = null; // story "zoom to frame"
  let tween: { from: Cam; to: Cam; t0: number; ms: number } | null = null; // explore flight
  let hand: { from: Cam; t0: number; ms: number } | null = null; // blend into the story camera
  let follow = -1;
  let atHome = true;
  let glActive = true;
  let cover = 1;

  const toBoard = (sx: number, sy: number) => ({ x: (sx - W / 2) / cam.z + cam.cx, y: (sy - H / 2) / cam.z + cam.cy });
  const inHero = (p: { x: number; y: number }) => p.x >= HERO.x && p.x <= HERO.x + HERO.w && p.y >= HERO.y && p.y <= HERO.y + HERO.h;
  const frameBox = (i: number, pad = 1.3): Box => {
    const f = FRAMES[i];
    return { cx: f.x + f.dx + f.w / 2, cy: f.y + f.dy + f.h / 2, w: f.w * pad, h: f.h * pad };
  };
  function zoomAt(sx: number, sy: number, f: number) {
    if (!free) return;
    const bx = (sx - W / 2) / free.z + free.cx, by = (sy - H / 2) / free.z + free.cy;
    free.z = clamp(free.z * f, ZMIN, ZMAX);
    free.cx = bx - (sx - W / 2) / free.z;
    free.cy = by - (sy - H / 2) / free.z;
    tween = null;
    follow = -1;
  }
  function flyTo(box: Box, ms = 700) {
    if (!free) return;
    tween = { from: { ...free }, to: { cx: box.cx, cy: box.cy, z: clamp(fitZ(box), ZMIN, ZMAX) }, t0: performance.now(), ms };
  }

  /** Move along the story rail by a scroll amount. */
  function railBy(d: number) {
    if (!d) return;
    stopTour();
    railT = clamp(railT + d, 0, RAIL_MAX);
    lastDir = Math.sign(d);
    lastInput = performance.now();
    railRate = 12;
    focus = null;
    story.px *= 0.85;
    story.py *= 0.85;
  }
  /** Fly the story camera straight to a rail position (no whip through the stops in between). */
  function flyRail(s: number, ms = 900) {
    stopTour();
    if (mode === 'explore') leaveExplore();
    hand = { from: { ...cam }, t0: performance.now(), ms };
    rail = railT = clamp(s, 0, RAIL_MAX);
    focus = null;
    story.px = story.py = 0;
    lastInput = -1e9;
  }
  const goHome = () => flyRail(0, 850);
  const stopIndex = () => {
    let best = -1;
    STOPS.forEach((st, i) => {
      if (rail >= st.s - 300) best = i;
    });
    if (rail > RAIL_MAX - 300) best = 0;
    return rail < HOME_END * 0.5 ? -1 : best;
  };

  // ── modes ────────────────────────────────────────────────────────────────
  function enterExplore(reason?: string) {
    if (mode === 'explore') return;
    stopTour();
    mode = 'explore';
    free = { ...cam };
    focus = null;
    hand = null;
    app.classList.add('is-explore');
    toast(reason ?? 'Exploring · scroll pans · ⌘/Ctrl + scroll or pinch zooms');
    renderTools();
  }
  function leaveExplore() {
    mode = 'story';
    follow = -1;
    free = null;
    tween = null;
    story.px = story.py = 0;
    app.classList.remove('is-explore');
    if (tool !== 'hand') setTool('hand', true);
    renderTools();
  }
  function exitExplore() {
    if (mode !== 'explore') return;
    const from = { ...cam };
    leaveExplore();
    hand = { from, t0: performance.now(), ms: 700 };
    if (railT < HOME_END) rail = railT = HOME_END;
  }
  on(doneBtn, 'click', exitExplore);

  // ── tools ────────────────────────────────────────────────────────────────
  let tool: Tool = 'hand';
  let color = COLORS[0];
  let stampKind = 'heart';
  let comments = false;

  function setTool(t: Tool, quiet = false) {
    tool = t;
    app.dataset.tool = t;
    if (!quiet && t !== 'hand') {
      enterExplore(
        t === 'marker' ? 'Marker · draw anywhere. It stays in your browser.'
        : t === 'stamp' ? 'Stamps · click the work you like'
        : t === 'note' ? 'Sticky notes · click to leave one'
        : 'Move · drag frames around. Tidy up puts them back.');
    }
    ghost.innerHTML = STAMPS[stampKind];
    renderTools();
  }
  function renderTools() {
    const moved = FRAMES.some((f) => f.dx || f.dy);
    const btn = (id: string, label: string, key: string, extra = '') => {
      const pressed = (TOOLS as string[]).includes(id) ? tool === id : id === 'comments' ? comments : false;
      return `<button type="button" class="bd-tool ${extra}" data-act="${id}" aria-label="${label}" title="${label}${key ? ` · ${key}` : ''}" aria-pressed="${pressed}">${ICON[id]}</button>`;
    };
    toolsEl.innerHTML =
      btn('hand', 'Hand', 'H') + btn('move', 'Move frames', 'V') + '<hr>' +
      btn('marker', 'Marker', 'P') + btn('stamp', 'Stamp', 'S') + btn('note', 'Sticky note', 'N') + btn('comments', 'Designer’s notes', 'C') + '<hr>' +
      btn('undo', 'Undo', '⌘Z') + (moved ? btn('tidy', 'Tidy up', '') : '') + (history.length ? btn('clear', 'Clear my marks', '') : '') +
      (mode === 'story'
        ? `<hr><button type="button" class="bd-tool is-wide" data-act="tour" title="Play the tour">${ICON.tour}<span>Tour</span></button><button type="button" class="bd-tool is-wide is-primary" data-act="explore" title="Explore the board · E">${ICON.explore}<span>Explore</span></button>`
        : '');
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
    else if (a === 'explore') enterExplore();
    else if (a === 'tour') playTour();
  });

  // nav: Home + the stops of the story
  let navAt = -2;
  function renderNav() {
    const cur = mode === 'explore' ? -2 : stopIndex();
    if (cur === navAt) return;
    navAt = cur;
    nav.innerHTML =
      `<button type="button" class="is-home" data-stop="home" title="Back to the homepage · Esc">${ICON.home}<span>Home</span></button><hr>` +
      STOPS.map((s, i) => `<button type="button" data-stop="${i}" aria-current="${i === cur}">${s.name}</button>`).join('');
  }
  on(nav, 'click', (e: MouseEvent) => {
    const s = btnOf(e)?.dataset.stop;
    if (s == null) return;
    if (s === 'home') goHome();
    else flyRail(STOPS[+s].s);
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
    enterExplore(`Following ${CURSORS[i].name} · Esc to stop`);
    follow = i;
    if (free) free.z = clamp(fitZ({ w: 1400, h: 1000 }), ZMIN, ZMAX);
    toast(`Following ${CURSORS[i].name} · Esc to stop`, 4000);
  }

  // tour: the story plays by itself until any input
  let touring = false;
  function playTour() {
    if (mode === 'explore') leaveExplore();
    if (railT > RAIL_MAX - 200) flyRail(HOME_END, 700);
    touring = true;
    toast('Touring the board · any input stops it');
  }
  function stopTour() {
    touring = false;
  }

  // ── pointer input (board) ────────────────────────────────────────────────
  const ptrs = new Map<number, { x: number; y: number }>();
  let gesture: Gesture | null = null;
  const TOUCH_K = () => Math.max(1.7, HOME_END / (0.42 * H));
  const swipe = { y0: 0, rail0: 0, lastY: 0, lastT: 0, v: 0 };
  function swipeStart(y: number) {
    stopTour();
    swipe.y0 = swipe.lastY = y;
    swipe.rail0 = railT;
    swipe.lastT = performance.now();
    swipe.v = 0;
    holding = true;
  }
  function swipeMove(y: number) {
    const now = performance.now();
    const dt = Math.max(1, now - swipe.lastT);
    swipe.v = lerp(swipe.v, ((swipe.lastY - y) / dt) * 1000, 0.5);
    swipe.lastY = y;
    swipe.lastT = now;
    const next = clamp(swipe.rail0 + (swipe.y0 - y) * TOUCH_K(), 0, RAIL_MAX);
    if (next !== railT) lastDir = Math.sign(next - railT);
    railT = next;
    railRate = 30;
    lastInput = now;
    focus = null;
  }
  function swipeEnd() {
    if (!holding) return;
    holding = false;
    const now = performance.now();
    const v = now - swipe.lastT < 120 ? swipe.v : 0;
    if (Math.abs(v) > 60) {
      railT = clamp(railT + v * TOUCH_K() * 0.22, 0, RAIL_MAX);
      lastDir = Math.sign(v);
    }
    railRate = 7;
    lastInput = now;
  }

  on(app, 'pointerdown', (e: PointerEvent) => {
    if (atHome) return;
    const target = e.target as Element;
    if (target.closest('.bd-glass, .bd-cmt, .bd-sticky, .bd-cursor b, .home, .case')) return;
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    ptrs.set(e.pointerId, { x: sx, y: sy });
    if (ptrs.size === 2) {
      if (gesture?.kind === 'draw') return;
      holding = false;
      enterExplore();
      if (!free) return;
      const [a, b] = [...ptrs.values()];
      gesture = { kind: 'pinch', d0: Math.hypot(b.x - a.x, b.y - a.y), z0: free.z, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, c0: { cx: free.cx, cy: free.cy } };
      return;
    }
    if (ptrs.size > 2) return;
    const touch = e.pointerType === 'touch';
    const p = toBoard(sx, sy);
    const fi = frameAt(p.x, p.y);
    if (mode === 'explore' && tool === 'marker') {
      const s: Stroke = { c: color, pts: [[Math.round(p.x), Math.round(p.y)]] };
      drawStroke(s);
      gesture = { kind: 'draw', s };
    } else if (mode === 'explore' && tool === 'move' && fi >= 0) {
      gesture = { kind: 'move', i: fi, start: p, dx0: FRAMES[fi].dx, dy0: FRAMES[fi].dy, moved: false };
      frameEls[fi].classList.add('is-dragged');
    } else {
      gesture = { kind: 'pan', x: sx, y: sy, moved: false, touch, fi, startCam: free ? { ...free } : null, sp: { ...story }, rail: false };
    }
    try {
      app.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
  on(app, 'pointermove', (e: PointerEvent) => {
    if (atHome) return;
    const sx = e.clientX, sy = e.clientY;
    const target = e.target as Element;
    if (e.pointerType === 'mouse') {
      const onHud = !!target.closest?.('.bd-glass');
      youTag.style.transform = `translate(${sx + 14}px, ${sy + 16}px)`;
      youTag.classList.toggle('is-on', !onHud);
      ghost.style.transform = `translate(${sx}px, ${sy}px)`;
      ghost.classList.toggle('is-on', !onHud);
      app.classList.toggle('is-hero-hover', !onHud && !gesture && (tool === 'hand' || tool === 'move') && inHero(toBoard(sx, sy)));
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
    if (!g) return;
    if (g.kind === 'pinch') {
      if (ptrs.size < 2 || !free) return;
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      free.z = clamp(g.z0 * (d / Math.max(1, g.d0)), ZMIN, ZMAX);
      const bx = (g.m0.x - W / 2) / g.z0 + g.c0.cx, by = (g.m0.y - H / 2) / g.z0 + g.c0.cy;
      free.cx = bx - (m.x - W / 2) / free.z;
      free.cy = by - (m.y - H / 2) / free.z;
      tween = null;
      follow = -1;
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
      if (!g.moved && Math.hypot(dx, dy) > 5) {
        g.moved = true;
        // story + touch: a vertical swipe scrolls the story, like a page
        if (g.touch && mode === 'story' && Math.abs(dy) > Math.abs(dx)) {
          g.rail = true;
          swipeStart(g.y);
        } else app.classList.add('is-dragging');
      }
      if (!g.moved) return;
      if (g.rail) swipeMove(sy);
      else if (mode === 'explore' && free && g.startCam) {
        free.cx = g.startCam.cx - dx / free.z;
        free.cy = g.startCam.cy - dy / free.z;
        tween = null;
        follow = -1;
      } else {
        stopTour();
        story.px = g.sp.px + dx;
        story.py = g.sp.py + dy;
        focus = null;
      }
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
    } else if (g.rail) swipeEnd();
    else if (!g.moved && e.type === 'pointerup') tap(e.clientX, e.clientY, g.fi);
  };
  on(app, 'pointerup', endPtr);
  on(app, 'pointercancel', endPtr);
  on(app, 'pointerleave', (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    youTag.classList.remove('is-on');
    ghost.classList.remove('is-on');
    app.classList.remove('is-hero-hover');
  });

  const cases = createCaseStudies({
    // a case study opened by address shouldn't strand the visitor on the homepage behind it
    onChange: (open) => {
      if (open && atHome) rail = railT = HOME_END;
    },
    sourceOf: (work) => frameEls[FRAMES.findIndex((f) => f.work === work)]?.querySelector<HTMLElement>('.bd-media') ?? null,
  });
  const openCase = (i: number) => cases.open(FRAMES[i].work, frameEls[i].querySelector<HTMLElement>('.bd-media'));

  function tap(sx: number, sy: number, fi: number) {
    const p = toBoard(sx, sy);
    if (mode === 'explore' && tool === 'stamp') return placeStamp(p.x, p.y);
    if (mode === 'explore' && tool === 'note') return placeNote(p.x, p.y);
    if (inHero(p)) return goHome();
    if (fi < 0) return;
    if (FRAMES[fi].work.type === 'ux') return openCase(fi);
    if (mode === 'explore') flyTo(frameBox(fi), 650);
    else {
      stopTour();
      focus = focus && focus.i === fi ? null : { i: fi, t: 0 };
      story.px = story.py = 0;
    }
  }
  frameEls.forEach((el, i) =>
    on(el, 'keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      if (FRAMES[i].work.type === 'ux') openCase(i);
      else if (mode === 'explore') flyTo(frameBox(i), 650);
      else focus = { i, t: 0 };
    }),
  );

  // wheel: at home and in the story it scrolls the rail; exploring, it pans (⌘/Ctrl or pinch zooms)
  on(app, 'wheel', (e: WheelEvent) => {
    if (cases.isOpen()) return;
    const target = e.target as Element;
    if (e.defaultPrevented) return; // a toy on the homepage took it
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    const zoomGesture = e.ctrlKey || e.metaKey;
    if (atHome) {
      if (target.closest('.ui')) return;
      e.preventDefault();
      railBy(e.deltaY * unit * (zoomGesture ? 4 : 1));
      return;
    }
    if (target.closest('.bd-glass, .bd-sticky')) return;
    e.preventDefault();
    if (mode === 'story' && !zoomGesture) {
      railBy(e.deltaY * unit);
      return;
    }
    if (mode === 'story') enterExplore();
    if (!free) return;
    if (zoomGesture) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * 0.0045));
    else {
      free.cx += (e.deltaX * unit) / free.z;
      free.cy += (e.deltaY * unit) / free.z;
      tween = null;
      follow = -1;
    }
  }, { passive: false });

  on(zoomEl, 'click', (e: MouseEvent) => {
    const z = btnOf(e)?.dataset.z;
    if (!z) return;
    enterExplore();
    zoomAt(W / 2, H / 2, z === '1' ? 1.4 : 1 / 1.4);
  });
  on(mini, 'click', (e: MouseEvent) => {
    const r = miniSvg.getBoundingClientRect();
    const s = Math.min(r.width / BW, r.height / BH);
    const bx = (e.clientX - r.left - (r.width - BW * s) / 2) / s, by = (e.clientY - r.top - (r.height - BH * s) / 2) / s;
    enterExplore();
    if (free) flyTo({ cx: clamp(bx, 0, BW), cy: clamp(by, 0, BH), w: W / free.z, h: H / free.z }, 500);
  });

  // gestures on the empty part of the homepage
  homeGestures.drag = (phase: GesturePhase, _x: number, y: number, pointerType: string) => {
    if (pointerType === 'mouse') return;
    if (phase === 'start') swipeStart(y);
    else if (phase === 'move') {
      if (holding && (railT > 0 || swipe.y0 - y > 8)) swipeMove(y);
    } else swipeEnd();
  };
  let pinch0 = 0;
  homeGestures.pinch = (phase: GesturePhase, ratio: number) => {
    if (phase === 'start') {
      pinch0 = railT;
      holding = true;
    } else if (phase === 'move') {
      const span = Math.log((W / HERO.w) / fitZ(KEYS[1][1]));
      const next = clamp(pinch0 + (HOME_END * -Math.log(Math.max(0.05, ratio))) / Math.max(0.2, span), 0, HOME_END);
      if (next !== railT) lastDir = Math.sign(next - railT);
      railT = next;
      railRate = 30;
      lastInput = performance.now();
    } else {
      holding = false;
      railRate = 7;
      lastInput = performance.now();
    }
  };
  homeGestures.openBoard = () => flyRail(HOME_END, 950);

  // keyboard
  on(window, 'keydown', (e: KeyboardEvent) => {
    if (cases.isOpen()) return;
    if (isTyping(e.target)) {
      // Esc finishes a sticky note
      if (e.key === 'Escape' && (e.target as HTMLElement).closest('.bd-sticky')) (e.target as HTMLElement).blur();
      return;
    }
    const k = e.key.toLowerCase();
    if (atHome) {
      if (host.hasSelection() || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element | null)?.closest?.('.ui')) return;
      if (k === 'pagedown' || k === 'arrowdown' || k === 'end') {
        e.preventDefault();
        flyRail(HOME_END, 950);
      }
      return;
    }
    if (k === 'escape') {
      if (follow >= 0) {
        follow = -1;
        toast('Stopped following');
      } else if (mode === 'explore') exitExplore();
      else goHome();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && k === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (k === 'home') return goHome();
    if (e.shiftKey && e.key === '!') {
      enterExplore();
      flyTo(OVER, 600);
      return;
    }
    const map: Record<string, Tool> = { h: 'hand', v: 'move', p: 'marker', m: 'marker', s: 'stamp', n: 'note' };
    if (map[k]) return setTool(map[k]);
    if (k === 'c') return toggleComments();
    if (k === 'e') return mode === 'explore' ? exitExplore() : enterExplore();
    if (mode === 'story') {
      const i = stopIndex();
      if (k === 'arrowdown' || k === 'pagedown' || k === 'arrowright') {
        e.preventDefault();
        if (i < STOPS.length - 1) flyRail(STOPS[i + 1].s);
      } else if (k === 'arrowup' || k === 'pageup' || k === 'arrowleft') {
        e.preventDefault();
        if (i <= 0) goHome();
        else flyRail(STOPS[i - 1].s);
      }
      return;
    }
    if (!free) return;
    if (k === '=' || k === '+') zoomAt(W / 2, H / 2, 1.3);
    else if (k === '-') zoomAt(W / 2, H / 2, 1 / 1.3);
    else if (k === '0') zoomAt(W / 2, H / 2, 1 / free.z);
    else if (k.startsWith('arrow')) {
      const d = 80 / free.z;
      if (k === 'arrowleft') free.cx -= d;
      if (k === 'arrowright') free.cx += d;
      if (k === 'arrowup') free.cy -= d;
      if (k === 'arrowdown') free.cy += d;
      tween = null;
    } else return;
    e.preventDefault();
  });

  const onResize = () => {
    W = Math.max(1, app.clientWidth);
    H = Math.max(1, app.clientHeight);
    layoutHero();
    placeHero();
    buildKeys();
    rail = Math.min(rail, RAIL_MAX);
    railT = Math.min(railT, RAIL_MAX);
    navAt = -2;
    wasHome = null;
  };
  on(window, 'resize', onResize);

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

    // story rail
    if (touring) {
      railT = Math.min(RAIL_MAX, railT + dt * 270);
      railRate = 12;
      if (railT >= RAIL_MAX) touring = false;
    }
    if (mode === 'story' && !holding && !touring && railT > 0 && railT < HOME_END && now - lastInput > 170) {
      // never rest half-way between the homepage and the board
      const f = railT / HOME_END;
      railT = (lastDir >= 0 ? f > 0.1 : f > 0.9) ? HOME_END : 0;
      railRate = 6;
    }
    rail = Math.abs(railT - rail) < 0.4 ? railT : lerp(rail, railT, 1 - Math.exp(-dt * railRate));

    let target: Cam;
    if (mode === 'explore' && free) {
      if (tween) {
        const t = ease(clamp((now - tween.t0) / tween.ms, 0, 1));
        Object.assign(free, mixCam(tween.from, tween.to, t));
        if (t >= 1) tween = null;
      }
      if (follow >= 0) {
        const c = cursorPos(CURSORS[follow], tsec);
        free.cx = lerp(free.cx, c.x, 1 - Math.exp(-dt * 3));
        free.cy = lerp(free.cy, c.y, 1 - Math.exp(-dt * 3));
      }
      target = free;
    } else {
      let b = boxAt(rail);
      if (focus) {
        focus.t = Math.min(1, focus.t + dt * 2.2);
        const fb = frameBox(focus.i), t = ease(focus.t);
        b = { cx: lerp(b.cx, fb.cx, t), cy: lerp(b.cy, fb.cy, t), w: Math.exp(lerp(Math.log(b.w), Math.log(fb.w), t)), h: Math.exp(lerp(Math.log(b.h), Math.log(fb.h), t)) };
      }
      const z = fitZ(b);
      target = { cx: b.cx - story.px / z, cy: b.cy - story.py / z, z };
    }
    if (hand) {
      const t = clamp((now - hand.t0) / hand.ms, 0, 1);
      target = mixCam(hand.from, target, ease(t));
      if (t >= 1) hand = null;
    }
    Object.assign(cam, target);

    // (not while a finger that started on the homepage is still driving the camera: it holds the capture)
    const inertNow = !atHome && !holding;
    if (home.inert !== inertNow) home.inert = inertNow;

    const nowHome = mode === 'story' && rail === 0 && railT === 0 && !hand && !focus && !story.px && !story.py;
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
      home.style.transform = `translate3d(${hx.toFixed(2)}px, ${hy.toFixed(2)}px, 0) scale(${k.toFixed(5)})`;
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
    const hudNow = cover < 0.72;
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

    const draw = mode === 'explore' ? 1 : smoothstep(0.25, 0.9, rail / HOME_END);
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

    renderNav();
    const msg = mode === 'explore'
      ? (tool === 'marker' ? 'Draw anywhere. <b>⌘Z</b> undoes. Saved in your browser.'
        : tool === 'stamp' ? 'Click a piece to stamp it.'
        : tool === 'note' ? 'Click anywhere to leave a note.'
        : tool === 'move' ? 'Drag frames around. <b>Tidy up</b> puts them back.'
        : 'Scroll pans · <b>⌘/Ctrl + scroll</b> zooms · <b>Esc</b> returns to the story.')
      : rail < RAIL_MAX - 500 ? 'Scroll to tour the work · <b>E</b> to explore freely · click <b>Home</b> to go back.'
      : 'That’s the tour. <b>E</b> to explore, or pick a tool and leave a mark.';
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
  renderNav();
  // deep link: #work lands on the board
  if (startOnBoard || location.hash === '#work' || cases.isOpen()) rail = railT = HOME_END;
  raf = requestAnimationFrame(frame);

  return {
    atHome: () => atHome,
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
      app.classList.remove('is-explore', 'hud-on', 'show-comments', 'is-dragging', 'is-hero-hover');
      delete app.dataset.view;
      delete app.dataset.tool;
      host.onView('home');
      host.onGlActive(true);
    },
  };
}
