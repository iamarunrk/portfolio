import { LIBRARY_ORDER } from '../objects/library/order';
import { WORKS, type Work, type WorkType } from './works';

/**
 * Lays the works out on the board, so adding a piece to `works.ts` is all it takes:
 *
 *   ┌ Motion ┐   ┌ Home ┐   ┌ 3D ┐      Motion and 3D are three-column masonry (wide pieces span two),
 *   └────────┘   └──────┘   └────┘      Product is rows of equal height. Sections grow with their content
 *        ┌──── Product ────┐            and each one is a jump target for the nav chips.
 *        └─────────────────┘
 *
 * Around (and between) the work there is room for the shelf collectibles: the 18 toys from
 * src/objects/library are scattered over the free canvas, spread as evenly as the space allows
 * (farthest-point sampling over every spot that keeps clear of frames, labels and connectors).
 */

export interface Rect { x: number; y: number; w: number; h: number }
/** A camera target: the stage fits this board-space box. */
export interface Box { cx: number; cy: number; w: number; h: number }
export interface Frame extends Rect { work: Work; dx: number; dy: number }
export interface Section extends Rect { id: WorkType; name: string; tab: string; count: number }
export interface StoryStop { id: string; name: string; boxes: Box[] }
/** A shelf collectible lying on the board: its centre, diameter (board px) and a little pose of its own. */
export interface ToySpot { kind: string; x: number; y: number; d: number; yaw: number; roll: number; phase: number }

export interface BoardLayout {
  w: number;
  h: number;
  /** Phones: everything is stacked in one column, so you pan straight down. */
  portrait: boolean;
  sections: Section[];
  frames: Frame[];
  /** Where the homepage frame is centred, and the room it may take. */
  heroC: { x: number; y: number };
  heroMax: { w: number; h: number };
  over: Box;
  /** The first step back from the homepage (wide: the whole board, toys included; phones: the top of the column). `aspect` = viewport w / h. */
  first(aspect: number): Box;
  stops: StoryStop[];
  /** The collectibles scattered over the free canvas. */
  toys: ToySpot[];
}

type Content = Omit<BoardLayout, 'toys'>;

const M = 120; // board margin
const TOP = 150;
const PAD = 70; // section padding
const GAP = 40;
const COL = 310;
const COLS = 3;
const SIDE_W = COLS * COL + (COLS - 1) * GAP + PAD * 2;
const HERO_COL = 1320; // room between the two side sections
const HERO_MAX = { w: 1040, h: 1320 };
const HERO_MAX_P = { w: 780, h: 1500 };
const ROW_H = 450;
const ROW_GAP = 50;
const ROW_MAX = 2700;
/** Phones: room between the stacked sections (a few collectibles lie there). */
const GAP_P = 470;

const NAMES: Record<WorkType, { name: string; tab: string }> = {
  motion: { name: 'Motion', tab: '#ff7ac6' },
  '3d': { name: '3D', tab: '#7fa0ff' },
  ux: { name: 'Product', tab: '#d7ff3a' },
};

export const aspectOf = (w: Work) => {
  const [a, b] = w.aspect.split('/').map(Number);
  return a > 0 && b > 0 ? a / b : 1;
};

function masonry(works: Work[], x0: number, y0: number) {
  const hts: number[] = new Array(COLS).fill(0);
  const frames: Frame[] = [];
  for (const work of works) {
    const a = aspectOf(work);
    const span = a >= 1.4 ? 2 : 1;
    let col = 0;
    let top = Infinity;
    for (let c = 0; c + span <= COLS; c++) {
      const y = Math.max(...hts.slice(c, c + span));
      if (y < top - 0.5) {
        top = y;
        col = c;
      }
    }
    const w = span * COL + (span - 1) * GAP;
    const h = Math.round(w / a);
    frames.push({ work, x: x0 + col * (COL + GAP), y: y0 + top, w, h, dx: 0, dy: 0 });
    for (let c = col; c < col + span; c++) hts[c] = top + h + GAP;
  }
  return { frames, height: Math.max(GAP, ...hts) - GAP };
}

/** Rows of equal height, each centred on `cx`. */
function rowsOf(works: Work[], cx: number, y0: number, maxW: number) {
  const rows: { items: { work: Work; w: number }[]; w: number }[] = [];
  for (const work of works) {
    const w = Math.round(ROW_H * aspectOf(work));
    let row = rows[rows.length - 1];
    if (!row || row.w + ROW_GAP + w > maxW) {
      row = { items: [], w: 0 };
      rows.push(row);
    }
    row.w += (row.items.length ? ROW_GAP : 0) + w;
    row.items.push({ work, w });
  }
  const frames: Frame[] = [];
  const boxes: Rect[] = [];
  rows.forEach((row, r) => {
    let x = cx - row.w / 2;
    const y = y0 + r * (ROW_H + ROW_GAP);
    boxes.push({ x, y, w: row.w, h: ROW_H });
    for (const it of row.items) {
      frames.push({ work: it.work, x: Math.round(x), y, w: it.w, h: ROW_H, dx: 0, dy: 0 });
      x += it.w + ROW_GAP;
    }
  });
  return { frames, boxes, width: Math.max(0, ...rows.map((r) => r.w)), height: rows.length * ROW_H + Math.max(0, rows.length - 1) * ROW_GAP };
}

/** One camera box per screenful of a tall section. */
function slide(sec: Section, tall: number): Box[] {
  const w = sec.w + 120;
  const total = sec.h + 250;
  const top = sec.y - 100;
  const maxH = w * tall;
  const n = Math.max(1, Math.ceil((total - maxH * 0.12) / (maxH * 0.88)));
  if (n === 1) return [{ cx: sec.x + sec.w / 2, cy: top + total / 2, w, h: total }];
  return Array.from({ length: n }, (_, i) => ({ cx: sec.x + sec.w / 2, cy: top + maxH / 2 + (i * (total - maxH)) / (n - 1), w, h: maxH }));
}

export function layoutBoard(works: Work[] = WORKS, portrait = false, toys: string[] = LIBRARY_ORDER): BoardLayout {
  return portrait ? withToys(layoutColumn(works), toys, TOYS_TALL) : withToys(layoutWide(works), toys, TOYS_WIDE);
}

// ── the collectibles ────────────────────────────────────────────────────────

interface ToyRoom {
  /** Extra canvas added around the work (board px). */
  pad: { l: number; r: number; t: number; b: number };
  /** Toy diameter range. */
  d: [number, number];
  /** Clearance from sections, the homepage frame and connectors. */
  gap: number;
  /** The homepage frame's tallest shape to keep clear of (w / h). */
  heroAspect: number | null;
  /** Where the first toy goes (relative to the hero frame), the rest spread out from there. */
  start: (hero: Rect) => { x: number; y: number };
  /** Leaving the homepage lands on the whole board (toys included) rather than on the work alone. */
  landOnAll: boolean;
  /** Board corners the HUD covers in the overview (the minimap): no toy lies there. */
  hud: (w: number, h: number) => Rect[];
}
const TOYS_WIDE: ToyRoom = {
  pad: { l: 480, r: 480, t: 360, b: 460 },
  d: [270, 330],
  gap: 56,
  heroAspect: 1.2,
  start: (r) => ({ x: r.x + r.w * 0.18, y: r.y + r.h + 260 }),
  landOnAll: true,
  hud: (w, h) => [{ x: w - 820, y: h - 600, w: 820, h: 600 }],
};
const TOYS_TALL: ToyRoom = {
  pad: { l: 210, r: 210, t: 0, b: 380 },
  d: [205, 245],
  gap: 40,
  heroAspect: null,
  start: (r) => ({ x: r.x - 140, y: r.y + r.h * 0.3 }),
  // phones keep landing on the column itself; the toys beside it peek in
  landOnAll: false,
  hud: () => [],
};

/** Small deterministic PRNG, so every visitor gets the same board. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const distToRect = (r: Rect, x: number, y: number) =>
  Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));

/** Grow the canvas around the work and scatter the collectibles over whatever is free. */
function withToys(c: Content, kinds: string[], room: ToyRoom): BoardLayout {
  const { l, r, t, b } = room.pad;
  const W = c.w + l + r;
  const H = c.h + t + b;
  const mv = (bx: Box): Box => ({ ...bx, cx: bx.cx + l, cy: bx.cy + t });
  const first = c.first;
  const over: Box = { cx: W / 2, cy: H / 2, w: W + 160, h: H + 300 };
  const L: Content = {
    ...c,
    w: W,
    h: H,
    sections: c.sections.map((s) => ({ ...s, x: s.x + l, y: s.y + t })),
    frames: c.frames.map((f) => ({ ...f, x: f.x + l, y: f.y + t })),
    heroC: { x: c.heroC.x + l, y: c.heroC.y + t },
    over,
    first: room.landOnAll ? () => over : (aspect) => mv(first(aspect)),
    stops: c.stops.map((st) => ({ ...st, boxes: st.boxes.map(mv) })),
  };

  // what the toys keep clear of
  const hw = L.heroMax.w;
  const hh = room.heroAspect ? Math.min(L.heroMax.h, hw / room.heroAspect) : L.heroMax.h;
  const hero: Rect = { x: L.heroC.x - hw / 2, y: L.heroC.y - hh / 2, w: hw, h: hh };
  const keep: { r: Rect; gap: number }[] = [
    { r: hero, gap: room.gap },
    { r: { x: hero.x - 10, y: hero.y - 130, w: 320, h: 130 }, gap: 10 }, // the Home label
  ];
  for (const s of L.sections) {
    keep.push({ r: s, gap: room.gap });
    keep.push({ r: { x: s.x - 10, y: s.y - 150, w: 460, h: 150 }, gap: 10 }); // section label
  }
  for (const r of room.hud(W, H)) keep.push({ r, gap: 0 });
  // connectors from the homepage frame to the sections
  const cy = L.heroC.y;
  for (const s of L.sections) {
    if (s.y > hero.y + hero.h) keep.push({ r: { x: L.heroC.x - 2, y: hero.y + hero.h, w: 4, h: s.y - hero.y - hero.h }, gap: 36 });
    else if (s.x + s.w < hero.x) keep.push({ r: { x: s.x + s.w, y: cy - 2, w: hero.x - s.x - s.w, h: 4 }, gap: 36 });
    else if (s.x > hero.x + hero.w) keep.push({ r: { x: hero.x + hero.w, y: cy - 2, w: s.x - hero.x - hero.w, h: 4 }, gap: 36 });
  }

  // every spot a toy of the largest size fits, on a jittered grid
  const rand = rng(7);
  const rad = (room.d[1] / 2) * 1.07; // room for the hover lift
  const edge = 60 + rad;
  const step = 34;
  const cands: { x: number; y: number }[] = [];
  for (let y = edge; y <= H - edge; y += step) {
    for (let x = edge; x <= W - edge; x += step) {
      const px = x + (rand() - 0.5) * step * 0.7;
      const py = y + (rand() - 0.5) * step * 0.7;
      if (keep.every((k) => distToRect(k.r, px, py) >= rad + k.gap)) cands.push({ x: px, y: py });
    }
  }

  // farthest-point sampling: each toy goes where it is furthest from all the others
  const n = Math.min(kinds.length, cands.length);
  const near = new Float64Array(cands.length).fill(Infinity);
  const s0 = room.start(hero);
  let cur = 0;
  cands.forEach((p, i) => {
    if (Math.hypot(p.x - s0.x, p.y - s0.y) < Math.hypot(cands[cur].x - s0.x, cands[cur].y - s0.y)) cur = i;
  });
  const spots: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    const p = cands[cur];
    spots.push(p);
    let best = -1;
    let far = -1;
    for (let i = 0; i < cands.length; i++) {
      const d = Math.hypot(cands[i].x - p.x, cands[i].y - p.y);
      if (d < near[i]) near[i] = d;
      if (near[i] > far) {
        far = near[i];
        best = i;
      }
    }
    cur = best;
  }

  // a stable shuffle, so neighbours are of different kinds
  const order = kinds.slice(0, n);
  const mix = rng(23);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(mix() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pose = rng(41);
  const toys: ToySpot[] = spots.map((p, i) => ({
    kind: order[i],
    x: Math.round(p.x),
    y: Math.round(p.y),
    d: Math.round(room.d[0] + pose() * (room.d[1] - room.d[0])),
    yaw: (pose() - 0.5) * 0.9,
    roll: (pose() - 0.5) * 0.22,
    phase: pose() * Math.PI * 2,
  }));
  return { ...L, toys };
}

/** Phones: Home on top, then one section under another. */
function layoutColumn(works: Work[]): Content {
  const W = M * 2 + SIDE_W;
  const cx = W / 2;
  const sections: Section[] = [];
  const frames: Frame[] = [];
  const stops: StoryStop[] = [];
  const heroC = { x: cx, y: TOP + HERO_MAX_P.h / 2 };
  // the gaps hold some of the collectibles
  let y = TOP + HERO_MAX_P.h + GAP_P;
  for (const type of ['motion', '3d', 'ux'] as WorkType[]) {
    const list = works.filter((w) => w.type === type);
    if (!list.length) continue;
    const body = type === 'ux' ? rowsOf(list, cx, y + PAD, SIDE_W - PAD * 2) : masonry(list, M + PAD, y + PAD);
    const sec: Section = { id: type, ...NAMES[type], x: M, y, w: SIDE_W, h: body.height + PAD * 2, count: list.length };
    sections.push(sec);
    frames.push(...body.frames);
    stops.push({ id: type === 'ux' ? 'product' : type, name: sec.name, boxes: slide(sec, 2) });
    y += sec.h + GAP_P;
  }
  const H = y - GAP_P + M;
  return {
    w: W,
    h: H,
    portrait: true,
    sections,
    frames,
    heroC,
    heroMax: HERO_MAX_P,
    over: { cx, cy: H / 2, w: W + 160, h: H + 300 },
    first: (aspect) => {
      const w = W + 160;
      const h = Math.min(H + 300, w / aspect);
      return { cx, cy: TOP - 340 + h / 2, w, h };
    },
    stops,
  };
}

function layoutWide(works: Work[]): Content {
  const of = (t: WorkType) => works.filter((w) => w.type === t);
  const sections: Section[] = [];
  const frames: Frame[] = [];
  const W = M * 2 + SIDE_W * 2 + HERO_COL;
  const heroX = M + SIDE_W + HERO_COL / 2;

  // side sections
  let sideH = HERO_MAX.h + 120;
  const side = (type: WorkType, x: number) => {
    const list = of(type);
    if (!list.length) return null;
    const m = masonry(list, x + PAD, TOP + PAD);
    const sec: Section = { id: type, ...NAMES[type], x, y: TOP, w: SIDE_W, h: m.height + PAD * 2, count: list.length };
    sections.push(sec);
    frames.push(...m.frames);
    sideH = Math.max(sideH, sec.h);
    return sec;
  };
  const motion = side('motion', M);
  const three = side('3d', M + SIDE_W + HERO_COL);
  const heroC = { x: heroX, y: TOP + sideH / 2 };

  // product: rows of equal height, centred under the homepage
  const list = of('ux');
  let bottom = TOP + sideH;
  let product: Section | null = null;
  let rowBoxes: Rect[] = [];
  if (list.length) {
    const y = TOP + sideH + 200;
    const body = rowsOf(list, heroX, y + PAD, ROW_MAX);
    product = { id: 'ux', ...NAMES.ux, x: heroX - body.width / 2 - PAD, y, w: body.width + PAD * 2, h: body.height + PAD * 2, count: list.length };
    sections.push(product);
    frames.push(...body.frames);
    rowBoxes = body.boxes;
    bottom = y + product.h;
  }
  const H = bottom + M;

  const stops: StoryStop[] = [];
  if (motion) stops.push({ id: 'motion', name: motion.name, boxes: slide(motion, 1.36) });
  if (three) stops.push({ id: '3d', name: three.name, boxes: slide(three, 1.36) });
  if (product) stops.push({ id: 'product', name: product.name, boxes: rowBoxes.map((r) => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2 - 10, w: r.w + 260, h: r.h + 320 })) });
  const over: Box = { cx: W / 2, cy: H / 2, w: W + 160, h: H + 300 };

  return {
    w: W,
    h: H,
    portrait: false,
    sections,
    frames,
    heroC,
    heroMax: HERO_MAX,
    over,
    first: () => over,
    stops,
  };
}
