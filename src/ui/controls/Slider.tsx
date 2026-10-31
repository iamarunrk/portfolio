import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Formats the readout and aria-valuetext. Defaults to a step-aware number. */
  format?: (v: number) => string;
  /** Double-click restores this value. */
  defaultValue?: number;
  disabled?: boolean;
  /** Extra hint appended to the label, e.g. "static". */
  note?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}

function snap(v: number, min: number, max: number, step: number): number {
  const s = step > 0 ? step : (max - min) / 100;
  const snapped = Math.round((v - min) / s) * s + min;
  return Number(clamp(snapped, min, max).toFixed(decimalsOf(s)));
}

export function formatNumber(v: number, step: number): string {
  return v.toFixed(decimalsOf(step));
}

/**
 * A "scrubby" design-tool slider: the whole row is the track, the label sits
 * on the left and the value on the right. Mouse drags anywhere; on touch a
 * horizontal drag scrubs while a vertical swipe still scrolls the panel
 * (touch-action: pan-y), and a tap jumps to the tapped spot.
 * Keyboard: arrows (shift = x10), PageUp/PageDown, Home/End.
 */
export function Slider({ label, value, min, max, step, onChange, format, defaultValue, disabled, note }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const range = max - min || 1;
  const safe = Number.isFinite(value) ? value : min;
  const p = clamp((safe - min) / range, 0, 1);
  const text = format ? format(safe) : formatNumber(safe, step);

  const emit = (v: number) => {
    const next = snap(v, min, max, step);
    if (next !== safe) onChange(next);
  };

  const valueAt = (clientX: number) => {
    const el = ref.current;
    if (!el) return safe;
    const r = el.getBoundingClientRect();
    return min + clamp((clientX - r.left) / Math.max(1, r.width), 0, 1) * range;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const mouse = e.pointerType === 'mouse' || e.pointerType === 'pen';
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active: mouse };
    if (mouse) {
      e.preventDefault(); // no text selection while scrubbing
      ref.current?.focus({ preventScroll: true });
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      emit(valueAt(e.clientX));
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.active) {
      const dx = Math.abs(e.clientX - d.x);
      const dy = Math.abs(e.clientY - d.y);
      if (dy > 8 && dy > dx) {
        drag.current = null; // a vertical swipe: let the panel scroll
        return;
      }
      if (dx < 6) return;
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    emit(valueAt(e.clientX));
  };

  const end = (e: PointerEvent<HTMLDivElement>, commitTap: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (commitTap && !d.active) emit(valueAt(e.clientX));
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const s = step > 0 ? step : range / 100;
    const big = Math.max(s * 10, range / 10);
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = safe + (e.shiftKey ? big : s);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = safe - (e.shiftKey ? big : s);
        break;
      case 'PageUp':
        next = safe + big;
        break;
      case 'PageDown':
        next = safe - big;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    emit(next);
  };

  const onDoubleClick = () => {
    if (!disabled && defaultValue !== undefined && Number.isFinite(defaultValue)) emit(defaultValue);
  };

  return (
    <div
      ref={ref}
      className="ui-slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={safe}
      aria-valuetext={text}
      aria-disabled={disabled || undefined}
      data-dragging={dragging || undefined}
      style={{ '--p': p } as CSSProperties}
      title={defaultValue !== undefined && !disabled ? 'Drag to adjust · double-click to reset' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
      onLostPointerCapture={() => {
        if (drag.current?.active) {
          drag.current = null;
          setDragging(false);
        }
      }}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    >
      <span className="ui-slider__fill" aria-hidden="true" />
      <span className="ui-slider__label">
        {label}
        {note ? <em className="ui-slider__note"> · {note}</em> : null}
      </span>
      <span className="ui-slider__value">{text}</span>
    </div>
  );
}
