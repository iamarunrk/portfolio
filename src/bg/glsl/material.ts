/**
 * Material pass: refracts / filters the base render target, adds film grain + vignette, dithers,
 * then converts sRGB -> linear and lets three encode for the current target (<colorspace_fragment>).
 * One program per MaterialKind via the MAT_KIND define.
 */
import type { MaterialKind } from '../types';
import { GLSL_COMMON } from './common';

export const MATERIAL_KIND_ORDER: MaterialKind[] = [
  'none', 'fluted', 'ribbed', 'frosted', 'blur', 'liquidGlass', 'tiles', 'water', 'crystal', 'prism',
  'halftone', 'pixelate', 'crt', 'dither',
];

const KIND_DEFINES = MATERIAL_KIND_ORDER.map((k, i) => `#define M_${k.toUpperCase()} ${i}`).join('\n');

const HEADER = /* glsl */ `
${KIND_DEFINES}
uniform sampler2D tBase;
uniform vec2 uRes;        // output size in device px (the main canvas)
uniform vec2 uBaseRes;    // base render-target size in px
uniform float uDpr;       // device px per CSS px
uniform float uUnit;      // device px per design px (dpr, eased down a little on small screens)
uniform float uTime;      // material time (integrated with material speed)
uniform float uStrength;
uniform float uSize;
uniform float uBlur;
uniform float uAngle;     // radians
uniform float uHighlight;
uniform float uAberration;
uniform vec3 uTint;       // sRGB
uniform float uTintAmount;
uniform float uShape;
uniform vec2 uPointer;    // 0..1, eased
uniform vec4 uPulses[4];  // xy = 0..1 position, z = age (s), w = amplitude
uniform float uGrain;
uniform float uVignette;
uniform float uOutSrgb;   // 1 = write sRGB directly (thumbnails / readback)
uniform vec3 uCol[4];
uniform vec3 uLab[4];
varying vec2 vUv;

${GLSL_COMMON}

/** Base texels per output pixel. */
float baseScale() { return uBaseRes.y / uRes.y; }
vec3 tex(vec2 uv) { return texture(tBase, uv).rgb; }
vec3 texL(vec2 uv, float lod) { return textureLod(tBase, uv, lod).rgb; }
/** Mip level whose texel footprint is ~radiusPx output pixels. */
float lodForPx(float radiusPx) { return log2(max(radiusPx * baseScale(), 1.0)); }
/** Aspect space: short side spans 1. */
vec2 frameSize() { return uRes / min(uRes.x, uRes.y); }
float pxUnit() { return 1.0 / min(uRes.x, uRes.y); }

/** Golden-angle disc blur: mip prefilter + N taps, rotated per pixel by IGN. R in output px. */
vec3 blurDisc(vec2 uv, float R, const int N) {
  if (R < 0.75) return tex(uv);
  float n = float(N);
  float lod = lodForPx(R * 1.8 / sqrt(n));
  vec2 rad = vec2(R) / uRes;
  float rnd = ign(gl_FragCoord.xy) * TAU;
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= N) break;
    float fi = float(i) + 0.5;
    float rr = sqrt(fi / n);
    float a = fi * GOLDEN_ANGLE + rnd;
    float w = 1.0 - rr * rr * 0.55;
    acc += texL(uv + vec2(cos(a), sin(a)) * rr * rad, lod) * w;
    ws += w;
  }
  return acc / ws;
}

/** Three taps along a displacement with yellow/blue-leaning dispersion; soft (mip + paired jitter) when lod > 0. */
vec3 refractRGB(vec2 uv, vec2 d, float ab, float lod) {
  vec2 dr = d * (1.0 + ab);
  vec2 dg = d * (1.0 + ab * 0.7);
  vec2 db = d * (1.0 - ab);
  if (lod < 0.01) {
    return vec3(texL(uv + dr, 0.0).r, texL(uv + dg, 0.0).g, texL(uv + db, 0.0).b);
  }
  float a = ign(gl_FragCoord.xy) * TAU;
  vec2 j = vec2(cos(a), sin(a)) * exp2(lod) * 0.45 / uBaseRes;
  vec3 s1 = vec3(texL(uv + dr + j, lod).r, texL(uv + dg + j, lod).g, texL(uv + db + j, lod).b);
  vec3 s2 = vec3(texL(uv + dr - j, lod).r, texL(uv + dg - j, lod).g, texL(uv + db - j, lod).b);
  return (s1 + s2) * 0.5;
}

vec3 applyTint(vec3 c) { return mix(c, c * uTint, uTintAmount); }

vec3 applyFx(vec3 c, vec2 uv) {
  // vignette: soft elliptical falloff, multiplicative in sRGB
  vec2 q = (uv - 0.5) * 2.0;
  float vd = length(q * vec2(1.0, 0.92));
  c *= 1.0 - uVignette * 0.78 * smoothstep(0.35, 1.55, vd);
  // film grain: ~1 CSS px grain + a little per-device-pixel sparkle; stronger in shadows/mids
  vec2 gp = uv * uRes / max(uDpr * 0.9, 1.0);
  float g1 = vnoise(gp * 1.15) - 0.5;
  float g2 = hash12(floor(uv * uRes) + 0.37) - 0.5;
  float g = g1 * 1.25 + g2 * 0.55;
  float l = luma(c);
  float amt = uGrain * 0.16 * mix(1.0, 0.5, l);
  return c + g * amt;
}
`;

const KINDS_A = /* glsl */ `
#if MAT_KIND == M_NONE
vec3 material(vec2 uv) { return tex(uv); }
#endif

#if MAT_KIND == M_FLUTED || MAT_KIND == M_RIBBED
vec3 material(vec2 uv) {
  vec2 px = (uv - 0.5) * uRes;
  mat2 Rw = rot2(uAngle);
  vec2 q = transpose(Rw) * px;              // flute frame: q.x runs across the flutes
#if MAT_KIND == M_FLUTED
  float W = mix(10.0, 120.0, pow(uSize, 1.4)) * uUnit;
#else
  float W = mix(4.0, 44.0, pow(uSize, 1.4)) * uUnit;
#endif
  float u = q.x / W;
  float x = fract(u) * 2.0 - 1.0;           // -1..1 across one reed
  float pxX = 2.0 / W;                      // one device px in x units
  vec2 across = Rw * vec2(1.0, 0.0);
#if MAT_KIND == M_FLUTED
  // Each reed is a cylinder lens holding an upright copy of a wider strip (compression C),
  // bent harder toward the grooves, so content edges repeat reed after reed.
  float roundness = mix(0.5, 0.97, uShape);
  float bend = x / sqrt(max(1.0 - roundness * x * x, 0.04)) - x;
  float disp = x * uStrength * 5.0 + bend * uStrength * 1.2;
  float groove = smoothstep(1.0 - 3.0 * pxX - 0.035, 1.0, abs(x));
  float shade = 1.0 - 0.1 * smoothstep(0.0, 1.0, x);
  float sx = -0.66;
#else
  // ribbed: smooth corrugation, no hard seams
  float disp = -sin(x * PI) * uStrength * 1.6;
  float groove = pow(0.5 - 0.5 * cos(x * PI), 6.0) * 0.6;
  float shade = 0.96 + 0.06 * cos(x * PI) - 0.05 * sin(x * PI);
  float sx = -0.38;
#endif
  vec2 d = across * disp * W * 0.5 / uRes;
  float lod = lodForPx(uBlur * 28.0 * uDpr);
  vec3 c = refractRGB(uv, d, uAberration * 0.5, lod);
  float l = luma(c);
  c *= shade * (1.0 - 0.6 * groove);
  // light transmitted through the reed concentrates in a thin line near the lit edge: bright over
  // bright content, barely there over dark content (as in real reeded glass)
  float sw = max(0.055, 1.4 * pxX);
  float spec = exp(-pow((x - sx) / sw, 2.0)) * 0.9 + exp(-pow((x - sx - 0.18) / 0.22, 2.0)) * 0.06;
  float rim = exp(-pow((x - 0.9) / max(0.035, 1.2 * pxX), 2.0)) * 0.22;
  float k = (0.16 + 0.84 * smoothstep(0.04, 0.7, l)) * uHighlight;
  c = screenBlend(c, vec3(1.0, 0.95, 0.86) * spec * k + vec3(rim * k));
  return applyTint(c);
}
#endif

#if MAT_KIND == M_FROSTED
vec3 material(vec2 uv) {
  vec2 px = uv * uRes;
  float gs = mix(0.75, 2.5, uSize) * uDpr;
  vec2 cell = floor(px / gs);
  vec2 h = hash22(cell) * 2.0 - 1.0;
  float jr = mix(2.0, 24.0, uStrength) * uDpr;
  vec2 juv = h * jr / uRes;
  float R = mix(3.0, 64.0, uBlur) * uDpr;
  vec3 c = blurDisc(uv + juv, R, 8);
  c = mix(c, uTint, 0.07 + 0.38 * uTintAmount);   // milky lift
  c = mix(vec3(luma(c)), c, 0.92);
  c += (hash12(cell + 13.1) - 0.5) * 0.03 * (0.4 + uStrength);   // sandblasted surface
  vec2 sc = floor(px / max(2.0 * uDpr, 1.0));
  float r = hash12(sc + 91.7);
  float tw = 0.55 + 0.45 * sin(uTime * 2.0 + r * 60.0);
  c += step(0.9965, r) * tw * uHighlight * 0.55;   // icy sparkle
  return c;
}
#endif

#if MAT_KIND == M_BLUR
vec3 material(vec2 uv) {
  float R = mix(6.0, 120.0, uBlur) * uDpr;
  vec3 c = blurDisc(uv, R, 16);
  c = mix(vec3(luma(c)), c, 1.0 + 0.4 * uStrength);
  return applyTint(clamp(c, 0.0, 1.0));
}
#endif
`;

const KINDS_B = /* glsl */ `
#if MAT_KIND == M_LIQUIDGLASS
float lgShapes(vec2 p) {
  float t = uTime * 0.22;
  vec2 fr = frameSize();
  float s = mix(0.055, 0.2, uSize);
  float k = mix(0.015, 0.17, uShape);
  vec2 c1 = vec2(sin(t * 0.61 + 0.5) * 0.30, cos(t * 0.47 + 1.2) * 0.22) * fr;
  float d = length(p - c1) - s * 1.25;
  vec2 c2 = vec2(cos(t * 0.53 + 2.0) * 0.33, sin(t * 0.71 + 0.3) * 0.27) * fr;
  vec2 pp = rot2(sin(t * 0.4) * 0.6) * (p - c2);
  d = smin(d, sdRoundBox(pp, vec2(s * 1.55, s * 0.62), s * 0.62), k);
  vec2 c3 = vec2(sin(t * 0.43 + 4.0) * 0.35, cos(t * 0.59 + 3.1) * 0.29) * fr;
  vec2 pq = rot2(t * 0.3 + 0.4) * (p - c3);
  d = smin(d, sdRoundBox(pq, vec2(s * 0.85), s * 0.4), k);
  vec2 c4 = vec2(cos(t * 0.67 + 5.0) * 0.39, sin(t * 0.37 + 2.4) * 0.31) * fr;
  d = smin(d, length(p - c4) - s * 0.68, k);
  vec2 c5 = (uPointer - 0.5) * fr;
  float wob = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 pl = uPulses[i];
    wob += pl.w * 0.2 * exp(-pl.z * 3.0) * sin(pl.z * 17.0);
  }
  d = smin(d, length(p - c5) - s * 0.95 * (1.0 + wob), k);
  return d;
}
vec3 material(vec2 uv) {
  vec2 fr = frameSize();
  vec2 p = (uv - 0.5) * fr;
  float pu = pxUnit();
  float d = lgShapes(p);
  float e = 1.5 * pu;
  vec2 g = vec2(lgShapes(p + vec2(e, 0.0)) - lgShapes(p - vec2(e, 0.0)),
                lgShapes(p + vec2(0.0, e)) - lgShapes(p - vec2(0.0, e))) / (2.0 * e);
  vec2 n = g / max(length(g), 1e-5);
  float inside = 1.0 - smoothstep(-pu, pu, d);
  float bevel = mix(0.028, 0.075, uSize);
  float tin = clamp(-d / bevel, 0.0, 1.0);
  float edgeK = pow(1.0 - tin, 2.4);
  // thick-lens rim: content is pulled inward and squeezed along the edge, the core stays calm
  vec2 off = -n * (edgeK * 0.11 + (1.0 - tin) * 0.012) * uStrength;
  vec2 duv = off / fr;
  float lod = lodForPx(uBlur * 26.0 * uDpr);
  float ab = uAberration * (0.12 + 0.88 * edgeK) * 0.9;
  vec3 cin = refractRGB(uv, duv, ab, lod);
  cin = applyTint(cin) * 1.04 + 0.012;
  float fres = pow(1.0 - tin, 3.0);
  cin = screenBlend(cin, vec3(fres * 0.16 * (0.35 + uHighlight)));
  vec2 L = normalize(vec2(-0.55, 0.85));
  float lit = max(dot(n, L), 0.0);
  float bk = max(dot(n, -L), 0.0);
  float rim = 1.0 - smoothstep(0.0, 1.7 * max(uDpr, 1.0) * pu, -d);
  float rimLight = rim * (0.18 + 0.82 * pow(lit, 1.5)) + rim * pow(bk, 2.0) * 0.5;
  float glow = exp(-tin * 7.0) * pow(lit, 3.0) * 0.25;
  // dome shading: a tilted normal toward the rim gives a specular crescent and a soft body light
  vec3 N = normalize(vec3(n * pow(1.0 - tin, 1.5) * 1.3, 1.0));
  vec3 L3 = normalize(vec3(-0.45, 0.7, 0.55));
  float spec = pow(max(reflect(-L3, N).z, 0.0), 22.0);
  cin *= 0.96 + 0.08 * max(dot(N, L3), 0.0);
  cin = screenBlend(cin, vec3(1.0, 0.99, 0.97) * (rimLight * 1.1 + glow + spec * 0.4) * uHighlight);
  vec3 cout = tex(uv);
  float sh = 1.0 - smoothstep(-0.015, 0.065, lgShapes(p + vec2(0.0, 0.018)));
  cout *= 1.0 - 0.24 * sh;
  return mix(cout, cin, inside);
}
#endif

#if MAT_KIND == M_TILES
vec3 material(vec2 uv) {
  vec2 px = (uv - 0.5) * uRes;
  mat2 Rw = rot2(uAngle);
  vec2 q = transpose(Rw) * px;
  float T = mix(26.0, 190.0, pow(uSize, 1.25)) * uUnit;
  vec2 f = fract(q / T) - 0.5;
  float aa = 1.0 / T;
  float gap = 0.012 + aa;
  float rr = mix(0.06, 0.5 - gap, uShape);
  vec2 dq = abs(f) - vec2(0.5 - gap) + rr;
  float sd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - rr;
  vec2 gq = (max(dq.x, dq.y) > 0.0) ? normalize(max(dq, 0.0) + 1e-5) : (dq.x > dq.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 nt = gq * sign(f + 1e-6);
  float tin = clamp(-sd / 0.13, 0.0, 1.0);
  float edgeK = pow(1.0 - tin, 2.0);
  // each block is a thick lens: an inverted, magnified view of its own cell, bent hard at the bevel
  float k = 1.0 + uStrength * 1.4;
  vec2 offT = -f * k - nt * edgeK * uStrength * 0.3;
  vec2 duv = (Rw * offT) * T / uRes;
  vec3 c = refractRGB(uv, duv, uAberration * 0.4, lodForPx(uBlur * 24.0 * uDpr));
  c = applyTint(c);
  vec2 Lt = transpose(Rw) * normalize(vec2(-0.6, 0.8));
  float lit = dot(nt, Lt);
  c = screenBlend(c, vec3(max(lit, 0.0) * edgeK * uHighlight * 0.75));
  c *= 1.0 - max(-lit, 0.0) * edgeK * 0.28;
  c = screenBlend(c, vec3(0.035 * tin * uHighlight));
  float inside = 1.0 - smoothstep(-aa, aa, sd);
  float line = (1.0 - smoothstep(0.0, 2.0 * aa * max(uUnit, 1.0), -sd)) * (0.35 + 0.65 * max(lit, 0.0));
  c = screenBlend(c, vec3(line * uHighlight * 0.8));
  vec3 grout = texL(uv, lodForPx(8.0 * uDpr)) * 0.55;
  return mix(grout, c, inside);
}
#endif

#if MAT_KIND == M_WATER
vec3 material(vec2 uv) {
  vec2 fr = frameSize();
  vec2 p = (uv - 0.5) * fr;
  float k0 = mix(18.0, 4.5, uSize);
  float t = uTime;
  vec2 wd = vec2(cos(uAngle), sin(uAngle));
  vec2 grad = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 dir = rot2((fi - 1.5) * 0.55 + sin(fi * 2.3) * 0.2) * wd;
    float k = k0 * (0.7 + 0.35 * fi);
    float w = sqrt(9.8 * k) * 0.32;
    float ph = dot(p, dir) * k - t * w + fi * 1.7;
    grad += dir * cos(ph) / (1.0 + fi * 0.8);
  }
  vec2 np = p * k0 * 0.35 + vec2(t * 0.3, -t * 0.2);
  float n0 = snoise(np);
  grad += vec2(snoise(np + vec2(0.05, 0.0)) - n0, snoise(np + vec2(0.0, 0.05)) - n0) * 1.6;
  for (int i = 0; i < 4; i++) {
    vec4 pl = uPulses[i];
    if (pl.w > 0.001) {
      vec2 dv = p - (pl.xy - 0.5) * fr;
      float r = length(dv) + 1e-4;
      float x = r - pl.z * 0.42;
      float env = exp(-x * x * 90.0) * exp(-pl.z * 1.1) * pl.w;
      grad += dv / r * cos(x * 70.0) * env * 2.4;
    }
  }
  vec2 duv = grad * uStrength * 0.012 / fr;
  vec3 c = refractRGB(uv, duv, uAberration * 0.5, lodForPx(uBlur * 20.0 * uDpr));
  vec2 cp = p * k0 * 0.5;
  float c1 = 1.0 - abs(snoise(cp + vec2(t * 0.25, t * 0.15) + grad * 0.25));
  float c2 = 1.0 - abs(snoise(cp * 1.37 - vec2(t * 0.2, -t * 0.27) + 4.0));
  float caus = pow(c1, 9.0) + pow(c2, 9.0) * 0.6;
  c += uHighlight * 0.32 * caus * (0.3 + 0.7 * luma(c));
  vec3 nrm = normalize(vec3(-grad * 0.5, 1.0));
  float glint = pow(clamp(dot(nrm, normalize(vec3(-0.35, 0.55, 0.75))), 0.0, 1.0), 70.0);
  c = screenBlend(c, vec3(glint * uHighlight * 0.6));
  return applyTint(c);
}
#endif

#if MAT_KIND == M_CRYSTAL
vec2 crystalSeed(vec2 cell) { return 0.12 + 0.76 * hash22(cell); }
vec3 material(vec2 uv) {
  vec2 fr = frameSize();
  vec2 p = (uv - 0.5) * fr;
  float S = mix(10.0, 2.0, uSize);
  mat2 Rq = rot2(0.35);
  vec2 q = Rq * p * S;
  vec2 iq = floor(q);
  vec2 fq = fract(q);
  float md = 8.0;
  vec2 mr = vec2(0.0);
  vec2 mg = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + crystalSeed(iq + g) - fq;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  float bd = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + crystalSeed(iq + g) - fq;
      vec2 dd = r - mr;
      if (dot(dd, dd) > 1e-5) bd = min(bd, dot(0.5 * (mr + r), normalize(dd)));
    }
  }
  vec3 rnd = hash32(iq + mg);
  vec2 dirR = rnd.xy * 2.0 - 1.0;
  // each shard: magnifies around its seed and jumps by its own offset
  vec2 offQ = mr * 0.55 * uStrength + dirR * 0.35 * uStrength;
  vec2 duv = (transpose(Rq) * offQ) / S / fr;
  vec3 c = refractRGB(uv, duv, uAberration * (0.35 + 0.65 * rnd.z), lodForPx(uBlur * 20.0 * uDpr));
  vec2 Ld = vec2(cos(uAngle), sin(uAngle));
  float lit = dot(dirR, transpose(Rq) * Ld) * 0.5;
  c *= 1.0 + lit * 0.4 * uHighlight;
  c = screenBlend(c, vec3(max(lit, 0.0) * 0.22 * uHighlight));
  float px1 = S * pxUnit();
  float edge = 1.0 - smoothstep(0.0, 1.6 * px1 * max(uDpr, 1.0), bd);
  float inner = 1.0 - smoothstep(px1 * 2.0, px1 * 16.0 * max(uDpr, 1.0), bd);
  c *= 1.0 - inner * 0.16;
  vec3 rb = 0.5 + 0.5 * cos(TAU * (rnd.z + bd * 2.5 + vec3(0.0, 0.33, 0.67)));
  c = screenBlend(c, rb * inner * 0.16 * uAberration);
  c = screenBlend(c, vec3(edge * 0.6 * uHighlight));
  return applyTint(c);
}
#endif
`;

const KINDS_C = /* glsl */ `
#if MAT_KIND == M_PRISM
vec3 material(vec2 uv) {
  vec2 fr = frameSize();
  vec2 p = (uv - 0.5) * fr;
  mat2 Rw = rot2(uAngle);
  vec2 q = transpose(Rw) * p;
  float Wf = mix(0.1, 0.7, uSize);
  float u = q.x / Wf;
  float id = floor(u);
  float x = fract(u);
  float rnd = hash12(vec2(id, 7.0));
  vec2 across = Rw * vec2(1.0, 0.0);
  // wedge prisms: the shift ramps across each facet, every facet has its own bias
  float disp = ((x - 0.5) * 0.9 + (rnd - 0.5) * 0.8) * uStrength * 0.2;
  vec2 duv = across * disp / fr;
  float ab = 0.15 + uAberration * 1.4;
  vec2 split = across * (0.002 + 0.01 * uAberration) / fr;
  vec3 c;
  c.r = tex(uv + duv * (1.0 + ab) + split).r;
  c.g = tex(uv + duv).g;
  c.b = tex(uv + duv * (1.0 - ab) - split).b;
  // light leak: a drifting spectral band, brighter where it crosses facet edges
  float t = uTime * 0.12;
  float lk = dot(p, normalize(vec2(0.82, 0.57))) * 0.8 + t + x * 0.12;
  vec3 rainbow = 0.5 + 0.5 * cos(TAU * (lk * 1.6 + vec3(0.0, 0.33, 0.67)));
  float leak = smoothstep(0.15, 1.0, sin(lk * 2.1 + 0.6)) * (0.55 + 0.45 * smoothstep(0.25, 0.0, min(x, 1.0 - x)));
  c = screenBlend(c, rainbow * leak * uHighlight * 0.6);
  float ePx = min(x, 1.0 - x) * Wf / pxUnit();
  float edgeLine = 1.0 - smoothstep(0.0, 1.6 * max(uDpr, 1.0), ePx);
  c = screenBlend(c, mix(vec3(1.0), rainbow, 0.5) * edgeLine * 0.45 * uHighlight);
  c *= 0.94 + 0.08 * x;
  return applyTint(c);
}
#endif

#if MAT_KIND == M_HALFTONE
vec3 material(vec2 uv) {
  vec2 px = (uv - 0.5) * uRes;
  float cell = max(mix(5.0, 30.0, uSize) * uUnit, 3.0);
  mat2 Rw = rot2(uAngle);
  vec2 q = transpose(Rw) * px / cell;
  vec2 id = floor(q) + 0.5;
  vec2 f = q - id;
  vec2 cuv = (Rw * (id * cell)) / uRes + 0.5;
  vec3 s = texL(cuv, lodForPx(cell * 0.6));
  float l = luma(s);
  float rad = sqrt(clamp(l * mix(0.75, 1.6, uStrength) + 0.02, 0.0, 1.0)) * 0.64;
  float d = mix(length(f), (abs(f.x) + abs(f.y)) * 0.74, uShape);
  float aa = 0.9 / cell;
  float m = 1.0 - smoothstep(rad - aa, rad + aa, d);
  vec3 ink = clamp(mix(vec3(l), s, 1.25) * 1.12 + 0.02, 0.0, 1.0);
  vec3 paper = mix(s * 0.1, uTint, uTintAmount);
  return mix(paper, ink, m);
}
#endif

#if MAT_KIND == M_PIXELATE
vec3 material(vec2 uv) {
  vec2 px = (uv - 0.5) * uRes;
  float cell = max(mix(6.0, 44.0, uSize) * uUnit, 3.0);
  vec2 g = px / cell;
  vec2 id = floor(g);
  vec2 f = g - id - 0.5;
  vec2 cuv = (id + 0.5) * cell / uRes + 0.5;
  float lod = lodForPx(cell * 0.55);
  vec3 s = texL(cuv, lod);
  float gap = mix(0.0, 0.22, uStrength);
  float rr = uShape * (0.5 - gap);
  float sd = sdRoundBox(f, vec2(0.5 - gap), rr);
  float aa = 1.0 / cell;
  float m = 1.0 - smoothstep(-aa, aa, sd);
  vec3 glow = texL(uv, lod + 1.5) * 0.3 * uHighlight;
  vec3 led = s * (1.0 + 0.12 * uHighlight);
  float gl = exp(-dot(f - vec2(-0.17, 0.17), f - vec2(-0.17, 0.17)) * 30.0) * uHighlight * 0.18;
  return mix(s * 0.05 + glow, led + gl, m);
}
#endif

#if MAT_KIND == M_CRT
vec3 material(vec2 uv) {
  vec2 cc = uv - 0.5;
  vec2 fr = frameSize();
  float k = uStrength * 0.2;
  vec2 ac = cc * fr / max(fr.x, fr.y);
  vec2 buv = 0.5 + cc * (1.0 + k * dot(ac, ac) * 2.0) / (1.0 + k * 0.35);
  float ab = (0.5 + uAberration * 3.0) * uDpr / uRes.x;
  vec3 c = vec3(tex(buv + vec2(ab, 0.0)).r, tex(buv).g, tex(buv - vec2(ab, 0.0)).b);
  vec3 bloom = texL(buv, lodForPx(14.0 * uDpr));
  c = screenBlend(c, bloom * smoothstep(0.35, 0.95, luma(bloom)) * uHighlight * 0.45);
  float lineH = max(mix(2.0, 6.0, uSize) * uUnit, 2.0);
  float sl = 0.5 + 0.5 * cos(buv.y * uRes.y / lineH * TAU);
  float slAmt = smoothstep(2.0, 3.0, lineH);
  c *= mix(1.0, 0.62 + 0.38 * sl + 0.25 * luma(c) * (1.0 - sl), slAmt);
  float maskW = max(mix(1.0, 2.2, uSize) * uUnit, 1.0);
  float mx = buv.x * uRes.x / maskW;
  vec3 mask = 0.62 + 0.38 * cos(TAU * (mx / 3.0 + vec3(0.0, -1.0 / 3.0, -2.0 / 3.0)));
  c *= mix(vec3(1.0), mask * 1.35, 0.55 * smoothstep(0.95, 1.5, maskW));
  float roll = fract(buv.y * 0.55 - uTime * 0.07);
  c *= 1.0 + 0.06 * smoothstep(0.0, 0.08, roll) * (1.0 - smoothstep(0.08, 0.22, roll));
  c *= 1.0 + 0.012 * sin(uTime * 40.0) * step(0.001, uTime);
  vec2 bp = (buv - 0.5) * uRes;
  float bez = sdRoundBox(bp, uRes * 0.5, 26.0 * uDpr);
  c *= 1.0 - smoothstep(-1.5, 1.5, bez);
  float vg = smoothstep(0.3, 1.0, length(cc * 2.0) * 0.8);
  c *= 1.0 - 0.3 * vg;
  return c;
}
#endif

#if MAT_KIND == M_DITHER
vec3 material(vec2 uv) {
  float pix = max(1.0, floor(mix(1.0, 7.0, uSize) * uDpr + 0.5));
  vec2 bid = floor(uv * uRes / pix);
  vec2 cuv = (bid + 0.5) * pix / uRes;
  vec3 s = texL(cuv, lodForPx(pix * 0.5));
  vec3 lab = srgbToOklab(s);
  float d0 = distance(lab, uLab[0]);
  float d1 = distance(lab, uLab[1]);
  float d2 = distance(lab, uLab[2]);
  float d3 = distance(lab, uLab[3]);
  float bi = 0.0; float bd = d0;
  if (d1 < bd) { bi = 1.0; bd = d1; }
  if (d2 < bd) { bi = 2.0; bd = d2; }
  if (d3 < bd) { bi = 3.0; bd = d3; }
  float si = -1.0; float sdist = 1e5;
  if (bi != 0.0 && d0 < sdist) { si = 0.0; sdist = d0; }
  if (bi != 1.0 && d1 < sdist) { si = 1.0; sdist = d1; }
  if (bi != 2.0 && d2 < sdist) { si = 2.0; sdist = d2; }
  if (bi != 3.0 && d3 < sdist) { si = 3.0; sdist = d3; }
  vec3 a = labAt(bi);
  vec3 b = labAt(si);
  vec3 ab = b - a;
  float t = clamp(dot(lab - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  t = mix(step(0.5, t), t, clamp(uStrength, 0.0, 1.0));
  float pick = step(bayer8(bid), t);
  return mix(colAt(bi), colAt(si), pick);
}
#endif
`;

const MAIN = /* glsl */ `
void main() {
  vec3 c = material(vUv);
  c = applyFx(c, vUv);
  c = clamp(c, 0.0, 1.0);
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;   // final +-0.5/255 dither: no banding
  vec3 o = uOutSrgb > 0.5 ? c : toLinear(c);
  gl_FragColor = vec4(o, 1.0);
  #include <colorspace_fragment>
}
`;

export const MATERIAL_FRAG = [HEADER, KINDS_A, KINDS_B, KINDS_C, MAIN].join('\n');
