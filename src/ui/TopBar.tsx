import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { randomBg } from '../bg/presets';
import { IconDice, IconEye, IconEyeOff, IconReset, ZeroGlyph } from './icons';
import { keepKeys } from './keys';
import './ui.css';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const HIDE_SHORTCUT = isMac ? '⌘\\' : 'Ctrl+\\';

/**
 * Two floating glass pills. Left: the Zeros "0" mark, the file name and an
 * "Edited" badge. Right: Reset, Surprise me, Hide UI. While the chrome is
 * hidden, a single round "show UI" button stays bottom-right.
 * Cmd/Ctrl + \ toggles the chrome, like hiding UI in a design tool.
 */
export function TopBar() {
  const edited = useStore((s) => s.edited);
  const hidden = useStore((s) => s.uiHidden);
  const setHidden = useStore((s) => s.setUiHidden);
  const resetAll = useStore((s) => s.resetAll);
  const setBg = useStore((s) => s.setBg);

  const [resets, setResets] = useState(0);
  const [rolls, setRolls] = useState(0);
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'show' | 'hide' | null>(null);

  // Move focus to whichever toggle is visible after hide/show, so keyboard users don't get stranded.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'show') showRef.current?.focus({ preventScroll: true });
    else if (target === 'hide') hideRef.current?.focus({ preventScroll: true });
  }, [hidden]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault();
        const s = useStore.getState();
        s.setUiHidden(!s.uiHidden);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hide = () => {
    focusNext.current = 'show';
    setHidden(true);
  };
  const show = () => {
    focusNext.current = 'hide';
    setHidden(false);
  };
  const reset = () => {
    resetAll();
    setResets((n) => n + 1);
  };
  const surprise = () => {
    setBg(randomBg());
    setRolls((n) => n + 1);
  };

  return (
    <>
      <div className="ui ui-glass ui-top ui-top--left ui-hideable" data-hidden={hidden || undefined} inert={hidden}>
        <ZeroGlyph className="ui-logo" size={20} />
        <span className="ui-file" title="once-upon-a-time">
          once-upon-a-time
        </span>
        <span className="ui-badge" data-on={edited || undefined} aria-hidden={!edited}>
          <span className="ui-badge__in">
            <span className="ui-badge__pill">
              <span className="ui-badge__dot" aria-hidden="true" />
              <span className="ui-badge__text">Edited</span>
            </span>
          </span>
        </span>
      </div>

      <div
        className="ui ui-glass ui-top ui-top--right ui-hideable"
        role="group"
        aria-label="Canvas actions"
        data-hidden={hidden || undefined}
        inert={hidden}
        onKeyDown={keepKeys}
      >
        <button
          type="button"
          className="ui-tbtn ui-tbtn--reset"
          onClick={reset}
          disabled={!edited}
          aria-label="Reset the canvas"
          title={edited ? 'Put everything back' : 'Nothing to reset yet'}
        >
          <IconReset key={resets} size={17} className={resets ? 'ui-spin-back' : undefined} />
          <span className="ui-tbtn__label">Reset</span>
        </button>
        <button type="button" className="ui-tbtn ui-tbtn--dice" onClick={surprise} aria-label="Surprise me: random background">
          <IconDice key={rolls} size={17} className={rolls ? 'ui-roll' : undefined} />
          <span className="ui-tbtn__label">Surprise me</span>
        </button>
        <button
          ref={hideRef}
          type="button"
          className="ui-tbtn"
          onClick={hide}
          aria-label="Hide UI"
          aria-keyshortcuts={isMac ? 'Meta+Backslash' : 'Control+Backslash'}
          title={`Hide UI (${HIDE_SHORTCUT})`}
        >
          <IconEyeOff size={17} />
          <span className="ui-tbtn__label">Hide UI</span>
        </button>
      </div>

      <button
        ref={showRef}
        type="button"
        className="ui ui-glass ui-show"
        data-on={hidden || undefined}
        inert={!hidden}
        aria-hidden={!hidden || undefined}
        onClick={show}
        onKeyDown={keepKeys}
        aria-label="Show UI"
        title={`Show UI (${HIDE_SHORTCUT})`}
      >
        <IconEye size={18} />
      </button>
    </>
  );
}
