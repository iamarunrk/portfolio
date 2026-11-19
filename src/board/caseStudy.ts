import { h } from './dom';
import { WORKS, mountWork, type Work } from './works';

/**
 * Case-study pages. Each product piece has its own address (#/work/<id>): opening one from the
 * board zooms the frame up into the page, the browser's back button zooms it back.
 */

const ROUTE = /^#\/work\/([\w-]+)$/;
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

const DEFAULT_BODY = [
  'This is where the case study lives, on its own page. The board only shows the output; opening it tells the story: the problem, the process, the decisions and the outcome.',
  'Placeholder copy and visuals for now. Add the real story in src/board/works.ts.',
];

interface Rect { x: number; y: number; w: number; h: number }
const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

export interface CaseStudies {
  open(work: Work, from?: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function createCaseStudies(opts: { onChange(open: boolean): void; sourceOf(work: Work): HTMLElement | null }): CaseStudies {
  const cases = WORKS.filter((w) => w.case);
  const ac = new AbortController();
  const baseTitle = document.title;
  let current: Work | null = null;
  let from: HTMLElement | null = null;
  let pushed = false;
  let busy: Animation | null = null;

  const el = h('div', { class: 'case', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Case study' });
  el.innerHTML = `
    <div class="case__bg"></div>
    <div class="case__scroll">
      <figure class="case__hero"></figure>
      <article class="case__body">
        <div class="case__kicker"></div>
        <h1 class="case__title"></h1>
        <div class="case__meta"></div>
        <div class="case__text"></div>
        <div class="case__grid"><div></div><div></div></div>
        <div class="case__next"><span>Next case study</span><button type="button"></button></div>
      </article>
    </div>
    <button class="case__close" type="button" aria-label="Back to the board">${ARROW}<span>Board</span></button>`;
  document.body.append(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const hero = q<HTMLElement>('.case__hero');
  const bg = q<HTMLElement>('.case__bg');
  const scroll = q<HTMLElement>('.case__scroll');
  const nextBtn = q<HTMLButtonElement>('.case__next button');

  function fill(work: Work) {
    const c = work.case;
    q('.case__kicker').textContent = c?.kicker ?? 'Case study';
    q('.case__title').textContent = c?.title ?? 'Project name';
    q('.case__meta').replaceChildren(...(c?.meta ?? []).map((m) => h('span', {}, m)));
    const text = q('.case__text');
    text.className = 'case__text';
    text.style.cssText = 'display:grid;gap:18px';
    text.replaceChildren(...(c?.body ?? DEFAULT_BODY).map((p) => h('p', { class: 'case__p' }, p)));
    hero.replaceChildren();
    mountWork(work, hero, { pause: false });
    const others = cases.filter((w) => w.id !== work.id);
    el.querySelectorAll<HTMLElement>('.case__grid > div').forEach((g, i) => {
      g.replaceChildren();
      if (others.length) mountWork(others[i % others.length], g);
    });
    const next = cases[(cases.indexOf(work) + 1) % cases.length];
    nextBtn.textContent = `${next.case?.title ?? 'Next'} →`;
    nextBtn.onclick = () => show(next, null, true);
    document.title = `${c?.title ?? 'Case study'} · Once upon a time`;
  }

  function flip(ghost: HTMLElement, a: Rect, b: Rect, r0: string, r1: string, duration: number) {
    ghost.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
    return ghost.animate(
      [
        { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${a.w / b.w}, ${a.h / b.h})`, transformOrigin: '0 0', borderRadius: r0 },
        { transform: 'none', transformOrigin: '0 0', borderRadius: r1 },
      ],
      { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
    );
  }

  /** Show a case study. `replace` swaps the address instead of adding a history entry. */
  function show(work: Work, fromEl: HTMLElement | null, navigate: boolean, replace = false) {
    const wasOpen = !!current;
    current = work;
    from = fromEl ?? opts.sourceOf(work);
    if (navigate) {
      const url = `#/work/${work.id}`;
      // some embeds refuse history changes: the page still opens, just without its own address
      try {
        if (wasOpen || replace) history.replaceState(history.state, '', url);
        else {
          history.pushState({ caseStudy: true }, '', url);
          pushed = true;
        }
      } catch {
        pushed = false;
      }
    }
    fill(work);
    scroll.scrollTop = 0;
    el.classList.add('is-open');
    opts.onChange(true);
    if (wasOpen) {
      el.classList.add('is-ready');
      return;
    }
    busy?.cancel();
    const to = rectOf(hero);
    if (!fromEl) {
      // Arrived by address (or the back/forward buttons): no frame to zoom from.
      bg.style.opacity = '1';
      el.classList.add('is-ready');
      return;
    }
    bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease', fill: 'both' });
    hero.style.visibility = 'hidden';
    const ghost = h('div', { class: 'case__ghost' });
    mountWork(work, ghost, { pause: false });
    el.append(ghost);
    busy = flip(ghost, rectOf(fromEl), to, '14px', '0px', 620);
    busy.finished
      .then(() => {
        hero.style.visibility = '';
        ghost.remove();
        el.classList.add('is-ready');
        q<HTMLElement>('.case__close').focus({ preventScroll: true });
      })
      .catch(() => ghost.remove());
  }

  function hide() {
    if (!current) return;
    const work = current;
    current = null;
    pushed = false;
    document.title = baseTitle;
    opts.onChange(false);
    const target = from && from.isConnected ? rectOf(from) : null;
    const start = rectOf(hero);
    el.classList.remove('is-ready');
    const ghost = h('div', { class: 'case__ghost' });
    mountWork(work, ghost, { pause: false });
    el.append(ghost);
    hero.style.visibility = 'hidden';
    scroll.style.opacity = '0';
    bg.style.opacity = '';
    bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease', fill: 'both' });
    busy?.cancel();
    const visible = target && target.w > 4 && target.x < innerWidth && target.y < innerHeight && target.x + target.w > 0 && target.y + target.h > 0;
    busy = visible
      ? flip(ghost, start, target, '0px', '14px', 520)
      : ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'both' });
    const done = () => {
      ghost.remove();
      hero.style.visibility = '';
      scroll.style.opacity = '';
      if (!current) el.classList.remove('is-open');
    };
    busy.finished.then(done).catch(done);
  }

  function close() {
    if (!current) return;
    if (pushed) history.back();
    else {
      try {
        history.replaceState(history.state, '', location.pathname + location.search);
      } catch {
        /* no address to restore */
      }
      hide();
    }
  }

  function sync() {
    const m = ROUTE.exec(location.hash);
    const work = m ? cases.find((w) => w.id === m[1]) : undefined;
    if (work) {
      if (current !== work) show(work, null, false);
    } else if (current) hide();
  }

  q<HTMLButtonElement>('.case__close').addEventListener('click', close, { signal: ac.signal });
  addEventListener('popstate', sync, { signal: ac.signal });
  addEventListener('hashchange', sync, { signal: ac.signal });
  addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && current) {
        e.stopPropagation();
        close();
      }
    },
    { signal: ac.signal, capture: true },
  );
  sync();

  return {
    open: (work, fromEl) => show(work, fromEl ?? null, true),
    close,
    isOpen: () => !!current,
    destroy() {
      ac.abort();
      busy?.cancel();
      document.title = baseTitle;
      el.remove();
    },
  };
}
