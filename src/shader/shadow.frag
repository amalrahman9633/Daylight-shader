#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

// Two scene slots (A = 0, B = 1) so presets can crossfade. Each scene has up
// to three mask layers. Layer i of scene s lives at index s * 3 + i.
uniform sampler2D uMaskA0;
uniform sampler2D uMaskA1;
uniform sampler2D uMaskA2;
uniform sampler2D uMaskB0;
uniform sampler2D uMaskB1;
uniform sampler2D uMaskB2;
uniform vec4 uLayerShape[6];   // x scale, y weight (0 = unused), z blur multiplier, w flutter
uniform vec2 uLayerOffset[6];  // drift + wind, in mask units
uniform vec2 uLayerLevels[6];  // contrast remap: below x = light, above y = shadow
uniform vec4 uScene[2];        // xy origin/pivot, z lean axis (0 = x, 1 = y), w anchored
uniform vec4 uSceneFrame[2];   // xy align, z lean amount, w sway angle (radians)
uniform float uSceneAspect[2]; // mask width ÷ height (built-in masks are 1)
uniform vec4 uSceneCrop[2];    // part of the mask used for framing: left, top, right, bottom
uniform float uMix;            // 0 = scene A only, 1 = scene B only

uniform vec2 uResolution;      // canvas size in pixels
uniform float uTime;           // animation time in seconds (stops when paused)
uniform float uGust;           // 0..~2, how strong the current gust is
uniform float uWindStrength;   // 1 = default branch wind
uniform vec3 uBackground;      // background color, linear RGB
uniform vec3 uLightTint;       // warmth: multiplier on lit areas
uniform vec3 uShadowTint;      // color the background darkens toward in shadow
uniform float uLightStretch;   // light angle: how much longer the shadow is cast
uniform float uSkew;           // light angle: how much the shadow leans
uniform float uOpacity;        // 0..1
uniform float uSoftness;       // 0..1
uniform float uGrain;          // grain amplitude
uniform float uGrainSeed;      // changes ~24 times a second while playing
uniform float uReveal;         // 0..1 fade-in on load

// Cheap per-pixel random number, used to scatter blur samples and dither.
float ign(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Smooth value noise.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
    mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x),
    u.y
  );
}

// Soft blur: average 24 samples laid out in a sunflower spiral inside a disc.
// Reading from a smaller mipmap level fills the gaps between samples, so the
// result is smooth without needing hundreds of taps.
float softMask(sampler2D mask, vec2 uv, float radius, float maskAspect) {
  const int N = 24;
  const float GOLDEN_ANGLE = 2.39996323;
  // Radius is measured in mask heights; widen x for wide masks so the blur
  // stays round instead of oval.
  vec2 stretch = vec2(1.0 / maskAspect, 1.0);
  float texels = float(textureSize(mask, 0).y);
  float spacing = radius * texels * 1.77 / sqrt(float(N));
  float lod = log2(max(spacing, 1.0));
  float spin = ign(gl_FragCoord.xy) * 6.2831853;

  float sum = 0.0;
  for (int i = 0; i < N; i++) {
    float r = sqrt((float(i) + 0.5) / float(N)) * radius;
    float a = float(i) * GOLDEN_ANGLE + spin;
    sum += textureLod(mask, uv + r * vec2(cos(a), sin(a)) * stretch, lod).r;
  }
  return sum / float(N);
}

// One mask layer: tile it, move it, tremble it, blur it.
float layerShadow(sampler2D mask, int i, vec2 uv, float reach, float radius, float maskAspect) {
  vec4 shape = uLayerShape[i];
  if (shape.y <= 0.0) return 0.0;

  vec2 luv = uv * shape.x + uLayerOffset[i];

  // A tiny noise flutter. On the branch it grows with distance from the
  // pivot, so the tips tremble while the thick limb stays steady.
  vec2 flutter = vec2(
    vnoise(luv * 5.0 + vec2(uTime * 0.7, 0.0)),
    vnoise(luv * 5.0 + vec2(13.1, uTime * 0.6))
  ) - 0.5;
  luv += flutter * 0.005 * shape.w * (0.3 * uWindStrength + uGust) * reach;

  // Blur is set in screen terms, so scale it into this layer's tiling.
  float v = softMask(mask, luv, radius * shape.x * shape.z, maskAspect);
  vec2 levels = uLayerLevels[i];
  v = smoothstep(levels.x, levels.y, v);
  return v * shape.y;
}

// The full shadow for one scene slot, 0..1.
float sceneShadow(int s, vec2 p, float aspect, float radius,
                  sampler2D m0, sampler2D m1, sampler2D m2) {
  vec4 scene = uScene[s];
  vec4 frame = uSceneFrame[s];
  vec2 origin = scene.xy;

  // "Cover" fit: the framing area fills the screen and the overflow is cropped.
  float m = uSceneAspect[s];
  vec4 crop = uSceneCrop[s];
  vec2 cropSize = crop.zw - crop.xy;
  float cropAspect = m * cropSize.x / cropSize.y;
  vec2 visible = aspect > cropAspect ? vec2(1.0, cropAspect / aspect) : vec2(aspect / cropAspect, 1.0);
  vec2 uv = crop.xy + (frame.xy * (1.0 - visible) + p * visible) * cropSize;

  // Shape math happens in "true proportion" units (x scaled by the mask's
  // aspect), so leaning and rotating never squash a non-square mask.
  vec2 prop = vec2(m, 1.0);

  // Light angle: a lower sun casts a longer shadow that leans sideways.
  // Both grow away from the origin, so an anchored branch stays put at its
  // pivot and we never sample past the mask's edge.
  vec2 d = (uv - origin) * prop / uLightStretch;
  float lean = uSkew * frame.z;
  if (scene.z < 0.5) d.x -= d.y * lean;
  else d.y -= d.x * lean;

  // Wind on anchored masks: rotate the whole thing around the pivot.
  float c = cos(frame.w), sn = sin(frame.w);
  d = mat2(c, sn, -sn, c) * d;
  uv = origin + d / prop;

  float reach = scene.w > 0.5 ? length(d) / max(m, 1.0) : 0.5;

  // Layers stack like real leaves: each one blocks part of the light that
  // got past the others, so overlaps get darker without going solid black.
  int base = s * 3;
  float light = 1.0;
  light *= 1.0 - layerShadow(m0, base + 0, uv, reach, radius, m);
  light *= 1.0 - layerShadow(m1, base + 1, uv, reach, radius, m);
  light *= 1.0 - layerShadow(m2, base + 2, uv, reach, radius, m);
  return 1.0 - light;
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  // Screen position with y pointing down, to match image coordinates.
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uResolution.x / uResolution.y;
  float radius = 0.002 + uSoftness * 0.022;

  // Only draw the scenes that are actually visible.
  float shadow = 0.0;
  if (uMix < 1.0) {
    shadow += sceneShadow(0, p, aspect, radius, uMaskA0, uMaskA1, uMaskA2) * (1.0 - uMix);
  }
  if (uMix > 0.0) {
    shadow += sceneShadow(1, p, aspect, radius, uMaskB0, uMaskB1, uMaskB2) * uMix;
  }
  shadow *= uOpacity * uReveal;

  // Lit areas take the light's color; shaded areas darken toward the cool
  // shadow tint. Done in linear light, which is how real light mixes, then
  // converted back for the screen.
  vec3 color = uBackground * mix(uLightTint, uShadowTint, shadow);
  color = linearToSrgb(clamp(color, 0.0, 1.0));

  // Grain: two random values added together give a softer, film-like
  // distribution than one. A little weaker in highlights, like real film.
  vec2 seed = gl_FragCoord.xy + uGrainSeed * vec2(37.0, 17.0);
  float n = hash12(seed) + hash12(seed * 1.37 + 11.0) - 1.0;
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color += n * uGrain * (1.15 - 0.3 * lum);

  // Sub-visible dither to stop banding in soft gradients.
  color += (ign(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;

  outColor = vec4(color, 1.0);
}
