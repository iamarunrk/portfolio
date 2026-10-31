import type { CSSProperties, ReactNode } from 'react';

/** Normalises any "#rgb" / "#rrggbb" / "#rrggbbaa" string to the "#rrggbb" a colour input needs. */
export function toHex6(c: string | undefined | null): string {
  if (!c) return '#000000';
  let s = c.trim().toLowerCase();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3,4}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^#[0-9a-f]{8}$/.test(s)) s = s.slice(0, 7);
  return /^#[0-9a-f]{6}$/.test(s) ? s : '#000000';
}

export const sameColor = (a: string | undefined, b: string | undefined) => toHex6(a) === toHex6(b);

export interface ColorChipProps {
  value: string;
  onChange: (hex: string) => void;
  /** Accessible name, e.g. "Palette colour 2". */
  label: string;
  /** Show the hex code next to the dot (design-tool "fill row"). */
  showHex?: boolean;
  /** Optional caption shown before the hex (e.g. "Tint"). */
  caption?: ReactNode;
}

/**
 * A colour dot wrapping a real `<input type="color">`. The input covers the
 * chip (transparent), so a tap opens the native picker on every platform.
 */
export function ColorChip({ value, onChange, label, showHex = true, caption }: ColorChipProps) {
  const hex = toHex6(value);
  return (
    <label className="ui-chip" data-hex={showHex || undefined} style={{ '--c': hex } as CSSProperties}>
      <span className="ui-chip__dot" aria-hidden="true" />
      {caption ? <span className="ui-chip__caption">{caption}</span> : null}
      {showHex ? <span className="ui-chip__hex">{hex.slice(1).toUpperCase()}</span> : null}
      <input
        className="ui-chip__input"
        type="color"
        value={hex}
        aria-label={`${label}, ${hex.toUpperCase()}`}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}
