import vertexSource from './shader/fullscreen.vert?raw';
import fragmentSource from './shader/shadow.frag?raw';
import { presets, presetOrder, type MaskName, type PresetId, type SceneConfig } from './presets';
import type { Settings, Store, ViewStore } from './state';
import { TRANSITION_SECONDS } from './transition';
import { layerWind, sampleWind } from './wind';

const MAX_DPR = 2;
const REVEAL_SECONDS = 1.6;
const GRAIN_FPS = 24;
const LAYERS_PER_SCENE = 3;
// If a new preset is picked mid-fade, finish the current fade this quickly
// first, so nothing ever snaps.
const HURRY_SECONDS = 0.25;

type Vec3 = [number, number, number];

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed to compile');
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program failed to link');
  }
  return program;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** Hex color to linear-light RGB, the space the shader does its math in. */
function hexToLinear(hex: string): Vec3 {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Vec3;
}

const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Light colors, as multipliers on the background. Cool is overcast daylight,
// golden is late-afternoon sun. Both are normalized to the same brightness so
// warmth changes hue, not exposure.
const COOL_LIGHT: Vec3 = [0.93, 0.98, 1.06];
const NEUTRAL: Vec3 = [1, 1, 1];
const GOLDEN_LIGHT: Vec3 = [1.07, 1.0, 0.85];
// Shadow colors. The warmer the sun, the bluer the shadow looks next to it.
const GREY_SHADOW: Vec3 = [0.15, 0.15, 0.16];
const BLUE_SHADOW: Vec3 = [0.1, 0.13, 0.21];

function normalizeLuminance(c: Vec3): Vec3 {
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [c[0] / y, c[1] / y, c[2] / y];
}

/**
 * Turns slider units into the numbers the shader actually uses. Every
 * "what does 55 mean" decision lives here.
 */
function toShaderValues(s: Settings) {
  const w = s.warmth / 100;
  const lightTint =
    w < 0.5
      ? mix3(COOL_LIGHT, NEUTRAL, w * 2)
      : mix3(NEUTRAL, GOLDEN_LIGHT, (w - 0.5) * 2);

  const angle = (s.lightAngle * Math.PI) / 180;

  return {
    background: hexToLinear(s.background),
    lightTint: normalizeLuminance(lightTint),
    shadowTint: mix3(GREY_SHADOW, BLUE_SHADOW, w),
    // A lower sun casts a longer shadow and leans it away from the light.
    lightStretch: 1 + (1 - Math.cos(angle)) * 0.35,
    skew: Math.sin(angle) * 0.22,
    softness: s.softness / 100,
    opacity: s.opacity / 100,
    // The branch preset defaults (speed 30, wind 55) are the tuned "1x".
    speed: s.speed / 30,
    wind: s.wind / 55,
    // Peak grain is about ±7% brightness; the default 12 is about ±1%.
    grain: (s.grain / 100) * 0.07,
  };
}

/** A mask made in the browser: one byte per pixel, 0 = light, 255 = shadow. */
export interface MaskPixels {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface Renderer {
  /** Largest image side this device's GPU can render. */
  maxExportSize: number;
  /** Render the current frame offscreen at any size and return its pixels. */
  renderStill(width: number, height: number): ImageData;
  /** Use a new custom mask + scene. Crossfades if the custom look is showing. */
  setCustom(mask: MaskPixels | TexImageSource, scene: SceneConfig): void;
  /** Replace the custom mask's pixels in place (same size), no crossfade. */
  updateCustomMask(mask: MaskPixels): void;
  /** Forget the custom mask (after the UI has moved off it). */
  clearCustom(): void;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  store: Store;
  view: ViewStore;
  onError: (message: string) => void;
  /** Where to load a built-in mask from. Defaults to the site's /masks folder. */
  maskUrl?: (name: MaskName) => string;
  /** Called when the background color changes, e.g. to color the page. */
  onBackground?: (hex: string) => void;
  /** Load every preset's masks in the background so switching is instant.
   *  Off in the embeddable player, which only ever shows one look. */
  preload?: boolean;
}

// Big exports render in strips, so a slow GPU never stalls long enough for
// the browser to give up on it.
const EXPORT_STRIP = 512;

export function createRenderer({
  canvas,
  gl,
  store,
  view,
  onError,
  maskUrl = (name) => `${import.meta.env.BASE_URL}masks/${name}.png`,
  onBackground,
  preload = true,
}: RendererOptions): Renderer {
  const program = createProgram(gl);
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());

  const u = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    resolution: u('uResolution'),
    time: u('uTime'),
    gust: u('uGust'),
    windStrength: u('uWindStrength'),
    background: u('uBackground'),
    lightTint: u('uLightTint'),
    shadowTint: u('uShadowTint'),
    lightStretch: u('uLightStretch'),
    skew: u('uSkew'),
    opacity: u('uOpacity'),
    softness: u('uSoftness'),
    grain: u('uGrain'),
    grainSeed: u('uGrainSeed'),
    reveal: u('uReveal'),
    layerShape: u('uLayerShape'),
    layerOffset: u('uLayerOffset'),
    layerLevels: u('uLayerLevels'),
    scene: u('uScene'),
    sceneFrame: u('uSceneFrame'),
    sceneAspect: u('uSceneAspect'),
    sceneCrop: u('uSceneCrop'),
    mix: u('uMix'),
  };

  // Each layer slot reads from its own texture unit (0..5).
  ['uMaskA0', 'uMaskA1', 'uMaskA2', 'uMaskB0', 'uMaskB1', 'uMaskB2'].forEach((name, unit) =>
    gl.uniform1i(u(name), unit),
  );

  // ---------- Textures ----------

  // Texture uploads use a spare unit, so loading a mask in the background
  // never disturbs the textures currently on screen.
  const UPLOAD_UNIT = gl.TEXTURE0 + 7;

  // Stand-in for empty layer slots: a single black (no shadow) pixel.
  const emptyTexture = gl.createTexture()!;
  gl.activeTexture(UPLOAD_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, emptyTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));

  const textures = new Map<MaskName, Promise<WebGLTexture>>();

  const wrapMode = { extend: gl.CLAMP_TO_EDGE, repeat: gl.REPEAT, mirror: gl.MIRRORED_REPEAT };

  function sceneWrap(scene: SceneConfig): number {
    return wrapMode[scene.wrap ?? (scene.anchored ? 'extend' : 'repeat')];
  }

  /** Upload a mask to the GPU, with mipmaps and edge behaviour. */
  function createMaskTexture(source: MaskPixels | TexImageSource, wrap: number): WebGLTexture {
    const texture = gl.createTexture()!;
    gl.activeTexture(UPLOAD_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Single-channel texture: the mask only needs one value per pixel.
    if ('data' in source) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, source.width, source.height, 0, gl.RED, gl.UNSIGNED_BYTE, source.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, source);
    }
    // Mipmaps are pre-shrunk copies of the texture. The blur reads from them.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return texture;
  }

  function loadMask(name: MaskName): Promise<WebGLTexture> {
    let promise = textures.get(name);
    if (!promise) {
      // Branch and window blinds don't tile: past the edge, keep extending
      // the edge pixels. The maple photo mirrors (it isn't made to repeat).
      // Everything else repeats seamlessly.
      const wrap =
        name === 'branch-trees' || name === 'blinds-window'
          ? gl.CLAMP_TO_EDGE
          : name === 'leaves-maple'
            ? gl.MIRRORED_REPEAT
            : gl.REPEAT;
      promise = loadImage(maskUrl(name)).then((img) => createMaskTexture(img, wrap));
      textures.set(name, promise);
      // Forget failed downloads so picking the preset again retries them.
      promise.catch(() => textures.delete(name));
    }
    return promise;
  }

  // ---------- Custom mask ----------

  let customScene: SceneConfig | null = null;
  let customTexture: WebGLTexture | null = null;
  // Old custom textures wait here until no scene slot uses them any more.
  const retired = new Set<WebGLTexture>();

  function sweepRetired() {
    for (const texture of retired) {
      if (!slots.some((slot) => slot?.textures.includes(texture))) {
        gl.deleteTexture(texture);
        retired.delete(texture);
      }
    }
  }

  function sceneFor(id: PresetId): SceneConfig | null {
    return id === 'custom' ? customScene : presets[id].scene;
  }

  const loadScene = (scene: SceneConfig) =>
    Promise.all(
      scene.layers.map((l) => {
        if (l.mask !== 'custom') return loadMask(l.mask);
        return customTexture ? Promise.resolve(customTexture) : Promise.reject(new Error('No custom mask'));
      }),
    );

  // ---------- Scene slots ----------

  interface Slot {
    scene: SceneConfig;
    textures: WebGLTexture[];
  }

  // Slot 0 is what's showing; slot 1 is what we're fading to.
  const slots: (Slot | null)[] = [null, null];
  let fade = 0; // 0..1 progress of the slot 0 → slot 1 crossfade
  let fadeSeconds = TRANSITION_SECONDS;
  let pending: SceneConfig | null = null;
  let requestedId: PresetId = store.get().preset;
  let requested: SceneConfig | null = sceneFor(requestedId);

  const layerShape = new Float32Array(6 * 4);
  const layerOffset = new Float32Array(6 * 2);
  const layerLevels = new Float32Array(6 * 2);
  const sceneData = new Float32Array(2 * 4);
  const sceneFrame = new Float32Array(2 * 4);
  const sceneAspect = new Float32Array([1, 1]);
  const sceneCrop = new Float32Array([0, 0, 1, 1, 0, 0, 1, 1]);

  /** Bind a slot's textures and upload the parts of the scene that don't animate. */
  function bindSlot(index: number) {
    const slot = slots[index];
    for (let l = 0; l < LAYERS_PER_SCENE; l++) {
      const i = index * LAYERS_PER_SCENE + l;
      const layer = slot?.scene.layers[l];
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, layer ? slot!.textures[l] : emptyTexture);
      layerShape.set(layer ? [layer.scale, layer.weight, layer.blur, layer.flutter] : [1, 0, 1, 0], i * 4);
      layerLevels.set(layer ? layer.levels : [0, 1], i * 2);
    }
    if (slot) {
      const sc = slot.scene;
      sceneData.set([sc.origin[0], sc.origin[1], sc.leanAxis === 'y' ? 1 : 0, sc.anchored ? 1 : 0], index * 4);
      sceneFrame.set([sc.align[0], sc.align[1], sc.leanAmount], index * 4);
      sceneAspect[index] = sc.aspect ?? 1;
      sceneCrop.set(sc.crop ?? [0, 0, 1, 1], index * 4);
    }
    gl.uniform4fv(uniforms.layerShape, layerShape);
    gl.uniform2fv(uniforms.layerLevels, layerLevels);
    gl.uniform4fv(uniforms.scene, sceneData);
    gl.uniform1fv(uniforms.sceneAspect, sceneAspect);
    gl.uniform4fv(uniforms.sceneCrop, sceneCrop);
  }

  async function showScene(scene: SceneConfig, name: string) {
    requested = scene;
    const target = slots[1] ?? slots[0];
    if (target?.scene === scene && !pending) return;

    if (slots[1]) {
      // Already fading: let it finish quickly, then go to the newest pick.
      pending = scene === slots[1].scene ? null : scene;
      fadeSeconds = Math.min(fadeSeconds, HURRY_SECONDS / Math.max(1 - fade, 0.01));
      return;
    }

    let loaded: WebGLTexture[];
    try {
      loaded = await loadScene(scene);
    } catch {
      onError(`Couldn’t load the ${name} shadow. Check your connection and try again.`);
      // Point the preset buttons back at what's actually on screen.
      const shown = (slots[1] ?? slots[0])?.scene;
      if (shown && requested === scene) {
        requested = shown;
        const id = shown === customScene ? 'custom' : (Object.values(presets).find((p) => p.scene === shown)?.id);
        if (id) {
          requestedId = id;
          store.set({ preset: id });
        }
      }
      return;
    }
    // The user may have picked something else while this was loading.
    if (requested !== scene || slots[1]) {
      if (!slots[1] && requested && requested !== slots[0]?.scene) showScene(requested, name);
      return;
    }

    if (!slots[0]) {
      slots[0] = { scene, textures: loaded };
      bindSlot(0);
      maskReady = true;
      revealStart = performance.now();
    } else {
      slots[1] = { scene, textures: loaded };
      fade = 0;
      fadeSeconds = TRANSITION_SECONDS;
      bindSlot(1);
    }
    requestFrame();
  }

  function showPreset(id: PresetId) {
    requestedId = id;
    const scene = sceneFor(id);
    if (scene) showScene(scene, id === 'custom' ? 'custom' : presets[id].name.toLowerCase());
  }

  function finishFade() {
    slots[0] = slots[1];
    slots[1] = null;
    fade = 0;
    bindSlot(0);
    bindSlot(1);
    sweepRetired();
    if (pending) {
      const next = pending;
      pending = null;
      showScene(next, 'next');
    }
  }

  function setCustom(mask: MaskPixels | TexImageSource, scene: SceneConfig) {
    if (customTexture) retired.add(customTexture);
    customTexture = createMaskTexture(mask, sceneWrap(scene));
    customScene = scene;
    if (requestedId === 'custom') showScene(scene, 'custom');
    sweepRetired();
  }

  function updateCustomMask(mask: MaskPixels) {
    if (!customTexture) return;
    gl.activeTexture(UPLOAD_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, customTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mask.width, mask.height, gl.RED, gl.UNSIGNED_BYTE, mask.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    requestFrame();
  }

  function clearCustom() {
    if (customTexture) retired.add(customTexture);
    customTexture = null;
    customScene = null;
    sweepRetired();
  }

  // ---------- Settings ----------

  let values = toShaderValues(store.get());

  function applySettings(s: Settings) {
    values = toShaderValues(s);
    gl.uniform3fv(uniforms.background, values.background);
    gl.uniform3fv(uniforms.lightTint, values.lightTint);
    gl.uniform3fv(uniforms.shadowTint, values.shadowTint);
    gl.uniform1f(uniforms.lightStretch, values.lightStretch);
    gl.uniform1f(uniforms.skew, values.skew);
    gl.uniform1f(uniforms.opacity, values.opacity);
    gl.uniform1f(uniforms.softness, values.softness);
    gl.uniform1f(uniforms.grain, values.grain);
    gl.uniform1f(uniforms.windStrength, values.wind);
    onBackground?.(s.background);
    if (s.preset !== requestedId) showPreset(s.preset);
  }

  // ---------- Frame loop ----------

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let maskReady = false;
  let revealStart = 0;
  let animTime = 0; // scaled by the speed slider
  let playTime = 0; // real seconds spent playing, drives grain flicker
  let lastFrame = performance.now();
  let frameRequested = false;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(uniforms.resolution, w, h);
  }

  /** Per-frame motion for one slot: branch sway, or layer drift + wind. */
  function animateSlot(index: number, gust: number, sway: number) {
    const slot = slots[index];
    if (!slot) return;
    const sc = slot.scene;
    sceneFrame[index * 4 + 3] = sc.anchored ? sway * (sc.sway ?? 1) : 0;
    sc.layers.forEach((layer, l) => {
      const i = index * LAYERS_PER_SCENE + l;
      if (sc.anchored) {
        layerOffset.set([0, 0], i * 2);
        return;
      }
      const w = layerWind(animTime, values.wind * layer.wind, gust, l * 17.3 + index * 5.1);
      // Wrap the drift: the masks tile, and small numbers keep the GPU precise.
      const dx = (layer.drift[0] * animTime) % 1;
      const dy = (layer.drift[1] * animTime) % 1;
      // Slow back-and-forth, one cycle roughly every 40s at speed 8.
      const bob = layer.bob ? Math.sin(animTime * 0.6 + l) : 0;
      const bx = (layer.bob?.[0] ?? 0) * bob;
      const by = (layer.bob?.[1] ?? 0) * bob;
      layerOffset.set([dx + w[0] + bx, dy + w[1] + by], i * 2);
    });
  }

  function draw(now: number) {
    frameRequested = false;
    const realDt = Math.max((now - lastFrame) / 1000, 0);
    // Clamp the motion step so a hiccup or returning to the tab never makes
    // the wind jump. Fades use the real clock so they always take as long
    // as they should.
    const dt = Math.min(realDt, 0.1);
    lastFrame = now;
    const playing = view.get().playing;
    if (playing) {
      animTime += dt * values.speed;
      playTime += dt;
    }

    if (slots[1]) {
      fade = Math.min(fade + Math.min(realDt, 0.5) / fadeSeconds, 1);
      if (fade >= 1) finishFade();
    }
    // Ease in and out so the crossfade has no visible start or stop.
    const mix = fade * fade * (3 - 2 * fade);

    const reveal = !maskReady
      ? 0
      : reducedMotion
        ? 1
        : Math.min((now - revealStart) / 1000 / REVEAL_SECONDS, 1);
    // Ease-out so the shadow settles in rather than stopping abruptly.
    const eased = 1 - (1 - reveal) ** 3;

    const wind = sampleWind(animTime, values.wind);
    animateSlot(0, wind.gust, wind.sway);
    animateSlot(1, wind.gust, wind.sway);

    gl.uniform1f(uniforms.time, animTime);
    gl.uniform1f(uniforms.gust, wind.gust);
    gl.uniform2fv(uniforms.layerOffset, layerOffset);
    gl.uniform4fv(uniforms.sceneFrame, sceneFrame);
    gl.uniform1f(uniforms.mix, slots[1] ? mix : 0);
    gl.uniform1f(uniforms.grainSeed, Math.floor(playTime * GRAIN_FPS) % 997);
    gl.uniform1f(uniforms.reveal, eased);
    lastReveal = eased;
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const settling = reveal < 1 || slots[1] !== null;
    if (playing || settling) requestFrame();
  }

  let lastReveal = 0;

  /**
   * Draws the exact frame that's on screen (same wind, same crossfade, same
   * grain) into an offscreen framebuffer at the requested size. A framebuffer
   * is an invisible canvas on the GPU: the live preview is never touched.
   */
  function renderStill(width: number, height: number): ImageData {
    const target = gl.createTexture()!;
    gl.activeTexture(UPLOAD_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);

    try {
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Could not create an offscreen image of this size');
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uniforms.resolution, width, height);
      // A still should always show the shadow fully, even mid fade-in.
      gl.uniform1f(uniforms.reveal, 1);

      gl.enable(gl.SCISSOR_TEST);
      for (let y = 0; y < height; y += EXPORT_STRIP) {
        gl.scissor(0, y, width, Math.min(EXPORT_STRIP, height - y));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.flush();
      }
      gl.disable(gl.SCISSOR_TEST);

      const pixels = new Uint8ClampedArray(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // The GPU stores rows bottom-up; images are top-down. Flip in place.
      const row = width * 4;
      const tmp = new Uint8ClampedArray(row);
      for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
        tmp.set(pixels.subarray(top * row, top * row + row));
        pixels.copyWithin(top * row, bottom * row, bottom * row + row);
        pixels.set(tmp, bottom * row);
      }
      return new ImageData(pixels, width, height);
    } finally {
      // Put everything back the way the live preview expects it.
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(target);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.reveal, lastReveal);
    }
  }

  let frameId = 0;
  function requestFrame() {
    if (!frameRequested && !document.hidden) {
      frameRequested = true;
      frameId = requestAnimationFrame(draw);
    }
  }

  applySettings(store.get());
  // Slider changes go straight to the GPU and draw on the very next frame.
  store.subscribe((s) => {
    applySettings(s);
    requestFrame();
  });

  view.subscribe(() => {
    // Resuming after a pause should continue smoothly, not catch up.
    lastFrame = performance.now();
    requestFrame();
  });

  // Resizing a canvas wipes it. Redraw right away (resize callbacks run
  // before the screen updates) so it never flashes black, e.g. while the
  // frame animates between aspect ratios.
  new ResizeObserver(() => {
    resize();
    if (frameRequested) {
      cancelAnimationFrame(frameId);
      frameRequested = false;
    }
    draw(performance.now());
  }).observe(canvas);

  // The browser already stops animation frames in hidden tabs; this just
  // restarts the loop cleanly when the tab comes back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastFrame = performance.now();
      requestFrame();
    }
  });

  resize();
  bindSlot(0);
  bindSlot(1);
  requestFrame();

  if (requested) showScene(requested, requestedId);
  // Warm up the other presets in the background so switching is instant.
  // (Failures here are fine: they're retried when the preset is picked.)
  if (preload) presetOrder.forEach((id) => loadScene(presets[id].scene).catch(() => {}));

  const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  return {
    maxExportSize: Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), dims[0], dims[1]),
    renderStill,
    setCustom,
    updateCustomMask,
    clearCustom,
  };
}
