import { WORKS, type Work, type WorkType } from './works';

/**
 * Lays the works out on the board, so adding a piece to `works.ts` is all it takes:
 *
 *   ┌ Motion ┐   ┌ Home ┐   ┌ 3D ┐      Motion and 3D are three-column masonry (wide pieces span two),
 *   └────────┘   └──────┘   └────┘      Product is rows of equal height. Sections grow with their content
 *        ┌──── Product ────┐            and each one is a jump target for the nav chips.
 *        └─────────────────┘
 */

export interface Rect { x: number; y: number; w: number; h: number }
/** A camera target: the stage fits this board-space box. */
export interface Box { cx: number; cy: number; w: number; h: number }
export interface Frame extends Rect { work: Work; dx: number; dy: number }
export interface Section extends Rect { id: WorkType; name: string; tab: string; count: number }
export interface StoryStop { id: string; name: string; boxes: Box[] }

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
  /** The first step back from the homepage (the whole board; on phones, its top). `aspect` = viewport w / h. */
  first(aspect: number): Box;
  stops: StoryStop[];
}

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

export function layoutBoard(works: Work[] = WORKS, portrait = false): BoardLayout {
  return portrait ? layoutColumn(works) : layoutWide(works);
}

/** Phones: Home on top, then one section under another. */
function layoutColumn(works: Work[]): BoardLayout {
  const W = M * 2 + SIDE_W;
  const cx = W / 2;
  const sections: Section[] = [];
  const frames: Frame[] = [];
  const stops: StoryStop[] = [];
  const heroC = { x: cx, y: TOP + HERO_MAX_P.h / 2 };
  let y = TOP + HERO_MAX_P.h + 230;
  for (const type of ['motion', '3d', 'ux'] as WorkType[]) {
    const list = works.filter((w) => w.type === type);
    if (!list.length) continue;
    const body = type === 'ux' ? rowsOf(list, cx, y + PAD, SIDE_W - PAD * 2) : masonry(list, M + PAD, y + PAD);
    const sec: Section = { id: type, ...NAMES[type], x: M, y, w: SIDE_W, h: body.height + PAD * 2, count: list.length };
    sections.push(sec);
    frames.push(...body.frames);
    stops.push({ id: type === 'ux' ? 'product' : type, name: sec.name, boxes: slide(sec, 2) });
    y += sec.h + 200;
  }
  const H = y - 200 + M;
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

function layoutWide(works: Work[]): BoardLayout {
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
