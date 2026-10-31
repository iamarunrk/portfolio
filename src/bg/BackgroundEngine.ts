import * as THREE from 'three';
import type { BaseKind, BaseLayer, BgConfig, Effects, MaterialKind, MaterialLayer } from './types';
import { BASE_META } from './meta';
import { BASE_FRAG, BASE_KIND_ORDER } from './glsl/base';
import { MATERIAL_FRAG, MATERIAL_KIND_ORDER } from './glsl/material';
import { FULLSCREEN_VERT } from './glsl/common';
import { DEFAULT_BG, defaultBase, defaultMaterial } from './presets';

const DEG = Math.PI / 180;
const MAX_PULSES = 4;
const PULSE_LIFE = 4.5;

type Uniform<T> = { value: T };

interface BaseUniforms {
  [k: string]: Uniform<unknown>;
  uTime: Uniform<number>;
  uRes: Uniform<THREE.Vector2>;
  uDpr: Uniform<number>;
  uScale: Uniform<number>;
  uAngle: Uniform<number>;
  uDetail: Uniform<number>;
  uAmount: Uniform<number>;
  uCol: Uniform<THREE.Vector3[]>;
  uLab: Uniform<THREE.Vector3[]>;
}

interface MatUniforms {
  [k: string]: Uniform<unknown>;
  tBase: Uniform<THREE.Texture>;
  uRes: Uniform<THREE.Vector2>;
  uBaseRes: Uniform<THREE.Vector2>;
  uDpr: Uniform<number>;
  uUnit: Uniform<number>;
  uTime: Uniform<number>;
  uStrength: Uniform<number>;
  uSize: Uniform<number>;
  uBlur: Uniform<number>;
  uAngle: Uniform<number>;
  uHighlight: Uniform<number>;
  uAberration: Uniform<number>;
  uTint: Uniform<THREE.Vector3>;
  uTintAmount: Uniform<number>;
  uShape: Uniform<number>;
  uPointer: Uniform<THREE.Vector2>;
  uPulses: Uniform<THREE.Vector4[]>;
  uGrain: Uniform<number>;
  uVignette: Uniform<number>;
  uOutSrgb: Uniform<number>;
  uCol: Uniform<THREE.Vector3[]>;
  uLab: Uniform<THREE.Vector3[]>;
}

// ------------------------------------------------------------------------------------------------
// CPU colour helpers
// ------------------------------------------------------------------------------------------------
const _color = new THREE.Color();
function parseHex(hex: string | undefined, out: THREE.Vector3): THREE.Vector3 {
  let h = (hex ?? '').trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (/^[0-9a-f]{3,4}$/i.test(h)) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) {
    const n = parseInt(h.slice(0, 6), 16);
    return out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  _color.set(0x000000);
  try {
    _color.setStyle(hex ?? '#000');
  } catch {
    /* keep black */
  }
  const s = { r: 0, g: 0, b: 0 };
  _color.getRGB(s, THREE.SRGBColorSpace);
  return out.set(s.r, s.g, s.b);
}
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function srgbToOklab(c: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const r = toLin(c.x);
  const g = toLin(c.y);
  const b = toLin(c.z);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return out.set(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
}

const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function sanitize(cfg: BgConfig | undefined): BgConfig {
  const src = cfg ?? DEFAULT_BG;
  const bk: BaseKind = BASE_KIND_ORDER.includes(src.base?.kind) ? src.base.kind : 'mesh';
  const mk: MaterialKind = MATERIAL_KIND_ORDER.includes(src.material?.kind) ? src.material.kind : 'none';
  const bd = defaultBase(bk);
  const md = defaultMaterial(mk);
  const b = src.base ?? bd;
  const m = src.material ?? md;
  const cols = Array.isArray(b.colors) && b.colors.length ? b.colors : bd.colors;
  const base: BaseLayer = {
    kind: bk,
    colors: [cols[0], cols[1] ?? cols[0], cols[2] ?? cols[1] ?? cols[0], cols[3] ?? cols[2] ?? cols[0]],
    speed: finite(b.speed, bd.speed),
    scale: Math.max(0.05, finite(b.scale, bd.scale)),
    angle: finite(b.angle, bd.angle),
    detail: finite(b.detail, bd.detail),
    amount: finite(b.amount, bd.amount),
  };
  const material: MaterialLayer = {
    kind: mk,
    strength: finite(m.strength, md.strength),
    size: finite(m.size, md.size),
    blur: finite(m.blur, md.blur),
    angle: finite(m.angle, md.angle),
    highlight: finite(m.highlight, md.highlight),
    aberration: finite(m.aberration, md.aberration),
    tint: typeof m.tint === 'string' ? m.tint : md.tint,
    tintAmount: finite(m.tintAmount, md.tintAmount),
    speed: finite(m.speed, md.speed),
    shape: finite(m.shape, md.shape ?? 0.5),
  };
  const fx: Effects = { grain: finite(src.fx?.grain, 0), vignette: finite(src.fx?.vignette, 0) };
  return { base, material, fx };
}

interface Pulse {
  x: number;
  y: number;
  t0: number;
  amp: number;
}

/**
 * Two-pass background: (1) the base generator renders sRGB into an internal mip-mapped RGBA8 target
 * (half resolution for smooth kinds, full resolution for crisp ones), (2) the material pass draws the
 * full-screen `mesh` in the main scene, refracting / filtering that target, adding grain + vignette and
 * writing linear colour so three encodes correctly both to the canvas and to the transmission pre-pass.
 */
export class BackgroundEngine {
  /** Full-screen quad for the main scene: renderOrder -1000, frustumCulled false, depthTest/depthWrite false. */
  readonly mesh: THREE.Mesh;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly geometry: THREE.BufferGeometry;
  private readonly camera = new THREE.Camera();
  private readonly baseScene = new THREE.Scene();
  private readonly matScene = new THREE.Scene();
  private readonly baseQuad: THREE.Mesh;
  private readonly matQuad: THREE.Mesh;
  private readonly baseMats = new Map<BaseKind, THREE.ShaderMaterial>();
  private readonly matMats = new Map<MaterialKind, THREE.ShaderMaterial>();
  private readonly bu: BaseUniforms;
  private readonly mu: MatUniforms;
  private readonly rt: THREE.WebGLRenderTarget;
  private thumbBase: THREE.WebGLRenderTarget | null = null;
  private thumbOut: THREE.WebGLRenderTarget | null = null;
  private thumbCanvas: HTMLCanvasElement | null = null;

  private cfg: BgConfig;
  private baseKind: BaseKind;
  private matKind: MaterialKind;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private outW = 1;
  private outH = 1;
  private baseTime = 0;
  private matTime = 0;
  private clock = 0;
  private readonly pointer = new THREE.Vector2(0.62, 0.58);
  private readonly pointerTarget = new THREE.Vector2(0.62, 0.58);
  private pulses: Pulse[] = [];
  private baseDirty = true;
  private disposed = false;
  private colorKeys: string[] = ['', '', '', '', ''];
  private readonly onContextRestored = () => {
    this.baseDirty = true;
  };

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.geometry = g;

    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.MirroredRepeatWrapping,
      wrapT: THREE.MirroredRepeatWrapping,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: THREE.NoColorSpace,
    });
    this.rt.texture.name = 'bg-base';

    const v3s = () => [0, 1, 2, 3].map(() => new THREE.Vector3());
    const cols = v3s();
    const labs = v3s();
    this.bu = {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(4, 4) },
      uDpr: { value: 1 },
      uScale: { value: 1 },
      uAngle: { value: 0 },
      uDetail: { value: 0.5 },
      uAmount: { value: 0.5 },
      uCol: { value: cols },
      uLab: { value: labs },
    };
    this.mu = {
      tBase: { value: this.rt.texture },
      uRes: { value: new THREE.Vector2(4, 4) },
      uBaseRes: { value: new THREE.Vector2(4, 4) },
      uDpr: { value: 1 },
      uUnit: { value: 1 },
      uTime: { value: 0 },
      uStrength: { value: 0.5 },
      uSize: { value: 0.5 },
      uBlur: { value: 0 },
      uAngle: { value: 0 },
      uHighlight: { value: 0.5 },
      uAberration: { value: 0.3 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uTintAmount: { value: 0 },
      uShape: { value: 0.5 },
      uPointer: { value: this.pointer.clone() },
      uPulses: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector4()) },
      uGrain: { value: 0 },
      uVignette: { value: 0 },
      uOutSrgb: { value: 0 },
      uCol: { value: cols },
      uLab: { value: labs },
    };

    this.cfg = sanitize(DEFAULT_BG);
    this.baseKind = this.cfg.base.kind;
    this.matKind = this.cfg.material.kind;

    this.baseQuad = new THREE.Mesh(g, this.getBaseMat(this.baseKind));
    this.baseQuad.frustumCulled = false;
    this.baseScene.add(this.baseQuad);

    const mm = this.getMatMat(this.matKind);
    this.mesh = new THREE.Mesh(g, mm);
    this.mesh.name = 'BackgroundEngine';
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.raycast = () => {}; // never intercept object picking
    this.matQuad = new THREE.Mesh(g, mm);
    this.matQuad.frustumCulled = false;
    this.matScene.add(this.matQuad);

    renderer.domElement?.addEventListener?.('webglcontextrestored', this.onContextRestored);
    const size = renderer.getSize(new THREE.Vector2());
    this.setSize(size.x || 1, size.y || 1, renderer.getPixelRatio() || 1);
    this.applyBase(this.cfg.base);
    this.applyMaterial(this.cfg.material, this.cfg.fx);
  }

  // ----------------------------------------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------------------------------------

  /** Cheap: uniforms only. Programs are compiled once per kind and cached. */
  setConfig(cfg: BgConfig): void {
    const next = sanitize(cfg);
    const prev = this.cfg.base;
    const nb = next.base;
    const baseChanged =
      nb.kind !== prev.kind || nb.scale !== prev.scale || nb.angle !== prev.angle || nb.detail !== prev.detail ||
      nb.amount !== prev.amount || nb.colors.some((c, i) => c !== prev.colors[i]);
    this.cfg = next;
    if (next.base.kind !== this.baseKind) {
      this.baseKind = next.base.kind;
      this.baseQuad.material = this.getBaseMat(this.baseKind);
      this.resizeBaseRT();
    }
    if (next.material.kind !== this.matKind) {
      this.matKind = next.material.kind;
      const mm = this.getMatMat(this.matKind);
      this.mesh.material = mm;
      this.matQuad.material = mm;
    }
    this.applyBase(next.base);
    this.applyMaterial(next.material, next.fx);
    if (baseChanged) this.baseDirty = true;
  }

  setSize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssW = Math.max(1, finite(cssWidth, 1));
    this.cssH = Math.max(1, finite(cssHeight, 1));
    this.dpr = Math.min(4, Math.max(0.25, finite(dpr, 1)));
    this.outW = Math.max(1, Math.round(this.cssW * this.dpr));
    this.outH = Math.max(1, Math.round(this.cssH * this.dpr));
    this.mu.uRes.value.set(this.outW, this.outH);
    this.mu.uDpr.value = this.dpr;
    this.mu.uUnit.value = designUnit(this.cssW, this.cssH, this.dpr);
    this.resizeBaseRT();
    this.baseDirty = true;
  }

  /** 0..1, origin bottom-left. The liquid-glass pointer blob eases toward it. */
  setPointer(x: number, y: number): void {
    this.pointerTarget.set(clamp01(finite(x, 0.5)), clamp01(finite(y, 0.5)));
  }

  /** Tap ripple at 0..1 coords (origin bottom-left). Water and liquid glass react. */
  pulse(x: number, y: number): void {
    this.pulses.push({ x: clamp01(finite(x, 0.5)), y: clamp01(finite(y, 0.5)), t0: this.clock, amp: 1 });
    if (this.pulses.length > MAX_PULSES) this.pulses.shift();
    if (this.matKind === 'liquidGlass') this.pointerTarget.set(this.pulses[this.pulses.length - 1].x, this.pulses[this.pulses.length - 1].y);
  }

  /** Advance time and render the base pass into the internal target. Call once per frame before the main render. */
  update(dt: number): void {
    if (this.disposed) return;
    const d = Math.min(Math.max(finite(dt, 0), 0), 0.1);
    const b = this.cfg.base;
    if (d > 0 && b.speed !== 0 && BASE_META[b.kind].animated) {
      this.baseTime += d * b.speed;
      this.baseDirty = true;
    }
    this.matTime += d * this.cfg.material.speed;
    this.clock += d;
    this.pointer.lerp(this.pointerTarget, 1 - Math.exp(-d * 4.5));
    while (this.pulses.length && this.clock - this.pulses[0].t0 >= PULSE_LIFE) this.pulses.shift();
    this.syncDynamicUniforms();
    if (this.baseDirty) {
      this.renderBase(this.rt);
      this.baseDirty = false;
    }
  }

  /** Renders `cfg` off-screen and returns an sRGB PNG data URL. Leaves all renderer state as it was. */
  renderThumbnail(cfg: BgConfig, width: number, height: number, time?: number): string {
    if (this.disposed) return '';
    const w = Math.max(1, Math.min(2048, Math.round(finite(width, 160))));
    const h = Math.max(1, Math.min(2048, Math.round(finite(height, 100))));
    const tdpr = Math.min(1, Math.max(0.3, Math.min(w, h) / 400));
    const px = this.renderOffscreen(cfg, w, h, tdpr, time);
    if (typeof document === 'undefined') return '';
    const canvas = this.thumbCanvas ?? (this.thumbCanvas = document.createElement('canvas'));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /** 0..1 average perceived lightness (cube root of relative luminance, ~OKLab L) of the final background. */
  sampleLuminance(cfg?: BgConfig): number {
    if (this.disposed) return 0;
    const aspect = this.outH / this.outW;
    const w = 48;
    const h = Math.max(8, Math.min(160, Math.round(w * aspect)));
    const dpr = Math.max(0.1, (w / this.cssW) * 1.5);
    const px = this.renderOffscreen(cfg ?? this.cfg, w, h, dpr);
    let sum = 0;
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const Y = 0.2126 * toLin(px[i * 4] / 255) + 0.7152 * toLin(px[i * 4 + 1] / 255) + 0.0722 * toLin(px[i * 4 + 2] / 255);
      sum += Math.cbrt(Y);
    }
    return n ? sum / n : 0;
  }

  /**
   * Optional extra: compile every base + material program ahead of time so switching kinds never hitches.
   * Uses KHR_parallel_shader_compile when available; otherwise compiles one program per idle slice.
   */
  async precompile(): Promise<void> {
    const r = this.renderer;
    const jobs: { mat: THREE.ShaderMaterial; toTarget: boolean }[] = [
      ...BASE_KIND_ORDER.map((k) => ({ mat: this.getBaseMat(k), toTarget: true })),
      ...MATERIAL_KIND_ORDER.map((k) => ({ mat: this.getMatMat(k), toTarget: false })),
    ];
    const sceneFor = (list: typeof jobs) => {
      const scene = new THREE.Scene();
      for (const j of list) {
        const m = new THREE.Mesh(this.geometry, j.mat);
        m.frustumCulled = false;
        scene.add(m);
      }
      return scene;
    };
    // base programs are keyed for the render target they draw into, material programs for the canvas
    const compileInto = (scene: THREE.Scene, toTarget: boolean, asyncMode: boolean) => {
      const prev = r.getRenderTarget();
      if (toTarget) r.setRenderTarget(this.rt);
      try {
        return asyncMode ? r.compileAsync(scene, this.camera) : (r.compile(scene, this.camera), Promise.resolve());
      } finally {
        r.setRenderTarget(prev);
      }
    };
    try {
      if (r.extensions.has('KHR_parallel_shader_compile')) {
        await Promise.all([
          compileInto(sceneFor(jobs.filter((j) => j.toTarget)), true, true),
          compileInto(sceneFor(jobs.filter((j) => !j.toTarget)), false, true),
        ]);
        return;
      }
      for (const job of jobs) {
        await idle();
        if (this.disposed) return;
        await compileInto(sceneFor([job]), job.toTarget, false);
      }
    } catch {
      /* best effort */
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.domElement?.removeEventListener?.('webglcontextrestored', this.onContextRestored);
    this.mesh.removeFromParent();
    for (const m of this.baseMats.values()) m.dispose();
    for (const m of this.matMats.values()) m.dispose();
    this.baseMats.clear();
    this.matMats.clear();
    this.geometry.dispose();
    this.rt.dispose();
    this.thumbBase?.dispose();
    this.thumbOut?.dispose();
    this.thumbBase = this.thumbOut = null;
    this.thumbCanvas = null;
  }

  // ----------------------------------------------------------------------------------------------
  // Internals
  // ----------------------------------------------------------------------------------------------

  private getBaseMat(kind: BaseKind): THREE.ShaderMaterial {
    let m = this.baseMats.get(kind);
    if (!m) {
      m = new THREE.ShaderMaterial({
        name: `bg-base-${kind}`,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: BASE_FRAG,
        uniforms: this.bu,
        defines: { BASE_KIND: BASE_KIND_ORDER.indexOf(kind) },
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.baseMats.set(kind, m);
    }
    return m;
  }

  private getMatMat(kind: MaterialKind): THREE.ShaderMaterial {
    let m = this.matMats.get(kind);
    if (!m) {
      m = new THREE.ShaderMaterial({
        name: `bg-material-${kind}`,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: MATERIAL_FRAG,
        uniforms: this.mu,
        defines: { MAT_KIND: MATERIAL_KIND_ORDER.indexOf(kind) },
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.matMats.set(kind, m);
    }
    return m;
  }

  /** Half resolution for smooth kinds (>= 256 px on the short side), full resolution for crisp kinds. */
  private baseScale(kind: BaseKind, w: number, h: number): number {
    if (BASE_META[kind].crisp) return 1;
    const short = Math.min(w, h);
    return short * 0.5 >= 256 ? 0.5 : Math.min(1, 256 / Math.max(short, 1));
  }

  private resizeBaseRT(): void {
    const s = this.baseScale(this.baseKind, this.outW, this.outH);
    const w = Math.max(1, Math.round(this.outW * s));
    const h = Math.max(1, Math.round(this.outH * s));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    this.bu.uRes.value.set(w, h);
    this.bu.uDpr.value = this.dpr * (h / this.outH);
    this.mu.uBaseRes.value.set(w, h);
    this.baseDirty = true;
  }

  private applyBase(b: BaseLayer): void {
    const u = this.bu;
    u.uScale.value = b.scale;
    u.uAngle.value = b.angle * DEG;
    u.uDetail.value = b.detail;
    u.uAmount.value = b.amount;
    for (let i = 0; i < 4; i++) {
      const hex = b.colors[i] ?? b.colors[0];
      if (this.colorKeys[i] === hex) continue;
      this.colorKeys[i] = hex;
      parseHex(hex, u.uCol.value[i]);
      srgbToOklab(u.uCol.value[i], u.uLab.value[i]);
    }
  }

  private applyMaterial(m: MaterialLayer, fx: Effects): void {
    const u = this.mu;
    u.uStrength.value = m.strength;
    u.uSize.value = clamp01(m.size);
    u.uBlur.value = clamp01(m.blur);
    u.uAngle.value = m.angle * DEG;
    u.uHighlight.value = m.highlight;
    u.uAberration.value = m.aberration;
    if (this.colorKeys[4] !== m.tint) {
      this.colorKeys[4] = m.tint;
      parseHex(m.tint, u.uTint.value);
    }
    u.uTintAmount.value = clamp01(m.tintAmount);
    u.uShape.value = clamp01(m.shape ?? 0.5);
    u.uGrain.value = Math.max(0, fx.grain);
    u.uVignette.value = Math.max(0, fx.vignette);
  }

  private syncDynamicUniforms(): void {
    this.bu.uTime.value = this.baseTime;
    this.mu.uTime.value = this.matTime;
    this.mu.uPointer.value.copy(this.pointer);
    const arr = this.mu.uPulses.value;
    for (let i = 0; i < MAX_PULSES; i++) {
      const p = this.pulses[i];
      if (p) arr[i].set(p.x, p.y, this.clock - p.t0, p.amp);
      else arr[i].set(0, 0, 0, 0);
    }
  }

  private renderBase(target: THREE.WebGLRenderTarget): void {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevFace = r.getActiveCubeFace();
    const prevLevel = r.getActiveMipmapLevel();
    const prevAutoClear = r.autoClear;
    const prevXr = r.xr.enabled;
    r.xr.enabled = false;
    r.autoClear = false;
    r.setRenderTarget(target);
    r.render(this.baseScene, this.camera);
    r.setRenderTarget(prevTarget, prevFace, prevLevel);
    r.autoClear = prevAutoClear;
    r.xr.enabled = prevXr;
  }

  private ensureThumbTargets(w: number, h: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    if (!this.thumbBase) {
      this.thumbBase = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.MirroredRepeatWrapping,
        wrapT: THREE.MirroredRepeatWrapping,
        generateMipmaps: true,
        depthBuffer: false,
        colorSpace: THREE.NoColorSpace,
      });
      this.thumbOut = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
        depthBuffer: false,
        colorSpace: THREE.NoColorSpace,
      });
    }
    const tb = this.thumbBase;
    const to = this.thumbOut!;
    if (tb.width !== w || tb.height !== h) tb.setSize(w, h);
    if (to.width !== w || to.height !== h) to.setSize(w, h);
    return [tb, to];
  }

  /** Renders base + material for cfg into small targets and reads back sRGB bytes (bottom-up rows). */
  private renderOffscreen(cfgIn: BgConfig, w: number, h: number, dpr: number, time?: number): Uint8Array {
    const r = this.renderer;
    const cfg = sanitize(cfgIn);
    const [tb, to] = this.ensureThumbTargets(w, h);

    const prevTarget = r.getRenderTarget();
    const prevFace = r.getActiveCubeFace();
    const prevLevel = r.getActiveMipmapLevel();
    const prevViewport = r.getViewport(new THREE.Vector4());
    const prevScissor = r.getScissor(new THREE.Vector4());
    const prevScissorTest = r.getScissorTest();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevClearAlpha = r.getClearAlpha();
    const prevAutoClear = r.autoClear;
    const prevXr = r.xr.enabled;
    const prevBaseMat = this.baseQuad.material;
    const prevMatMat = this.matQuad.material;
    const prevDirty = this.baseDirty;

    const out = new Uint8Array(w * h * 4);
    try {
      this.baseQuad.material = this.getBaseMat(cfg.base.kind);
      this.matQuad.material = this.getMatMat(cfg.material.kind);
      this.applyBase(cfg.base);
      this.applyMaterial(cfg.material, cfg.fx);
      const bs = this.baseScale(cfg.base.kind, w, h) < 1 && Math.min(w, h) > 512 ? 0.5 : 1;
      const bw = Math.max(1, Math.round(w * bs));
      const bh = Math.max(1, Math.round(h * bs));
      if (tb.width !== bw || tb.height !== bh) tb.setSize(bw, bh);
      this.bu.uTime.value = time ?? this.baseTime;
      this.bu.uRes.value.set(bw, bh);
      this.bu.uDpr.value = dpr * bs;
      this.mu.uTime.value = time ?? this.matTime;
      this.mu.uRes.value.set(w, h);
      this.mu.uBaseRes.value.set(bw, bh);
      this.mu.uDpr.value = dpr;
      this.mu.uUnit.value = designUnit(w / dpr, h / dpr, dpr);
      this.mu.tBase.value = tb.texture;
      this.mu.uOutSrgb.value = 1;
      this.mu.uPointer.value.set(0.62, 0.58);
      for (const p of this.mu.uPulses.value) p.set(0, 0, 0, 0);

      r.xr.enabled = false;
      r.autoClear = false;
      r.setScissorTest(false);
      r.setRenderTarget(tb);
      r.render(this.baseScene, this.camera);
      r.setRenderTarget(to);
      r.render(this.matScene, this.camera);
      r.readRenderTargetPixels(to, 0, 0, w, h, out);
    } finally {
      this.baseQuad.material = prevBaseMat;
      this.matQuad.material = prevMatMat;
      this.applyBase(this.cfg.base);
      this.applyMaterial(this.cfg.material, this.cfg.fx);
      this.mu.tBase.value = this.rt.texture;
      this.mu.uOutSrgb.value = 0;
      this.mu.uRes.value.set(this.outW, this.outH);
      this.mu.uDpr.value = this.dpr;
      this.mu.uUnit.value = designUnit(this.cssW, this.cssH, this.dpr);
      this.resizeBaseRT();
      this.syncDynamicUniforms();
      this.baseDirty = prevDirty; // the internal target was not touched

      r.setRenderTarget(prevTarget, prevFace, prevLevel);
      r.setViewport(prevViewport);
      r.setScissor(prevScissor);
      r.setScissorTest(prevScissorTest);
      r.setClearColor(prevClear, prevClearAlpha);
      r.autoClear = prevAutoClear;
      r.xr.enabled = prevXr;
    }
    return out;
  }
}

/**
 * Device px per "design px" for structural material sizes (flutes, tiles, mosaic cells): the dpr,
 * eased down to 0.68x on phone-sized viewports so reeds and tiles stay proportionate.
 */
function designUnit(cssW: number, cssH: number, dpr: number): number {
  return dpr * Math.min(1, Math.max(0.68, Math.min(cssW, cssH) / 820));
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 250 });
    else setTimeout(resolve, 32);
  });
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
