import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { BgConfig } from '../../bg/types';
import { useInView, useThumb } from '../thumbs';

/** Render size of rail thumbnails in device pixels (72 CSS px at 2x). */
export const SWATCH_RENDER_PX = 144;

export interface SwatchItem {
  id: string;
  name: string;
  /** Exact config the thumbnail renders. */
  cfg: BgConfig;
  /** CSS background shown until the real thumbnail arrives. */
  fallback: string;
}

interface SwatchProps {
  item: SwatchItem;
  active: boolean;
  tabbable: boolean;
  rootRef: RefObject<HTMLElement | null>;
  debounce?: number;
  onSelect: (id: string) => void;
}

export function Swatch({ item, active, tabbable, rootRef, debounce, onSelect }: SwatchProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const inView = useInView(ref, rootRef);
  const url = useThumb(item.cfg, SWATCH_RENDER_PX, SWATCH_RENDER_PX, { debounce, enabled: inView, priority: 1 });
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={tabbable ? 0 : -1}
      className="ui-swatch"
      data-id={item.id}
      onClick={() => onSelect(item.id)}
    >
      <span className="ui-swatch__thumb" style={{ background: item.fallback }}>
        {url ? <img className="ui-swatch__img" src={url} alt="" draggable={false} decoding="async" /> : null}
      </span>
      <span className="ui-swatch__name">{item.name}</span>
    </button>
  );
}

interface RailProps {
  items: SwatchItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Accessible name of the radio group. */
  label: string;
  /** Debounce for thumbnail re-renders when items' configs change. */
  debounce?: number;
}

const NAV_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * Horizontally scrolling rail of swatches. A radio group: one tab stop, arrow
 * keys move and apply (live preview), Home/End jump. Vertical mouse wheels
 * scroll it sideways; touch gets native momentum. Edges fade when there's more.
 */
export function Rail({ items, activeId, onSelect, label, debounce }: RailProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const updateEdges = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft >= max - 2;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  // Mouse wheels are vertical; translate them while the rail can still move.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const delta = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      const next = Math.max(0, Math.min(max, el.scrollLeft + delta));
      if (Math.abs(next - el.scrollLeft) < 0.5) return; // at the end: let the panel scroll
      el.scrollLeft = next;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Centre the active swatch on open. Set scrollLeft directly: scrollIntoView
  // would also scroll the (overflow: hidden) panel while it animates open.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const act = el.querySelector<HTMLElement>('[aria-checked="true"]');
    if (act) el.scrollLeft = act.offsetLeft - (el.clientWidth - act.offsetWidth) / 2;
    updateEdges();
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateEdges]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(e.key) || !ref.current) return;
    const buttons = Array.from(ref.current.querySelectorAll<HTMLButtonElement>('.ui-swatch'));
    if (!buttons.length) return;
    const cur = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    let next = cur;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    e.preventDefault();
    const btn = buttons[next];
    const el = ref.current;
    btn.focus({ preventScroll: true });
    const left = btn.offsetLeft;
    const right = left + btn.offsetWidth;
    if (left < el.scrollLeft + 8) el.scrollTo({ left: left - 16, behavior: 'smooth' });
    else if (right > el.scrollLeft + el.clientWidth - 8) el.scrollTo({ left: right - el.clientWidth + 16, behavior: 'smooth' });
    const id = btn.dataset.id;
    if (id) onSelect(id);
  };

  const tabbableId = activeId && items.some((i) => i.id === activeId) ? activeId : items[0]?.id;

  return (
    <div
      ref={ref}
      className="ui-rail"
      role="radiogroup"
      aria-label={label}
      data-at-start={edges.start || undefined}
      data-at-end={edges.end || undefined}
      onScroll={updateEdges}
      onKeyDown={onKeyDown}
    >
      {items.map((it) => (
        <Swatch
          key={it.id}
          item={it}
          active={it.id === activeId}
          tabbable={it.id === tabbableId}
          rootRef={ref}
          debounce={debounce}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
