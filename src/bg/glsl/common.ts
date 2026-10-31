/**
 * Shared GLSL chunks for the background engine.
 * Compiled by three's ShaderMaterial as GLSL ES 3.00 (texture/textureLod, int + bit ops available).
 * Palette chunks expect `uniform vec3 uCol[4]` (sRGB) and `uniform vec3 uLab[4]` (OKLab) to be declared first.
 */

export const GLSL_CONSTANTS = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
#define GOLDEN_ANGLE 2.39996323
`;

/** Hashes without sine (Dave Hoskins style) + interleaved gradient noise. */
export const GLSL_HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
/** Interleaved gradient noise (Jimenez 2014): cheap, well distributed per-pixel rotation / dither. */
float ign(vec2 fc) {
  return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
}
`;

/** Value noise, 2D simplex noise (after Gustavson / McEwan, MIT) and small fbm helpers. */
export const GLSL_NOISE = /* glsl */ `
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec3 permute289(vec3 x) { return mod(((x * 34.0) + 10.0) * x, 289.0); }
/** Simplex noise, returns roughly -1..1. */
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute289(permute289(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * snoise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + 17.17;
    a *= 0.5;
  }
  return s;
}
float fbm4(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * snoise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + 17.17;
    a *= 0.5;
  }
  return s;
}
`;

/** sRGB <-> linear (exact piecewise curves, same as three) and linear sRGB <-> OKLab (Ottosson). */
export const GLSL_COLOR = /* glsl */ `
vec3 toLinear(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045)));
}
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, step(c, vec3(0.0031308)));
}
float cbrtf(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }
vec3 linToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = cbrtf(l); m = cbrtf(m); s = cbrtf(s);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 oklabToLin(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
   -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
   -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
vec3 srgbToOklab(vec3 c) { return linToOklab(toLinear(c)); }
vec3 oklabToSrgb(vec3 c) { return toSrgb(clamp(oklabToLin(c), 0.0, 1.0)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 screenBlend(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - clamp(b, 0.0, 1.0)); }
`;

/** 4-stop palette sampling in OKLab (uniform stops at 0, 1/3, 2/3, 1) and a cyclic variant. */
export const GLSL_PALETTE = /* glsl */ `
vec3 palLab(float t) {
  t = clamp(t, 0.0, 1.0) * 3.0;
  vec3 a = mix(uLab[0], uLab[1], clamp(t, 0.0, 1.0));
  a = mix(a, uLab[2], clamp(t - 1.0, 0.0, 1.0));
  return mix(a, uLab[3], clamp(t - 2.0, 0.0, 1.0));
}
/** Loops 0 -> 1 -> 2 -> 3 -> 0 so angular / repeating patterns never show a seam. */
vec3 palLabCyc(float t) {
  t = fract(t) * 4.0;
  vec3 a = mix(uLab[0], uLab[1], clamp(t, 0.0, 1.0));
  a = mix(a, uLab[2], clamp(t - 1.0, 0.0, 1.0));
  a = mix(a, uLab[3], clamp(t - 2.0, 0.0, 1.0));
  return mix(a, uLab[0], clamp(t - 3.0, 0.0, 1.0));
}
vec3 pal(float t) { return oklabToSrgb(palLab(t)); }
vec3 palCyc(float t) { return oklabToSrgb(palLabCyc(t)); }
vec3 palMeanLab() { return (uLab[0] + uLab[1] + uLab[2] + uLab[3]) * 0.25; }
/** Palette entry by float index 0..3 without dynamic indexing. */
vec3 colAt(float i) {
  return i < 0.5 ? uCol[0] : (i < 1.5 ? uCol[1] : (i < 2.5 ? uCol[2] : uCol[3]));
}
vec3 labAt(float i) {
  return i < 0.5 ? uLab[0] : (i < 1.5 ? uLab[1] : (i < 2.5 ? uLab[2] : uLab[3]));
}
`;

export const GLSL_UTIL = /* glsl */ `
mat2 rot2(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
/** 8x8 ordered Bayer threshold in (0,1) for an integer pixel coordinate. */
float bayer8(vec2 p) {
  ivec2 ip = ivec2(mod(floor(p), 8.0));
  int x = ip.x;
  int y = ip.y;
  int xy = x ^ y;
  int v = ((xy & 1) << 5) | ((y & 1) << 4) | ((xy & 2) << 2) | ((y & 2) << 1) | ((xy & 4) >> 1) | ((y & 4) >> 2);
  return (float(v) + 0.5) / 64.0;
}
`;

/** Full-screen triangle in clip space; ignores camera matrices on purpose. */
export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const GLSL_COMMON = [GLSL_CONSTANTS, GLSL_HASH, GLSL_NOISE, GLSL_COLOR, GLSL_PALETTE, GLSL_UTIL].join('\n');
