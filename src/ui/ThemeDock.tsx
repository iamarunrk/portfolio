import { useEffect, useMemo, useRef, useState } from 'react';
import type { BgConfig } from '../bg/types';
import { useStore, type IslandTab } from '../store';
import { themeName } from '../theme/tokens';
import { Island, tabForKind } from './Island';
import { keepKeys } from './keys';
import { useLiquidGlass } from './liquidGlass';
import { paletteCss, useThumb } from './thumbs';
import './themeDock.css';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el?.tagName && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/**
 * The homepage's theme button: the whole remix island at rest. One live swatch of the current
 * theme at the bottom of the page (Liquid Glass, like the rest of the homepage chrome); it opens
 * the island (Shaders, Gradients, Colors, Glass, Effects, dice) on the tab that owns the current
 * look, and the island folds back into it. `T` toggles it.
 */
export function ThemeButton() {
  const bg = useStore((s) => s.bg);
  const tab = useStore((s) => s.islandTab);
  const setTab = useStore((s) => s.setIslandTab);
  const uiHidden = useStore((s) => s.uiHidden);
  const ref = useRef<HTMLButtonElement>(null);
  useLiquidGlass(ref);
  const open = tab != null;
  const hidden = uiHidden || open;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 't' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      const s = useStore.getState();
      if (s.view !== 'home' || s.uiHidden) return;
      e.preventDefault();
      s.setIslandTab(s.islandTab ? null : tabForKind(s.bg.base.kind));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // the island folded back (Esc, the active tab again): focus returns to the button that opened it
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const a = document.activeElement;
      if (!a || a === document.body || a.closest('.ui-island')) ref.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  const cfg = useMemo<BgConfig>(() => ({ ...bg, fx: { ...bg.fx, grain: 0 } }), [bg]);
  const url = useThumb(cfg, 64, 64, { debounce: 140, priority: 3 });
  const name = themeName(bg);

  return (
    <button
      ref={ref}
      type="button"
      className="ui ui-glass ui-hideable th-home"
      data-hidden={hidden || undefined}
      inert={hidden}
      onClick={() => setTab(tabForKind(bg.base.kind))}
      onKeyDown={keepKeys}
      aria-label={`Theme: ${name}. Change it`}
      aria-expanded={open}
      aria-keyshortcuts="T"
      data-tip={`Theme · ${name}`}
    >
      <span className="th-btn__thumb" style={{ background: paletteCss(bg.base) }}>
        {url ? <img src={url} alt="" draggable={false} decoding="async" /> : null}
      </span>
    </button>
  );
}

/**
 * The theme, one button away, off the homepage too.
 *
 * On the board (and inside a case study) the whole remix island folds into a single button at the
 * bottom: a live swatch of the current theme, beside the board's toolbar. It opens the same controls
 * as the homepage (Shaders, Gradients, Colors, Glass, Effects and the dice), on the tab that owns the
 * current look. Changing the theme here changes it everywhere: the homepage frame on the board
 * repaints live, and the board and case pages echo it (src/theme).
 *
 * `T` toggles it (the board sends `theme:toggle`, so its shortcuts stay in one place).
 */
export function ThemeDock() {
  const view = useStore((s) => s.view);
  const bg = useStore((s) => s.bg);
  const [tab, setTab] = useState<IslandTab | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const open = tab != null;
  const onBoard = view === 'board';

  // back on the homepage its own island takes over
  useEffect(() => {
    if (!onBoard) setTab(null);
  }, [onBoard]);

  useEffect(() => {
    const toggle = () => setTab((t) => (t ? null : tabForKind(useStore.getState().bg.base.kind)));
    window.addEventListener('theme:toggle', toggle);
    return () => window.removeEventListener('theme:toggle', toggle);
  }, []);

  // closing with Esc leaves focus on the button that opened it, not on the vanished panel
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const a = document.activeElement;
      if (!a || a === document.body || a.closest('.th-dock')) btnRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  const cfg = useMemo<BgConfig>(() => ({ ...bg, fx: { ...bg.fx, grain: 0 } }), [bg]);
  const url = useThumb(cfg, 64, 64, { debounce: 140, priority: 3, enabled: onBoard });
  const name = themeName(bg);

  return (
    <div className="ui th-dock" data-open={open || undefined}>
      <button
        ref={btnRef}
        type="button"
        className="th-btn"
        onClick={() => setTab(tabForKind(bg.base.kind))}
        aria-label={`Theme: ${name}. Change it`}
        aria-expanded={open}
        aria-keyshortcuts="T"
        data-tip={`Theme · ${name}`}
        tabIndex={open ? -1 : 0}
      >
        <span className="th-btn__thumb" style={{ background: paletteCss(bg.base) }}>
          {url ? <img src={url} alt="" draggable={false} decoding="async" /> : null}
        </span>
      </button>
      <Island variant="board" tab={tab} onTab={setTab} />
    </div>
  );
}
