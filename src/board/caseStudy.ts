import { h } from './dom';
import { WORKS, mountWork, type Work } from './works';

/**
 * The case-study page.
 *
 * Like the homepage, a case study is a real page that sits on the board: its frame is the page seen
 * from afar. This module only builds and fills the page; the board's camera scales it, unfolds it
 * out of its frame as you zoom in, and decides when it is "the page you are on".
 */

const ROUTE = /^#\/work\/([\w-]+)$/;
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

const DEFAULT_BODY = [
  'This is where the case study lives, on its own page. The board only shows the output; opening it tells the story: the problem, the process, the decisions and the outcome.',
  'Placeholder copy and visuals for now. Add the real story in src/board/works.ts.',
];

export const caseWorks = (): Work[] => WORKS.filter((w) => w.case);

/** The work a `#/work/<id>` address points at, if any. */
export function caseFromHash(hash = location.hash): Work | null {
  const m = ROUTE.exec(hash);
  return (m && caseWorks().find((w) => w.id === m[1])) || null;
}
export const caseHash = (work: Work) => `#/work/${work.id}`;

export interface CasePage {
  el: HTMLElement;
  scroll: HTMLElement;
  close: HTMLButtonElement;
  next: HTMLButtonElement;
  /** The work currently shown. */
  work: Work | null;
  fill(work: Work): void;
  atTop(): boolean;
  atBottom(): boolean;
}

export function buildCasePage(el: HTMLElement): CasePage {
  el.setAttribute('role', 'document');
  el.setAttribute('aria-label', 'Case study');
  el.innerHTML = `
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
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const scroll = q<HTMLElement>('.case__scroll');
  const hero = q<HTMLElement>('.case__hero');
  const page: CasePage = {
    el,
    scroll,
    close: q<HTMLButtonElement>('.case__close'),
    next: q<HTMLButtonElement>('.case__next button'),
    work: null,
    fill(work) {
      if (page.work === work) return;
      page.work = work;
      const c = work.case;
      q('.case__kicker').textContent = c?.kicker ?? 'Case study';
      q('.case__title').textContent = c?.title ?? 'Project name';
      q('.case__meta').replaceChildren(...(c?.meta ?? []).map((m) => h('span', {}, m)));
      q('.case__text').replaceChildren(...(c?.body ?? DEFAULT_BODY).map((p) => h('p', { class: 'case__p' }, p)));
      hero.replaceChildren();
      mountWork(work, hero, { pause: false });
      const all = caseWorks();
      const others = all.filter((w) => w.id !== work.id);
      el.querySelectorAll<HTMLElement>('.case__grid > div').forEach((g, i) => {
        g.replaceChildren();
        if (others.length) mountWork(others[i % others.length], g);
      });
      const next = all[(all.indexOf(work) + 1) % all.length];
      page.next.textContent = `${next.case?.title ?? 'Next'} →`;
      page.next.dataset.id = next.id;
      scroll.scrollTop = 0;
    },
    atTop: () => scroll.scrollTop <= 0.5,
    atBottom: () => scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1.5,
  };
  return page;
}
