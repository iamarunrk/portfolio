import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store';
import { IconClose, IconSparkle } from './icons';
import { keepKeys } from './keys';
import './ui.css';

const HINT_KEY = 'once-upon-a-time:hint';
const SHOW_DELAY = 900;
const LIFETIME = 9000;
const AFTER_HOVER = 3500;

function seen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* storage unavailable: the hint may show again next visit */
  }
}

type Phase = 'wait' | 'open' | 'closing' | 'done';

/**
 * First-visit toast above the island. Goes away when a toy (or the title) gets
 * selected, when the island opens, after ~9 s, or via its close button.
 * Hovering pauses the countdown.
 */
export function Hint() {
  const [phase, setPhase] = useState<Phase>(() => (seen() ? 'done' : 'wait'));
  const [hovered, setHovered] = useState(false);
  const [wasHovered, setWasHovered] = useState(false);
  const selected = useStore((s) => s.selected);
  const islandTab = useStore((s) => s.islandTab);
  const hidden = useStore((s) => s.uiHidden);

  const dismiss = useCallback(() => {
    markSeen();
    setPhase((p) => (p === 'open' ? 'closing' : p === 'wait' ? 'done' : p));
  }, []);

  useEffect(() => {
    if (phase !== 'wait') return;
    const t = setTimeout(() => setPhase('open'), SHOW_DELAY);
    return () => clearTimeout(t);
  }, [phase]);

  // Countdown pauses while hovered or while the chrome is hidden (nobody can read it then).
  useEffect(() => {
    if (phase !== 'open' || hovered || hidden) return;
    const t = setTimeout(dismiss, wasHovered ? AFTER_HOVER : LIFETIME);
    return () => clearTimeout(t);
  }, [phase, hovered, hidden, wasHovered, dismiss]);

  useEffect(() => {
    if (phase !== 'closing') return;
    const t = setTimeout(() => setPhase('done'), 280);
    return () => clearTimeout(t);
  }, [phase]);

  // The visitor found the toys or the island: job done.
  useEffect(() => {
    if (selected != null || islandTab != null) dismiss();
  }, [selected, islandTab, dismiss]);

  const visible = phase === 'open' || phase === 'closing';

  return (
    <>
      {/* Live region exists before the text arrives, so screen readers announce it. */}
      <div className="ui-sr" role="status" aria-live="polite">
        {phase === 'open' ? `${LEAD}. ${SUB}` : ''}
      </div>
      {visible ? (
        <div
          className="ui ui-glass ui-hint ui-hideable"
          data-state={phase}
          data-hidden={hidden || undefined}
          inert={hidden}
          onPointerEnter={() => {
            setHovered(true);
            setWasHovered(true);
          }}
          onPointerLeave={() => setHovered(false)}
          onKeyDown={keepKeys}
        >
          <IconSparkle className="ui-hint__spark" size={18} />
          <p className="ui-hint__text" aria-hidden="true">
            <span className="ui-hint__lead">
              Everything here is <em>editable</em>
            </span>
            <span className="ui-hint__sub">{SUB}</span>
          </p>
          <button type="button" className="ui-hint__close" onClick={dismiss} aria-label="Dismiss hint">
            <IconClose size={14} />
          </button>
        </div>
      ) : null}
    </>
  );
}

const LEAD = 'Everything here is editable';
const SUB = 'Drag, spin & scale the toys, then remix the canvas below.';
