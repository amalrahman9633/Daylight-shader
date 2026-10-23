// The embeddable player: the same engine as the site, with no interface.
// It's built into one script (src/generated/player.js) that "Copy code"
// pastes into the snippet, so embeds always look exactly like the preview.

import type { MaskName, SceneConfig } from './presets';
import { createRenderer } from './renderer';
import { createStore, type Settings, type View } from './state';

export interface PlayerConfig {
  settings: Settings;
  /** Mask images as data URLs, keyed by mask name ('custom' for uploads). */
  masks: Record<string, string>;
  /** Only for custom uploads: the scene built from the upload's options. */
  scene?: SceneConfig;
}

export function mount(el: HTMLElement, config: PlayerConfig) {
  // The canvas sits behind anything placed inside the element.
  el.style.isolation = 'isolate';
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.style.backgroundColor = config.settings.background;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    zIndex: '-1',
    pointerEvents: 'none',
  });
  el.prepend(canvas);

  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) {
    // No WebGL: the plain background color is a calm fallback.
    canvas.remove();
    return;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = createStore<Settings>(config.settings);
  const view = createStore<View>({ playing: !reducedMotion, ratio: '16:9' });

  const renderer = createRenderer({
    canvas,
    gl,
    store,
    view,
    onError: () => {},
    maskUrl: (name: MaskName) => config.masks[name] ?? '',
    preload: false,
  });

  if (config.settings.preset === 'custom' && config.scene && config.masks.custom) {
    const img = new Image();
    img.onload = () => renderer.setCustom(img, config.scene!);
    img.src = config.masks.custom;
  }

  // Don't spend battery animating what nobody can see.
  if (!reducedMotion && 'IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => view.set({ playing: entry.isIntersecting })).observe(el);
  }
}
