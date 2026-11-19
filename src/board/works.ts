import { h } from './dom';
import './works.css';

/**
 * The works on the board.
 *
 * Every entry is one frame. Until the real files arrive each one is drawn by a CSS stand-in
 * (`kind`). To use a real piece, add `src` (a video or an image in /public, e.g. "works/launch.mp4"):
 * the stand-in is replaced by that file, cropped to the frame's `aspect`.
 */
export type WorkType = 'motion' | '3d' | 'ux';

export interface CaseInfo {
  kicker: string;
  title: string;
  meta: string[];
  /** Paragraphs of the story. Placeholder copy is used when omitted. */
  body?: string[];
}

export interface Work {
  id: string;
  type: WorkType;
  /** Stand-in renderer. */
  kind: keyof typeof R;
  /** "w/h" */
  aspect: string;
  /** Dominant colour (minimap, loading tint). */
  tone: string;
  /** Real media: path to a video (mp4/webm) or image. Replaces the stand-in. */
  src?: string;
  poster?: string;
  word?: string;
  bg?: string;
  /** Product work: opens a case-study page. */
  case?: CaseInfo;
  /** A designer's note pinned to the frame (visitors see it when they turn notes on). */
  note?: string;
}

const rand = (() => {
  let s = 7;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
})();

type Rendered = Node | Node[];

const R = {
  bounce: () => [h('i', { class: 'sh' }), h('i', { class: 'ball' })],
  type: (w) => h('div', { class: 'word' }, [...(w.word || 'LOOP')].map((ch, i) => h('span', { style: `--i:${i}` }, ch))),
  blob: () => h('i', { class: 'b' }),
  orbit: () => [
    h('i', { class: 'ring', style: '--r:44cqmin;--t:5s' }, h('b', { style: '--s:6cqmin;--c:#38e6a8' })),
    h('i', { class: 'ring', style: '--r:66cqmin;--t:8s' }, h('b', { style: '--s:8cqmin;--c:#ff4fd8' })),
    h('i', { class: 'ring', style: '--r:88cqmin;--t:12s' }, h('b', { style: '--s:5cqmin;--c:#d7ff3a' })),
    h('i', { class: 'sun' }),
  ],
  stripes: () => h('i', { class: 'hole' }),
  grid: () => {
    const g = h('div', { class: 'g' });
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) g.append(h('i', { style: `--d:${Math.hypot(x - 3, y - 3).toFixed(2)}` }));
    return g;
  },
  cube: () => h('div', { class: 'c' }, ['#ff4fd8', '#2b59ff', '#d7ff3a', '#38e6a8', '#fff1d6', '#6c3bff'].map((f) => h('i', { style: `--f:${f}` }))),
  marquee: (w) => {
    const t = (w.word || 'ONCE UPON A TIME') + ' ✦ ';
    const row = (rev: boolean) => h('div', { class: 'row' + (rev ? ' rev' : '') }, h('span', {}, t.repeat(3)), h('span', {}, t.repeat(3)));
    const badge = h('div', { class: 'badge' });
    badge.innerHTML = '<svg viewBox="0 0 100 100"><defs><path id="bp" d="M50,50 m-36,0 a36,36 0 1,1 72,0 a36,36 0 1,1 -72,0"/></defs><text><textPath href="#bp">MOTION ✦ MOTION ✦ MOTION ✦ </textPath></text></svg>';
    return [row(false), row(true), row(false), badge];
  },
  sphere: () => [h('i', { class: 'sh' }), h('i', { class: 's' }), h('i', { class: 's2' })],
  donut: () => {
    const d = h('i', { class: 'd' });
    const cols = ['#fff', '#2b59ff', '#d7ff3a', '#ffd23f', '#6c3bff', '#38e6a8'];
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, r = 22 + rand() * 20;
      d.append(h('b', { style: `--x:${(50 + Math.cos(a) * r).toFixed(1)}%;--y:${(50 + Math.sin(a) * r).toFixed(1)}%;--r:${(rand() * 180).toFixed(0)}deg;--c:${cols[i % cols.length]}` }));
    }
    return [h('i', { class: 'sh' }), d];
  },
  pill: () => [h('i', { class: 'sh' }), h('i', { class: 'p' })],
  stack: () => h('div', { class: 'scene' }, [
    ['#ff4fd8', '0', '0', '0'], ['#d7ff3a', '0', '-30cqmin', '0'], ['#2b59ff', '30cqmin', '0', '0'], ['#ffd23f', '0', '0', '-30cqmin'],
  ].map(([c, x, y, z]) => h('div', { class: 'cube', style: `--c:${c};--x:${x};--y:${y};--z:${z}` }, h('i'), h('i'), h('i')))),
  chrome: () => [h('i', { class: 'sh' }), h('i', { class: 'm' })],
  can: () => [h('i', { class: 'sh' }), h('i', { class: 'can' })],
  dashboard: () => h('div', { class: 'ux-win' },
    h('div', { class: 'ux-bar' }, h('i'), h('i'), h('i')),
    h('div', { class: 'ux-body' },
      h('aside', { class: 'ux-side' }, h('b'), h('b'), h('b'), h('b'), h('b'), h('b')),
      h('div', { class: 'ux-main' },
        h('div', { class: 'ux-kpis' }, ['24.8k', '1,204', '98%'].map((n, i) => h('div', { class: 'ux-kpi' }, h('b', {}, n), h('i'), h('em', {}, ['+12%', '+4.1%', '+0.6%'][i])))),
        (() => {
          const c = h('div', { class: 'ux-chart' });
          c.innerHTML = '<svg viewBox="0 0 300 120" preserveAspectRatio="none"><defs><linearGradient id="ug" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2b59ff" stop-opacity=".25"/><stop offset="1" stop-color="#2b59ff" stop-opacity="0"/></linearGradient></defs><path d="M0,92 C30,80 45,96 70,70 S120,40 150,52 S205,20 230,30 S280,8 300,14 L300,120 L0,120Z" fill="url(#ug)"/><path d="M0,92 C30,80 45,96 70,70 S120,40 150,52 S205,20 230,30 S280,8 300,14" fill="none" stroke="#2b59ff" stroke-width="2.5"/><path d="M0,104 C40,98 70,106 110,90 S180,84 220,70 S270,62 300,50" fill="none" stroke="#c4e800" stroke-width="2" stroke-dasharray="5 5"/></svg>';
          return c;
        })(),
        h('div', { class: 'ux-rows' },
          ['#c7d0ff', '#ffc7e5', '#c9f5df'].map((c, i) => h('div', { class: 'ux-row' }, h('i', { style: `--c:${c}` }), h('b'), h('span', { class: i === 1 ? 'warn' : '' }, i === 1 ? 'PENDING' : 'ACTIVE')))),
      ))),
  finance: () => h('div', { class: 'ux-phone' }, h('div', { class: 'ux-screen' },
    h('div', { class: 'ux-card' }, h('i'), h('b', {}, '$12,480.20'), h('i', { style: 'width:28%' })),
    h('div', { class: 'ux-acts' }, h('i'), h('i'), h('i'), h('i')),
    h('div', { class: 'ux-list' }, ['#ffd23f', '#38e6a8', '#ff4fd8', '#2b59ff', '#ffa25c'].map((c, i) => h('div', { class: 'ux-item' }, h('i', { style: `--c:${c}` }), h('b'), h('em', {}, ['-$24', '+$1.2k', '-$8', '-$62', '+$90'][i])))),
    h('div', { class: 'ux-tab' }, h('i'), h('i'), h('i'), h('i')))),
  chat: () => h('div', { class: 'ux-phone' }, h('div', { class: 'ux-screen chat', style: '--scr:#eef1ff' },
    h('div', { class: 'ux-bubble' }, h('i', { style: 'width:30cqmin' }), h('i', { style: 'width:20cqmin' })),
    h('div', { class: 'ux-bubble me' }, h('i', { style: 'width:24cqmin' })),
    h('div', { class: 'ux-bubble' }, h('i', { style: 'width:26cqmin' }), h('i', { style: 'width:30cqmin' }), h('i', { style: 'width:12cqmin' })),
    h('div', { class: 'ux-bubble me' }, h('i', { style: 'width:28cqmin' }), h('i', { style: 'width:16cqmin' })),
    h('div', { class: 'ux-typing' }, h('i'), h('i'), h('i')),
    h('div', { class: 'ux-input' }))),
  system: () => h('div', { class: 'ux-sheet' },
    h('div', { style: 'display:grid;gap:2cqmin;align-content:start' }, h('div', { class: 'ux-aa' }, 'Aa'),
      h('div', { class: 'ux-sw' }, ['#d7ff3a', '#2b59ff', '#ff4fd8', '#15122b', '#f4efe6'].map((c) => h('i', { style: `--c:${c}` }))),
      h('div', { class: 'ux-chips' }, h('i', {}, 'chip'), h('i', {}, 'tag'), h('i', {}, 'badge'))),
    h('div', { class: 'ux-btns' }, h('div', { class: 'ux-btn p' }, 'Primary'), h('div', { class: 'ux-btn s' }, 'Secondary'), h('div', { class: 'ux-btn o' }, 'Outline'),
      h('div', { class: 'ux-tg' }, h('i', { class: 'on' }), h('i')),
      h('div', { class: 'ux-range' }),
      h('div', { class: 'ux-field' }, 'Search components…'))),
} satisfies Record<string, (w: Work) => Rendered>;

export const WORKS: Work[] = [
  { id: 'm1', type: 'motion', kind: 'bounce', aspect: '4/5', tone: '#6c3bff', note: 'Launch loop. The brief, the tools and how long it took, in one line.' },
  { id: 'm2', type: 'motion', kind: 'type', aspect: '1/1', tone: '#ff6b1a', word: 'LOOP' },
  { id: 'm3', type: 'motion', kind: 'blob', aspect: '4/5', tone: '#1c2f7a' },
  { id: 'm8', type: 'motion', kind: 'marquee', aspect: '16/10', tone: '#d7ff3a' },
  { id: 'm4', type: 'motion', kind: 'orbit', aspect: '1/1', tone: '#1d1450' },
  { id: 'm5', type: 'motion', kind: 'stripes', aspect: '1/1', tone: '#ff4fd8' },
  { id: 'm6', type: 'motion', kind: 'grid', aspect: '1/1', tone: '#121216' },
  { id: 'm7', type: 'motion', kind: 'cube', aspect: '4/5', tone: '#ff6b1a' },
  { id: 'd1', type: '3d', kind: 'sphere', aspect: '4/5', tone: '#ff4f8f', note: '3D render. Software, render time, what was hard.' },
  { id: 'd2', type: '3d', kind: 'donut', aspect: '1/1', tone: '#a9d3ff' },
  { id: 'd3', type: '3d', kind: 'pill', aspect: '1/1', tone: '#d4f0a3' },
  { id: 'd4', type: '3d', kind: 'stack', aspect: '4/5', tone: '#292152' },
  { id: 'd5', type: '3d', kind: 'chrome', aspect: '1/1', tone: '#3b3b45' },
  { id: 'd6', type: '3d', kind: 'can', aspect: '4/5', tone: '#2a5cff' },
  { id: 'd7', type: '3d', kind: 'donut', aspect: '16/10', tone: '#a9d3ff', note: 'A note like this only shows when visitors turn notes on.' },
  { id: 'u1', type: 'ux', kind: 'dashboard', aspect: '16/10', tone: '#2b59ff', bg: 'linear-gradient(160deg,#eef2ff,#d9e1ff)',
    case: { kicker: 'Case study · B2B SaaS', title: 'Project name for a dashboard redesign', meta: ['Role · Lead product designer', 'Year · 20XX', 'Team · 6'] } },
  { id: 'u2', type: 'ux', kind: 'finance', aspect: '4/5', tone: '#ff4fd8', bg: 'linear-gradient(160deg,#ffe3f4,#e9dcff)',
    case: { kicker: 'Case study · Mobile', title: 'Project name for a money app', meta: ['Role · Product designer', 'Year · 20XX', 'Platform · iOS + Android'] } },
  { id: 'u3', type: 'ux', kind: 'chat', aspect: '4/5', tone: '#2b59ff', bg: 'linear-gradient(160deg,#dff4ff,#e6e3ff)',
    case: { kicker: 'Case study · Messaging', title: 'Project name for a conversations product', meta: ['Role · Product designer', 'Year · 20XX', 'Users · 1M+'] } },
  { id: 'u4', type: 'ux', kind: 'system', aspect: '4/3', tone: '#d7ff3a', bg: 'linear-gradient(160deg,#fff7d6,#ffe4cc)',
    case: { kicker: 'Case study · Design system', title: 'Project name for a design system', meta: ['Role · Design systems', 'Year · 20XX', 'Components · 120+'] } },
];

const pauser =
  typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('is-paused', !e.isIntersecting)), { rootMargin: '120px' })
    : null;

const isVideo = (src: string) => /\.(mp4|webm|mov)(\?|#|$)/i.test(src);

/** Render a work into `el` (which must have a size). Returns the inner element. */
export function mountWork(work: Work, el: HTMLElement, { pause = true } = {}): HTMLElement {
  const w = h('div', { class: `w k-${work.type === 'ux' ? 'ux' : work.kind} k-${work.kind}`, 'data-work': work.id, 'aria-hidden': 'true' });
  if (work.tone) w.style.setProperty('--c', work.tone);
  if (work.bg) w.style.setProperty('--ux-bg', work.bg);
  if (work.src) {
    w.className = 'w k-media';
    w.style.background = work.tone;
    if (isVideo(work.src)) {
      const v = h('video', { src: work.src, playsinline: '', loop: '', preload: 'metadata' });
      v.muted = true;
      v.autoplay = true;
      if (work.poster) v.poster = work.poster;
      w.append(v);
    } else {
      w.append(h('img', { src: work.src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
    }
  } else {
    const kids = R[work.kind](work);
    (Array.isArray(kids) ? kids : [kids]).forEach((k) => w.append(k));
  }
  el.append(w);
  if (pause && pauser) pauser.observe(w);
  return w;
}
