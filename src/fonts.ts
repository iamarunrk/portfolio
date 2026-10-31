/**
 * Font families used across the UI and the canvas-painted sticker textures.
 * They are loaded from Google Fonts in index.html; textures must wait for them,
 * otherwise the canvas would bake in a fallback face.
 */
export const FONTS = {
  /** chunky bubbly display: big logotypes */
  bagel: '"Bagel Fat One", "Arial Black", system-ui, sans-serif',
  /** wide geometric mono display: labels, badges */
  rubikMono: '"Rubik Mono One", "Arial Black", system-ui, sans-serif',
  /** 70s italic display: script-ish logos */
  shrikhand: '"Shrikhand", Georgia, serif',
  /** typewriter mono: small print, terminal screen */
  spaceMono: '"Space Mono", ui-monospace, monospace',
  /** heavy grotesk: warning labels, small bold text */
  archivoBlack: '"Archivo Black", "Arial Black", system-ui, sans-serif',
  /** marker handwriting: scribbles on stickers */
  marker: '"Permanent Marker", "Comic Sans MS", cursive',
  /** editorial serif (has italic): headline */
  serif: '"Instrument Serif", Georgia, "Times New Roman", serif',
  /** UI sans */
  ui: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif',
  /** UI mono */
  uiMono: '"Geist Mono", ui-monospace, "SF Mono", monospace',
} as const;

const FACES_TO_LOAD = [
  '64px "Bagel Fat One"',
  '64px "Rubik Mono One"',
  '64px "Shrikhand"',
  '64px "Space Mono"',
  'bold 64px "Space Mono"',
  '64px "Archivo Black"',
  '64px "Permanent Marker"',
  '64px "Instrument Serif"',
  'italic 64px "Instrument Serif"',
  '500 64px "Geist"',
  '700 64px "Geist"',
  '500 64px "Geist Mono"',
];

let loadPromise: Promise<void> | null = null;
let fontsPromise: Promise<void> | null = null;
let loaded = false;

function startLoad(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      if (typeof document === 'undefined' || !('fonts' in document)) return;
      await Promise.allSettled(FACES_TO_LOAD.map((f) => document.fonts.load(f, 'AaZz09')));
    })().then(() => {
      loaded = true;
    });
  }
  return loadPromise;
}

/**
 * Resolves once all faces are loaded, or after `timeoutMs` (whichever comes first),
 * so a blocked font CDN never stalls the page; textures then fall back gracefully.
 */
export function ensureFonts(timeoutMs = 3500): Promise<void> {
  if (fontsPromise) return fontsPromise;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  fontsPromise = Promise.race([startLoad(), timeout]);
  return fontsPromise;
}

/** True once every face has actually finished loading (not just timed out). */
export function fontsLoaded(): boolean {
  return loaded;
}

/** Resolves when every face has really loaded (no timeout). */
export function whenFontsLoaded(): Promise<void> {
  return startLoad();
}
