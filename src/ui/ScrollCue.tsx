import { useStore } from '../store';
import { homeGestures } from '../view';

/** A quiet "scroll" cue in the corner of the homepage. Clicking it flies out to the board. */
export function ScrollCue() {
  const ink = useStore((s) => s.ink);
  const hidden = useStore((s) => s.uiHidden || s.selected != null || s.islandTab != null);
  return (
    <button
      type="button"
      className="scroll-cue"
      data-ink={ink}
      data-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : 0}
      onClick={() => homeGestures.openBoard?.()}
      aria-label="See the work"
    >
      <i aria-hidden="true" />
      <span>Scroll for the work</span>
    </button>
  );
}
