/**
 * Base pass: one generator per BaseKind, selected with the BASE_KIND define (one program per kind).
 * Output is sRGB-encoded colour written to an RGBA8 target (palette hex values are used as-is).
 */
import type { BaseKind } from '../types';
import { GLSL_COMMON } from './common';

/** Order defines the numeric BASE_KIND value of every kind. */
export const BASE_KIND_ORDER: BaseKind[] = [
  'solid', 'linear', 'radial', 'conic', 'mesh', 'flow', 'aurora', 'liquidMetal', 'satin', 'plasma',
  'swirl', 'waves', 'goo', 'sunburst', 'holo', 'checker', 'dotgrid', 'halftone', 'dither', 'studio',
];

const KIND_DEFINES = BASE_KIND_ORDER.map((k, i) => `#define K_${k.toUpperCase()} ${i}`).join('\n');

const HEADER = /* glsl */ `
${KIND_DEFINES}
uniform float uTime;
uniform vec2 uRes;      // render-target size in px
uniform float uDpr;     // device px per CSS px *in this target* (already scaled for half-res targets)
uniform float uScale;
uniform float uAngle;   // radians
uniform float uDetail;
uniform float uAmount;
uniform vec3 uCol[4];   // sRGB
uniform vec3 uLab[4];   // OKLab
varying vec2 vUv;

${GLSL_COMMON}

vec2 frameSize() { return uRes / min(uRes.x, uRes.y); }
/** Centred coords: the short side spans 1 (so -0.5..0.5), y up. */
vec2 centered(vec2 uv) { return (uv - 0.5) * frameSize(); }
/** One target pixel in centered() units. */
float pxSize() { return 1.0 / min(uRes.x, uRes.y); }
float safeScale() { return max(uScale, 0.05); }

/**
 * Four colour bands in palette order. fw = pixel footprint in band units (anti-aliasing; fades to the
 * average colour where bands get sub-pixel), soft = extra transition width 0..1 (1 = smooth gradient).
 */
vec3 bands4(float x, float fw, float soft) {
  float i = floor(x);
  float f = x - i;
  float i0 = mod(i, 4.0);
  float i1 = mod(i + 1.0, 4.0);
  float w = clamp(max(fw, soft), 1e-4, 1.0);
  vec3 c = oklabToSrgb(mix(labAt(i0), labAt(i1), smoothstep(1.0 - w, 1.0, f)));
  vec3 avg = oklabToSrgb(palMeanLab());
  return mix(c, avg, smoothstep(0.45, 1.0, fw));
}
`;

const KINDS_A = /* glsl */ `
#if BASE_KIND == K_SOLID
vec3 baseColor(vec2 uv) { return uCol[0]; }
#endif

#if BASE_KIND == K_LINEAR
vec3 baseColor(vec2 uv) {
  vec2 fr = frameSize();
  vec2 p = centered(uv);
  vec2 dir = vec2(sin(uAngle), cos(uAngle)); // CSS convention: 0deg = to top, 90deg = to right
  float ext = 0.5 * (abs(dir.x) * fr.x + abs(dir.y) * fr.y);
  float t = dot(p, dir) / (2.0 * ext * safeScale()) + 0.5;
  float tt = uTime * 0.08;
  t += uDetail * 0.17 * snoise(p * 1.1 + vec2(tt, -tt * 0.7));
  t += uDetail * 0.06 * snoise(p * 2.3 - vec2(tt * 1.3, tt * 0.4) + 7.0);
  t = clamp(t, 0.0, 1.0);
  t = pow(t, exp2((0.5 - uAmount) * 2.4));
  return pal(t);
}
#endif

#if BASE_KIND == K_RADIAL
vec3 baseColor(vec2 uv) {
  vec2 fr = frameSize();
  vec2 p = centered(uv);
  float tt = uTime * 0.1;
  vec2 c = vec2(sin(uAngle), cos(uAngle)) * uAmount * 0.5 * fr;
  c += 0.05 * vec2(sin(tt * 1.3), cos(tt)) * step(0.0001, abs(uTime));
  float R = (0.5 * length(fr) + 0.6 * length(c)) * safeScale();
  float r = length(p - c) / R;
  r += uDetail * 0.12 * snoise(p * 1.4 + vec2(tt, tt * 0.6));
  r += uDetail * 0.05 * snoise(p * 3.1 - vec2(tt * 0.8, -tt) + 3.0);
  return pal(clamp(r, 0.0, 1.0));
}
#endif

#if BASE_KIND == K_CONIC
vec3 baseColor(vec2 uv) {
  vec2 p = centered(uv);
  float r = length(p);
  float a = atan(p.y, p.x) - uAngle - uTime * 0.25;
  a += uDetail * 5.0 * r;
  float t = a / TAU;
  // Box-filter the cyclic palette over an angular window that widens toward the centre:
  // a soft, swirly core instead of a harsh pinch point.
  float k = uAmount * 0.09 + 1e-4;
  float w = 0.8 * smoothstep(0.0, 1.0, k / (r + k));
  vec3 lab = (palLabCyc(t - 0.375 * w) + palLabCyc(t - 0.125 * w) + palLabCyc(t + 0.125 * w) + palLabCyc(t + 0.375 * w)) * 0.25;
  return oklabToSrgb(lab);
}
#endif

#if BASE_KIND == K_MESH
void meshPoint(inout vec4 acc, inout float ws, vec2 p, vec2 q, vec3 lab, float pw) {
  vec2 d = p - q;
  float w = 1.0 / pow(dot(d, d) + 0.004, pw);
  acc += vec4(lab, length(lab.yz)) * w;
  ws += w;
}
vec3 baseColor(vec2 uv) {
  vec2 fr = frameSize();
  vec2 h = fr * 0.5;
  vec2 p = centered(uv);
  float t = uTime * 0.14;
  p = rot2(uAngle) * p / safeScale();
  // organic warp
  p += 0.075 * vec2(snoise(p * 1.25 + vec2(t * 0.6, 1.7)), snoise(p * 1.25 + vec2(4.1, -t * 0.55)));
  // swirl around the centre
  float r2 = dot(p / h, p / h);
  float sw = uDetail * 2.6 * exp(-r2 * 0.9) * (0.8 + 0.2 * sin(t * 0.7));
  p = rot2(sw) * p;
  float pw = mix(2.4, 0.85, uAmount);
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  meshPoint(acc, ws, p, h * (vec2(-0.80, 0.72) + 0.24 * vec2(sin(t * 0.83 + 1.0), cos(t * 0.71 + 2.0))), uLab[0], pw);
  meshPoint(acc, ws, p, h * (vec2(0.78, 0.62) + 0.26 * vec2(cos(t * 0.67 + 0.4), sin(t * 0.92 + 1.1))), uLab[1], pw);
  meshPoint(acc, ws, p, h * (vec2(0.55, -0.70) + 0.28 * vec2(sin(t * 0.74 + 2.5), cos(t * 0.61 + 0.3))), uLab[2], pw);
  meshPoint(acc, ws, p, h * (vec2(-0.62, -0.58) + 0.25 * vec2(cos(t * 0.58 + 3.1), sin(t * 0.79 + 2.2))), uLab[3], pw);
  meshPoint(acc, ws, p, h * (vec2(0.05, 0.08) + 0.32 * vec2(sin(t * 0.51 + 4.0), cos(t * 0.47 + 5.0))), uLab[0], pw);
  meshPoint(acc, ws, p, h * (vec2(-0.05, 0.95) + 0.20 * vec2(cos(t * 0.69 + 1.7), sin(t * 0.55))), uLab[2], pw);
  // keep chroma through the blends: luminous in-betweens instead of muddy greys
  vec4 m = acc / ws;
  float cm = length(m.yz);
  m.yz *= min(m.w / max(cm, 1e-4), 1.7);
  return oklabToSrgb(m.xyz);
}
#endif

#if BASE_KIND == K_FLOW
vec3 baseColor(vec2 uv) {
  vec2 p = rot2(uAngle) * centered(uv) * (2.0 / safeScale());
  float t = uTime * 0.12;
  float amp = mix(0.35, 1.1, uDetail);
  vec2 q = p;
  for (int i = 1; i < 6; i++) {
    float fi = float(i);
    q.x += amp / fi * sin(fi * 1.2 * q.y + t * (0.9 + 0.11 * fi) + fi * 1.3);
    q.y += amp / fi * cos(fi * 1.0 * q.x - t * (0.7 + 0.13 * fi) + fi * 2.1);
  }
  float ph = q.x * 1.25 + q.y * 0.8 + t * 0.35;
  // soft triangle wave: every palette stop gets a fair share of the silk
  float v = acos(0.985 * sin(ph)) / PI;
  vec3 lab = palLab(v);
  lab.x *= 0.88 + 0.14 * cos(ph);
  float sheen = pow(clamp(0.5 + 0.5 * cos(ph - 0.9), 0.0, 1.0), 14.0) * uAmount;
  lab.x += sheen * 0.18;
  lab.yz *= 1.0 - sheen * 0.3;
  return oklabToSrgb(lab);
}
#endif

#if BASE_KIND == K_AURORA
vec3 baseColor(vec2 uv) {
  vec2 p = rot2(uAngle) * centered(uv);
  float t = uTime * 0.2;
  float sc = 1.0 / safeScale();
  vec3 sky = toLinear(uCol[0]);
  vec3 col = sky * mix(1.5, 0.6, smoothstep(-0.6, 0.7, p.y));
  vec3 cBase = toLinear(uCol[1]);
  vec3 cCore = toLinear(uCol[2]);
  vec3 cTip = toLinear(uCol[3]);
  float height = mix(0.18, 0.6, uAmount);
  float rayF = mix(8.0, 42.0, uDetail);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float x = p.x * sc * (0.9 + 0.25 * fk) + fk * 3.7;
    float yb = (-0.2 + 0.12 * fk) * sc;
    yb += 0.22 * snoise(vec2(x * 0.38 + t * (0.22 + 0.06 * fk), fk * 7.3 + t * 0.05));
    yb += 0.07 * snoise(vec2(x * 1.3 - t * 0.35, fk * 3.1 + 1.0));
    float hgt = p.y * sc - yb;
    // ribbons come and go along their length, so layers never stack into flat bands
    float pres = smoothstep(-0.5, 0.35, snoise(vec2(x * 0.3 + t * 0.07, fk * 4.0 + 1.7)));
    float prof = smoothstep(-0.07, 0.03, hgt) * exp(-max(hgt, 0.0) / height) + exp(-max(-hgt, 0.0) * 14.0) * 0.07;
    float r1 = snoise(vec2(x * rayF, hgt * 0.8 + t * 0.3 + fk * 5.0));
    float r2 = snoise(vec2(x * rayF * 0.37 + 9.0, t * 0.15 + fk));
    float rays = 0.68 + 0.32 * r1 * (0.55 + 0.45 * r2);
    float I = prof * rays * pres * (1.0 - 0.15 * fk);
    vec3 cc = mix(cBase, cCore, smoothstep(0.0, 0.12, hgt));
    cc = mix(cc, cTip, smoothstep(0.1, height * 1.4, hgt));
    col += cc * I * 1.35;
  }
  col = col / (1.0 + max(col - 0.85, 0.0) * 1.2);
  return toSrgb(col);
}
#endif
`;

const KINDS_B = /* glsl */ `
#if BASE_KIND == K_LIQUIDMETAL
float lmHeight(vec2 p, float t, float turb) {
  vec2 q = p;
  q += turb * 0.45 * vec2(sin(q.y * 1.9 + t * 0.9), sin(q.x * 1.6 - t * 0.7));
  q += turb * 0.30 * vec2(sin(q.y * 3.1 - t * 1.1 + 1.3), sin(q.x * 2.7 + t * 0.8 + 2.1));
  return 0.55 * sin(q.x * 1.8 + q.y * 0.9) + 0.35 * sin(q.y * 2.4 - q.x * 0.6 + 1.1) + 0.12 * sin((q.x + q.y) * 4.3 - t);
}
/** Fake studio reflection: dark floor, sharp horizon, bright sky with a softbox band. */
vec3 lmEnv(float s, float w) {
  vec3 dark = uCol[0];
  vec3 mid = uCol[1];
  vec3 light = uCol[2];
  vec3 glint = uCol[3];
  vec3 sky = mix(light, mid, smoothstep(0.05, 1.5, s));
  float band = smoothstep(0.42 - w, 0.42 + w, s) - smoothstep(0.66 - w, 0.66 + w, s);
  sky = mix(sky, glint, band * 0.9);
  vec3 ground = mix(mix(dark, mid, 0.45), dark, smoothstep(0.0, 0.9, -s));
  float fl = smoothstep(-0.78 - w, -0.78 + w, s) - smoothstep(-0.62 - w, -0.62 + w, s);
  ground = mix(ground, mid, fl * 0.55);
  vec3 c = mix(ground, sky, smoothstep(-w, w, s));
  c += glint * 0.5 * exp(-pow((s - 0.03) / (w * 1.8 + 0.01), 2.0));
  return c;
}
vec3 baseColor(vec2 uv) {
  float zoom = 1.6 / safeScale();
  vec2 p = rot2(uAngle) * centered(uv) * zoom;
  float t = uTime * 0.35;
  float turb = mix(0.3, 1.45, uDetail);
  float e = 2.0 * pxSize() * zoom;
  float h0 = lmHeight(p, t, turb);
  float hx = lmHeight(p + vec2(e, 0.0), t, turb);
  float hy = lmHeight(p + vec2(0.0, e), t, turb);
  vec2 g = vec2(hx - h0, hy - h0) / e;
  vec3 n = normalize(vec3(-g * 0.55, 1.0));
  float s = n.y * 1.25 + n.x * 0.35 + p.y * 0.1 / zoom + h0 * 0.22;
  float w = mix(0.17, 0.012, uAmount);
  float disp = 0.035 + 0.03 * uAmount;
  vec3 c = vec3(lmEnv(s + disp, w).r, lmEnv(s, w).g, lmEnv(s - disp, w).b);
  c *= mix(1.0, 0.72, smoothstep(0.45, 0.95, 1.0 - n.z));
  return c;
}
#endif

#if BASE_KIND == K_SATIN
vec3 baseColor(vec2 uv) {
  vec2 p = rot2(-uAngle) * centered(uv);
  float t = uTime * 0.3;
  float freq = 5.5 / safeScale();
  float depth = mix(0.35, 1.6, uDetail);
  float ph = 0.55 * sin(p.y * 1.4 + t) + 0.25 * sin(p.y * 2.9 - t * 1.2 + p.x * 0.8);
  float u = p.x * freq + ph;
  float m = 0.6 * sin(p.y * 0.8 + t * 0.6 + p.x * 0.5);
  float h = sin(u) + 0.5 * sin(2.13 * u + 1.7 + m) + 0.22 * sin(4.7 * u + 0.6);
  float dh = cos(u) + 1.065 * cos(2.13 * u + 1.7 + m) + 0.517 * cos(4.7 * u + 0.6);
  float slope = dh * depth * 0.36;
  vec3 n = normalize(vec3(-slope, -0.12 * depth * cos(p.y * 1.4 + t), 1.0));
  vec3 L = normalize(vec3(-0.55, 0.5, 0.7));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float nh = clamp(dot(n, H), 0.0, 1.0);
  float gloss = uAmount;
  float spec = pow(nh, mix(18.0, 160.0, gloss)) * mix(0.7, 1.7, gloss);
  float bloom = pow(nh, 6.0) * 0.45;
  float sheen = pow(1.0 - n.z, 1.5) * 0.9;
  float ao = mix(0.55, 1.0, smoothstep(-1.4, 1.2, h));
  vec3 dyeDark = toLinear(uCol[0]);
  vec3 dye = toLinear(uCol[1]);
  vec3 hi = toLinear(uCol[2]);
  vec3 sh = toLinear(uCol[3]);
  vec3 col = mix(dyeDark, dye, pow(diff, 1.6)) * ao;
  col += hi * (spec + bloom * (0.35 + gloss * 0.65)) * ao;
  col += sh * sheen * 0.3 * (1.0 - diff);
  col = col / (1.0 + max(col - 0.9, 0.0));
  return toSrgb(col);
}
#endif

#if BASE_KIND == K_PLASMA
vec3 baseColor(vec2 uv) {
  vec2 p = rot2(uAngle) * centered(uv) * (3.4 / safeScale());
  float t = uTime * 0.6;
  vec2 q = p + uDetail * 1.1 * vec2(sin(p.y * 1.2 + t * 0.6), cos(p.x * 1.05 - t * 0.5));
  float v = sin(q.x * 1.6 + t) + sin(q.y * 1.35 - t * 0.85)
          + sin((q.x + q.y) * 1.1 + t * 0.55)
          + sin(length(q - vec2(sin(t * 0.33) * 1.5, cos(t * 0.27) * 1.2)) * 2.4 - t * 1.1)
          + sin(length(q + vec2(cos(t * 0.21) * 1.8, sin(t * 0.29) * 1.4)) * 1.7 + t * 0.7);
  float f = 0.5 + 0.1 * v;
  f = clamp((f - 0.5) * mix(0.9, 2.4, uAmount) + 0.5, 0.0, 1.0);
  return pal(smoothstep(0.0, 1.0, f));
}
#endif

#if BASE_KIND == K_SWIRL
vec3 baseColor(vec2 uv) {
  vec2 p = centered(uv) / safeScale();
  float r = length(p) + 1e-4;
  float a = atan(p.y, p.x) + uAngle;
  float arms = floor(1.0 + uAmount * 4.99);
  float twist = mix(0.5, 3.6, uDetail);
  float t = uTime * 0.25;
  float wob = 0.05 * sin(r * 9.0 - t * 2.0 + 2.0 * a);
  float s = a / TAU * arms + log(r) * twist * 0.5 - t + wob;
  float grad = 4.0 * sqrt(pow(arms / TAU, 2.0) + pow(twist * 0.5, 2.0)) / r;
  float fw = grad * pxSize() / safeScale() * 1.3;
  return bands4(s * 4.0, fw, 0.0);
}
#endif

#if BASE_KIND == K_WAVES
vec3 baseColor(vec2 uv) {
  vec2 p = rot2(uAngle) * centered(uv);
  float t = uTime * 0.35;
  float dens = 4.5 / safeScale();
  float amp = uDetail * 0.2;
  float w = sin(p.x * 3.2 + t) * 0.55 + sin(p.x * 5.7 - t * 1.4 + 1.3) * 0.25 + sin(p.x * 1.3 + t * 0.5) * 0.45;
  float s = (p.y + amp * w) * dens + t * 0.4;
  float fw = fwidth(s) * 1.3;
  return bands4(s, fw, uAmount * uAmount);
}
#endif
`;

const KINDS_C = /* glsl */ `
#if BASE_KIND == K_GOO
vec3 gooBlob(int i, float t) {
  float fi = float(i);
  vec2 h = frameSize() * 0.5;
  vec2 c = vec2(sin(t * (0.31 + 0.07 * fi) + fi * 1.9), cos(t * (0.27 + 0.05 * fi) + fi * 2.7));
  c += 0.35 * vec2(sin(t * 0.53 + fi * 4.1), cos(t * 0.47 + fi * 3.3));
  c *= h * vec2(0.5, 0.48);
  float r = (0.095 + 0.055 * fract(fi * 0.618 + 0.2)) * mix(0.8, 1.45, uDetail);
  return vec3(c, r);
}
float gooField(vec2 p, float t, out vec2 grad, out vec3 lab) {
  float f = 0.0;
  grad = vec2(0.0);
  vec3 la = vec3(0.0);
  float wa = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 b = gooBlob(i, t);
    vec2 d = p - b.xy;
    float d2 = dot(d, d) + 1e-4;
    float fi = b.z * b.z / d2;
    f += fi;
    grad += -2.0 * fi / d2 * d;
    float w = fi * fi;
    int ci = i - (i / 3) * 3;
    la += w * (ci == 0 ? uLab[1] : (ci == 1 ? uLab[2] : uLab[3]));
    wa += w;
  }
  lab = la / max(wa, 1e-6);
  return f;
}
float gooFieldOnly(vec2 p, float t) {
  float f = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 b = gooBlob(i, t);
    vec2 d = p - b.xy;
    f += b.z * b.z / (dot(d, d) + 1e-4);
  }
  return f;
}
vec3 baseColor(vec2 uv) {
  vec2 p = centered(uv) / safeScale();
  float t = uTime * 0.5;
  vec2 g;
  vec3 lab;
  float f = gooField(p, t, g, lab);
  float aa = length(g) * pxSize() / safeScale() * 1.2 + 1e-4;
  float inside = smoothstep(1.0 - aa, 1.0 + aa, f);
  float hgt = sqrt(clamp(1.0 - 1.0 / max(f, 1.0), 0.0, 1.0));
  vec2 gh = g / (2.0 * max(hgt, 0.06) * f * f);
  vec3 n = normalize(vec3(-gh * 0.12, 1.0));
  vec3 L = normalize(vec3(cos(uAngle + 2.2), sin(uAngle + 2.2), 0.9));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  vec3 R = reflect(-L, n);
  float gloss = uAmount;
  float spec = pow(clamp(R.z, 0.0, 1.0), mix(18.0, 140.0, gloss)) * mix(0.35, 1.5, gloss);
  float fres = pow(1.0 - n.z, 3.0);
  vec3 body = clamp(oklabToLin(lab), 0.0, 1.0);
  vec3 col = body * (0.32 + 0.78 * diff) + body * body * 0.35 * (1.0 - diff);
  col += fres * mix(body, vec3(1.0), 0.45) * 0.55;
  col += spec;
  vec3 bg = toLinear(uCol[0]);
  float fs = gooFieldOnly(p + L.xy * 0.045, t);
  bg *= 1.0 - smoothstep(0.35, 1.05, fs) * 0.42;
  col = mix(bg, col, inside);
  col = col / (1.0 + max(col - 0.92, 0.0));
  return toSrgb(col);
}
#endif

#if BASE_KIND == K_SUNBURST
vec3 baseColor(vec2 uv) {
  vec2 p = centered(uv) / safeScale();
  float r = length(p) + 1e-5;
  float a = atan(p.y, p.x) + uAngle + uTime * 0.12;
  float N = 2.0 * floor(mix(4.0, 16.0, uDetail) + 0.5);
  float s = a / TAU * N * 0.5;
  float fw = (N * 0.5 / TAU) / r * pxSize() / safeScale() * 1.4;
  float d = abs(fract(s) - 0.5) - 0.25;
  float m = clamp(0.5 + d / fw, 0.0, 1.0);
  m = mix(m, 0.5, smoothstep(0.2, 0.5, fw));
  vec3 col = oklabToSrgb(mix(uLab[1], uLab[0], m));
  // depth: rays darken a touch toward the frame edge
  col *= 1.0 - 0.18 * smoothstep(0.3, 1.2, r * safeScale());
  float R = mix(0.05, 0.3, uAmount);
  float glow = exp(-max(r - R, 0.0) * 7.0);
  col = mix(col, uCol[2], glow * 0.28);
  float edge = pxSize() / safeScale() * 1.2;
  float sun = 1.0 - smoothstep(R - edge, R + edge, r);
  vec3 sunCol = oklabToSrgb(mix(uLab[3], uLab[2], smoothstep(0.0, R, r)));
  return mix(col, sunCol, sun);
}
#endif

#if BASE_KIND == K_HOLO
vec3 baseColor(vec2 uv) {
  vec2 p = rot2(uAngle) * centered(uv) / safeScale();
  float t = uTime * 0.25;
  float cr = mix(0.1, 1.0, uDetail);
  float n1 = snoise(p * 0.7 + vec2(t * 0.1, -t * 0.07));
  float n2 = snoise(p * 3.0 + vec2(4.1, 1.3));
  float n3 = snoise(p * 8.0 + vec2(-2.3, 7.7));
  float crink = (n2 * 0.65 + n3 * 0.35) * cr;
  // thin-film phase: broad spectral sweeps, only gently bent by the laminate crinkle
  float ph = dot(p, vec2(0.5, 0.86)) * 1.8 + n1 * 0.5 + crink * 0.18 + t * 0.35;
  vec3 irid = oklabToSrgb(palLabCyc(ph));
  vec3 spec = 0.5 + 0.5 * cos(TAU * (ph + vec3(0.0, 0.33, 0.67)));
  irid = mix(irid, spec, 0.3);
  float silver = 0.5 + 0.5 * cos(TAU * ph * 2.0 + 1.0);
  vec3 col = mix(irid, vec3(0.93), 0.2 * silver);
  col *= 0.93 + 0.1 * crink;
  float band = sin(dot(p, vec2(0.8, -0.6)) * 1.6 + n1 * 1.4 - t * 1.1);
  col = mix(col, vec3(1.0), smoothstep(0.6, 1.0, band) * 0.5);
  vec2 sp = vUv * uRes / max(2.0 * uDpr, 1.5);
  float rnd = hash12(floor(sp));
  float tw = 0.5 + 0.5 * sin(t * 7.0 + rnd * 40.0);
  float glint = step(0.955, rnd) * tw * uAmount * (1.0 - smoothstep(0.1, 0.5, length(fract(sp) - 0.5)));
  col += glint * mix(vec3(1.0), oklabToSrgb(palLabCyc(ph + 0.5)), 0.4) * 0.9;
  return col;
}
#endif

#if BASE_KIND == K_CHECKER
vec3 baseColor(vec2 uv) {
  vec2 fr = frameSize();
  vec2 p = centered(uv);
  float cells = 7.0 / safeScale();
  float t = uTime * 0.35;
  vec2 q = rot2(uAngle) * p * cells;
  float w = uDetail;
  q += w * 0.6 * vec2(sin(q.y * 0.55 + t), sin(q.x * 0.55 - t * 0.8 + 1.3));
  q *= 1.0 + w * 0.25 * sin(length(p) * 4.0 - t * 1.5);
  float s = sin(PI * q.x) * sin(PI * q.y);
  float fw = fwidth(s);
  float m = clamp(0.5 + 0.5 * s / (fw + uAmount * 1.1 + 1e-4), 0.0, 1.0);
  float g = clamp(dot(p / fr, vec2(0.6, 0.8)) + 0.5, 0.0, 1.0);
  vec3 a = oklabToSrgb(mix(uLab[0], uLab[2], g));
  vec3 b = oklabToSrgb(mix(uLab[1], uLab[3], g));
  return mix(a, b, m);
}
#endif
`;

const KINDS_D = /* glsl */ `
#if BASE_KIND == K_DOTGRID
vec3 baseColor(vec2 uv) {
  vec2 fr = frameSize();
  vec2 px = (uv - 0.5) * uRes;
  float sp = max(24.0 * safeScale() * uDpr, 4.0);
  vec2 f = (fract(px / sp + 0.5) - 0.5) * sp;
  float d = length(f);
  float t = uTime * 0.15;
  vec2 p = centered(uv);
  vec2 g1 = vec2(sin(t * 0.9) * 0.32, cos(t * 0.7) * 0.22 + 0.05) * fr;
  vec2 g2 = vec2(cos(t * 0.6 + 2.0) * 0.36, sin(t * 0.8 + 1.0) * 0.28 - 0.08) * fr;
  float glow = exp(-dot(p - g1, p - g1) * 3.2) + 0.7 * exp(-dot(p - g2, p - g2) * 4.5);
  glow = clamp(glow, 0.0, 1.0) * uAmount;
  float rad = mix(0.75, 2.1, uDetail) * uDpr * (1.0 + 0.45 * glow);
  float m = 1.0 - smoothstep(rad - 0.6, rad + 0.6, d);
  vec3 bg = oklabToSrgb(mix(uLab[0], uLab[2], glow * 0.16));
  vec3 dotc = oklabToSrgb(mix(uLab[1], uLab[2], clamp(glow * 1.3, 0.0, 1.0)));
  return mix(bg, dotc, m);
}
#endif

#if BASE_KIND == K_HALFTONE
float htField(vec2 p, float t, float turb) {
  vec2 q = p + turb * 0.35 * vec2(snoise(p * 1.1 + vec2(t * 0.4, 0.0)), snoise(p * 1.1 + vec2(3.3, -t * 0.35)));
  float v = 0.5 + 0.38 * sin(q.x * 2.1 + q.y * 1.3 + t * 0.6) + 0.22 * snoise(q * 1.7 - t * 0.2);
  return clamp(v, 0.0, 1.0);
}
vec3 baseColor(vec2 uv) {
  vec2 px = (uv - 0.5) * uRes;
  float cell = max(11.0 * safeScale() * uDpr, 3.0);
  mat2 R = rot2(-uAngle);
  vec2 q = (R * px) / cell;
  vec2 id = floor(q) + 0.5;
  vec2 f = q - id;
  vec2 cuv = (transpose(R) * (id * cell)) / uRes + 0.5;
  vec2 cp = centered(cuv);
  float t = uTime * 0.3;
  float v = htField(cp, t, uAmount);
  float v2 = 0.5 + 0.5 * snoise(cp * 0.9 + vec2(-t * 0.15, t * 0.1) + 11.0);
  float rad = sqrt(v) * mix(0.42, 0.74, uDetail);
  float aa = 0.8 / cell;
  float m = 1.0 - smoothstep(rad - aa, rad + aa, length(f));
  vec3 ink = oklabToSrgb(mix(uLab[1], uLab[2], smoothstep(0.3, 0.7, v2)));
  vec3 paper = oklabToSrgb(mix(uLab[0], uLab[3], smoothstep(-0.8, 0.8, cp.y) * 0.35));
  return mix(paper, ink, m);
}
#endif

#if BASE_KIND == K_DITHER
vec3 baseColor(vec2 uv) {
  float pix = max(1.0, floor(mix(1.5, 6.0, uDetail) * uDpr + 0.5));
  vec2 bid = floor(uv * uRes / pix);
  vec2 cuv = (bid + 0.5) * pix / uRes;
  vec2 p = centered(cuv) / safeScale();
  float t = uTime * 0.3;
  vec2 q = p + 0.35 * vec2(snoise(p * 1.2 + t * 0.4), snoise(p * 1.2 - t * 0.35 + 5.0));
  float v = 0.5 + 0.3 * sin(q.x * 2.2 + q.y * 1.4 + t) + 0.2 * snoise(q * 2.0 - t * 0.2);
  v = clamp((v - 0.5) * mix(0.8, 2.0, uAmount) + 0.5, 0.0, 1.0);
  float lv = v * 3.0;
  float i = floor(lv);
  i += step(bayer8(bid), fract(lv));
  return colAt(clamp(i, 0.0, 3.0));
}
#endif

#if BASE_KIND == K_STUDIO
vec3 baseColor(vec2 uv) {
  vec2 fr = frameSize();
  vec2 p = centered(uv);
  float t = uTime * 0.2;
  float soft = mix(0.55, 1.7, uDetail);
  float inten = mix(0.25, 1.6, uAmount);
  vec3 albedo = toLinear(uCol[0]);
  vec3 keyC = toLinear(uCol[1]);
  vec3 fillC = toLinear(uCol[2]);
  vec3 backC = toLinear(uCol[3]);
  float horizon = -0.2 * fr.y * safeScale();
  float wall = smoothstep(horizon - 0.22, horizon + 0.3, p.y);
  vec2 kp = vec2(sin(uAngle) * 0.38 * fr.x, 0.3 * fr.y) + 0.05 * vec2(sin(t), cos(t * 0.8)) * step(0.0001, abs(uTime));
  vec2 kd = (p - kp) * vec2(0.85, 1.15) / safeScale();
  float key = exp(-dot(kd, kd) / (0.2 * soft * soft));
  vec2 fp = vec2(kp.x * 0.5, horizon - 0.1);
  vec2 fd = (p - fp) * vec2(0.65, 2.0) / safeScale();
  float pool = exp(-dot(fd, fd) / (0.09 * soft)) * (1.0 - wall);
  float fillL = exp(-pow((p.x + 0.6 * fr.x) / (0.38 * soft), 2.0));
  float fillR = exp(-pow((p.x - 0.6 * fr.x) / (0.38 * soft), 2.0));
  float back = exp(-max(p.y - horizon, 0.0) * 3.2 / soft) * wall;
  vec2 ap = vec2(sin(t * 0.7 + 1.0) * 0.4, cos(t * 0.5) * 0.15 + 0.1) * fr;
  float amb = exp(-dot(p - ap, p - ap) * 2.5) * step(0.0001, abs(uTime)) * 0.15;
  vec3 light = vec3(0.3 + 0.16 * wall)
             + keyC * key * 0.95 * inten
             + keyC * pool * 0.45 * inten
             + fillC * (fillL + fillR) * 0.28 * inten
             + backC * back * 0.4 * inten
             + fillC * amb * inten;
  vec3 col = albedo * light;
  float vg = smoothstep(0.35, 1.25, length(p / fr * vec2(1.0, 1.25)));
  col *= 1.0 - 0.5 * vg;
  col = col / (1.0 + max(col - 0.9, 0.0));
  return toSrgb(col);
}
#endif
`;

const MAIN = /* glsl */ `
void main() {
  vec3 c = baseColor(vUv);
  // dither before the 8-bit target so smooth gradients never band
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export const BASE_FRAG = [HEADER, KINDS_A, KINDS_B, KINDS_C, KINDS_D, MAIN].join('\n');
