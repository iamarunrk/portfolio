/** Tiny DOM helpers for the imperative board (kept out of React so camera moves never re-render). */

type Kid = Node | string | null | undefined | Kid[];

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  const add = (kid: Kid) => {
    if (kid == null) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else el.append(kid);
  };
  kids.forEach(add);
  return el;
}

const NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => t * t * (3 - 2 * t);
export const smoothstep = (a: number, b: number, v: number) => ease(clamp((v - a) / (b - a), 0, 1));

export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}
